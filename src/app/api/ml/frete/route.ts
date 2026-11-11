import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { atualizarFretes } from "@/lib/server/frete";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Puxa do Mercado Livre o frete de cada anúncio.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await atualizarFretes(user.id, { forcar: !!body.forcar, consultarML: true }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao puxar o frete" }, { status: 500 });
  }
}
