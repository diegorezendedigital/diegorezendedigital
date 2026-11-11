import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export function gerarHash(senha: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(senha, salt, 64).toString("hex") };
}

// "definida" = existe senha; "ok" = senha confere. Falhas seguidas ficam mais lentas (freio simples contra tentativa e erro).
export async function conferirSenha(storeId: string, senha: string): Promise<"sem_senha" | "errada" | "ok"> {
  const { data, error } = await supabaseAdmin().from("store_secrets").select("master_salt, master_hash").eq("store_id", storeId).maybeSingle();
  if (error) throw new Error(`Banco de dados: ${error.message}`);
  if (!data) return "sem_senha";
  const calc = scryptSync(String(senha ?? ""), data.master_salt as string, 64);
  const ok = timingSafeEqual(calc, Buffer.from(data.master_hash as string, "hex"));
  if (!ok) await new Promise((r) => setTimeout(r, 1500));
  return ok ? "ok" : "errada";
}
