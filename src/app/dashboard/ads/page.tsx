"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { brl, pct } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";

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
const COR_ML = "#2a78d6"; // azul (série 1)
const COR_SH = "#eb6834"; // laranja (série 2)
const COR_ROAS = "#1baf7a";

// Teto "redondo" do eixo e 4 divisões
function escala(max: number) {
  if (max <= 0) return { topo: 1, passos: [0, 0.25, 0.5, 0.75, 1] };
  const bruto = max / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((x) => x >= bruto) ?? 10 * pot;
  const topo = passo * 4;
  return { topo, passos: [0, 1, 2, 3, 4].map((i) => i * passo) };
}
const compacto = (v: number, metrica: Metrica) =>
  metrica === "roas" ? v.toFixed(1).replace(".", ",") : v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v)}`;

function GraficoAds({ serie, semDiario }: { serie: PontoAds[]; semDiario: string[] }) {
  const [metrica, setMetrica] = useState<Metrica>("gasto");
  const [sobre, setSobre] = useState<number | null>(null);
  const valorDe = (d: PontoAds) => (metrica === "gasto" ? d.gasto : metrica === "vendas" ? d.vendas : d.gasto > 0 ? d.vendas / d.gasto : 0);
  const { topo, passos } = escala(Math.max(...serie.map(valorDe)));
  const altura = 220;
  const n = serie.length;
  const cadaRotulo = Math.max(1, Math.ceil(n / 8));
  const media = serie.reduce((t, d) => t + valorDe(d), 0) / Math.max(1, metrica === "roas" ? serie.filter((d) => d.gasto > 0).length : n);
  const d = sobre != null ? serie[sobre] : null;
  const temML = serie.some((x) => x.ml > 0 || x.vml > 0);
  const temSH = serie.some((x) => x.sh > 0 || x.vsh > 0);

  // Linha do ROAS (SVG esticado; só a linha, o texto fica em HTML)
  const pontosRoas = serie.map((x, i) => `${((i + 0.5) / n) * 100},${100 - (valorDe(x) / topo) * 100}`).join(" ");

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Ads por dia</p>
          <p className="text-[12px] text-slate-500">
            Média por dia: <b className="text-slate-700">{metrica === "roas" ? compacto(media, "roas") : brl(media)}</b>
          </p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-1 text-[13px]">
          {([["gasto", "Investido"], ["vendas", "Vendas pelos ads"], ["roas", "ROAS"]] as [Metrica, string][]).map(([id, t]) => (
            <button key={id} onClick={() => setMetrica(id)} className={`rounded-full px-3.5 py-1 font-medium ${metrica === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {metrica !== "roas" && (temML || temSH) && (
        <div className="mb-3 flex gap-4 text-[12px] text-slate-600">
          {temML && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_ML }} />Mercado Livre</span>}
          {temSH && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_SH }} />Shopee</span>}
        </div>
      )}

      <div className="flex gap-2">
        {/* Eixo Y */}
        <div className="relative w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-400" style={{ height: altura }}>
          {passos.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (v / topo) * 100}%` }}>{compacto(v, metrica)}</span>
          ))}
        </div>

        <div className="relative flex-1" style={{ height: altura }} onMouseLeave={() => setSobre(null)}>
          {/* Grade */}
          {passos.map((v) => (
            <div key={v} className={`absolute inset-x-0 border-t ${v === 0 ? "border-slate-300" : "border-dashed border-slate-100"}`} style={{ top: `${100 - (v / topo) * 100}%` }} />
          ))}

          {/* Barras empilhadas (investido ou vendas) */}
          {metrica !== "roas" && (
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {serie.map((x, i) => {
                const a = metrica === "gasto" ? x.ml : x.vml;
                const b = metrica === "gasto" ? x.sh : x.vsh;
                const apagado = sobre != null && sobre !== i;
                return (
                  <div key={x.data} className="flex h-full flex-1 flex-col justify-end" style={{ opacity: apagado ? 0.45 : 1 }}>
                    {b > 0 && <div className={`w-full ${a > 0 ? "" : "rounded-b-none"} rounded-t-[4px]`} style={{ height: `${(b / topo) * 100}%`, background: COR_SH, minHeight: 2 }} />}
                    {b > 0 && a > 0 && <div className="h-[2px] w-full bg-white" />}
                    {a > 0 && <div className={`w-full ${b > 0 ? "" : "rounded-t-[4px]"}`} style={{ height: `${(a / topo) * 100}%`, background: COR_ML, minHeight: 2 }} />}
                  </div>
                );
              })}
            </div>
          )}

          {/* Linha do ROAS */}
          {metrica === "roas" && (
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points={pontosRoas} fill="none" stroke={COR_ROAS} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          )}
          {metrica === "roas" &&
            serie.map((x, i) =>
              x.gasto > 0 ? (
                <span
                  key={x.data}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white"
                  style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${(valorDe(x) / topo) * 100}%`, background: COR_ROAS, transform: `translate(-50%, 50%) scale(${sobre === i ? 1.4 : 1})` }}
                />
              ) : null
            )}

          {/* Áreas de toque por dia + linha guia */}
          <div className="absolute inset-0 flex">
            {serie.map((x, i) => (
              <div key={x.data} className="relative h-full flex-1 cursor-crosshair" onMouseEnter={() => setSobre(i)}>
                {sobre === i && <div className="absolute inset-y-0 left-1/2 border-l border-slate-300" />}
              </div>
            ))}
          </div>

          {/* Detalhe do dia */}
          {d && sobre != null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-52 rounded-lg bg-slate-900 p-3 text-[12px] text-white shadow-lg"
              style={sobre / n > 0.6 ? { right: `${(1 - sobre / n) * 100 + 1}%` } : { left: `${((sobre + 1) / n) * 100 + 1}%` }}
            >
              <p className="mb-1.5 font-semibold">{new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</p>
              {temML && <p className="flex justify-between gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COR_ML }} />Mercado Livre</span><span className="tabular-nums">{brl(d.ml)}</span></p>}
              {temSH && <p className="flex justify-between gap-3"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COR_SH }} />Shopee</span><span className="tabular-nums">{brl(d.sh)}</span></p>}
              <div className="my-1.5 border-t border-white/15" />
              <p className="flex justify-between gap-3"><span>Investido</span><b className="tabular-nums">{brl(d.gasto)}</b></p>
              <p className="flex justify-between gap-3"><span>Vendas pelos ads</span><span className="tabular-nums">{brl(d.vendas)}</span></p>
              <p className="flex justify-between gap-3"><span>ROAS</span><span className="tabular-nums">{d.gasto > 0 ? (d.vendas / d.gasto).toFixed(2).replace(".", ",") : "—"}</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Eixo X */}
      <div className="ml-[72px] mt-2 flex text-[11px] text-slate-400">
        {serie.map((x, i) => (
          <span key={x.data} className="flex-1 text-center tabular-nums">{i % cadaRotulo === 0 || i === n - 1 ? x.data.slice(8, 10) + "/" + x.data.slice(5, 7) : ""}</span>
        ))}
      </div>

      {semDiario.length > 0 && (
        <p className="mt-3 text-[11px] text-amber-700">{semDiario.join(", ")}: a plataforma mandou só o total do período, sem o detalhe por dia, então não aparece no gráfico.</p>
      )}
    </div>
  );
}
