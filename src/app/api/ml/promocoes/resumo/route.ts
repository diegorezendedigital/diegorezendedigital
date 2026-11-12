import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Promo = { id?: string; type?: string; status?: string; name?: string };
type ItensResp = { results?: { id?: string; original_price?: number; price?: number; meli_percentage?: number }[]; paging?: { total?: number; searchAfter?: string; search_after?: string } };

// Resumo de todas as promoções das contas: anúncios que podem entrar, participando, aguardando,
// taxa de aceite e o bônus do Mercado Livre (meli_percentage × preço original) dos anúncios participando.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const inicio = Date.now();
  try {
    const contas = await listConnections(user.id);
    type Tarefa = { token: string; conta: string; id: string; tipo: string; nome: string };
    const tarefas: Tarefa[] = [];
    const erros: string[] = [];

    for (const c of contas) {
      try {
        const token = await getAccessToken(user.id, c.ml_user_id);
        if (!token) {
          erros.push(`${c.store_name || c.nickname || c.ml_user_id}: reconecte a conta`);
          continue;
        }
        const r = await mlGet<{ results?: Promo[] } | Promo[]>(token, `/seller-promotions/users/${c.ml_user_id}?app_version=v2`);
        const lista = Array.isArray(r) ? r : r.results ?? [];
        lista
          .filter((p) => p.id && p.type && p.status !== "finished")
          .forEach((p) => tarefas.push({ token, conta: c.store_name || c.nickname || c.ml_user_id, id: p.id as string, tipo: p.type as string, nome: p.name ?? (p.id as string) }));
      } catch (e) {
        erros.push(`${c.store_name || c.nickname || c.ml_user_id}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }

    const porPromocao: { conta: string; id: string; nome: string; tipo: string; candidatos: number; participando: number; aguardando: number; bonus: number }[] = [];
    let parcial = false;

    const total = async (t: Tarefa, status: string): Promise<number> => {
      try {
        const q = new URLSearchParams({ promotion_type: t.tipo, app_version: "v2", limit: "1", status });
        const r = await mlGet<ItensResp>(t.token, `/seller-promotions/promotions/${encodeURIComponent(t.id)}/items?${q}`);
        return r.paging?.total ?? (r.results?.length ?? 0);
      } catch {
        return 0;
      }
    };
    const bonusDe = async (t: Tarefa): Promise<number> => {
      let soma = 0;
      let depois: string | null = null;
      for (let pg = 0; pg < 4; pg++) {
        try {
          const q = new URLSearchParams({ promotion_type: t.tipo, app_version: "v2", limit: "50", status: "started" });
          if (depois) q.set("search_after", depois);
          const r = await mlGet<ItensResp>(t.token, `/seller-promotions/promotions/${encodeURIComponent(t.id)}/items?${q}`);
          (r.results ?? []).forEach((i) => {
            const pctML = Number(i.meli_percentage) || 0;
            const base = Number(i.original_price) || 0;
            if (pctML > 0 && base > 0) soma += (base * pctML) / 100;
          });
          depois = r.paging?.searchAfter ?? r.paging?.search_after ?? null;
          if (!depois || (r.results ?? []).length < 50) break;
        } catch {
          break;
        }
      }
      return soma;
    };

    // 6 promoções ao mesmo tempo
    for (let i = 0; i < tarefas.length; i += 6) {
      if (Date.now() - inicio > 45000) {
        parcial = true;
        break;
      }
      await Promise.all(
        tarefas.slice(i, i + 6).map(async (t) => {
          const [candidatos, participando, pendentes, programados] = await Promise.all([total(t, "candidate"), total(t, "started"), total(t, "pending"), total(t, "programmed")]);
          const bonus = participando > 0 ? await bonusDe(t) : 0;
          porPromocao.push({ conta: t.conta, id: t.id, nome: t.nome, tipo: t.tipo, candidatos, participando, aguardando: pendentes + programados, bonus: Math.round(bonus * 100) / 100 });
        })
      );
    }

    const soma = (f: (p: (typeof porPromocao)[number]) => number) => porPromocao.reduce((a, p) => a + f(p), 0);
    const candidatos = soma((p) => p.candidatos);
    const participando = soma((p) => p.participando);
    const aguardando = soma((p) => p.aguardando);
    const ofertados = candidatos + participando + aguardando;
    return NextResponse.json({
      promocoes: porPromocao.length,
      promocoesComVaga: porPromocao.filter((p) => p.candidatos > 0).length,
      candidatos,
      participando,
      aguardando,
      aceite: ofertados > 0 ? ((participando + aguardando) / ofertados) * 100 : null,
      bonus: Math.round(soma((p) => p.bonus) * 100) / 100,
      porPromocao: porPromocao.sort((a, b) => b.candidatos - a.candidatos),
      parcial,
      erros,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
