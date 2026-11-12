import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken } from "@/lib/server/ml";
import { freteML } from "@/lib/server/frete-ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Frete real de cada anúncio no PREÇO DA PROMOÇÃO (o custo do frete muda por faixa de preço).
// body: { consultas: [{ ml_user_id, item_id, price }] } → { fretes: { "MLB123|99.90": 12.35 } }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    const lista: { ml_user_id: string; item_id: string; price: number }[] = Array.isArray(b.consultas) ? b.consultas.slice(0, 80) : [];
    const tokens = new Map<string, string | null>();
    const fretes: Record<string, number> = {};
    let falhas = 0;
    for (let i = 0; i < lista.length; i += 8) {
      await Promise.all(
        lista.slice(i, i + 8).map(async (c) => {
          if (!tokens.has(c.ml_user_id)) tokens.set(c.ml_user_id, await getAccessToken(user.id, String(c.ml_user_id)).catch(() => null));
          const token = tokens.get(c.ml_user_id);
          if (!token) return;
          const v = await freteML(token, String(c.ml_user_id), String(c.item_id), Number(c.price));
          if (v != null) fretes[`${c.item_id}|${Number(c.price).toFixed(2)}`] = v;
          else falhas++;
        })
      );
    }
    return NextResponse.json({ fretes, falhas });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
