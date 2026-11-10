import crypto from "crypto";
import { supabaseAdmin } from "./supabase-admin";

export const ML_API = "https://api.mercadolibre.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

/* ---------- "state" assinado do OAuth (liga o retorno do ML à loja certa e evita CSRF) ---------- */
function hmac(payload: string): string {
  return crypto.createHmac("sha256", env("ML_STATE_SECRET")).update(payload).digest("base64url");
}

export function signState(storeId: string): string {
  const payload = Buffer.from(JSON.stringify({ s: storeId, e: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verifyState(state: string | null): string | null {
  if (!state) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { s, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof s === "string" && typeof e === "number" && e > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function authUrl(state: string): string {
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env("ML_CLIENT_ID"));
  url.searchParams.set("redirect_uri", env("ML_REDIRECT_URI"));
  url.searchParams.set("state", state);
  return url.toString();
}

/* ---------- Tokens ---------- */
type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      ...params,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Falha no OAuth do Mercado Livre: ${json?.message || res.status}`);
  return json as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env("ML_REDIRECT_URI") });
}

export async function getConnection(storeId: string) {
  const { data } = await supabaseAdmin().from("ml_connections").select("*").eq("store_id", storeId).maybeSingle();
  return data;
}

// Devolve um access_token válido; renova (e guarda o novo refresh_token) se faltar menos de 2 min.
export async function getAccessToken(storeId: string): Promise<string | null> {
  const conn = await getConnection(storeId);
  if (!conn) return null;
  if (new Date(conn.expires_at).getTime() - Date.now() > 120000) return conn.access_token as string;

  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  await supabaseAdmin()
    .from("ml_connections")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    })
    .eq("store_id", storeId);
  return t.access_token;
}

/* ---------- Chamadas à API ---------- */
export async function mlGet<T = any>(token: string, path: string): Promise<T> {
  const res = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message || `Mercado Livre respondeu ${res.status}`);
  return json as T;
}
