"use client";

import { supabase } from "@/lib/supabase/client";

// Loja de quem está logado. Para o master é o próprio id; para o convidado é a loja que o convidou.
let cache: { userId: string; lojaId: string } | null = null;

export async function lojaAtual(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return undefined;
  const c = cache;
  if (c && c.userId === uid) return c.lojaId;
  const r = await supabase.rpc("loja_do_usuario");
  const lojaId = !r.error && typeof r.data === "string" ? r.data : uid; // SQL ainda não rodado: a própria conta
  cache = { userId: uid, lojaId };
  return lojaId;
}

export async function souConvidado(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  return !!uid && (await lojaAtual()) !== uid;
}
