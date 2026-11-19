"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { brl, pct } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";
import { GraficoLinhasSvg, MARGEM_L, type SerieLinha } from "@/components/ads/GraficoLinhas";

type Conta = {
  mp: "mercado_livre" | "shopee";
  conta: string;
  nome: string;
  gasto: number;
  vendasAds: number;
  pedidosAds: number;
  cliques: number;
  impressoes: number;
  faturamento: number;
  dias: { data: string; gasto: number; vendasAds: number }[];
  erro?: string;
};

const DIA = 86_400_000;
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (d: string, k: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + k * DIA).toISOString().slice(0, 10);
const br = (d: string) => d.split("-").reverse().join("/");
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");

const ATALHOS: { id: string; label: string; faixa: () => [string, string] }[] = [
  { id: "hoje", label: "Hoje", faixa: () => [hojeSP(), hojeSP()] },
  { id: "ontem", label: "Ontem", faixa: () => [somaDias(hojeSP(), -1), somaDias(hojeSP(), -1)] },
  { id: "7d", label: "7 dias", faixa: () => [somaDias(hojeSP(), -6), hojeSP()] },
  { id: "30d", label: "30 dias", faixa: () => [somaDias(hojeSP(), -29), hojeSP()] },
  { id: "mes", label: "Este mês", faixa: () => [`${hojeSP().slice(0, 7)}-01`, hojeSP()] },
  {
    id: "mespassado",
    label: "Mês passado",
    faixa: () => {
      const ini = `${hojeSP().slice(0, 7)}-01`;
      const fim = somaDias(ini, -1);
      return [`${fim.slice(0, 7)}-01`, fim];
    },
  },
];

// Período de comparação: mês anterior inteiro quando o período começa no dia 1; senão, o mesmo número de dias logo antes
function periodoAnterior(de: string, ate: string): [string, string] {
  if (de.endsWith("-01") && de.slice(0, 7) === ate.slice(0, 7)) {
    const fim = somaDias(de, -1);
    return [`${fim.slice(0, 7)}-01`, fim];
  }
  const dias = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / DIA) + 1;
  return [somaDias(de, -dias), somaDias(de, -1)];
}
const ultimoDiaDoMes = (d: string) => somaDias(`${somaDias(`${d.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);

const NOME_MP: Record<string, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee" };

export default function PublicidadePage() {
  const [atalho, setAtalho] = useState("mes");
  const [de, setDe] = useState(() => `${hojeSP().slice(0, 7)}-01`);
  const [ate, setAte] = useState(hojeSP);
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [contasAnt, setContasAnt] = useState<Conta[]>([]);
  const [filtroMp, setFiltroMp] = useState<"todos" | "mercado_livre" | "shopee">("todos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [a1, a2] = periodoAnterior(de, ate);
      const [r, ra] = await Promise.all([
        apiFetch<{ contas: Conta[] }>(`/api/ads?de=${de}&ate=${ate}`),
        apiFetch<{ contas: Conta[] }>(`/api/ads?de=${a1}&ate=${a2}`).catch(() => ({ contas: [] as Conta[] })),
      ]);
      setContas(r.contas);
      setContasAnt(ra.contas);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolherAtalho(id: string) {
    const a = ATALHOS.find((x) => x.id === id);
    if (!a) return;
    const [d1, d2] = a.faixa();
    setAtalho(id);
    setDe(d1);
    setAte(d2);
  }

  const visiveis = useMemo(() => contas.filter((c) => filtroMp === "todos" || c.mp === filtroMp), [contas, filtroMp]);
  const ok = visiveis.filter((c) => !c.erro);
  const tot = useMemo(
    () =>
      ok.reduce(
        (a, c) => ({
          gasto: a.gasto + c.gasto,
          vendasAds: a.vendasAds + c.vendasAds,
          pedidosAds: a.pedidosAds + c.pedidosAds,
          cliques: a.cliques + c.cliques,
          impressoes: a.impressoes + c.impressoes,
          faturamento: a.faturamento + c.faturamento,
        }),
        { gasto: 0, vendasAds: 0, pedidosAds: 0, cliques: 0, impressoes: 0, faturamento: 0 }
      ),
    [ok]
  );

  const okAnt = contasAnt.filter((c) => !c.erro && (filtroMp === "todos" || c.mp === filtroMp));
  const semDiario = ok.filter((c) => c.gasto > 0 && c.dias.length === 0).map((c) => c.nome);

  const roas = (gasto: number, vendas: number) => (gasto > 0 ? (vendas / gasto).toFixed(2).replace(".", ",") : "—");
  const acos = (gasto: number, vendas: number) => (vendas > 0 ? pct((gasto / vendas) * 100) : "—");
  const tacos = (gasto: number, fat: number) => (fat > 0 ? pct((gasto / fat) * 100) : "—");

  const kpis = [
    { t: "Investido em publicidade", v: brl(tot.gasto), s: `${br(de)}${de !== ate ? ` a ${br(ate)}` : ""}`, destaque: true },
    { t: "Vendas pela publicidade", v: brl(tot.vendasAds), s: `${int(tot.pedidosAds)} vendas atribuídas` },
    { t: "ROAS", v: roas(tot.gasto, tot.vendasAds), s: "vendas pelos ads ÷ investido" },
    { t: "ACOS", v: acos(tot.gasto, tot.vendasAds), s: "investido ÷ vendas pelos ads" },
    { t: "TACOS", v: tacos(tot.gasto, tot.faturamento), s: `investido ÷ faturamento total (${brl(tot.faturamento)})` },
    { t: "Cliques", v: int(tot.cliques), s: `CPC ${tot.cliques > 0 ? brl(tot.gasto / tot.cliques) : "—"} · ${int(tot.impressoes)} impressões` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Publicidade</h1>
          <p className="text-sm text-slate-600">Quanto cada conta investiu em publicidade no Mercado Livre e na Shopee, e o retorno disso.</p>
        </div>
        <button className="btn-ghost" onClick={carregar} disabled={carregando}>{carregando ? "Atualizando…" : "Atualizar"}</button>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => (
            <button
              key={a.id}
              onClick={() => escolherAtalho(a.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${atalho === a.id ? "bg-brand text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
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
      </div>

      {erro && <div className="card text-sm text-red-700">{erro}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.t} className={`card ${k.destaque ? "ring-1 ring-brand/30" : ""}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.t}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${carregando ? "opacity-40" : ""}`}>{k.v}</p>
            <p className="mt-1 text-[11px] text-slate-500">{k.s}</p>
          </div>
        ))}
      </div>

      {ok.length > 0 && <GraficosPublicidade contas={ok} contasAnt={okAnt} de={de} ate={ate} semDiario={semDiario} />}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="px-5 py-3">Conta</th>
              <th className="px-4 py-3 text-right">Investido</th>
              <th className="px-4 py-3 text-right">Vendas pela publicidade</th>
              <th className="px-4 py-3 text-right">ROAS</th>
              <th className="px-4 py-3 text-right">ACOS</th>
              <th className="px-4 py-3 text-right">Faturamento total</th>
              <th className="px-4 py-3 text-right">TACOS</th>
              <th className="px-4 py-3 text-right">Cliques</th>
              <th className="px-4 py-3 text-right">CPC</th>
            </tr>
          </thead>
          <tbody>
            {carregando && contas.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">Buscando os dados de publicidade de cada conta…</td></tr>
            )}
            {!carregando && visiveis.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">Nenhuma conta do Mercado Livre ou Shopee conectada.</td></tr>
            )}
            {visiveis.map((c) => (
              <tr key={`${c.mp}-${c.conta}`} className={`border-b border-slate-100 ${carregando ? "opacity-50" : ""}`}>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <MarcaMP mp={c.mp} />
                    <div>
                      <p className="font-medium">{c.nome}</p>
                      <p className="text-[11px] text-slate-500">{NOME_MP[c.mp]}</p>
                    </div>
                  </div>
                </td>
                {c.erro ? (
                  <td colSpan={8} className="px-4 py-4 text-[13px] text-amber-800">{c.erro}</td>
                ) : (
                  <>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">{brl(c.gasto)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{brl(c.vendasAds)}<div className="text-[11px] text-slate-500">{int(c.pedidosAds)} vendas</div></td>
                    <td className="px-4 py-4 text-right tabular-nums">{roas(c.gasto, c.vendasAds)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{acos(c.gasto, c.vendasAds)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{brl(c.faturamento)}</td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">{tacos(c.gasto, c.faturamento)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{int(c.cliques)}<div className="text-[11px] text-slate-500">{int(c.impressoes)} impr.</div></td>
                    <td className="px-4 py-4 text-right tabular-nums">{c.cliques > 0 ? brl(c.gasto / c.cliques) : "—"}</td>
                  </>
                )}
              </tr>
            ))}
            {ok.length > 1 && (
              <tr className="bg-slate-50 font-semibold">
                <td className="px-5 py-4">Total</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.gasto)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.vendasAds)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{roas(tot.gasto, tot.vendasAds)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{acos(tot.gasto, tot.vendasAds)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{brl(tot.faturamento)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{tacos(tot.gasto, tot.faturamento)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{int(tot.cliques)}</td>
                <td className="px-4 py-4 text-right tabular-nums">{tot.cliques > 0 ? brl(tot.gasto / tot.cliques) : "—"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Dados de Product Ads do Mercado Livre e de anúncios CPC da Shopee, direto das plataformas. Vendas pelos ads seguem a atribuição de cada
        plataforma. TACOS compara o investido com todo o faturamento da conta no período (pedidos sincronizados em Pedidos).
      </p>
    </div>
  );
}

/* ---------- Gráficos da publicidade ---------- */
type Metrica = "gasto" | "vendas" | "roas";
const COR_MET: Record<Metrica, string> = { gasto: "#6250d6", vendas: "#1baf7a", roas: "#d55181" };
const COR_ML = "#2a78d6";
const COR_SH = "#eb6834";
const COR_ANT = "#94a3b8";

const rotuloReais = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const rotuloRoas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function CartaoLinhas({
  titulo,
  subtitulo,
  datas,
  datasAnt,
  series,
  fmt,
  marcaX,
  extra,
}: {
  titulo: string;
  subtitulo: string;
  datas: string[];
  datasAnt: string[];
  series: SerieLinha[];
  fmt: (v: number) => string;
  marcaX?: { indice: number; texto: string } | null;
  extra?: React.ReactNode;
}) {
  const [sobre, setSobre] = useState<number | null>(null);
  const [largura, setLargura] = useState(900);
  const caixa = useRef<HTMLDivElement | null>(null);
  const ALTURA = 300;
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = datas.length;
  const pw = largura - MARGEM_L.esq - MARGEM_L.dir;
  function mover(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const xx = e.clientX - r.left - MARGEM_L.esq;
    if (xx < -10 || xx > pw + 10) return setSobre(null);
    setSobre(Math.min(n - 1, Math.max(0, Math.round((xx / pw) * (n - 1)))));
  }
  const xFoco = sobre != null ? MARGEM_L.esq + (n <= 1 ? pw / 2 : (pw * sobre) / (n - 1)) : 0;
  const direita = xFoco < largura * 0.6;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900">{titulo}</p>
          <p className="text-[12px] text-slate-500">{subtitulo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <svg width="22" height="8" aria-hidden>
                <line x1="1" x2="21" y1="4" y2="4" stroke={s.cor} strokeWidth={s.espessura ?? 2.5} strokeLinecap="round" strokeDasharray={s.estilo === "tracejada" ? "6 4" : s.estilo === "pontilhada" ? "1 4" : undefined} />
              </svg>
              {s.nome}
            </span>
          ))}
        </div>
      </div>
      {extra}
      <div ref={caixa} className="relative mt-4 select-none" onMouseMove={mover} onMouseLeave={() => setSobre(null)}>
        <GraficoLinhasSvg rotulosX={datas.map(ddmm)} series={series} largura={largura} altura={ALTURA} sobre={sobre} rotuloEixo={fmt} marcaX={marcaX} />
        {sobre != null && series.some((s) => s.valores[sobre] != null) && (
          <div
            className="pointer-events-none absolute z-10 w-60 rounded-xl border border-slate-200 bg-white/95 p-3 text-[12px] shadow-xl backdrop-blur"
            style={{ top: MARGEM_L.topo, ...(direita ? { left: xFoco + 16 } : { right: largura - xFoco + 16 }) }}
          >
            <p className="mb-2 font-semibold capitalize text-slate-900">
              {new Date(`${datas[sobre]}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
            </p>
            {series.map((s) => {
              const v = s.valores[sobre];
              if (v == null || !Number.isFinite(v)) return null;
              const ant = s.id.startsWith("ant") && datasAnt[sobre] ? ` (${ddmm(datasAnt[sobre])})` : "";
              return (
                <p key={s.id} className="mt-1 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />{s.nome}{ant}</span>
                  <b className="tabular-nums text-slate-900">{fmt === rotuloRoas ? rotuloRoas(v) : brl(v)}</b>
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function GraficosPublicidade({ contas, contasAnt, de, ate, semDiario }: { contas: Conta[]; contasAnt: Conta[]; de: string; ate: string; semDiario: string[] }) {
  const [metrica, setMetrica] = useState<Metrica>("gasto");
  const hoje = hojeSP();
  const fimDado = ate < hoje ? ate : hoje;
  // Mês corrente: o eixo vai até o fim do mês para mostrar a projeção
  const mesCorrente = de.endsWith("-01") && de.slice(0, 7) === hoje.slice(0, 7) && ate >= hoje;
  const fimEixo = mesCorrente ? ultimoDiaDoMes(de) : ate;
  const datas: string[] = [];
  for (let d = de; d <= fimEixo; d = somaDias(d, 1)) datas.push(d);
  const [a1, a2] = periodoAnterior(de, ate);
  const datasAnt: string[] = [];
  for (let d = a1; d <= a2; d = somaDias(d, 1)) datasAnt.push(d);
  const idxFim = datas.indexOf(fimDado);

  const somar = (cs: Conta[], ds: string[]) => {
    const pos = new Map(ds.map((d, i) => [d, i]));
    const z = () => ds.map(() => 0);
    const r = { ml: z(), sh: z(), vml: z(), vsh: z() };
    cs.forEach((c) =>
      c.dias.forEach((d) => {
        const i = pos.get(d.data);
        if (i == null) return;
        if (c.mp === "mercado_livre") { r.ml[i] += d.gasto; r.vml[i] += d.vendasAds; } else { r.sh[i] += d.gasto; r.vsh[i] += d.vendasAds; }
      })
    );
    return r;
  };
  const cur = somar(contas, datas);
  const ant = somar(contasAnt, datasAnt);
  const gasto = datas.map((_, i) => cur.ml[i] + cur.sh[i]);
  const vendas = datas.map((_, i) => cur.vml[i] + cur.vsh[i]);
  const gastoAnt = datasAnt.map((_, i) => ant.ml[i] + ant.sh[i]);
  const vendasAnt = datasAnt.map((_, i) => ant.vml[i] + ant.vsh[i]);

  const acumular = (v: number[], ate: number) => { let t = 0; return v.map((x, i) => (i <= ate ? (t += x) : null)); };
  const ateIdx = idxFim < 0 ? datas.length - 1 : idxFim;
  const cG = acumular(gasto, ateIdx), cV = acumular(vendas, ateIdx);
  const aG = acumular(gastoAnt, gastoAnt.length - 1), aV = acumular(vendasAnt, vendasAnt.length - 1);
  const alinhar = (v: (number | null)[]) => datas.map((_, i) => (i < v.length ? v[i] : null));

  const acum = metrica === "gasto" ? cG : metrica === "vendas" ? cV : cG.map((g, i) => (g && cV[i] != null ? (cV[i] as number) / g : null));
  const acumAnt = alinhar(metrica === "gasto" ? aG : metrica === "vendas" ? aV : aG.map((g, i) => (g ? (aV[i] as number) / g : null)));
  const atual = acum[ateIdx] ?? 0;
  const mediaDia = metrica === "roas" ? null : atual / (ateIdx + 1);
  const projecao: (number | null)[] =
    mesCorrente && metrica !== "roas" && ateIdx < datas.length - 1 ? datas.map((_, i) => (i < ateIdx ? null : atual + (mediaDia ?? 0) * (i - ateIdx))) : [];
  const projFim = projecao.length ? (projecao[projecao.length - 1] as number) : null;
  const antMesmoPonto = acumAnt[ateIdx];
  const antTotal = metrica === "gasto" ? aG[aG.length - 1] : metrica === "vendas" ? aV[aV.length - 1] : null;
  const variacao = antMesmoPonto && antMesmoPonto > 0 ? ((atual - antMesmoPonto) / antMesmoPonto) * 100 : null;
  const cor = COR_MET[metrica];
  const fmt = metrica === "roas" ? rotuloRoas : rotuloReais;
  const fmtCheio = (v: number) => (metrica === "roas" ? rotuloRoas(v) : brl(v));
  const nomeMet = metrica === "gasto" ? "Investido" : metrica === "vendas" ? "Vendas pela publicidade" : "ROAS";
  const nomeAnt = de.endsWith("-01") && de.slice(0, 7) === ate.slice(0, 7) ? "Mês anterior" : "Período anterior";
  // Para investido, subir é custo (neutro/alerta); para vendas e ROAS, subir é bom
  const corVar = variacao == null ? "text-slate-500" : metrica === "gasto" ? (variacao > 0 ? "text-amber-600" : "text-emerald-600") : variacao >= 0 ? "text-emerald-600" : "text-red-600";

  const seriesAcum: SerieLinha[] = [
    { id: "ant", nome: nomeAnt, cor: COR_ANT, valores: acumAnt, estilo: "tracejada", espessura: 2 },
    ...(projecao.length ? [{ id: "proj", nome: "Projeção", cor, valores: projecao, estilo: "pontilhada" as const, espessura: 3, pontoFinal: true }] : []),
    { id: "atual", nome: `${nomeMet} acumulado`, cor, valores: acum, area: true, espessura: 3, pontoFinal: true },
  ];

  // Por dia: Mercado Livre, Shopee, total e o total do período anterior
  const diaML = metrica === "gasto" ? cur.ml : metrica === "vendas" ? cur.vml : cur.ml.map((g, i) => (g > 0 ? cur.vml[i] / g : null));
  const diaSH = metrica === "gasto" ? cur.sh : metrica === "vendas" ? cur.vsh : cur.sh.map((g, i) => (g > 0 ? cur.vsh[i] / g : null));
  const diaTot = metrica === "gasto" ? gasto : metrica === "vendas" ? vendas : gasto.map((g, i) => (g > 0 ? vendas[i] / g : null));
  const diaAnt = metrica === "gasto" ? gastoAnt : metrica === "vendas" ? vendasAnt : gastoAnt.map((g, i) => (g > 0 ? vendasAnt[i] / g : null));
  const corta = (v: (number | null)[]) => datas.map((_, i) => (i <= ateIdx ? v[i] ?? null : null));
  const temML = cur.ml.some((x) => x > 0), temSH = cur.sh.some((x) => x > 0);
  const seriesDia: SerieLinha[] = [
    { id: "ant-dia", nome: `${nomeAnt} (total)`, cor: COR_ANT, valores: alinhar(diaAnt), estilo: "tracejada", espessura: 2 },
    ...(temML ? [{ id: "ml", nome: "Mercado Livre", cor: COR_ML, valores: corta(diaML), espessura: 2.5 }] : []),
    ...(temSH ? [{ id: "sh", nome: "Shopee", cor: COR_SH, valores: corta(diaSH), espessura: 2.5 }] : []),
    ...(temML && temSH ? [{ id: "tot", nome: "Total", cor, valores: corta(diaTot), espessura: 3, area: true }] : []),
  ];

  const blocos = [
    { t: `${nomeMet} até ${ddmm(datas[ateIdx])}`, v: fmtCheio(atual), cor, sub: mediaDia != null ? `média de ${brl(mediaDia)} por dia` : "retorno acumulado no período" },
    ...(projFim != null ? [{ t: `Projeção até ${ddmm(datas[datas.length - 1])}`, v: fmtCheio(projFim), cor, sub: "se mantiver a média por dia", tracejado: true }] : []),
    {
      t: `${nomeAnt} no mesmo ponto`,
      v: antMesmoPonto != null ? fmtCheio(antMesmoPonto) : "—",
      cor: COR_ANT,
      sub: variacao != null ? <span className={`font-semibold ${corVar}`}>{variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(0)}% este período</span> : "sem dados para comparar",
    },
    ...(antTotal != null ? [{ t: `${nomeAnt} fechado`, v: fmtCheio(antTotal), cor: COR_ANT, sub: `${ddmm(a1)} a ${ddmm(a2)}` }] : []),
  ];

  const resumo = (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {blocos.map((b) => (
        <div key={b.t} className="relative overflow-hidden rounded-xl border border-slate-100 px-4 py-3" style={{ background: `linear-gradient(135deg, ${b.cor}14, ${b.cor}05)` }}>
          <span className="absolute inset-y-0 left-0 w-1" style={{ background: b.cor, opacity: "tracejado" in b ? 0.5 : 1 }} />
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{b.t}</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{b.v}</p>
          <p className="text-[11px] text-slate-500">{b.sub}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Comparando com {nomeAnt.toLowerCase()} ({ddmm(a1)} a {ddmm(a2)}).
        </p>
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[13px]">
          {([["gasto", "Investido"], ["vendas", "Vendas pela publicidade"], ["roas", "ROAS"]] as [Metrica, string][]).map(([id, t]) => (
            <button
              key={id}
              onClick={() => setMetrica(id)}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium transition-colors ${metrica === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: COR_MET[id] }} />
              {t}
            </button>
          ))}
        </div>
      </div>

      <CartaoLinhas
        titulo={`Evolução ${metrica === "roas" ? "do ROAS" : "acumulada"}`}
        subtitulo={mesCorrente ? "Linha cheia: até hoje · pontilhada: projeção até o fim do mês · tracejada: mês anterior" : `Linha cheia: ${br(de)} a ${br(ate)} · tracejada: ${nomeAnt.toLowerCase()}`}
        datas={datas}
        datasAnt={datasAnt}
        series={seriesAcum}
        fmt={fmt}
        marcaX={mesCorrente && ateIdx < datas.length - 1 ? { indice: ateIdx, texto: "hoje" } : null}
        extra={resumo}
      />

      <CartaoLinhas
        titulo="Dia a dia"
        subtitulo="Como cada marketplace sobe e desce por dia, comparado com o período anterior"
        datas={datas}
        datasAnt={datasAnt}
        series={seriesDia}
        fmt={fmt}
        marcaX={mesCorrente && ateIdx < datas.length - 1 ? { indice: ateIdx, texto: "hoje" } : null}
      />

      {semDiario.length > 0 && (
        <p className="text-[11px] text-amber-700">{semDiario.join(", ")}: a plataforma mandou só o total do período, sem o detalhe por dia, então não aparece nos gráficos.</p>
      )}
    </div>
  );
}
