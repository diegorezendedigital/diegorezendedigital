import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

// Remove a loja Shopee. O que já foi importado continua guardado.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const shopId = String(b.shop_id || "");
  if (!shopId) return NextResponse.json({ error: "Informe a loja" }, { status: 400 });
  const { error } = await supabaseAdmin().from("shopee_connections").delete().eq("store_id", user.id).eq("shop_id", shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
