import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { criarRodada, dispararWorker, estaParada } from "@/lib/server/promocoes-rodada";
import { reprocessarPendentes } from "@/lib/server/promocoes-convite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rodadas agendadas (vercel.json: 3 vezes por dia). Para cada loja com SKU em "Promo auto": começa uma rodada
// (ou retoma a que parou no meio) e tenta de novo as notificações do Mercado Livre que não foram processadas.
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("products").select("store_id").eq("promo_auto", true).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lojas = Array.from(new Set(((data ?? []) as { store_id: string }[]).map((x) => x.store_id)));
  const resumo = { lojas: lojas.length, iniciadas: 0, retomadas: 0, em_andamento: 0, falhas: 0, notificacoes: 0 };
  for (const loja of lojas) {
    try {
      const { rodada, nova } = await criarRodada(admin, loja, "agendada");
      if (nova) {
        resumo.iniciadas++;
        await dispararWorker(rodada.id);
      } else if (estaParada(rodada)) {
        resumo.retomadas++;
        await dispararWorker(rodada.id);
      } else resumo.em_andamento++;
    } catch {
      resumo.falhas++;
    }
  }
  resumo.notificacoes = await reprocessarPendentes(admin, 20, 25_000).catch(() => 0);
  return NextResponse.json(resumo);
}
