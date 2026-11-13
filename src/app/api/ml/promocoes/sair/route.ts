import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlDelete } from "@/lib/server/ml";
import { itemNaPromocao, precisaOferta } from "@/lib/server/promocoes-motor";

export const dynamic = "force-dynamic";

// Tira um anúncio de uma promoção. body: { ml_user_id, item_id, promotion_id, promotion_type, offer_id? }
// Promoções com oferta pronta do ML (ex.: "Impulsione suas vendas") pedem o offer_id da participação.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.ml_user_id || !b.item_id || !b.promotion_id || !b.promotion_type) return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    const token = await getAccessToken(user.id, String(b.ml_user_id));
    if (!token) return NextResponse.json({ error: "Conta sem acesso: reconecte em Integrações." }, { status: 400 });
    const promo = { id: String(b.promotion_id), type: String(b.promotion_type) };
    const itemId = String(b.item_id);
    const q = new URLSearchParams({ promotion_type: promo.type, promotion_id: promo.id, app_version: "v2" });
    let offerId: string | null = b.offer_id ? String(b.offer_id) : null;
    if (!offerId && precisaOferta(promo.type)) offerId = (await itemNaPromocao(token, promo, itemId).catch(() => null))?.offer_id ?? null;
    if (offerId) q.set("offer_id", offerId);
    await mlDelete(token, `/seller-promotions/items/${encodeURIComponent(itemId)}?${q}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
