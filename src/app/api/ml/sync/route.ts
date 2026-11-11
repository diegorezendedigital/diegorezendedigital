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
// Pode ser repetido à vontade: cada venda tem um external_id único; repetir só completa dados (estado, produto); o custo e o imposto de vendas já gravadas não mudam.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const storeId = user.id;
    const body = await req.json().catch(() => ({}));
    const conn = await getConnection(storeId, body.ml_user_id ? String(body.ml_user_id) : null);
    if (!conn) return NextResponse.json({ error: "Conecte sua conta do Mercado Livre primeiro (Configurações)" }, { status: 400 });
    const token = await getAccessToken(storeId, conn.ml_user_id);
    if (!token) return NextResponse.json({ error: "Conexão com o Mercado Livre expirada" }, { status: 400 });

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
            ml_user_id: conn.ml_user_id,
            title: oi.item.title || id,
            price: Number(oi.unit_price) || 0,
            product_id: (oi.item.seller_sku && porSku.get(oi.item.seller_sku)) || null,
            company_id: conn.company_id ?? (empresaPadrao as Company | null)?.id ?? null,
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

    // Histórico de custo: cada venda usa o custo vigente na data dela (nunca o custo de hoje, se mudou).
    type CustoHist = { product_id: string; cost_price: number; icms_credit: number; pis_credit: number; cofins_credit: number; valid_from: string };
    const historico = new Map<string, CustoHist[]>();
    {
      const ids = Array.from(produtos.keys());
      if (ids.length) {
        const { data: hs } = await admin.from("product_costs").select("*").in("product_id", ids).order("valid_from", { ascending: true });
        ((hs ?? []) as CustoHist[]).forEach((h) => historico.set(h.product_id, [...(historico.get(h.product_id) ?? []), h]));
      }
    }
    const custoEm = (prod: Product, data: string) => {
      const lista = historico.get(prod.id) ?? [];
      const t = new Date(data).getTime();
      const vigente = [...lista].reverse().find((h) => new Date(h.valid_from).getTime() <= t) ?? lista[0];
      return vigente
        ? { custo: Number(vigente.cost_price), credito: Number(vigente.icms_credit) + Number(vigente.pis_credit) + Number(vigente.cofins_credit) }
        : { custo: Number(prod.cost_price), credito: Number(prod.icms_credit) + Number(prod.pis_credit) + Number(prod.cofins_credit) };
    };

    // 2) Frete que o vendedor paga em cada pedido (melhor esforço: se falhar, fica 0).
    const frete = new Map<number, number>();
    const estado = new Map<number, string>();
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
          try {
            const sh = await mlGet<{ receiver_address?: { state?: { id?: string; name?: string } } }>(token, `/shipments/${shipId}`);
            const st = sh.receiver_address?.state;
            const uf = (st?.id || "").replace(/^BR-/, "") || st?.name || "";
            if (uf) estado.set(o.id, uf);
          } catch {
            /* estado fica em branco */
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
        const hist = prod ? custoEm(prod, o.date_created) : { custo: 0, credito: 0 };
        const custo = hist.custo * unidades;
        const credito = hist.credito * unidades;
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
          order_number: String(o.id),
          title: oi.item.title || oi.item.id,
          buyer_state: estado.get(o.id) ?? null,
          ml_user_id: conn.ml_user_id,
        };
      })
    );

    // Vendas que já têm custo gravado ficam congeladas: só recebem os dados do pedido (produto, estado, conta).
    // Vendas novas, ou ainda sem custo, entram completas.
    let importadas = 0;
    if (vendas.length) {
      const { data: ja } = await admin
        .from("sales")
        .select("id, external_id, cost_price")
        .eq("store_id", storeId)
        .in("external_id", vendas.map((v) => v.external_id));
      const existentes = new Map<string, { id: string; cost_price: number }>(
        (ja ?? []).map((x) => [x.external_id as string, { id: x.id as string, cost_price: Number(x.cost_price) }])
      );
      const novas = vendas.filter((v) => {
        const e = existentes.get(v.external_id);
        return !e || Number(e.cost_price) === 0;
      });
      const congeladas = vendas.filter((v) => !novas.includes(v));
      if (novas.length) {
        const { data: inseridas, error } = await admin
          .from("sales")
          .upsert(novas, { onConflict: "store_id,external_id" })
          .select("id");
        if (error) throw new Error(error.message);
        importadas = inseridas?.length ?? 0;
      }
      await Promise.all(
        congeladas.map((v) =>
          admin
            .from("sales")
            .update({ order_number: v.order_number, title: v.title, buyer_state: v.buyer_state, ml_user_id: v.ml_user_id, listing_id: v.listing_id })
            .eq("id", (existentes.get(v.external_id) as { id: string }).id)
        )
      );
    }

    const proximo = offset + orders.length;
    const temMais = orders.length > 0 && proximo < total;
    if (!temMais) {
      await admin
        .from("ml_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .eq("ml_user_id", conn.ml_user_id);
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
    const msg = e instanceof Error ? e.message : "Erro ao sincronizar";
    if (/UNAUTHORIZED|forbidden/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "O Mercado Livre negou o acesso aos pedidos. No DevCenter do seu aplicativo, em Permissões, ative a leitura de \"Vendas e envios\" (pedidos) e depois desconecte e conecte a conta de novo. (" + msg + ")",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
