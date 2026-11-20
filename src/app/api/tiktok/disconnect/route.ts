import { NextResponse } from "next/server";
import { apenasMaster, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

// Remove a loja da TikTok Shop (vendas já importadas continuam guardadas)
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = apenasMaster(user);
  if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  const { error } = await supabaseAdmin().from("tiktok_connections").delete().eq("store_id", user.id).eq("shop_id", String(b.shop_id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
