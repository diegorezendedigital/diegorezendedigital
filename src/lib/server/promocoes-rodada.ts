import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Listing, Product } from "@/lib/types";
import { getAccessToken, mlGet } from "./ml";
import { decidirEEntrar, motivoNaoAutomatico, novoCache, type ItemPromoML, type PromoML } from "./promocoes-motor";

// Rodadas da promoção automática em segundo plano. Cada rodada fica gravada em promo_runs com o progresso e um cursor;
// o servidor processa ~40 s por vez e chama a si mesmo para continuar, então a rodada termina mesmo com a página fechada.
// Se uma continuação se perder, a tela (quando aberta) ou a próxima rodada agendada retomam do cursor.

export type Rodada = {
  id: string;
  store_id: string;
  origem: string;
  status: "na_fila" | "rodando" | "concluida" | "erro" | "cancelada";
  total: number;
  feitos: number;
  promocoes_total: number;
  promocoes_feitas: number;
  avaliados: number;
  entraram: number;
  recusados: number;
  erros: number;
  cursor: Cursor | null;
  mensagem: string | null;
  erro: string | null;
  criado_em: string;
  iniciado_em: string | null;
  batida_em: string | null;
  lease_ate: string | null;
  terminado_em: string | null;
};

type PlanoPromo = { conta: string; id: string; tipo: string; nome: string; total: number };
type Cursor = {
  plano?: PlanoPromo[];
  idx?: number; // promoção atual
  pagina?: string | null; // search_after da página atual (null = primeira página)
  paginaEm?: number; // quando o search_after foi obtido (o do Mercado Livre expira em 5 min)
  paginaIds?: string[]; // convites da página atual já vistos
  vistos?: number; // convites vistos na promoção atual
  falhas?: number; // falhas seguidas ao ler a página atual
  base?: number; // convites das promoções já terminadas
  avisos?: string[];
};

const ATIVAS = ["na_fila", "rodando"];
const TRAVA_MS = 75_000;
const VALIDADE_PAGINA_MS = 4 * 60_000;
export const PARADA_MS = 90_000; // sem sinal de vida há 90 s: a continuação se perdeu e precisa ser retomada

/* ---------- segundo plano ---------- */

// Endereço público do site (o mesmo do retorno do login do Mercado Livre), para o servidor chamar a si mesmo
export function urlBase(): string | null {
  const retorno = process.env.ML_REDIRECT_URI;
  if (retorno) {
    try {
      return new URL(retorno).origin;
    } catch {
      /* segue */
    }
  }
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
}

function segredo(): string {
  return process.env.ML_STATE_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
export function assinar(runId: string): string {
  return crypto.createHmac("sha256", segredo()).update(`promo-worker:${runId}`).digest("base64url");
}
export function assinaturaValida(runId: string, assinatura: string): boolean {
  if (!segredo() || !runId || !assinatura) return false;
  const a = Buffer.from(assinatura);
  const b = Buffer.from(assinar(runId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Roda `fazer` depois da resposta, mantendo a função viva (waitUntil da Vercel). false = não disponível aqui (nada foi iniciado).
export function emSegundoPlano(fazer: () => Promise<unknown>): boolean {
  const g = globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>;
  const ctx = g[Symbol.for("@vercel/request-context")]?.get?.();
  if (!ctx?.waitUntil) return false;
  ctx.waitUntil(fazer().catch((e) => console.error("[promocoes] segundo plano:", e)));
  return true;
}

// Pede ao próprio servidor a próxima parte da rodada
export async function dispararWorker(runId: string): Promise<boolean> {
  const base = urlBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/promocoes/worker`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: runId, assinatura: assinar(runId) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- rodadas ---------- */

export const estaParada = (r: Pick<Rodada, "status" | "batida_em" | "criado_em" | "lease_ate">): boolean => {
  if (!ATIVAS.includes(r.status)) return false;
  const ultimo = new Date(r.batida_em || r.criado_em).getTime();
  const travada = r.lease_ate ? new Date(r.lease_ate).getTime() > Date.now() : false;
  return !travada && Date.now() - ultimo > PARADA_MS;
};

export async function rodadaAtiva(admin: SupabaseClient, storeId: string): Promise<Rodada | null> {
  const { data, error } = await admin.from("promo_runs").select("*").eq("store_id", storeId).in("status", ATIVAS).order("criado_em", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Rodada | undefined) ?? null;
}

export const faltaTabela = (msg: string) => /promo_runs|ml_notificacoes|does not exist|schema cache|relation/i.test(msg);

// Cria a rodada (ou devolve a que já está em andamento)
export async function criarRodada(admin: SupabaseClient, storeId: string, origem: "manual" | "agendada"): Promise<{ rodada: Rodada; nova: boolean }> {
  const ativa = await rodadaAtiva(admin, storeId);
  if (ativa) return { rodada: ativa, nova: false };
  const { data, error } = await admin.from("promo_runs").insert({ store_id: storeId, origem, status: "na_fila" }).select("*").single();
  if (error) {
    // Outra chamada criou ao mesmo tempo (índice de uma rodada ativa por loja)
    const outra = await rodadaAtiva(admin, storeId).catch(() => null);
    if (outra) return { rodada: outra, nova: false };
    throw new Error(error.message);
  }
  return { rodada: data as Rodada, nova: true };
}

export async function pararRodada(admin: SupabaseClient, storeId: string): Promise<Rodada | null> {
  const { data } = await admin
    .from("promo_runs")
    .update({ status: "cancelada", terminado_em: new Date().toISOString(), lease_ate: null, mensagem: "Parada por você." })
    .eq("store_id", storeId)
    .in("status", ATIVAS)
    .select("*");
  return ((data ?? [])[0] as Rodada | undefined) ?? null;
}

// Processa a rodada e, se o tempo acabar antes do fim, pede a continuação
export async function executarEEncadear(admin: SupabaseClient, runId: string, prazoMs = 40_000): Promise<void> {
  const r = await processarFatia(admin, runId, prazoMs);
  if (r.continuar) await dispararWorker(runId);
}

async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < 50_000; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    saida.push(...lote);
    if (lote.length < 1000) break;
  }
  return saida;
}

// Uma parte da rodada (até prazoMs). continuar = ainda falta e alguém precisa chamar de novo.
export async function processarFatia(admin: SupabaseClient, runId: string, prazoMs = 40_000): Promise<{ continuar: boolean }> {
  const inicio = Date.now();
  const tempoAcabou = () => Date.now() - inicio > prazoMs;
  const agora = () => new Date().toISOString();
  const travaAte = () => new Date(Date.now() + TRAVA_MS).toISOString();

  // 1) Trava: só um processador por rodada. Lê a trava atual e só pega se ela não mudou nesse meio-tempo.
  const { data: atual } = await admin.from("promo_runs").select("status, lease_ate").eq("id", runId).maybeSingle();
  const situacao = atual as { status?: string; lease_ate?: string | null } | null;
  if (!situacao || !ATIVAS.includes(String(situacao.status))) return { continuar: false };
  if (situacao.lease_ate && new Date(situacao.lease_ate).getTime() > Date.now()) return { continuar: false };
  let pegar = admin.from("promo_runs").update({ status: "rodando", lease_ate: travaAte(), batida_em: agora() }).eq("id", runId).in("status", ATIVAS);
  pegar = situacao.lease_ate ? pegar.eq("lease_ate", situacao.lease_ate) : pegar.is("lease_ate", null);
  const { data: pega, error: erroTrava } = await pegar.select("*").maybeSingle();
  if (erroTrava || !pega) return { continuar: false };
  const run = pega as Rodada;
  const c: Cursor = run.cursor && typeof run.cursor === "object" ? { ...run.cursor } : {};
  const cont = { avaliados: run.avaliados || 0, entraram: run.entraram || 0, recusados: run.recusados || 0, erros: run.erros || 0 };
  const iniciado = run.iniciado_em || agora();
  let ultimoErro: string | null = run.erro;
  const avisos = new Set<string>(c.avisos ?? []);

  const progresso = () => {
    const plano = c.plano ?? [];
    const total = plano.reduce((s, p) => s + p.total, 0);
    return { total, feitos: Math.min(total, (c.base ?? 0) + (c.vistos ?? 0)), promocoes_total: plano.length, promocoes_feitas: Math.min(plano.length, c.idx ?? 0) };
  };
  // Grava o andamento (e renova a trava). Devolve o status atual para perceber se a rodada foi parada pela tela.
  const salvar = async (extra: Record<string, unknown> = {}): Promise<string | null> => {
    c.avisos = Array.from(avisos).slice(0, 12);
    const { data } = await admin
      .from("promo_runs")
      .update({ ...cont, ...progresso(), cursor: c, erro: ultimoErro, mensagem: c.avisos.join(" · ") || null, iniciado_em: iniciado, batida_em: agora(), lease_ate: travaAte(), ...extra })
      .eq("id", runId)
      .select("status")
      .maybeSingle();
    return ((data as { status?: string } | null)?.status as string | undefined) ?? null;
  };
  const pausar = async () => {
    await salvar({ lease_ate: null });
    return { continuar: true };
  };
  const terminar = async (status: "concluida" | "erro", aviso?: string) => {
    if (aviso) avisos.add(aviso);
    c.avisos = Array.from(avisos).slice(0, 12);
    await admin
      .from("promo_runs")
      .update({ ...cont, ...progresso(), cursor: c, erro: ultimoErro, mensagem: c.avisos.join(" · ") || null, iniciado_em: iniciado, batida_em: agora(), lease_ate: null, terminado_em: agora(), status })
      .eq("id", runId)
      .eq("status", "rodando");
    return { continuar: false };
  };

  try {
    // 2) SKUs com promoção automática e os anúncios do Mercado Livre ligados a eles
    const produtos = new Map(
      (await todas<Product>((de, ate) => admin.from("products").select("*").eq("store_id", run.store_id).eq("promo_auto", true).order("id").range(de, ate))).map((p) => [p.id, p])
    );
    if (!produtos.size) return await terminar("concluida", "Nenhum SKU está com “Promo auto” marcado no armazém.");
    const empresas = (await admin.from("companies").select("*").eq("store_id", run.store_id)).data as Company[] | null;
    const empresaPadrao = (empresas ?? []).find((x) => x.is_default) ?? null;
    const empresaDe = (a: Listing) => (empresas ?? []).find((x) => x.id === a.company_id) ?? empresaPadrao;
    const anuncios = (
      await todas<Listing>((de, ate) => admin.from("listings").select("*").eq("store_id", run.store_id).eq("marketplace_id", "mercado_livre").not("product_id", "is", null).order("id").range(de, ate))
    ).filter((a) => a.product_id && produtos.has(a.product_id) && a.ml_user_id);
    if (!anuncios.length) return await terminar("concluida", "Os SKUs com “Promo auto” não estão ligados a nenhum anúncio do Mercado Livre.");
    const porConta = new Map<string, Map<string, Listing>>();
    anuncios.forEach((a) => {
      const conta = String(a.ml_user_id);
      if (!porConta.has(conta)) porConta.set(conta, new Map());
      (porConta.get(conta) as Map<string, Listing>).set(a.external_id, a);
    });

    const tokens = new Map<string, string | null>();
    const tokenDe = async (conta: string): Promise<string | null> => {
      if (!tokens.has(conta)) tokens.set(conta, await getAccessToken(run.store_id, conta).catch(() => null));
      return tokens.get(conta) ?? null;
    };

    // 3) Plano: promoções abertas de cada conta e quantos convites cada uma tem (feito uma vez por rodada)
    if (!c.plano) {
      const plano: PlanoPromo[] = [];
      for (const conta of Array.from(porConta.keys())) {
        const token = await tokenDe(conta);
        if (!token) {
          cont.erros++;
          avisos.add(`A conta ${conta} está sem acesso ao Mercado Livre: reconecte em Integrações.`);
          continue;
        }
        let promos: PromoML[] = [];
        try {
          const r = await mlGet<{ results?: PromoML[] } | PromoML[]>(token, `/seller-promotions/users/${conta}?app_version=v2`);
          promos = Array.isArray(r) ? r : r.results ?? [];
        } catch (e) {
          cont.erros++;
          ultimoErro = `Promoções da conta ${conta}: ${e instanceof Error ? e.message : "erro do Mercado Livre"}`;
          continue;
        }
        let manuais = 0;
        for (const p of promos) {
          if (!p.id || !p.type) continue;
          if (!["started", "pending", "programmed"].includes(String(p.status))) continue;
          if (p.deadline_date && new Date(p.deadline_date).getTime() < Date.now()) continue;
          if (motivoNaoAutomatico(p.type)) {
            manuais++;
            continue;
          }
          plano.push({ conta, id: p.id, tipo: p.type, nome: p.name || p.id, total: -1 });
        }
        if (manuais) avisos.add(`${manuais} promoção(ões) da conta ${conta} não entram sozinhas (relâmpago, desconto por quantidade, cupom ou 100% ML).`);
      }
      for (let i = 0; i < plano.length; i += 4) {
        await Promise.all(
          plano.slice(i, i + 4).map(async (pp) => {
            const token = await tokenDe(pp.conta);
            if (!token) return;
            try {
              const q = new URLSearchParams({ promotion_type: pp.tipo, status: "candidate", limit: "1", app_version: "v2" });
              const r = await mlGet<{ results?: unknown[]; paging?: { total?: number } }>(token, `/seller-promotions/promotions/${encodeURIComponent(pp.id)}/items?${q}`);
              pp.total = Number(r.paging?.total ?? r.results?.length ?? 0) || 0;
            } catch {
              pp.total = -1; // não deu para contar: percorre assim mesmo
            }
          })
        );
      }
      c.plano = plano.filter((p) => p.total !== 0).map((p) => ({ ...p, total: Math.max(0, p.total) }));
      c.idx = 0;
      c.pagina = null;
      c.paginaIds = [];
      c.vistos = 0;
      c.base = 0;
      if (!c.plano.length) {
        if (cont.erros > 0 && !plano.length) return await terminar("erro", "Não consegui ler as promoções no Mercado Livre.");
        return await terminar("concluida", "Nenhuma promoção aberta tem convites para os seus anúncios agora.");
      }
      if ((await salvar()) === "cancelada") return { continuar: false };
    }

    // 4) Convites já tratados nesta rodada (não repete ao continuar)
    const tratados = new Set<string>();
    try {
      (await todas<{ item_id: string; promotion_id: string }>((de, ate) => admin.from("promo_actions").select("item_id, promotion_id").eq("store_id", run.store_id).eq("run_id", runId).range(de, ate))).forEach((x) =>
        tratados.add(`${x.item_id}|${x.promotion_id}`)
      );
    } catch {
      // Banco sem a coluna run_id: usa o horário de início da rodada
      (
        await todas<{ item_id: string; promotion_id: string }>((de, ate) => admin.from("promo_actions").select("item_id, promotion_id").eq("store_id", run.store_id).gte("updated_at", iniciado).range(de, ate)).catch(() => [])
      ).forEach((x) => tratados.add(`${x.item_id}|${x.promotion_id}`));
    }

    const cache = novoCache();
    const plano = c.plano as PlanoPromo[];
    const avancar = () => {
      const atual = plano[c.idx ?? 0];
      c.base = (c.base ?? 0) + (atual ? Math.max(atual.total, c.vistos ?? 0) : 0);
      c.idx = (c.idx ?? 0) + 1;
      c.pagina = null;
      c.paginaEm = undefined;
      c.paginaIds = [];
      c.vistos = 0;
      c.falhas = 0;
    };

    // 5) Percorre os convites de cada promoção, página por página
    while ((c.idx ?? 0) < plano.length) {
      if (tempoAcabou()) return await pausar();
      const pp = plano[c.idx ?? 0];
      const meus = porConta.get(pp.conta);
      const token = meus && meus.size ? await tokenDe(pp.conta) : null;
      if (!meus || !meus.size || !token) {
        avancar();
        continue;
      }
      if (c.pagina && (!c.paginaEm || Date.now() - c.paginaEm > VALIDADE_PAGINA_MS)) {
        // O marcador da página expirou: recomeça esta promoção (o que já foi tratado nesta rodada é pulado)
        c.pagina = null;
        c.paginaIds = [];
        c.vistos = 0;
      }
      const q = new URLSearchParams({ promotion_type: pp.tipo, status: "candidate", limit: "50", app_version: "v2" });
      if (c.pagina) q.set("search_after", c.pagina);
      // Uma falha passageira (limite de chamadas, instabilidade) ganha novas tentativas; se o tempo desta parte acabar,
      // tenta de novo na próxima parte. Só depois de várias falhas seguidas a promoção é pulada.
      let resposta: { results?: ItemPromoML[]; paging?: { searchAfter?: string; search_after?: string } } | null = null;
      let falha: unknown = null;
      for (let tentativa = 1; tentativa <= 3 && !resposta; tentativa++) {
        try {
          resposta = await mlGet(token, `/seller-promotions/promotions/${encodeURIComponent(pp.id)}/items?${q}`);
        } catch (e) {
          falha = e;
          if (tentativa < 3 && !tempoAcabou()) await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
          else break;
        }
      }
      if (!resposta) {
        c.falhas = (c.falhas ?? 0) + 1;
        if (c.falhas < 4) return await pausar();
        cont.erros++;
        ultimoErro = `Convites de “${pp.nome}”: ${falha instanceof Error ? falha.message : "erro do Mercado Livre"}`;
        avancar();
        if ((await salvar()) === "cancelada") return { continuar: false };
        continue;
      }
      c.falhas = 0;
      const itens: ItemPromoML[] = resposta.results ?? [];
      const proxima: string | null = resposta.paging?.searchAfter ?? resposta.paging?.search_after ?? null;

      const vistos = new Set(c.paginaIds ?? []);
      for (const it of itens) {
        if (!it.id || vistos.has(it.id)) continue;
        const anuncio = meus.get(it.id);
        const chave = `${it.id}|${pp.id}`;
        if (anuncio && (it.status ?? "candidate") === "candidate" && !tratados.has(chave)) {
          if (tempoAcabou()) {
            c.paginaIds = Array.from(vistos);
            return await pausar();
          }
          const produto = anuncio.product_id ? produtos.get(anuncio.product_id) : undefined;
          const r = await decidirEEntrar(admin, {
            token,
            mlUserId: pp.conta,
            anuncio,
            produto,
            empresa: empresaDe(anuncio),
            promo: { id: pp.id, type: pp.tipo, name: pp.nome },
            item: it,
            cache,
            storeId: run.store_id,
            runId,
            origem: run.origem,
          });
          cont.avaliados++;
          if (r.status === "entrou") cont.entraram++;
          else if (r.status === "recusada") cont.recusados++;
          else {
            cont.erros++;
            ultimoErro = `${anuncio.external_id} em “${pp.nome}”: ${r.mensagem}`;
          }
          if (r.logErro) avisos.add(`Não consegui gravar o log (${r.logErro}): rode o SQL da automação no Supabase.`);
          tratados.add(chave);
          vistos.add(it.id);
          c.paginaIds = Array.from(vistos);
          c.vistos = (c.vistos ?? 0) + 1;
          if ((await salvar()) === "cancelada") return { continuar: false };
        } else {
          vistos.add(it.id);
          c.vistos = (c.vistos ?? 0) + 1;
        }
      }
      if (proxima && proxima !== c.pagina && itens.length > 0) {
        c.pagina = proxima;
        c.paginaEm = Date.now();
        c.paginaIds = [];
      } else {
        avancar();
      }
      if ((await salvar()) === "cancelada") return { continuar: false };
    }
    return await terminar("concluida");
  } catch (e) {
    ultimoErro = e instanceof Error ? e.message : "Erro inesperado na rodada";
    return await terminar("erro");
  }
}
