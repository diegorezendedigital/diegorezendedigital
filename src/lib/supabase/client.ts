"use client";

import { createClient } from "@supabase/supabase-js";

// URL e chave "anon" são públicas por natureza; quem protege os dados são as regras RLS do banco.
// Trava da sessão entre abas com tempo máximo. Sem isso, uma aba do sistema congelada pelo Chrome
// (economia de memória) pode segurar a trava e deixar as outras abas presas em "Carregando…".
async function travaComLimite<R>(nome: string, _espera: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return fn();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    return await locks.request(nome, { mode: "exclusive", signal: ctrl.signal }, async () => {
      clearTimeout(t);
      return fn();
    });
  } catch (e) {
    if (ctrl.signal.aborted) return fn(); // outra aba segurou a trava por mais de 5 s: segue sem ela
    throw e;
  }
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  { auth: { lock: travaComLimite } }
);

// Chama as rotas /api do próprio app enviando o token da sessão do Supabase.
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
      Authorization: `Bearer ${token ?? ""}`,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Erro na requisição");
  return json as T;
}
