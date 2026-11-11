import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, getConnection } from "@/lib/server/ml";
import { carregarContexto, reajustarAnuncio, ResultadoPreco } from "@/lib/server/reprice";
import type { Listing } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Calcula o preço ideal dos anúncios escolhidos. Com apply=true, também altera o preço no Mercado Livre.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.listing_ids) ? body.listing_ids.slice(0, 40) : [];
    const aplicar = body.apply === true;
    if (ids.length === 0) return NextResponse.json({ error: "Escolha pelo menos um anúncio" }, { status: 400 });

    if (!(await getConnection(user.id))) return NextResponse.json({ error: "Conecte sua conta do Mercado Livre primeiro (Integrações)" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data } = await admin.from("listings").select("*").eq("store_id", user.id).in("id", ids);
    const ctx = await carregarContexto(admin, user.id);

    const resultados: ResultadoPreco[] = [];
    const tokens = new Map<string, string | null>();
    for (const l of (data ?? []) as Listing[]) {
      // Cada anúncio usa o acesso da conta do Mercado Livre a que pertence.
      const chave = l.ml_user_id ?? "";
      if (!tokens.has(chave)) tokens.set(chave, await getAccessToken(user.id, l.ml_user_id));
      const token = tokens.get(chave);
      if (!token) {
        resultados.push({ listing_id: l.id, external_id: l.external_id, title: l.title, status: "erro", old_price: Number(l.price), motivo: "A conta do Mercado Livre deste anúncio não está conectada." });
        continue;
      }
      resultados.push(await reajustarAnuncio(admin, token, l, ctx, aplicar));
    }
    return NextResponse.json({ results: resultados });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao calcular preços" }, { status: 500 });
  }
}
