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

  // Gasto por dia somando as contas
  const serie = useMemo(() => {
    const m = new Map<string, { gasto: number; vendasAds: number }>();
    for (let d = de; d <= ate; d = somaDias(d, 1)) m.set(d, { gasto: 0, vendasAds: 0 });
    ok.forEach((c) => c.dias.forEach((d) => { const a = m.get(d.data); if (a) { a.gasto += d.gasto; a.vendasAds += d.vendasAds; } }));
    return Array.from(m.entries()).map(([data, v]) => ({ data, ...v }));
  }, [ok, de, ate]);
  const temSerie = serie.length > 1 && serie.some((d) => d.gasto > 0);
  const maxDia = Math.max(1, ...serie.map((d) => d.gasto));

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

      {temSerie && (
        <div className="card">
          <p className="mb-3 font-semibold">Investido por dia</p>
          <div className="flex h-40 items-end gap-[2px]">
            {serie.map((d) => (
              <div key={d.data} className="group relative flex h-full flex-1 items-end">
                <div className="w-full rounded-t-[4px] bg-brand/80 transition-colors group-hover:bg-brand" style={{ height: `${Math.max(d.gasto > 0 ? 2 : 0, (d.gasto / maxDia) * 100)}%` }} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white group-hover:block">
                  {br(d.data)} · {brl(d.gasto)} investido · {brl(d.vendasAds)} em vendas
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{br(serie[0].data)}</span>
            <span>{br(serie[serie.length - 1].data)}</span>
          </div>
        </div>
      )}

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
