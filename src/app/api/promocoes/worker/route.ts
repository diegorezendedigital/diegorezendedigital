import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { assinaturaValida, dispararWorker, emSegundoPlano, executarEEncadear } from "@/lib/server/promocoes-rodada";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Continuação interna de uma rodada de promoções automáticas. Só aceita chamadas assinadas pelo próprio servidor.
// Responde na hora e processa em segundo plano (~40 s); se ainda faltar, chama a si mesma de novo.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const runId = String(b.run_id || "");
  if (!assinaturaValida(runId, String(b.assinatura || ""))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const trabalho = () => executarEEncadear(supabaseAdmin(), runId, 40_000);
  if (emSegundoPlano(trabalho)) return NextResponse.json({ ok: true }, { status: 202 });
  // Fora da Vercel (sem waitUntil): processa antes de responder
  try {
    await trabalho();
  } catch (e) {
    console.error("[promocoes] worker:", e);
    await dispararWorker(runId);
  }
  return NextResponse.json({ ok: true });
}
