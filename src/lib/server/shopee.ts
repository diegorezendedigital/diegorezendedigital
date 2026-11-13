import crypto from "crypto";
import { supabaseAdmin } from "./supabase-admin";

// Shopee Open Platform v2. Toda chamada leva uma assinatura HMAC-SHA256:
//   chamada pública:  partner_id + caminho + timestamp
//   chamada da loja:  partner_id + caminho + timestamp + access_token + shop_id
// O servidor padrão é o de TESTE (sandbox). Para produção, defina SHOPEE_HOST na Vercel.
export const HOST_TESTE = "https://partner.test-stable.shopeemobile.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const shopeeHost = () => (process.env.SHOPEE_HOST || HOST_TESTE).replace(/\/+$/, "");
export const shopeeEhTeste = (host = shopeeHost()) => host.includes("test-stable");

function assinar(path: string, ts: number, token = "", shopId = ""): string {
  const base = `${env("SHOPEE_PARTNER_ID")}${path}${ts}${token}${shopId}`;
  return crypto.createHmac("sha256", env("SHOPEE_PARTNER_KEY")).update(base).digest("hex");
}

// Link para o vendedor autorizar a loja. A Shopee devolve ?code=...&shop_id=... no endereço de retorno;
// o "state" assinado vai dentro do próprio endereço de retorno para ligar a volta à sua conta.
export function urlAutorizacao(state: string): string {
  const path = "/api/v2/shop/auth_partner";
  const ts = Math.floor(Date.now() / 1000);
  const retorno = `${env("SHOPEE_REDIRECT_URL")}?state=${encodeURIComponent(state)}`;
  const u = new URL(shopeeHost() + path);
  u.searchParams.set("partner_id", env("SHOPEE_PARTNER_ID"));
  u.searchParams.set("timestamp", String(ts));
  u.searchParams.set("sign", assinar(path, ts));
  u.searchParams.set("redirect", retorno);
  return u.toString();
}

type RespostaShopee = { error?: string; message?: string; request_id?: string; response?: unknown } & Record<string, unknown>;

async function chamar<T extends RespostaShopee>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("A Shopee não respondeu em 15 s");
  }
  const j = (await r.json().catch(() => ({}))) as T;
  if (!r.ok || (j.error && String(j.error).length > 0)) throw new Error(`Shopee: ${j.message || j.error || r.status}`);
  return j;
}

export type TokensShopee = { access_token: string; refresh_token: string; expire_in: number };

export async function trocarCodigo(code: string, shopId: string): Promise<TokensShopee> {
  const path = "/api/v2/auth/token/get";
  const ts = Math.floor(Date.now() / 1000);
  const url = `${shopeeHost()}${path}?partner_id=${env("SHOPEE_PARTNER_ID")}&timestamp=${ts}&sign=${assinar(path, ts)}`;
  return chamar<RespostaShopee & TokensShopee>(url, { method: "POST", body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(env("SHOPEE_PARTNER_ID")) }) });
}

async function renovarAcesso(refreshToken: string, shopId: string): Promise<TokensShopee> {
  const path = "/api/v2/auth/access_token/get";
  const ts = Math.floor(Date.now() / 1000);
  const url = `${shopeeHost()}${path}?partner_id=${env("SHOPEE_PARTNER_ID")}&timestamp=${ts}&sign=${assinar(path, ts)}`;
  return chamar<RespostaShopee & TokensShopee>(url, { method: "POST", body: JSON.stringify({ refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(env("SHOPEE_PARTNER_ID")) }) });
}

// Chamada GET de uma loja (já assinada com o acesso dela)
export async function shopeeGet<T = Record<string, unknown>>(token: string, shopId: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const ts = Math.floor(Date.now() / 1000);
  const u = new URL(shopeeHost() + path);
  u.searchParams.set("partner_id", env("SHOPEE_PARTNER_ID"));
  u.searchParams.set("timestamp", String(ts));
  u.searchParams.set("sign", assinar(path, ts, token, shopId));
  u.searchParams.set("access_token", token);
  u.searchParams.set("shop_id", shopId);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return chamar<RespostaShopee>(u.toString()) as unknown as T;
}

const DIAS_REFRESH = 30; // o acesso de renovação vale cerca de 30 dias

export async function guardarConexao(storeId: string, shopId: string, t: TokensShopee, extra: { shop_name?: string | null; region?: string | null } = {}) {
  const admin = supabaseAdmin();
  await admin.from("stores").upsert({ id: storeId, name: "Minha Loja" }, { onConflict: "id", ignoreDuplicates: true });
  const { error } = await admin.from("shopee_connections").upsert(
    {
      store_id: storeId,
      shop_id: shopId,
      ...(extra.shop_name ? { shop_name: extra.shop_name } : {}),
      ...(extra.region ? { region: extra.region } : {}),
      host: shopeeHost(),
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expire_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + DIAS_REFRESH * 86_400_000).toISOString(),
      connected_at: new Date().toISOString(),
    },
    { onConflict: "store_id,shop_id" }
  );
  if (error) throw new Error(error.message);
}

// Acesso válido da loja: renova sozinho quando faltam menos de 5 minutos (o acesso dura ~4 horas).
export async function tokenShopee(storeId: string, shopId: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("shopee_connections").select("access_token, refresh_token, expires_at").eq("store_id", storeId).eq("shop_id", shopId).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() - Date.now() > 5 * 60_000) return data.access_token as string;
  const novo = await renovarAcesso(data.refresh_token as string, shopId);
  await guardarConexao(storeId, shopId, novo);
  return novo.access_token;
}
