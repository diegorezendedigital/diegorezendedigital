import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { authUrl, signState } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Devolve a URL de autorização do Mercado Livre para a loja logada.
export async function POST(req: Request) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json({ url: authUrl(signState(user.id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
