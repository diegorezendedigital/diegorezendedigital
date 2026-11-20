import { NextResponse } from "next/server";
import { apenasMaster, userFromRequest } from "@/lib/server/supabase-admin";
import { signState } from "@/lib/server/ml";
import { urlAutorizacao } from "@/lib/server/tiktok";

export const dynamic = "force-dynamic";

// Devolve o link de autorização da TikTok Shop para a conta logada.
export async function POST(req: Request) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const bloqueio = apenasMaster(user);
    if (bloqueio) return bloqueio;
    return NextResponse.json({ url: urlAutorizacao(signState(user.id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
