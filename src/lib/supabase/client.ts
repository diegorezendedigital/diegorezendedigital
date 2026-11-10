"use client";

import { createClient } from "@supabase/supabase-js";

// URL e chave "anon" são públicas por natureza; quem protege os dados são as regras RLS do banco.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
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
