import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlDelete } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Tira um anúncio de uma promoção. body: { ml_user_id, item_id, promotion_id, promotion_type }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.ml_user_id || !b.item_id || !b.promotion_id || !b.promotion_type) return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    const token = await getAccessToken(user.id, String(b.ml_user_id));
    if (!token) return NextResponse.json({ error: "Conta sem acesso: reconecte em Integrações." }, { status: 400 });
    const q = new URLSearchParams({ promotion_type: String(b.promotion_type), promotion_id: String(b.promotion_id), app_version: "v2" });
    await mlDelete(token, `/seller-promotions/items/${encodeURIComponent(String(b.item_id))}?${q}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
