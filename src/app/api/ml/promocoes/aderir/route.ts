import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlPost } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Coloca um anúncio numa promoção. body: { ml_user_id, item_id, promotion_id, promotion_type, deal_price? }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.ml_user_id || !b.item_id || !b.promotion_id || !b.promotion_type) return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    const token = await getAccessToken(user.id, String(b.ml_user_id));
    if (!token) return NextResponse.json({ error: "Conta sem acesso: reconecte em Integrações." }, { status: 400 });
    const corpo: Record<string, unknown> = { promotion_id: String(b.promotion_id), promotion_type: String(b.promotion_type) };
    if (b.offer_id) corpo.offer_id = String(b.offer_id);
    const preco = Number(b.deal_price);
    if (Number.isFinite(preco) && preco > 0) corpo.deal_price = Math.round(preco * 100) / 100;
    const r = await mlPost(token, `/seller-promotions/items/${encodeURIComponent(String(b.item_id))}?app_version=v2`, corpo);
    return NextResponse.json({ ok: true, resposta: r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
