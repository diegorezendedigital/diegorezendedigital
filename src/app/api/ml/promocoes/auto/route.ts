import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { rodarPromocoesAutomaticas } from "@/lib/server/promocoes-auto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Roda agora a participação automática em promoções (a mesma que roda todo dia).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    return NextResponse.json(await rodarPromocoesAutomaticas(supabaseAdmin(), user.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
