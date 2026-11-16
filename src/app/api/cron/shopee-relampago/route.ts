import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { executarRegra, type Regra } from "@/lib/server/shopee-relampago";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rodada diária do robô de relâmpago (vercel.json): roda as regras ativas, as mais antigas primeiro.
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const inicio = Date.now();
  const { data, error } = await supabaseAdmin().from("shopee_flash_rules").select("*").eq("ativo", true).order("ultima_execucao", { ascending: true, nullsFirst: true }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const resumo = { regras: 0, criadas: 0, erros: 0 };
  for (const r of (data ?? []) as Regra[]) {
    const restante = 52_000 - (Date.now() - inicio);
    if (restante < 10_000) break;
    const res = await executarRegra(r, restante - 8_000);
    resumo.regras++;
    resumo.criadas += res.criadas.length;
    resumo.erros += res.erros.length;
  }
  return NextResponse.json(resumo);
}
