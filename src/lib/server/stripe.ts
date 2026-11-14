import crypto from "crypto";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

// Stripe sem SDK: chamadas REST diretas (formato application/x-www-form-urlencoded).
const API = "https://api.stripe.com/v1";

function chave(): string {
  const k = (process.env.STRIPE_SECRET_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new Error("Configure STRIPE_SECRET_KEY");
  return k;
}

function corpo(obj: Record<string, string>): string {
  return new URLSearchParams(obj).toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function stripe(metodo: "GET" | "POST", caminho: string, dados?: Record<string, string>): Promise<any> {
  const url = metodo === "GET" && dados ? `${API}${caminho}?${corpo(dados)}` : `${API}${caminho}`;
  const r = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${chave()}`,
      ...(metodo === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: metodo === "POST" && dados ? corpo(dados) : undefined,
    cache: "no-store",
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `Stripe ${r.status}`);
  return json;
}

export type PlanoId = "mensal" | "anual";

export function precoDoPlano(plano: PlanoId): string {
  const v = plano === "anual" ? process.env.STRIPE_PRICE_ANUAL : process.env.STRIPE_PRICE_MENSAL;
  return (v ?? "").trim();
}

/** Confere a assinatura do webhook (cabeçalho Stripe-Signature) com tolerância de 5 minutos. */
export function webhookValido(corpoBruto: string, cabecalho: string | null): boolean {
  const segredo = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!segredo || !cabecalho) return false;
  const partes = Object.fromEntries(
    cabecalho.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );
  const t = partes["t"];
  const v1 = cabecalho
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!t || v1.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const esperado = crypto.createHmac("sha256", segredo).update(`${t}.${corpoBruto}`).digest("hex");
  const a = Buffer.from(esperado);
  return v1.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function salvarAssinatura(email: string, sub: any, plano?: string) {
  const status = String(sub?.status ?? "incomplete");
  const fim = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  const linha = {
    email: email.trim().toLowerCase(),
    stripe_customer_id: typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id ?? null,
    stripe_subscription_id: sub?.id ?? null,
    plano: plano ?? sub?.metadata?.plano ?? null,
    status,
    current_period_end: fim ? new Date(Number(fim) * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin().from("assinaturas").upsert(linha, { onConflict: "email" });
  if (error) throw new Error(error.message);
}
