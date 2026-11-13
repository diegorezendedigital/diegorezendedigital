import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { signState } from "@/lib/server/ml";
import { urlAutorizacao } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";

// Devolve o link de autorização da Shopee para a conta logada.
export async function POST(req: Request) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json({ url: urlAutorizacao(signState(user.id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
