import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { emSegundoPlano } from "@/lib/server/promocoes-rodada";
import { processarNotificacao } from "@/lib/server/promocoes-convite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOPICOS = new Set(["public_candidates", "public_offers"]);

// URL de notificações do aplicativo no Mercado Livre (DevCenter → "URL de retornos de chamada de notificação").
// O ML exige resposta rápida: responde 200 na hora e processa o convite em segundo plano.
export async function POST(req: Request) {
  const n = (await req.json().catch(() => null)) as { topic?: string; resource?: string; user_id?: number | string; application_id?: number | string } | null;
  if (!n?.topic || !n.resource || !n.user_id) return NextResponse.json({ ok: true });
  const app = process.env.ML_CLIENT_ID;
  if (app && n.application_id != null && String(n.application_id) !== String(app)) return NextResponse.json({ ok: true });
  if (!TOPICOS.has(n.topic)) return NextResponse.json({ ok: true });

  const mlUserId = String(n.user_id);
  const topic = n.topic;
  const resource = String(n.resource);
  const trabalho = async () => {
    const admin = supabaseAdmin();
    const { data: conexoes } = await admin.from("ml_connections").select("store_id").eq("ml_user_id", mlUserId);
    for (const { store_id } of (conexoes ?? []) as { store_id: string }[]) {
      // Guarda a notificação (sem duplicar: o ML reenvia a mesma às vezes) e processa
      const ins = await admin
        .from("ml_notificacoes")
        .upsert({ store_id, ml_user_id: mlUserId, topic, resource }, { onConflict: "store_id,topic,resource", ignoreDuplicates: true })
        .select("id");
      const semTabela = !!ins.error;
      const id = ((ins.data ?? []) as { id: string }[])[0]?.id;
      if (!semTabela && !id) continue; // já recebida antes
      try {
        const resultado = await processarNotificacao(admin, { store_id, ml_user_id: mlUserId, topic, resource });
        if (id) await admin.from("ml_notificacoes").update({ processada_em: new Date().toISOString(), resultado, tentativas: 1 }).eq("id", id);
      } catch (e) {
        if (id) await admin.from("ml_notificacoes").update({ resultado: e instanceof Error ? e.message.slice(0, 300) : "erro", tentativas: 1 }).eq("id", id);
      }
    }
  };
  if (!emSegundoPlano(trabalho)) await trabalho().catch((e) => console.error("[notificacoes]", e));
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
