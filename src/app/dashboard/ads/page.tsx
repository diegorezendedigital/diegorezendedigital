"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { brl, pct } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";
import { CORES, GraficoDiarioSvg, MARGEM, type PontoGrafico } from "@/components/ads/GraficoDiario";

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

const NOME_MP: Record<string, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee" };

export default function AdsPage() {
  const [atalho, setAtalho] = useState("7d");
  const [de, setDe] = useState(() => somaDias(hojeSP(), -6));
  const [ate, setAte] = useState(hojeSP);
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroMp, setFiltroMp] = useState<"todos" | "mercado_livre" | "shopee">("todos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiFetch<{ contas: Conta[] }>(`/api/ads?de=${de}&ate=${ate}`);
      setContas(r.contas);
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

  // Série diária por marketplace (somando as contas de cada um)
  const serie = useMemo(() => {
    const m = new Map<string, { ml: number; sh: number; vml: number; vsh: number }>();
    for (let d = de; d <= ate; d = somaDias(d, 1)) m.set(d, { ml: 0, sh: 0, vml: 0, vsh: 0 });
    ok.forEach((c) =>
      c.dias.forEach((d) => {
        const a = m.get(d.data);
        if (!a) return;
        if (c.mp === "mercado_livre") { a.ml += d.gasto; a.vml += d.vendasAds; } else { a.sh += d.gasto; a.vsh += d.vendasAds; }
      })
    );
    return Array.from(m.entries()).map(([data, v]) => ({ data, ...v, gasto: v.ml + v.sh, vendas: v.vml + v.vsh }));
  }, [ok, de, ate]);
  const temSerie = serie.length > 1 && serie.some((d) => d.gasto > 0 || d.vendas > 0);
  // Contas que trouxeram total mas não o detalhe por dia (o gráfico fica incompleto para elas)
  const semDiario = ok.filter((c) => c.gasto > 0 && c.dias.length === 0).map((c) => c.nome);

  const roas = (gasto: number, vendas: number) => (gasto > 0 ? (vendas / gasto).toFixed(2).replace(".", ",") : "—");
  const acos = (gasto: number, vendas: number) => (vendas > 0 ? pct((gasto / vendas) * 100) : "—");
  const tacos = (gasto: number, fat: number) => (fat > 0 ? pct((gasto / fat) * 100) : "—");

  const kpis = [
    { t: "Investido em ads", v: brl(tot.gasto), s: `${br(de)}${de !== ate ? ` a ${br(ate)}` : ""}`, destaque: true },
    { t: "Vendas pelos ads", v: brl(tot.vendasAds), s: `${int(tot.pedidosAds)} vendas atribuídas` },
    { t: "ROAS", v: roas(tot.gasto, tot.vendasAds), s: "vendas pelos ads ÷ investido" },
    { t: "ACOS", v: acos(tot.gasto, tot.vendasAds), s: "investido ÷ vendas pelos ads" },
    { t: "TACOS", v: tacos(tot.gasto, tot.faturamento), s: `investido ÷ faturamento total (${brl(tot.faturamento)})` },
    { t: "Cliques", v: int(tot.cliques), s: `CPC ${tot.cliques > 0 ? brl(tot.gasto / tot.cliques) : "—"} · ${int(tot.impressoes)} impressões` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ads</h1>
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

      {temSerie && <GraficoAds serie={serie} semDiario={semDiario} />}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="px-5 py-3">Conta</th>
              <th className="px-4 py-3 text-right">Investido</th>
              <th className="px-4 py-3 text-right">Vendas pelos ads</th>
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
              <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">Buscando os dados de ads de cada conta…</td></tr>
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

/* ---------- Gráfico diário ---------- */
type PontoAds = { data: string; ml: number; sh: number; vml: number; vsh: number; gasto: number; vendas: number };
type Metrica = "gasto" | "vendas" | "roas";

const rotuloReais = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const rotuloRoas = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function GraficoAds({ serie, semDiario }: { serie: PontoAds[]; semDiario: string[] }) {
  const [metrica, setMetrica] = useState<Metrica>("gasto");
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

  const n = serie.length;
  const pontos: PontoGrafico[] = serie.map((d) =>
    metrica === "gasto" ? { data: d.data, a: d.ml, b: d.sh } : metrica === "vendas" ? { data: d.data, a: d.vml, b: d.vsh } : { data: d.data, a: d.gasto > 0 ? d.vendas / d.gasto : 0, b: 0 }
  );
  const totA = pontos.reduce((t, p) => t + p.a, 0);
  const totB = pontos.reduce((t, p) => t + p.b, 0);
  const somaGasto = serie.reduce((t, d) => t + d.gasto, 0);
  const somaVendas = serie.reduce((t, d) => t + d.vendas, 0);
  const diasComAds = serie.filter((d) => d.gasto > 0).length;
  const media = metrica === "roas" ? (somaGasto > 0 ? somaVendas / somaGasto : 0) : (totA + totB) / Math.max(1, n);
  const pico = pontos.reduce((m, p, i) => (p.a + p.b > pontos[m].a + pontos[m].b ? i : m), 0);
  const fmt = metrica === "roas" ? rotuloRoas : rotuloReais;
  const fmtCheio = (v: number) => (metrica === "roas" ? rotuloRoas(v) : brl(v));

  const resumo =
    metrica === "roas"
      ? [
          { t: "ROAS do período", v: rotuloRoas(media), cor: CORES.linha },
          { t: "Melhor dia", v: n ? `${rotuloRoas(pontos[pico].a)} · ${br(serie[pico].data).slice(0, 5)}` : "—" },
          { t: "Dias com ads", v: `${diasComAds} de ${n}` },
        ]
      : [
          { t: metrica === "gasto" ? "Total investido" : "Total vendido pelos ads", v: brl(totA + totB) },
          { t: "Mercado Livre", v: brl(totA), cor: CORES.a },
          { t: "Shopee", v: brl(totB), cor: CORES.b },
          { t: "Média por dia", v: brl(media) },
          { t: "Maior dia", v: n ? `${brl(pontos[pico].a + pontos[pico].b)} · ${br(serie[pico].data).slice(0, 5)}` : "—" },
        ];

  function mover(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - MARGEM.esq;
    const pw = largura - MARGEM.esq - MARGEM.dir;
    if (x < 0 || x > pw) return setSobre(null);
    setSobre(Math.min(n - 1, Math.max(0, Math.floor((x / pw) * n))));
  }

  const d = sobre != null ? serie[sobre] : null;
  const xFoco = sobre != null ? MARGEM.esq + ((largura - MARGEM.esq - MARGEM.dir) / n) * (sobre + 0.5) : 0;
  const tipDireita = xFoco < largura * 0.62;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-slate-900">Desempenho diário</p>
          <p className="text-[12px] text-slate-500">{br(serie[0].data)} a {br(serie[n - 1].data)} · todas as contas filtradas</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[13px]">
          {([["gasto", "Investido"], ["vendas", "Vendas pelos ads"], ["roas", "ROAS"]] as [Metrica, string][]).map(([id, t]) => (
            <button
              key={id}
              onClick={() => setMetrica(id)}
              className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${metrica === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-100 bg-slate-100 sm:grid-cols-3 lg:grid-cols-5">
        {resumo.map((k) => (
          <div key={k.t} className="bg-white px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {k.cor && <span className="h-2 w-2 rounded-full" style={{ background: k.cor }} />}
              {k.t}
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{k.v}</p>
          </div>
        ))}
      </div>

      <div ref={caixa} className="relative mt-5 select-none" onMouseMove={mover} onMouseLeave={() => setSobre(null)}>
        <GraficoDiarioSvg serie={pontos} modo={metrica === "roas" ? "linha" : "barras"} largura={largura} altura={ALTURA} sobre={sobre} rotuloEixo={fmt} media={media} />

        {d && sobre != null && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-xl border border-slate-200 bg-white p-3 text-[12px] shadow-xl"
            style={{ top: MARGEM.topo, ...(tipDireita ? { left: xFoco + 18 } : { right: largura - xFoco + 18 }) }}
          >
            <p className="mb-2 font-semibold capitalize text-slate-900">
              {new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
            </p>
            {metrica === "roas" ? (
              <p className="flex items-baseline justify-between"><span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: CORES.linha }} />ROAS</span><b className="text-base tabular-nums text-slate-900">{d.gasto > 0 ? rotuloRoas(d.vendas / d.gasto) : "—"}</b></p>
            ) : (
              <>
                <p className="flex justify-between"><span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: CORES.a }} />Mercado Livre</span><span className="tabular-nums text-slate-800">{fmtCheio(pontos[sobre].a)}</span></p>
                <p className="mt-1 flex justify-between"><span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-sm" style={{ background: CORES.b }} />Shopee</span><span className="tabular-nums text-slate-800">{fmtCheio(pontos[sobre].b)}</span></p>
                <p className="mt-2 flex justify-between border-t border-slate-100 pt-2"><span className="text-slate-500">Total</span><b className="tabular-nums text-slate-900">{fmtCheio(pontos[sobre].a + pontos[sobre].b)}</b></p>
              </>
            )}
            <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              {metrica !== "gasto" && <p className="flex justify-between"><span>Investido</span><span className="tabular-nums">{brl(d.gasto)}</span></p>}
              {metrica !== "vendas" && <p className="flex justify-between"><span>Vendas pelos ads</span><span className="tabular-nums">{brl(d.vendas)}</span></p>}
              {metrica !== "roas" && <p className="flex justify-between"><span>ROAS</span><span className="tabular-nums">{d.gasto > 0 ? rotuloRoas(d.vendas / d.gasto) : "—"}</span></p>}
            </div>
          </div>
        )}
      </div>

      {metrica !== "roas" && (
        <div className="mt-2 flex items-center justify-center gap-5 text-[12px] text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CORES.a }} />Mercado Livre</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CORES.b }} />Shopee</span>
          <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-slate-500" />Média por dia</span>
        </div>
      )}

      {semDiario.length > 0 && (
        <p className="mt-3 text-[11px] text-amber-700">{semDiario.join(", ")}: a plataforma mandou só o total do período, sem o detalhe por dia, então não aparece no gráfico.</p>
      )}
    </div>
  );
}
