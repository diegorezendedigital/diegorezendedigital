import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { criarRodada, dispararWorker, emSegundoPlano, estaParada, executarEEncadear, faltaTabela, pararRodada, rodadaAtiva } from "@/lib/server/promocoes-rodada";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SQL_PENDENTE = "Falta criar as tabelas da automação no Supabase: rode o SQL de supabase/migrations/20261128_automacao_promocoes.sql.";

// Promoção automática em segundo plano. body: { acao: "iniciar" | "continuar" | "parar" }
// iniciar: cria a rodada (ou devolve a que já está rodando) e começa na hora; continuar: retoma uma rodada parada; parar: cancela.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const acao = String(b.acao || "iniciar");
  const admin = supabaseAdmin();
  try {
    if (acao === "parar") return NextResponse.json({ rodada: await pararRodada(admin, user.id) });

    let rodada = await rodadaAtiva(admin, user.id);
    if (acao === "continuar" && !rodada) return NextResponse.json({ rodada: null });
    let nova = false;
    if (!rodada) {
      // Conta escolhida na tela ("" = todas). Só vale se for uma conta desta loja.
      let conta: string | null = null;
      if (b.conta) {
        const { data: c } = await admin.from("ml_connections").select("ml_user_id").eq("store_id", user.id);
        conta = (c ?? []).map((x) => String(x.ml_user_id)).find((x) => x === String(b.conta)) ?? null;
        if (!conta) return NextResponse.json({ error: "Conta não encontrada." }, { status: 400 });
      }
      const r = await criarRodada(admin, user.id, "manual", conta);
      rodada = r.rodada;
      nova = r.nova;
    }
    // Começa (ou retoma) nesta mesma chamada, em segundo plano; sem waitUntil, pede a um worker
    if (nova || estaParada(rodada)) {
      const id = rodada.id;
      if (!emSegundoPlano(() => executarEEncadear(admin, id, 40_000))) await dispararWorker(id);
    }
    return NextResponse.json({ rodada, nova });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro";
    if (faltaTabela(msg)) return NextResponse.json({ error: SQL_PENDENTE, precisaSQL: true }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
