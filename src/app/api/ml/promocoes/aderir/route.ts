import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlPost } from "@/lib/server/ml";
import { corpoDeEntrada, itemNaPromocao, precisaOferta } from "@/lib/server/promocoes-motor";

export const dynamic = "force-dynamic";

// Coloca um anúncio numa promoção. body: { ml_user_id, item_id, promotion_id, promotion_type, deal_price?, offer_id?, stock? }
// Cada tipo de promoção pede um corpo diferente: oferta pronta do ML (offer_id), preço escolhido (deal_price) ou só o aceite.
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
    let offerId: string | null = b.offer_id ? String(b.offer_id) : null;
    let temFaixa = false;
    let estoque: number | null = Number(b.stock) > 0 ? Number(b.stock) : null;
    // A oferta (offer_id) e a faixa de preço vêm do próprio convite
    const convite = await itemNaPromocao(token, promo, itemId).catch(() => null);
    if (convite) {
      offerId = offerId || convite.offer_id || null;
      temFaixa = convite.min_discounted_price != null && convite.max_discounted_price != null;
      // Relâmpago: sem estoque informado, reserva o mínimo que o Mercado Livre pede
      if (estoque == null && convite.stock?.min != null && Number(convite.stock.min) > 0) estoque = Number(convite.stock.min);
    }
    if (precisaOferta(promo.type) && !offerId) return NextResponse.json({ error: "O Mercado Livre não informou a oferta deste convite (offer_id). Atualize a lista e tente de novo." }, { status: 400 });
    const preco = Number(b.deal_price);
    const corpo = corpoDeEntrada(promo, { offerId, preco: Number.isFinite(preco) && preco > 0 ? preco : null, temFaixa, estoque });
    const r = await mlPost(token, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, corpo);
    return NextResponse.json({ ok: true, resposta: r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
