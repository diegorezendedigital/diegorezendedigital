"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { AcaoPromo, Listing, RodadaPromo, brl, mensagemErro, pct } from "@/lib/types";
import { SQL_AUTOMACAO_PROMOCOES } from "@/lib/sql-automacao";

// Painel da promoção automática: você aplica pelo botão; a rodada roda no servidor (pode fechar a página)
// e a tela mostra o andamento ao vivo, as últimas entradas e o resultado.

const ATIVAS = ["na_fila", "rodando"];
const ORIGEM: Record<string, string> = { manual: "pelo botão", agendada: "agendada", notificacao: "convite em tempo real" };
const PARADA_MS = 90_000;

const hora = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const quando = (s: string) => {
  const d = new Date(s);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return `hoje às ${hora(s)}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora(s)}`;
  return `${d.toLocaleDateString("pt-BR")} às ${hora(s)}`;
};
const duracao = (de: string, ate?: string | null) => {
  const seg = Math.max(0, Math.round(((ate ? new Date(ate).getTime() : Date.now()) - new Date(de).getTime()) / 1000));
  return `${Math.floor(seg / 60)}min ${String(seg % 60).padStart(2, "0")}s`;
};
const faltaTabela = (msg: string) => /promo_runs|ml_notificacoes|run_id|does not exist|schema cache|relation/i.test(msg);

export default function AutomacaoPromocoes({
  skusAuto,
  anunciosAuto,
  porItem,
  onTerminou,
}: {
  skusAuto: number;
  anunciosAuto: number;
  porItem: Map<string, Listing>;
  onTerminou: () => void;
}) {
  const [rodada, setRodada] = useState<RodadaPromo | null>(null);
  const [carregou, setCarregou] = useState(false);
  const [feed, setFeed] = useState<AcaoPromo[]>([]);
  const [faltaSQL, setFaltaSQL] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [, setTique] = useState(0);
  const retomadaEm = useRef(0);
  const estavaAtiva = useRef(false);

  const ativa = !!rodada && ATIVAS.includes(rodada.status);

  const lerRodada = useCallback(async (id?: string) => {
    const q = id ? supabase.from("promo_runs").select("*").eq("id", id).limit(1) : supabase.from("promo_runs").select("*").order("criado_em", { ascending: false }).limit(1);
    const { data, error } = await q;
    if (error) {
      if (faltaTabela(error.message)) setFaltaSQL(true);
      return null;
    }
    setFaltaSQL(false);
    const r = ((data ?? [])[0] as RodadaPromo | undefined) ?? null;
    setRodada(r);
    return r;
  }, []);

  const lerFeed = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("promo_actions").select("*").eq("run_id", id).order("updated_at", { ascending: false }).limit(6);
    if (!error) setFeed((data ?? []) as AcaoPromo[]);
  }, []);

  // Primeira leitura
  useEffect(() => {
    (async () => {
      const r = await lerRodada();
      if (r) await lerFeed(r.id);
      setCarregou(true);
    })();
  }, [lerRodada, lerFeed]);

  // Acompanha a rodada em andamento a cada 2 s
  useEffect(() => {
    if (!ativa || !rodada) return;
    const id = setInterval(
      async () => {
        const r = await lerRodada(rodada.id);
        if (r && ATIVAS.includes(r.status)) {
          await lerFeed(r.id);
          // A continuação se perdeu (sem sinal há 90 s): pede para retomar, no máximo uma vez por minuto
          const ultimo = new Date(r.batida_em || r.criado_em).getTime();
          const travada = r.lease_ate ? new Date(r.lease_ate).getTime() > Date.now() : false;
          if (!travada && Date.now() - ultimo > PARADA_MS && Date.now() - retomadaEm.current > 60_000) {
            retomadaEm.current = Date.now();
            apiFetch("/api/ml/promocoes/auto", { method: "POST", body: JSON.stringify({ acao: "continuar" }) }).catch(() => undefined);
          }
        }
      },
      2000
    );
    return () => clearInterval(id);
  }, [ativa, rodada, lerRodada, lerFeed]);

  // Relógio da rodada
  useEffect(() => {
    if (!ativa) return;
    const id = setInterval(() => setTique((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [ativa]);

  // Quando a rodada termina: atualiza o log e o resumo da página
  useEffect(() => {
    if (estavaAtiva.current && !ativa && rodada) {
      lerFeed(rodada.id);
      onTerminou();
    }
    estavaAtiva.current = ativa;
  }, [ativa, rodada, lerFeed, onTerminou]);

  async function iniciar() {
    setErro("");
    setEnviando(true);
    try {
      const r = await apiFetch<{ rodada: RodadaPromo | null }>("/api/ml/promocoes/auto", { method: "POST", body: JSON.stringify({ acao: "iniciar" }) });
      if (r.rodada) {
        setRodada(r.rodada);
        setFeed([]);
      }
    } catch (e) {
      const msg = mensagemErro(e);
      if (/Falta criar as tabelas/i.test(msg)) setFaltaSQL(true);
      else setErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  async function parar() {
    setEnviando(true);
    try {
      const r = await apiFetch<{ rodada: RodadaPromo | null }>("/api/ml/promocoes/auto", { method: "POST", body: JSON.stringify({ acao: "parar" }) });
      if (r.rodada) setRodada(r.rodada);
      else await lerRodada();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const r = rodada;
  const porcentagem = r && r.total > 0 ? Math.min(100, Math.round((r.feitos / r.total) * 100)) : r && !ativa ? 100 : 0;
  const titulo = !r
    ? ""
    : r.status === "na_fila"
      ? "Começando: lendo as promoções abertas…"
      : r.status === "rodando"
        ? "Aplicando no servidor: pode fechar esta página que continua."
        : r.status === "concluida"
          ? r.erros > 0
            ? "Terminou, com alguns erros (o motivo está no log)."
            : r.avaliados === 0
              ? "Terminou: não havia convite novo para os seus SKUs."
              : "Terminou: tudo certo."
          : r.status === "cancelada"
            ? "Rodada parada."
            : "A rodada parou com erro.";
  const corPainel = !r
    ? ""
    : ativa
      ? "border-brand/30 bg-brand-light/40"
      : r.status === "concluida" && r.erros === 0
        ? "border-emerald-200 bg-emerald-50"
        : r.status === "erro"
          ? "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50";

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${skusAuto > 0 ? (ativa ? "animate-pulse bg-brand" : "bg-emerald-500") : "bg-slate-300"}`} />
            Promoção automática
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {skusAuto > 0 ? (
              <>
                Ligada em <b>{skusAuto}</b> SKU{skusAuto > 1 ? "s" : ""} ({anunciosAuto} anúncio{anunciosAuto === 1 ? "" : "s"} do Mercado Livre). Ao clicar em “Aplicar promoções”, o sistema entra nas promoções em que a margem, depois de custo, taxa, frete e imposto, atinge a mínima de cada SKU. Roda no servidor: pode fechar a página.
              </>
            ) : (
              <>
                Nenhum SKU ligado. Em <Link href="/dashboard/produtos/armazem" className="underline">Produtos armazém</Link>, marque “Promo auto” e defina a margem mínima (padrão 10%).
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ativa && (
            <button className="btn-ghost" onClick={parar} disabled={enviando}>
              Parar
            </button>
          )}
          <button className="btn" onClick={iniciar} disabled={ativa || enviando || skusAuto === 0 || faltaSQL}>
            {ativa ? "Aplicando…" : enviando ? "Começando…" : "Aplicar promoções"}
          </button>
        </div>
      </div>

      {faltaSQL && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            <b>Falta um passo no banco:</b> rode este SQL uma vez no Supabase (SQL Editor → New query → colar → Run). Ele cria a tabela que guarda o andamento de cada aplicação. Depois recarregue a página.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(SQL_AUTOMACAO_PROMOCOES).then(() => setCopiado(true), () => setCopiado(false));
              }}
            >
              {copiado ? "SQL copiado" : "Copiar o SQL"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => window.location.reload()}>
              Já rodei, recarregar
            </button>
          </div>
        </div>
      )}

      {carregou && r && !ativa && (
        <p className="text-xs text-slate-500">
          Última aplicação: {r.status === "concluida" ? "concluída" : r.status === "cancelada" ? "parada" : "com erro"} {quando(r.terminado_em || r.criado_em)} · {r.entraram} entraram · {r.recusados} de fora · {r.erros} erro{r.erros === 1 ? "" : "s"}
        </p>
      )}

      {r && (ativa || r.terminado_em) && (
        <div className={`space-y-3 rounded-2xl border p-4 ${corPainel}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">{titulo}</strong>
            <span className="font-mono text-xs text-slate-500">
              {duracao(r.iniciado_em || r.criado_em, ativa ? null : r.terminado_em)} · {ORIGEM[r.origem] ?? r.origem}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white shadow-inner">
            <div
              className={`h-full rounded-full transition-all duration-700 ${r.status === "erro" ? "bg-red-500" : !ativa && r.status === "concluida" ? "bg-emerald-500" : r.total === 0 && ativa ? "w-1/4 animate-pulse bg-brand" : "bg-brand"}`}
              style={r.total === 0 && ativa ? undefined : { width: `${porcentagem}%` }}
            />
          </div>
          <p className="text-xs text-slate-600">
            {r.total > 0
              ? `${r.feitos} de ${r.total} convites verificados (${porcentagem}%) · promoção ${Math.min(r.promocoes_feitas + (ativa ? 1 : 0), r.promocoes_total)} de ${r.promocoes_total}`
              : ativa
                ? "Lendo as promoções abertas das suas contas…"
                : "Nenhum convite para verificar."}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span>
              Avaliados: <b>{r.avaliados}</b>
            </span>
            <span className="text-emerald-700">
              Entraram: <b>{r.entraram}</b>
            </span>
            <span>
              Ficaram de fora: <b>{r.recusados}</b>
            </span>
            <span className={r.erros > 0 ? "text-red-700" : ""}>
              Erros: <b>{r.erros}</b>
            </span>
          </div>
          {r.erro && <p className="text-xs text-red-700">Último erro: {r.erro}</p>}
          {r.mensagem && <p className="text-xs text-amber-800">{r.mensagem}</p>}
          {feed.length > 0 && (
            <ul className="divide-y divide-white/60 rounded-xl bg-white/70 text-xs">
              {feed.map((f) => {
                const a = porItem.get(f.item_id);
                return (
                  <li key={f.id} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 px-3 py-2">
                    <span className={`badge ${f.status === "entrou" ? "bg-emerald-100 text-emerald-800" : f.status === "erro" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"}`}>
                      {f.status === "entrou" ? "Entrou" : f.status === "erro" ? "Erro" : "De fora"}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{hora(f.updated_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a?.title ?? f.item_id}</span> em {f.promotion_name ?? f.promotion_id}
                      {f.price != null && ` · ${brl(Number(f.price))}`}
                      {f.margin != null && ` · ${pct(Number(f.margin))}`}
                      {f.message && <span className="block text-slate-500">{f.message}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Como a promoção automática decide</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Só olha os anúncios cujo SKU tem “Promo auto”; a meta é a margem mínima do SKU (padrão 10%, pode ser negativa).</li>
          <li>Promoção em que você escolhe o preço (tradicional, do vendedor, do dia): entra no menor preço da faixa que ainda entrega a meta, conferindo no Mercado Livre a taxa e o frete reais nesse preço.</li>
          <li>Promoção com preço pronto do Mercado Livre (como “Impulsione suas vendas”) ou co-participação: entra se a margem nesse preço, já com o bônus do ML, chegar à meta.</li>
          <li>Oferta relâmpago, desconto por quantidade e cupons não entram sozinhos: precisam de decisão sua.</li>
          <li>Tudo vai para o log abaixo, com o motivo de cada entrada, recusa ou erro.</li>
        </ul>
      </details>
    </div>
  );
}
