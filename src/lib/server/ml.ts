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

// PKCE: o code_verifier não é guardado em lugar nenhum; é recalculado a partir do "state" assinado
// (só o servidor conhece o segredo), então nunca viaja pela URL.
function pkceVerifier(state: string): string {
  return hmac(`pkce:${state.split(".")[0]}`);
}

export function authUrl(state: string): string {
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env("ML_CLIENT_ID"));
  url.searchParams.set("redirect_uri", env("ML_REDIRECT_URI"));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", crypto.createHash("sha256").update(pkceVerifier(state)).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
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
  const res = await chamarML(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("ML_CLIENT_ID"),
      client_secret: env("ML_CLIENT_SECRET"),
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const j = json as { error?: string; error_description?: string; message?: string };
    const detalhe = [j.error, j.error_description || j.message].filter(Boolean).join(": ") || String(res.status);
    throw new Error(`Falha no OAuth do Mercado Livre: ${detalhe}`);
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string, state: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: env("ML_REDIRECT_URI"),
    code_verifier: pkceVerifier(state),
  });
}

export type MlConn = {
  store_id: string;
  ml_user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_synced_at: string | null;
  connected_at: string;
  nickname: string | null;
  store_name?: string | null;
  company_id: string | null;
};

// Todas as contas do Mercado Livre conectadas à loja (a mais antiga primeiro).
export async function listConnections(storeId: string): Promise<MlConn[]> {
  const { data, error } = await supabaseAdmin().from("ml_connections").select("*").eq("store_id", storeId).order("connected_at");
  if (error) throw new Error(`Banco de dados: ${error.message}`);
  return (data ?? []) as MlConn[];
}

// Uma conta pelo id do Mercado Livre; sem id, devolve a primeira conectada.
export async function getConnection(storeId: string, mlUserId?: string | null): Promise<MlConn | null> {
  const todas = await listConnections(storeId);
  if (mlUserId) return todas.find((c) => c.ml_user_id === mlUserId) ?? null;
  return todas[0] ?? null;
}

// Devolve um access_token válido; renova (e guarda o novo refresh_token) se faltar menos de 2 min.
export async function getAccessToken(storeId: string, mlUserId?: string | null): Promise<string | null> {
  const conn = await getConnection(storeId, mlUserId);
  if (!conn) return null;
  if (new Date(conn.expires_at).getTime() - Date.now() > 120000) return conn.access_token;

  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  await supabaseAdmin()
    .from("ml_connections")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    })
    .eq("store_id", storeId)
    .eq("ml_user_id", conn.ml_user_id);
  return t.access_token;
}

/* ---------- Chamadas à API ---------- */
// Toda chamada ao Mercado Livre tem prazo: uma resposta que trava não pode segurar a rodada inteira.
const PRAZO_ML_MS = 15000;
async function chamarML(url: string, init: RequestInit, prazoMs = PRAZO_ML_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") throw new Error(`O Mercado Livre não respondeu em ${Math.round(prazoMs / 1000)} s`);
    throw e;
  }
}

export async function mlGet<T = any>(token: string, path: string): Promise<T> {
  const res = await chamarML(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { message?: string }).message || `Mercado Livre respondeu ${res.status}`;
    throw new Error(`${msg} [${res.status} ${path.split("?")[0]}]`);
  }
  return json as T;
}

export async function mlPut<T = any>(token: string, path: string, body: unknown): Promise<T> {
  return mlEnviar<T>("PUT", token, path, body);
}

export async function mlPost<T = any>(token: string, path: string, body: unknown): Promise<T> {
  return mlEnviar<T>("POST", token, path, body);
}

export async function mlDelete<T = any>(token: string, path: string): Promise<T> {
  return mlEnviar<T>("DELETE", token, path, undefined);
}

// Detalhes de vários anúncios de uma vez. O Mercado Livre desligou o multiget antigo (/items?ids=, prazo 25/10/2026):
// o novo é /items/bulk?ids= (até 20 por chamada), que responde [{ id, status_code, body }]. Aceita também o formato antigo
// ({ code, body }). Se o lote falhar, busca um anúncio por vez (5 em paralelo).
export async function itensDoML<T extends { id?: string } = any>(token: string, ids: string[]): Promise<T[]> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  const saida: T[] = [];
  for (let i = 0; i < unicos.length; i += 20) {
    const lote = unicos.slice(i, i + 20);
    let lidos: T[] | null = null;
    try {
      const r = await mlGet<unknown>(token, `/items/bulk?ids=${lote.map(encodeURIComponent).join(",")}`);
      const lista = Array.isArray(r) ? r : Array.isArray((r as { results?: unknown[] } | null)?.results) ? (r as { results: unknown[] }).results : [];
      if (lista.length) {
        lidos = [];
        for (const x of lista as { body?: T; code?: number; status_code?: number }[]) {
          const situacao = x?.status_code ?? x?.code;
          const corpo = x?.body;
          if (corpo && typeof corpo === "object" && corpo.id && (situacao == null || Number(situacao) === 200)) lidos.push(corpo);
        }
      }
    } catch {
      lidos = null;
    }
    if (lidos == null) {
      const unsAUns: T[] = [];
      for (let k = 0; k < lote.length; k += 5) {
        const parte = await Promise.all(lote.slice(k, k + 5).map((id) => mlGet<T>(token, `/items/${encodeURIComponent(id)}`).catch(() => null)));
        parte.forEach((b) => {
          if (b && b.id) unsAUns.push(b);
        });
      }
      lidos = unsAUns;
    }
    saida.push(...lidos);
  }
  return saida;
}

async function mlEnviar<T>(metodo: "PUT" | "POST" | "DELETE", token: string, path: string, body: unknown): Promise<T> {
  const res = await chamarML(`${ML_API}${path}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const j = json as { message?: string; cause?: { message?: string }[] };
    const causa = j.cause && j.cause[0] && j.cause[0].message ? ` (${j.cause[0].message})` : "";
    throw new Error((j.message || `Mercado Livre respondeu ${res.status}`) + causa);
  }
  return json as T;
}

// Taxa que o Mercado Livre cobra de um anúncio nesse preço: percentual e valor fixo.
export async function taxaDoAnuncio(
  token: string,
  preco: number,
  categoryId: string | null,
  listingTypeId: string | null
): Promise<{ pct: number; fixo: number } | null> {
  try {
    const q = new URLSearchParams({ price: String(preco) });
    if (categoryId) q.set("category_id", categoryId);
    if (listingTypeId) q.set("listing_type_id", listingTypeId);
    const r = await mlGet<any>(token, `/sites/MLB/listing_prices?${q}`);
    const o = Array.isArray(r) ? r.find((x: any) => x.listing_type_id === listingTypeId) || r[0] : r;
    if (!o) return null;
    const d = o.sale_fee_details || {};
    const total = Number(o.sale_fee_amount);
    const fixo = Number(d.fixed_fee) || 0;
    const pct = d.percentage_fee != null ? Number(d.percentage_fee) : preco > 0 ? ((total - fixo) / preco) * 100 : NaN;
    if (!Number.isFinite(pct)) return null;
    return { pct, fixo };
  } catch {
    return null;
  }
}
