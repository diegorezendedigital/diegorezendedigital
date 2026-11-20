import crypto from "crypto";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

// TikTok Shop Open API (versões 202309). Assinatura HMAC-SHA256 com o app secret.
const API = "https://open-api.tiktokglobalshop.com";
const AUTH = "https://auth.tiktok-shops.com";
const AUTORIZAR = "https://services.tiktokshop.com/open/authorize";

function credenciais() {
  const key = process.env.TIKTOK_APP_KEY;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!key || !secret) throw new Error("Chaves do app TikTok Shop não configuradas (TIKTOK_APP_KEY / TIKTOK_APP_SECRET).");
  return { key, secret };
}

// Link para o vendedor autorizar o app (o ID do serviço aparece no Partner Center)
export function urlAutorizacao(state: string) {
  const servico = process.env.TIKTOK_SERVICE_ID || "7708082206992353044";
  return `${AUTORIZAR}?service_id=${servico}&state=${encodeURIComponent(state)}`;
}

export type TokensTikTok = {
  access_token: string;
  access_token_expire_in: number; // data em segundos (epoch)
  refresh_token: string;
  refresh_token_expire_in: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
};

async function chamarAuth(params: Record<string, string>): Promise<TokensTikTok> {
  const { key, secret } = credenciais();
  const q = new URLSearchParams({ app_key: key, app_secret: secret, ...params });
  const r = await fetch(`${AUTH}/api/v2/token/${params.grant_type === "refresh_token" ? "refresh" : "get"}?${q}`, { signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: TokensTikTok };
  if (!r.ok || j.code !== 0 || !j.data?.access_token) throw new Error(`TikTok Shop: ${j.message || r.status}`);
  return j.data;
}

export const trocarCodigo = (code: string) => chamarAuth({ auth_code: code, grant_type: "authorized_code" });
export const renovarToken = (refresh: string) => chamarAuth({ refresh_token: refresh, grant_type: "refresh_token" });

// Assinatura: secret + path + (chaves ordenadas: chave+valor, sem sign/access_token) + corpo + secret
function assinar(path: string, query: Record<string, string>, corpo: string, secret: string) {
  const base = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  return crypto.createHmac("sha256", secret).update(`${secret}${path}${base}${corpo}${secret}`).digest("hex");
}

export async function ttsRequest<T = Record<string, unknown>>(
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  token: string,
  opts: { query?: Record<string, string | number>; body?: unknown; shopCipher?: string | null } = {}
): Promise<T> {
  const { key, secret } = credenciais();
  const query: Record<string, string> = { app_key: key, timestamp: String(Math.floor(Date.now() / 1000)) };
  for (const [k, v] of Object.entries(opts.query ?? {})) query[k] = String(v);
  if (opts.shopCipher) query.shop_cipher = opts.shopCipher;
  const corpo = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  query.sign = assinar(path, query, corpo, secret);
  const r = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
    method: metodo,
    headers: { "content-type": "application/json", "x-tts-access-token": token },
    body: corpo || undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
  if (!r.ok || (j.code !== undefined && j.code !== 0)) throw new Error(`TikTok Shop: ${j.message || r.status}${j.code ? ` [${j.code}]` : ""}`);
  return (j.data ?? {}) as T;
}

export type LojaAutorizada = { id: string; name?: string; region?: string; cipher?: string; code?: string; seller_type?: string };

export async function lojasAutorizadas(token: string): Promise<LojaAutorizada[]> {
  const d = await ttsRequest<{ shops?: LojaAutorizada[] }>("GET", "/authorization/202309/shops", token);
  return d.shops ?? [];
}

export async function guardarConexao(storeId: string, t: TokensTikTok, lojas: LojaAutorizada[]) {
  const admin = supabaseAdmin();
  await admin.from("stores").upsert({ id: storeId, name: "Minha Loja" }, { onConflict: "id", ignoreDuplicates: true });
  if (!lojas.length) throw new Error("A autorização não trouxe nenhuma loja da TikTok Shop.");
  const linhas = lojas.map((l) => ({
    store_id: storeId,
    shop_id: String(l.id),
    shop_name: l.name ?? null,
    shop_cipher: l.cipher ?? null,
    shop_code: l.code ?? null,
    region: l.region ?? t.seller_base_region ?? null,
    open_id: t.open_id ?? null,
    seller_name: t.seller_name ?? null,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.access_token_expire_in * 1000).toISOString(),
    refresh_expires_at: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
    connected_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("tiktok_connections").upsert(linhas, { onConflict: "store_id,shop_id" });
  if (error) throw new Error(error.message);
}

// Acesso válido da loja: renova sozinho quando falta menos de 1 hora
export async function tokenTikTok(storeId: string, shopId: string): Promise<{ token: string; cipher: string | null } | null> {
  const admin = supabaseAdmin();
  const { data: c } = await admin.from("tiktok_connections").select("*").eq("store_id", storeId).eq("shop_id", shopId).maybeSingle();
  if (!c) return null;
  if (new Date(c.expires_at as string).getTime() - Date.now() > 3600_000) return { token: c.access_token as string, cipher: (c.shop_cipher as string) ?? null };
  const t = await renovarToken(c.refresh_token as string);
  await admin
    .from("tiktok_connections")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(t.access_token_expire_in * 1000).toISOString(),
      ...(t.refresh_token_expire_in ? { refresh_expires_at: new Date(t.refresh_token_expire_in * 1000).toISOString() } : {}),
    })
    .eq("store_id", storeId)
    .eq("open_id", c.open_id as string);
  return { token: t.access_token, cipher: (c.shop_cipher as string) ?? null };
}
