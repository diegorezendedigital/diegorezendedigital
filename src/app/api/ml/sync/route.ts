import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, getConnection, mlGet } from "@/lib/server/ml";
import { calcularLucro } from "@/lib/pricing";
import type { Company, Product } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 25; // pedidos por chamada; a tela repete a chamada até terminar
const MARKETPLACE_ID = "mercado_livre";

type OrderItem = {
  item: { id: string; title?: string; seller_sku?: string | null };
  quantity: number;
  unit_price: number;
  sale_fee?: number;
};
type Order = {
  id: number;
  date_created: string;
  shipping?: { id?: number | null };
  order_items: OrderItem[];
};

// Importa pedidos pagos do Mercado Livre como vendas. Cada item vira (ou usa) um anúncio; o custo vem do
// produto do armazém ligado ao anúncio e o imposto, do regime do CNPJ do anúncio.
// Pode ser repetido à vontade: cada venda tem um external_id único e não é duplicada.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const storeId = user.id;
    const conn = await getConnection(storeId);
    if (!conn) return NextResponse.json({ error: "Conecte sua conta do Mercado Livre primeiro" }, { status: 400 });
    const token = await getAccessToken(storeId);
    if (!token) return NextResponse.json({ error: "Conexão com o Mercado Livre expirada" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 30, 1), 90);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);

    const params = new URLSearchParams({
      seller: String(conn.ml_user_id),
      "order.status": "paid",
      "order.date_created.from": from.toISOString().replace("Z", "-00:00"),
      sort: "date_asc",
      limit: String(PAGE),
      offset: String(offset),
    });
    const data = await mlGet<{ results?: Order[]; paging?: { total?: number } }>(token, `/orders/search?${params}`);
    const orders = data.results ?? [];
    const total = data.paging?.total ?? orders.length;

    const admin = supabaseAdmin();

    // 1) Anúncios: cria os que ainda não existem (ligados ao produto de mesmo SKU e ao CNPJ padrão).
    const itens = new Map<string, OrderItem>();
    orders.forEach((o) => o.order_items.forEach((oi) => itens.set(oi.item.id, oi)));
    const itemIds = Array.from(itens.keys());

    type Anuncio = { id: string; product_id: string | null; company_id: string | null; units: number };
    let anunciosCriados = 0;
    const anuncios = new Map<string, Anuncio>();
    const produtos = new Map<string, Product>();
    const empresas = new Map<string, Company>();
    let empresaPadrao: Company | null = null;

    if (itemIds.length) {
      const { data: emps } = await admin.from("companies").select("*").eq("store_id", storeId);
      ((emps ?? []) as Company[]).forEach((c) => {
        empresas.set(c.id, c);
        if (c.is_default) empresaPadrao = c;
      });

      const { data: existentes } = await admin
        .from("listings")
        .select("id, external_id, product_id, company_id, units")
        .eq("store_id", storeId)
        .in("external_id", itemIds);
      (existentes ?? []).forEach((l) =>
        anuncios.set(l.external_id as string, { id: l.id, product_id: l.product_id, company_id: l.company_id, units: Number(l.units) || 1 })
      );

      const faltam = itemIds.filter((id) => !anuncios.has(id));
      if (faltam.length) {
        const skus = faltam.map((id) => itens.get(id)?.item.seller_sku || "").filter(Boolean);
        const porSku = new Map<string, string>();
        if (skus.length) {
          const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", storeId).in("sku", skus);
          (prods ?? []).forEach((p) => porSku.set(p.sku as string, p.id as string));
        }
        const novos = faltam.map((id) => {
          const oi = itens.get(id) as OrderItem;
          return {
            store_id: storeId,
            marketplace_id: MARKETPLACE_ID,
            external_id: id,
            title: oi.item.title || id,
            price: Number(oi.unit_price) || 0,
            product_id: (oi.item.seller_sku && porSku.get(oi.item.seller_sku)) || null,
            company_id: (empresaPadrao as Company | null)?.id ?? null,
          };
        });
        const { data: criados, error } = await admin
          .from("listings")
          .upsert(novos, { onConflict: "store_id,external_id", ignoreDuplicates: true })
          .select("id, external_id, product_id, company_id, units");
        if (error) throw new Error(error.message);
        (criados ?? []).forEach((l) =>
          anuncios.set(l.external_id as string, { id: l.id, product_id: l.product_id, company_id: l.company_id, units: Number(l.units) || 1 })
        );
        anunciosCriados = criados?.length ?? 0;
      }

      const prodIds = Array.from(new Set(Array.from(anuncios.values()).map((a) => a.product_id).filter(Boolean))) as string[];
      if (prodIds.length) {
        const { data: prods } = await admin.from("products").select("*").in("id", prodIds);
        ((prods ?? []) as Product[]).forEach((p) => produtos.set(p.id, p));
      }
    }

    // 2) Frete que o vendedor paga em cada pedido (melhor esforço: se falhar, fica 0).
    const frete = new Map<number, number>();
    for (let i = 0; i < orders.length; i += 5) {
      await Promise.all(
        orders.slice(i, i + 5).map(async (o) => {
          const shipId = o.shipping?.id;
          if (!shipId) return;
          try {
            const c = await mlGet<{ senders?: { cost?: number }[] }>(token, `/shipments/${shipId}/costs`);
            frete.set(o.id, Number(c.senders?.[0]?.cost) || 0);
          } catch {
            /* mantém 0 */
          }
        })
      );
    }

    // 3) Vendas: uma linha por item do pedido (preço, custo e taxa já multiplicados pela quantidade).
    const vendas = orders.flatMap((o) =>
      o.order_items.map((oi, idx) => {
        const q = Number(oi.quantity) || 1;
        const an = anuncios.get(oi.item.id);
        const prod = an?.product_id ? produtos.get(an.product_id) : undefined;
        const unidades = (an?.units ?? 1) * q;
        const custo = (prod ? Number(prod.cost_price) : 0) * unidades;
        const credito = prod ? (Number(prod.icms_credit) + Number(prod.pis_credit) + Number(prod.cofins_credit)) * unidades : 0;
        const empresa = (an?.company_id && empresas.get(an.company_id)) || (empresaPadrao as Company | null);
        const preco = (Number(oi.unit_price) || 0) * q;
        const taxa = (Number(oi.sale_fee) || 0) * q;
        const freteVenda = idx === 0 ? frete.get(o.id) ?? 0 : 0;
        const imposto = empresa
          ? Math.max(0, calcularLucro(preco, { custo, credito, feePct: 0, feeFixo: taxa, frete: freteVenda, empresa }).impostos)
          : 0;
        return {
          store_id: storeId,
          product_id: prod?.id ?? null,
          listing_id: an?.id ?? null,
          marketplace_id: MARKETPLACE_ID,
          quantity: q,
          sale_price: preco,
          cost_price: custo,
          fees_total: taxa,
          shipping_cost: freteVenda,
          tax_amount: Math.round(imposto * 100) / 100,
          sold_at: o.date_created,
          external_id: `${o.id}:${oi.item.id}`,
        };
      })
    );

    let importadas = 0;
    if (vendas.length) {
      const { data: inseridas, error } = await admin
        .from("sales")
        .upsert(vendas, { onConflict: "store_id,external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      importadas = inseridas?.length ?? 0;
    }

    const proximo = offset + orders.length;
    const temMais = orders.length > 0 && proximo < total;
    if (!temMais) {
      await admin.from("ml_connections").update({ last_synced_at: new Date().toISOString() }).eq("store_id", storeId);
    }

    return NextResponse.json({
      processed: orders.length,
      imported: importadas,
      listings_created: anunciosCriados,
      total,
      next_offset: proximo,
      has_more: temMais,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao sincronizar" }, { status: 500 });
  }
}
