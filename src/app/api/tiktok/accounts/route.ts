import { NextResponse } from "next/server";
import { masterOuIntegracoes, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

// GET: lojas da TikTok Shop conectadas (sem tokens). PATCH { shop_id, store_name?, company_id? }
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("tiktok_connections")
    .select("shop_id, shop_name, store_name, seller_name, region, company_id, connected_at, refresh_expires_at, last_synced_at")
    .eq("store_id", user.id)
    .order("connected_at");
  if (error) return NextResponse.json({ accounts: [], precisaSQL: /tiktok_connections/.test(error.message) });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function PATCH(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = masterOuIntegracoes(user);
  if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  const upd: Record<string, unknown> = {};
  if ("store_name" in b) upd.store_name = String(b.store_name ?? "").trim() || null;
  if ("company_id" in b) upd.company_id = b.company_id || null;
  const { error } = await supabaseAdmin().from("tiktok_connections").update(upd).eq("store_id", user.id).eq("shop_id", String(b.shop_id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
