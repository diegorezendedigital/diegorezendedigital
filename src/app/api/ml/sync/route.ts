import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, getConnection, mlGet } from "@/lib/server/ml";

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

// Importa pedidos pagos do Mercado Livre como vendas (e cria os produtos que ainda não existem).
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

    // 1) Produtos: cria os que ainda não existem (custo começa em 0, você preenche depois).
    const itens = new Map<string, OrderItem>();
    orders.forEach((o) => o.order_items.forEach((oi) => itens.set(oi.item.id, oi)));
    const itemIds = Array.from(itens.keys());

    let produtosCriados = 0;
    const produtos = new Map<string, { id: string; cost_price: number }>();
    if (itemIds.length) {
      const { data: existentes } = await admin
        .from("products")
        .select("id, external_id, cost_price")
        .eq("store_id", storeId)
        .in("external_id", itemIds);
      (existentes ?? []).forEach((p) => produtos.set(p.external_id as string, { id: p.id, cost_price: Number(p.cost_price) }));

      const novos = itemIds
        .filter((id) => !produtos.has(id))
        .map((id) => {
          const oi = itens.get(id) as OrderItem;
          return {
            store_id: storeId,
            external_id: id,
            name: oi.item.title || id,
            sku: oi.item.seller_sku || null,
            cost_price: 0,
            sale_price: Number(oi.unit_price) || 0,
            marketplace_id: MARKETPLACE_ID,
          };
        });
      if (novos.length) {
        const { data: criados, error } = await admin
          .from("products")
          .upsert(novos, { onConflict: "store_id,external_id", ignoreDuplicates: true })
          .select("id, external_id, cost_price");
        if (error) throw new Error(error.message);
        (criados ?? []).forEach((p) => produtos.set(p.external_id as string, { id: p.id, cost_price: Number(p.cost_price) }));
        produtosCriados = criados?.length ?? 0;
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
        const prod = produtos.get(oi.item.id);
        return {
          store_id: storeId,
          product_id: prod?.id ?? null,
          marketplace_id: MARKETPLACE_ID,
          quantity: q,
          sale_price: (Number(oi.unit_price) || 0) * q,
          cost_price: (prod?.cost_price ?? 0) * q,
          fees_total: (Number(oi.sale_fee) || 0) * q,
          shipping_cost: idx === 0 ? frete.get(o.id) ?? 0 : 0,
          tax_amount: 0,
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
      products_created: produtosCriados,
      total,
      next_offset: proximo,
      has_more: temMais,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao sincronizar" }, { status: 500 });
  }
}
