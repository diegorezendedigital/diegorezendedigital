import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Bruto = {
  id?: string;
  type?: string;
  status?: string;
  name?: string;
  price?: number;
  original_price?: number;
  min_discounted_price?: number;
  max_discounted_price?: number;
  suggested_discounted_price?: number;
  start_date?: string;
  finish_date?: string;
  end_date?: string;
  meli_percentage?: number;
  seller_percentage?: number;
};

// Todas as promoções em que cada anúncio está ou pode entrar.
// body: { anuncios: [{ ml_user_id, item_id }] }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    const lista: { ml_user_id: string; item_id: string }[] = Array.isArray(b.anuncios) ? b.anuncios.slice(0, 20) : [];
    const tokens = new Map<string, string | null>();
    const resultado = await Promise.all(
      lista.map(async (a) => {
        try {
          if (!tokens.has(a.ml_user_id)) tokens.set(a.ml_user_id, await getAccessToken(user.id, String(a.ml_user_id)));
          const token = tokens.get(a.ml_user_id);
          if (!token) return { item_id: a.item_id, promocoes: [], erro: "Conta sem acesso" };
          const r = await mlGet<Bruto[] | { results?: Bruto[] }>(token, `/seller-promotions/items/${encodeURIComponent(a.item_id)}?app_version=v2`);
          const arr = Array.isArray(r) ? r : r.results ?? [];
          return {
            item_id: a.item_id,
            promocoes: arr
              .filter((p) => p.id && p.type && p.status !== "finished")
              .map((p) => ({
                promo_id: p.id as string,
                promo_type: p.type as string,
                promo_name: p.name ?? (p.id as string),
                status: p.status ?? "",
                price: p.price ?? null,
                original_price: p.original_price ?? null,
                min_price: p.min_discounted_price ?? null,
                max_price: p.max_discounted_price ?? null,
                suggested_price: p.suggested_discounted_price ?? null,
                start_date: p.start_date ?? null,
                end_date: p.finish_date ?? p.end_date ?? null,
                meli_percentage: p.meli_percentage ?? null,
                seller_percentage: p.seller_percentage ?? null,
              })),
          };
        } catch (e) {
          return { item_id: a.item_id, promocoes: [], erro: e instanceof Error ? e.message : "Erro" };
        }
      })
    );
    return NextResponse.json({ anuncios: resultado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
