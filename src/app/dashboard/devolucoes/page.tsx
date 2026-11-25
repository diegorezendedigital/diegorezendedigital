"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { brl } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";

type Devolucao = {
  mp: "mercado_livre" | "shopee";
  conta: string;
  contaNome: string;
  id: string;
  pedido: string;
  data: string;
  tipo: string;
  motivo: string;
  status: string;
  aberta: boolean;
  resultado: "comprador" | "vendedor" | "andamento" | "cancelada";
  produto: string;
  sku: string | null;
  qtd: number;
  venda: number;
  reembolso: number;
  freteIda: number;
  freteVolta: number;
  produtoPerdido: number;
  produtoVoltou: boolean | null;
  custo: number;
  link?: string;
  etapa?: Etapa;
  semCusto?: string | null;
  rastreio?: string | null;
  logisticaBruta?: string | null;
  custoPrevisto?: number;
  previstoObs?: string | null;
  atualizado?: string | null;
  tarifa?: number;
  fonte?: "extrato" | "estimativa";
  extrato?: { descricao: string; valor: number }[];
};

type Etapa = "aguardando_postagem" | "a_caminho" | "recebido" | "em_analise" | "reembolsado" | "a_favor" | "cancelada";
const ETAPAS: { id: Etapa; t: string; cor: string }[] = [
  { id: "aguardando_postagem", t: "Aguardando postagem", cor: "#d97706" },
  { id: "a_caminho", t: "A caminho", cor: "#2a78d6" },
  { id: "recebido", t: "Recebido", cor: "#0d9488" },
  { id: "em_analise", t: "Em análise", cor: "#7c3aed" },
  { id: "reembolsado", t: "Reembolsado", cor: "#dc2626" },
  { id: "a_favor", t: "A seu favor", cor: "#16a34a" },
  { id: "cancelada", t: "Cancelada", cor: "#64748b" },
];
// Casos salvos antes das etapas existirem
const etapaDe = (d: Devolucao): Etapa =>
  d.etapa ??
  (d.resultado === "comprador" ? "reembolsado" : d.resultado === "vendedor" ? "a_favor" : d.resultado === "cancelada" ? "cancelada" : d.produtoVoltou ? "recebido" : "em_analise");

const DIA = 86_400_000;
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (d: string, k: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + k * DIA).toISOString().slice(0, 10);
const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

const ATALHOS: { id: string; label: string; faixa: () => [string, string] }[] = [
  { id: "mes", label: "Este mês", faixa: () => [`${hojeSP().slice(0, 7)}-01`, hojeSP()] },
  {
    id: "mespassado",
    label: "Mês passado",
    faixa: () => {
      const fim = somaDias(`${hojeSP().slice(0, 7)}-01`, -1);
      return [`${fim.slice(0, 7)}-01`, fim];
    },
  },
  { id: "30d", label: "30 dias", faixa: () => [somaDias(hojeSP(), -29), hojeSP()] },
  { id: "90d", label: "90 dias", faixa: () => [somaDias(hojeSP(), -89), hojeSP()] },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RESULTADO: Record<Devolucao["resultado"], { t: string; cls: string }> = {
  comprador: { t: "Reembolsado ao comprador", cls: "bg-red-50 text-red-700 ring-red-200" },
  vendedor: { t: "A seu favor", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  andamento: { t: "Em andamento", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  cancelada: { t: "Cancelada", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export default function DevolucoesPage() {
  const [atalho, setAtalho] = useState("mes");
  const [de, setDe] = useState(() => `${hojeSP().slice(0, 7)}-01`);
  const [ate, setAte] = useState(hojeSP);
  const [itens, setItens] = useState<Devolucao[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [totalPedidos, setTotalPedidos] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroMp, setFiltroMp] = useState<"todos" | "mercado_livre" | "shopee">("todos");
  const [filtroEtapa, setFiltroEtapa] = useState<"todos" | Etapa>("todos");
  const [busca, setBusca] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  type Resp = { itens: Devolucao[]; erros: string[]; totalPedidos: number; ultima?: string | null; salvo?: boolean; novas?: number };
  const aplicar = (r: Resp) => {
    setItens(r.itens);
    setErros(r.erros);
    setTotalPedidos(r.totalPedidos);
    if (r.ultima) setUltima(r.ultima);
  };

  // Busca nos marketplaces só o que é novo ou ainda está aberto, e salva
  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setAviso(null);
    try {
      const r = await apiFetch<Resp>("/api/devolucoes", { method: "POST", body: JSON.stringify({ de, ate }) });
      aplicar(r);
      setAviso(r.novas ? `${r.novas} ${r.novas === 1 ? "caso novo ou atualizado" : "casos novos ou atualizados"}.` : "Nenhuma novidade.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSincronizando(false);
    }
  }, [de, ate]);

  // Abre na hora com o que já está salvo; depois busca novidades em segundo plano
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    let salvo = false;
    try {
      const r = await apiFetch<Resp>(`/api/devolucoes?de=${de}&ate=${ate}`);
      aplicar(r);
      salvo = !!r.salvo;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
    if (salvo) sincronizar();
  }, [de, ate, sincronizar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolher(id: string) {
    const a = ATALHOS.find((x) => x.id === id);
    if (!a) return;
    const [d1, d2] = a.faixa();
    setAtalho(id);
    setDe(d1);
    setAte(d2);
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter(
      (d) =>
        (filtroMp === "todos" || d.mp === filtroMp) &&
        (filtroEtapa === "todos" || etapaDe(d) === filtroEtapa) &&
        (!q || `${d.pedido} ${d.produto} ${d.sku ?? ""} ${d.motivo} ${d.contaNome}`.toLowerCase().includes(q))
    );
  }, [itens, filtroMp, filtroEtapa, busca]);

  // Contagem por etapa (respeita marketplace e busca, não a própria etapa)
  const porEtapa = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const m = new Map<string, number>();
    itens
      .filter((d) => (filtroMp === "todos" || d.mp === filtroMp) && (!q || `${d.pedido} ${d.produto} ${d.sku ?? ""} ${d.motivo} ${d.contaNome}`.toLowerCase().includes(q)))
      .forEach((d) => {
        m.set("todos", (m.get("todos") ?? 0) + 1);
        m.set(etapaDe(d), (m.get(etapaDe(d)) ?? 0) + 1);
      });
    return m;
  }, [itens, filtroMp, busca]);

  const tot = useMemo(
    () =>
      visiveis.reduce(
        (a, d) => ({
          custo: a.custo + d.custo,
          previsto: a.previsto + (d.custoPrevisto ?? 0),
          freteIda: a.freteIda + d.freteIda,
          freteVolta: a.freteVolta + d.freteVolta,
          perdido: a.perdido + d.produtoPerdido,
          reembolso: a.reembolso + d.reembolso,
          abertas: a.abertas + (d.aberta ? 1 : 0),
          comprador: a.comprador + (d.resultado === "comprador" ? 1 : 0),
          vendedor: a.vendedor + (d.resultado === "vendedor" ? 1 : 0),
        }),
        { custo: 0, previsto: 0, freteIda: 0, freteVolta: 0, perdido: 0, reembolso: 0, abertas: 0, comprador: 0, vendedor: 0 }
      ),
    [visiveis]
  );

  // Motivos mais comuns
  const motivos = useMemo(() => {
    const m = new Map<string, { qtd: number; custo: number }>();
    visiveis.forEach((d) => {
      const a = m.get(d.motivo) ?? { qtd: 0, custo: 0 };
      a.qtd += 1;
      a.custo += d.custo;
      m.set(d.motivo, a);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 6);
  }, [visiveis]);
  const maxMotivo = Math.max(1, ...motivos.map(([, v]) => v.qtd));

  // Produtos que mais voltam
  const produtos = useMemo(() => {
    const m = new Map<string, { qtd: number; custo: number }>();
    visiveis.forEach((d) => {
      const k = d.sku || d.produto;
      const a = m.get(k) ?? { qtd: 0, custo: 0 };
      a.qtd += 1;
      a.custo += d.custo;
      m.set(k, a);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 6);
  }, [visiveis]);

  const taxa = totalPedidos > 0 ? (itens.length / totalPedidos) * 100 : null;
  const kpis = [
    { t: "Reclamações e devoluções", v: String(visiveis.length), s: taxa != null ? `${taxa.toFixed(1).replace(".", ",")}% dos ${totalPedidos} pedidos do período` : "—", cor: "#6250d6" },
    { t: "Custo estimado", v: brl(tot.custo), s: tot.previsto > 0 ? `+ ${brl(tot.previsto)} previsto nas abertas por erro seu` : visiveis.length ? `média de ${brl(tot.custo / visiveis.length)} por caso` : "—", cor: "#dc2626" },
    { t: "Frete de volta", v: brl(tot.freteVolta), s: `+ ${brl(tot.freteIda)} de frete de ida perdido`, cor: "#eb6834" },
    { t: "Produtos que não voltaram", v: brl(tot.perdido), s: "custo dos produtos que ficaram com o comprador", cor: "#d55181" },
    { t: "Resultado", v: `${tot.comprador} × ${tot.vendedor}`, s: `reembolsados × a seu favor · ${tot.abertas} em andamento`, cor: "#1baf7a" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Devoluções e reclamações</h1>
          <p className="text-sm text-slate-600">Todos os pedidos com reclamação ou devolução no Mercado Livre e na Shopee, e quanto cada um custou para você.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-right text-[12px] text-slate-500">
            {sincronizando ? (
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />Buscando novidades…</span>
            ) : (
              <>
                {ultima && <>Atualizado em {new Date(ultima).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</>}
                {aviso && <span className="block">{aviso}</span>}
              </>
            )}
          </p>
          <button className="btn-ghost" onClick={sincronizar} disabled={carregando || sincronizando}>Buscar novidades</button>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => (
            <button key={a.id} onClick={() => escolher(a.id)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${atalho === a.id ? "bg-brand text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {a.label}
            </button>
          ))}
        </div>
        <div>
          <label className="label">De</label>
          <input type="date" className="input" value={de} max={ate} onChange={(e) => { setDe(e.target.value); setAtalho(""); }} />
        </div>
        <div>
          <label className="label">Até</label>
          <input type="date" className="input" value={ate} min={de} max={hojeSP()} onChange={(e) => { setAte(e.target.value); setAtalho(""); }} />
        </div>
        <div>
          <label className="label">Marketplace</label>
          <select className="input" value={filtroMp} onChange={(e) => setFiltroMp(e.target.value as typeof filtroMp)}>
            <option value="todos">Todos</option>
            <option value="mercado_livre">Mercado Livre</option>
            <option value="shopee">Shopee</option>
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="label">Buscar</label>
          <input className="input" placeholder="Pedido, produto, SKU ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {[{ id: "todos" as const, t: "Tudo", cor: "#5B3DF5" }, ...ETAPAS].map((e) => {
          const ativo = filtroEtapa === e.id;
          const qtd = porEtapa.get(e.id) ?? 0;
          return (
            <button
              key={e.id}
              onClick={() => setFiltroEtapa(e.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm transition-colors ${ativo ? "font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              style={ativo ? { borderColor: e.cor } : undefined}
            >
              {e.id !== "todos" && <span className="h-2 w-2 rounded-full" style={{ background: e.cor }} />}
              {e.t}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${ativo ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{qtd}</span>
            </button>
          );
        })}
      </div>

      {erro && <div className="card text-sm text-red-700">{erro}</div>}
      {erros.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          {erros.map((e) => <p key={e}>{/extrato/i.test(e) ? e : `Não foi possível buscar de ${e}`}</p>)}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.t} className="relative overflow-hidden rounded-xl border border-slate-100 bg-white px-4 py-3" style={{ background: `linear-gradient(135deg, ${k.cor}12, #ffffff)` }}>
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: k.cor }} />
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.t}</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums text-slate-900 ${carregando ? "opacity-40" : ""}`}>{k.v}</p>
            <p className="text-[11px] text-slate-500">{k.s}</p>
          </div>
        ))}
      </div>

      {visiveis.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <p className="mb-3 font-semibold">Motivos mais comuns</p>
            <div className="space-y-2.5">
              {motivos.map(([m, v]) => (
                <div key={m}>
                  <div className="flex justify-between text-[13px]">
                    <span className="truncate pr-3 text-slate-700">{m}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{v.qtd} · {brl(v.custo)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-[#6250d6]" style={{ width: `${(v.qtd / maxMotivo) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <p className="mb-3 font-semibold">Produtos que mais voltam</p>
            <div className="divide-y divide-slate-100 text-[13px]">
              {produtos.map(([p, v]) => (
                <div key={p} className="flex items-center justify-between py-2">
                  <span className="truncate pr-3 font-mono text-[12px] text-slate-700" title={p}>{p}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{v.qtd} {v.qtd === 1 ? "caso" : "casos"} · <b className="text-slate-800">{brl(v.custo)}</b></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="px-5 py-3">Pedido</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Motivo</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3 text-right">Venda</th>
              <th className="px-4 py-3 text-right">Frete de ida</th>
              <th className="px-4 py-3 text-right">Frete de volta</th>
              <th className="px-4 py-3 text-right">Produto perdido</th>
              <th className="px-4 py-3 text-right">Custo</th>
            </tr>
          </thead>
          <tbody>
            {carregando && itens.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">Buscando as reclamações e devoluções de cada conta…</td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">Nenhuma reclamação ou devolução neste período.</td></tr>
            )}
            {visiveis.map((d) => (
              <tr key={`${d.mp}-${d.id}`} className={`border-b border-slate-100 align-top ${carregando ? "opacity-50" : ""}`}>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <MarcaMP mp={d.mp} />
                    {d.link ? (
                      <a href={d.link} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-slate-800 hover:text-brand hover:underline">{d.pedido}</a>
                    ) : (
                      <span className="font-mono text-[13px] text-slate-800">{d.pedido}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="rounded bg-brand-light px-1.5 py-0.5 font-semibold text-brand">{d.contaNome}</span>
                    <span>{d.data ? br(d.data) : ""}</span>
                  </div>
                </td>
                <td className="max-w-[280px] px-4 py-4">
                  <p className="text-slate-800">{d.qtd > 1 && <b className="text-amber-600">{d.qtd}x </b>}{d.produto}</p>
                  {d.sku && <p className="font-mono text-[11px] text-slate-500">{d.sku}</p>}
                </td>
                <td className="max-w-[220px] px-4 py-4">
                  <p className="text-slate-700">{d.motivo}</p>
                  <p className="text-[11px] text-slate-500">{d.tipo}</p>
                </td>
                <td className="px-4 py-4">
                  {(() => {
                    const e = ETAPAS.find((x) => x.id === etapaDe(d))!;
                    return (
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1" style={{ color: e.cor, background: `${e.cor}12`, boxShadow: `inset 0 0 0 1px ${e.cor}40` }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.cor }} />
                        {e.t}
                      </span>
                    );
                  })()}
                  <p className="mt-1 text-[11px] text-slate-500">{d.status}</p>
                  {d.rastreio && <p className="font-mono text-[11px] text-slate-600">Rastreio {d.rastreio}</p>}
                  {d.logisticaBruta && <p className="text-[10px] text-slate-400" title="Status de logística informado pelo marketplace">{d.logisticaBruta}</p>}
                  {d.atualizado && <p className="text-[11px] text-slate-400">Atualizado {br(d.atualizado)}</p>}
                  {d.produtoVoltou === true && <p className="text-[11px] text-emerald-700">Produto voltou</p>}
                  {d.produtoVoltou === false && <p className="text-[11px] text-red-700">Produto não voltou</p>}
                </td>
                <td className="px-4 py-4 text-right tabular-nums">
                  {brl(d.venda)}
                  {d.reembolso > 0 && <div className="text-[11px] text-red-600">reembolso {brl(d.reembolso)}</div>}
                </td>
                <td className="px-4 py-4 text-right tabular-nums text-slate-700">{d.freteIda > 0 ? brl(d.freteIda) : "—"}</td>
                <td className="px-4 py-4 text-right tabular-nums text-slate-700">{d.freteVolta > 0 ? brl(d.freteVolta) : "—"}</td>
                <td className="px-4 py-4 text-right tabular-nums text-slate-700">{d.produtoPerdido > 0 ? brl(d.produtoPerdido) : "—"}</td>
                <td className={`px-4 py-4 text-right font-semibold tabular-nums ${d.custo > 0 ? "text-red-700" : "text-slate-400"}`}>
                  {d.custo > 0 ? `-${brl(d.custo)}` : (d.custoPrevisto ?? 0) > 0 ? <span className="text-amber-600">-{brl(d.custoPrevisto ?? 0)}</span> : brl(0)}
                  {d.custo === 0 && (d.custoPrevisto ?? 0) > 0 && <div className="mt-0.5 max-w-[14rem] text-[11px] font-normal text-amber-700">{d.previstoObs ?? "previsto"}</div>}
                  {(d.tarifa ?? 0) > 0 && <div className="mt-0.5 text-[11px] font-normal text-slate-500">inclui tarifa {brl(d.tarifa ?? 0)}</div>}
                  {d.semCusto && <div className="mt-0.5 text-[11px] font-normal text-emerald-700">{d.semCusto}</div>}
                  {d.mp === "mercado_livre" && (
                    d.fonte === "extrato" ? (
                      <span className="group relative mt-0.5 inline-block text-[11px] font-normal text-brand underline decoration-dotted">
                        pelo extrato do ML
                        <span className="absolute right-0 top-full z-40 hidden w-72 pt-1 text-left group-hover:block">
                          <span className="block rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
                            {(d.extrato ?? []).map((l, i) => (
                              <span key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
                                <span className="truncate">{l.descricao}</span>
                                <b className={l.valor < 0 ? "text-red-700" : "text-emerald-700"}>{l.valor < 0 ? "-" : "+"}{brl(Math.abs(l.valor))}</b>
                              </span>
                            ))}
                          </span>
                        </span>
                      </span>
                    ) : (
                      <div className="mt-0.5 text-[11px] font-normal text-slate-400" title="O extrato do Mercado Livre ainda não trouxe este pedido; o custo foi estimado pela regra.">estimado</div>
                    )
                  )}
                </td>
              </tr>
            ))}
            {visiveis.length > 1 && (
              <tr className="bg-slate-50 font-semibold">
                <td className="px-5 py-4" colSpan={4}>Total · {visiveis.length} casos</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(visiveis.reduce((t, d) => t + d.venda, 0))}</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.freteIda)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.freteVolta)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.perdido)}</td>
                <td className="px-4 py-4 text-right tabular-nums text-red-700">
                  -{brl(tot.custo)}
                  {tot.previsto > 0 && <div className="text-[11px] font-normal text-amber-700">+ {brl(tot.previsto)} previsto</div>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Em laranja = custo previsto de devoluções da Shopee ainda abertas por erro seu (produto errado, defeito, diferente do anúncio): frete de ida + frete de volta, estimado igual ao de ida até a Shopee lançar o valor real. Custo estimado = frete de ida perdido (quando a venda foi reembolsada) + frete da devolução cobrado de você + custo do produto quando há certeza de que ele não
        volta. No Mercado Livre, arrependimento/desistência e casos com cobertura do Mercado Livre não custam nada para você. Quando o produto volta, ele não entra no custo. A comissão costuma ser devolvida pelo marketplace no
        reembolso, por isso não entra.
      </p>
    </div>
  );
}
