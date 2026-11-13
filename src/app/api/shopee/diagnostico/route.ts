import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { diagnosticoShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";

// Confere a configuração da Shopee sem revelar a chave (só tamanho e tipo).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json(diagnosticoShopee());
}
