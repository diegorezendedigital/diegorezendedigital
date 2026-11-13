import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeEhTeste } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";

// Lista das lojas Shopee conectadas (sem tokens).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("shopee_connections")
    .select("shop_id, shop_name, region, host, store_name, company_id, connected_at, refresh_expires_at, last_synced_at")
    .eq("store_id", user.id)
    .order("connected_at");
  if (error) {
    const falta = /shopee_connections|schema cache|does not exist/i.test(error.message);
    return NextResponse.json({ accounts: [], precisaSQL: falta, error: falta ? undefined : error.message });
  }
  return NextResponse.json({
    accounts: (data ?? []).map((c) => ({
      shop_id: c.shop_id,
      shop_name: c.shop_name,
      store_name: c.store_name,
      region: c.region,
      company_id: c.company_id,
      connected_at: c.connected_at,
      last_synced_at: c.last_synced_at,
      teste: shopeeEhTeste((c.host as string | null) ?? undefined),
      status: !c.refresh_expires_at || new Date(c.refresh_expires_at).getTime() > Date.now() ? "ativo" : "reconectar",
    })),
  });
}

// Renomear a loja ou ligar a um CNPJ
export async function PATCH(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const shopId = String(b.shop_id || "");
  if (!shopId) return NextResponse.json({ error: "Informe a loja" }, { status: 400 });
  const campos: Record<string, unknown> = {};
  if ("store_name" in b) campos.store_name = String(b.store_name ?? "").trim().slice(0, 80) || null;
  if ("company_id" in b) campos.company_id = b.company_id ? String(b.company_id) : null;
  const { error } = await supabaseAdmin().from("shopee_connections").update(campos).eq("store_id", user.id).eq("shop_id", shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
