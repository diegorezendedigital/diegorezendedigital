import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, shopeePost, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ModeloDesc = { model_id: number; model_name?: string; model_original_price?: number; model_promotion_price?: number; model_normal_stock?: number; model_promotion_stock?: number };
type ItemDesc = {
  item_id: number; item_name?: string; purchase_limit?: number; item_original_price?: number; item_promotion_price?: number;
  normal_stock?: number; promotion_stock?: number; model_list?: ModeloDesc[];
};

const erro = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

// GET ?shop_id=&discount_id= → produtos da promoção de desconto (uma linha por variação)
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const u = new URL(req.url);
  const shopId = u.searchParams.get("shop_id") ?? "";
  const id = Number(u.searchParams.get("discount_id"));
  const token = await tokenShopee(user.id, shopId);
  if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
  try {
    const itens: ItemDesc[] = [];
    let info: Record<string, unknown> = {};
    for (let page_no = 1; page_no <= 20; page_no++) {
      const r = await shopeeGet<{ response?: Record<string, unknown> & { item_list?: ItemDesc[]; more?: boolean } }>(
        token, shopId, "/api/v2/discount/get_discount", { discount_id: id, page_no, page_size: 100 }
      );
      info = r.response ?? {};
      itens.push(...(r.response?.item_list ?? []));
      if (!r.response?.more) break;
    }
    type Linha = { item_id: number; model_id: number | null; nome: string; variacao: string | null; preco_original: number; preco_promo: number; estoque: number; limite_compra: number };
    const linhas = itens.flatMap((it): Linha[] =>
      it.model_list?.length
        ? it.model_list.map((m) => ({
            item_id: it.item_id, model_id: m.model_id, nome: it.item_name ?? String(it.item_id), variacao: m.model_name ?? null,
            preco_original: Number(m.model_original_price) || 0, preco_promo: Number(m.model_promotion_price) || 0,
            estoque: Number(m.model_promotion_stock ?? m.model_normal_stock) || 0, limite_compra: Number(it.purchase_limit) || 0,
          }))
        : [{
            item_id: it.item_id, model_id: null, nome: it.item_name ?? String(it.item_id), variacao: null,
            preco_original: Number(it.item_original_price) || 0, preco_promo: Number(it.item_promotion_price) || 0,
            estoque: Number(it.promotion_stock ?? it.normal_stock) || 0, limite_compra: Number(it.purchase_limit) || 0,
          }]
    );
    return NextResponse.json({ nome: info.discount_name, inicio: info.start_time, fim: info.end_time, itens: linhas });
  } catch (e) {
    return erro(e, 500);
  }
}

// POST { shop_id, discount_id, itens: [{ item_id, model_id, preco_promo, limite_compra }] } → muda o preço promocional
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const shopId = String(b.shop_id ?? "");
  const token = await tokenShopee(user.id, shopId);
  if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
  type Mud = { item_id: number; model_id: number | null; preco_promo: number; limite_compra?: number };
  const mud = (b.itens ?? []) as Mud[];
  if (!mud.length) return erro("Nada para salvar");
  const porItem = new Map<number, Mud[]>();
  for (const m of mud) porItem.set(m.item_id, [...(porItem.get(m.item_id) ?? []), m]);
  const item_list = Array.from(porItem.values()).map((g) =>
    g[0].model_id == null
      ? { item_id: g[0].item_id, purchase_limit: g[0].limite_compra ?? 0, item_promotion_price: g[0].preco_promo }
      : { item_id: g[0].item_id, purchase_limit: g[0].limite_compra ?? 0, model_list: g.map((x) => ({ model_id: x.model_id, model_promotion_price: x.preco_promo })) }
  );
  try {
    const r = await shopeePost<{ response?: { error_list?: { item_id: number; model_id?: number; fail_message?: string; fail_error?: string }[] } }>(
      token, shopId, "/api/v2/discount/update_discount_item", { discount_id: Number(b.discount_id), item_list }
    );
    return NextResponse.json({ ok: true, falhas: (r.response?.error_list ?? []).map((x) => ({ item_id: x.item_id, model_id: x.model_id, motivo: x.fail_message || x.fail_error })) });
  } catch (e) {
    return erro(e, 500);
  }
}
