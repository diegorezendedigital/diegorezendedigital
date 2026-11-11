import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORÁRIO: testa quais consultas do Mercado Livre devolvem comissão e frete de um anúncio (mesmo sem vendas).
// Devolve o resultado cru para eu descobrir o endereço certo; será removido depois.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const admin = supabaseAdmin();
    let q = admin.from("listings").select("external_id, ml_user_id, price, category_id, listing_type_id, title").eq("store_id", user.id).eq("marketplace_id", "mercado_livre");
    if (body.external_id) q = q.eq("external_id", String(body.external_id));
    const { data } = await q.limit(2);
    const saida: { item: string; titulo: string; chamadas: { caminho: string; status: number; corpo: string }[] }[] = [];

    for (const l of data ?? []) {
      const token = await getAccessToken(user.id, l.ml_user_id as string | null);
      if (!token) continue;
      const uid = l.ml_user_id;
      const id = l.external_id;
      const caminhos = [
        `/users/${uid}/shipping_options/free?item_id=${id}&verbose=true`,
        `/users/${uid}/shipping_options/free?item_id=${id}`,
        `/items/${id}/shipping_options?zip_code=01310100`,
        `/items/${id}?attributes=id,price,category_id,listing_type_id,shipping,attributes`,
        `/sites/MLB/listing_prices?price=${l.price}&category_id=${l.category_id ?? ""}&listing_type_id=${l.listing_type_id ?? ""}`,
        `/users/${uid}/shipping_preferences`,
      ];
      const chamadas = [];
      for (const c of caminhos) {
        try {
          const r = await fetch(`https://api.mercadolibre.com${c}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          const texto = (await r.text()).slice(0, 1800);
          chamadas.push({ caminho: c, status: r.status, corpo: texto });
        } catch (e) {
          chamadas.push({ caminho: c, status: 0, corpo: e instanceof Error ? e.message : "erro" });
        }
      }
      saida.push({ item: id as string, titulo: l.title as string, chamadas });
    }
    console.log("[diag-frete]", JSON.stringify(saida));
    return NextResponse.json({ resultado: saida });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
