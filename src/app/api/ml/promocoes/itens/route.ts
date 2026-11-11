import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ItemBruto = {
  id?: string;
  status?: string;
  price?: number;
  original_price?: number;
  min_discounted_price?: number;
  max_discounted_price?: number;
  suggested_discounted_price?: number;
  start_date?: string;
  end_date?: string;
  meli_percentage?: number;
  seller_percentage?: number;
};

// Anúncios de uma promoção: quais podem entrar (candidatos), já estão dentro ou aguardam, com a faixa de preço permitida.
// body: { ml_user_id, promotion_id, promotion_type, search_after? }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.ml_user_id || !b.promotion_id || !b.promotion_type) return NextResponse.json({ error: "Informe a conta e a promoção" }, { status: 400 });
    const token = await getAccessToken(user.id, String(b.ml_user_id));
    if (!token) return NextResponse.json({ error: "Conta sem acesso: reconecte em Integrações." }, { status: 400 });

    const q = new URLSearchParams({ promotion_type: String(b.promotion_type), app_version: "v2", limit: "50" });
    if (b.search_after) q.set("search_after", String(b.search_after));
    const r = await mlGet<{ results?: ItemBruto[]; paging?: { total?: number; searchAfter?: string; search_after?: string } }>(
      token,
      `/seller-promotions/promotions/${encodeURIComponent(String(b.promotion_id))}/items?${q}`
    );
    return NextResponse.json({
      itens: (r.results ?? []).map((i) => ({
        id: i.id ?? "",
        status: i.status ?? "",
        price: i.price ?? null,
        original_price: i.original_price ?? null,
        min_price: i.min_discounted_price ?? null,
        max_price: i.max_discounted_price ?? null,
        suggested_price: i.suggested_discounted_price ?? null,
        start_date: i.start_date ?? null,
        end_date: i.end_date ?? null,
        meli_percentage: i.meli_percentage ?? null,
      })),
      total: r.paging?.total ?? null,
      search_after: r.paging?.searchAfter ?? r.paging?.search_after ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
