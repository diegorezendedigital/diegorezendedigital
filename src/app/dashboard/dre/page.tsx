"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { lojaAtual } from "@/lib/loja";
import { CATEGORIAS_DESPESA, Expense, brl, intervaloDoMes, mesAtual, num, pct } from "@/lib/types";

type VendaDre = { sold_at: string; sale_price: number; cost_price: number | null; fees_total: number | null; shipping_cost: number | null; tax_amount: number | null };
type Linha = { receita: number; custo: number; taxas: number; frete: number; impostos: number; lucroVendas: number; ads: number; despesas: number; resultado: number; margem: number };

// Cores por papel (paleta validada; os valores sempre aparecem escritos ao lado)
const COR = { ads: "#0891b2", receita: "#5B3DF5", custo: "#2a78d6", taxas: "#eb6834", frete: "#6250d6", impostos: "#eda100", lucro: "#1baf7a", despesas: "#e87ba4", resultado: "#0f766e" };

const n = (x: number | null | undefined) => Number(x) || 0;
const nomeMes = (m: string, curto = false) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("pt-BR", curto ? { month: "short" } : { month: "long", year: "numeric" }).replace(".", "");
const somarMes = (m: string, d: number) => {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + (mm - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const rotuloCat = (c: string) => CATEGORIAS_DESPESA.find((x) => x.id === c)?.label ?? c;

function calcular(vs: VendaDre[], despesas: number, ads = 0): Linha {
  const receita = vs.reduce((t, v) => t + n(v.sale_price), 0);
  const custo = vs.reduce((t, v) => t + n(v.cost_price), 0);
  const taxas = vs.reduce((t, v) => t + n(v.fees_total), 0);
  const frete = vs.reduce((t, v) => t + n(v.shipping_cost), 0);
  const impostos = vs.reduce((t, v) => t + n(v.tax_amount), 0);
  const lucroVendas = receita - custo - taxas - frete - impostos;
  const resultado = lucroVendas - ads - despesas;
  return { receita, custo, taxas, frete, impostos, lucroVendas, ads, despesas, resultado, margem: receita > 0 ? (resultado / receita) * 100 : 0 };
}

function Delta({ a, b, inverso = false }: { a: number; b: number; inverso?: boolean }) {
  if (!b) return <span className="text-[11px] text-slate-400">—</span>;
  const d = ((a - b) / Math.abs(b)) * 100;
  const bom = inverso ? d <= 0 : d >= 0;
  return <span className={`text-[11px] font-semibold ${bom ? "text-emerald-600" : "text-red-600"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}%</span>;
}

// Cascata: da receita até o resultado líquido, cada desconto como um degrau
function Cascata({ l }: { l: Linha }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const passos = [
    { nome: "Receita", valor: l.receita, cor: COR.receita, tipo: "total" as const },
    { nome: "Custo", valor: -l.custo, cor: COR.custo, tipo: "menos" as const },
    { nome: "Taxas", valor: -l.taxas, cor: COR.taxas, tipo: "menos" as const },
    { nome: "Frete", valor: -l.frete, cor: COR.frete, tipo: "menos" as const },
    { nome: "Impostos", valor: -l.impostos, cor: COR.impostos, tipo: "menos" as const },
    { nome: "Lucro das vendas", valor: l.lucroVendas, cor: COR.lucro, tipo: "total" as const },
    ...(l.ads > 0 ? [{ nome: "Ads", valor: -l.ads, cor: COR.ads, tipo: "menos" as const }] : []),
    { nome: "Despesas", valor: -l.despesas, cor: COR.despesas, tipo: "menos" as const },
    { nome: "Resultado", valor: l.resultado, cor: l.resultado < 0 ? "#dc2626" : COR.resultado, tipo: "total" as const },
  ];
  const max = Math.max(1, l.receita);
  let nivel = 0;
  const barras = passos.map((p) => {
    let base: number, topo: number;
    if (p.tipo === "total") { base = 0; topo = p.valor; nivel = p.valor; }
    else { topo = nivel; base = nivel + p.valor; nivel = base; }
    return { ...p, base: Math.min(base, topo), topo: Math.max(base, topo) };
  });
  return (
    <div className="relative">
      <div className="flex h-64 items-end gap-3 border-b border-slate-200">
        {barras.map((b, i) => (
          <div key={b.nome} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
            <div className="absolute inset-x-0 mx-auto w-full max-w-[64px] rounded-t transition-opacity"
              style={{ bottom: `${(Math.max(0, b.base) / max) * 100}%`, height: `${(Math.max(0, b.topo - Math.max(0, b.base)) / max) * 100}%`, minHeight: Math.abs(b.valor) > 0 ? 3 : 0, background: b.cor, opacity: sobre === null || sobre === i ? 1 : 0.35 }} />
            <span className="absolute inset-x-0 text-center text-[11px] font-semibold text-slate-700" style={{ bottom: `calc(${(Math.max(0, b.topo) / max) * 100}% + 4px)` }}>
              {b.tipo === "menos" ? "−" : ""}{brl(Math.abs(b.valor))}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-3 pt-2">
        {barras.map((b) => (
          <div key={b.nome} className="flex-1 text-center">
            <p className="text-[11px] font-medium text-slate-600">{b.nome}</p>
            <p className="text-[10px] text-slate-400">{l.receita ? pct((Math.abs(b.valor) / l.receita) * 100) : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Últimos 6 meses: receita e resultado líquido lado a lado, com a margem embaixo
function Historico({ meses }: { meses: { mes: string; l: Linha }[] }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const max = Math.max(1, ...meses.map((m) => Math.max(m.l.receita, m.l.resultado)));
  return (
    <div>
      <div className="flex h-48 items-end gap-4 border-b border-slate-200">
        {meses.map((m, i) => (
          <div key={m.mes} className="relative flex h-full flex-1 items-end justify-center gap-1" onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
            <div className="w-1/2 max-w-[28px] rounded-t" style={{ height: `${(m.l.receita / max) * 100}%`, background: COR.receita, opacity: sobre === null || sobre === i ? 1 : 0.35, minHeight: m.l.receita ? 3 : 0 }} />
            <div className="w-1/2 max-w-[28px] rounded-t" style={{ height: `${(Math.max(0, m.l.resultado) / max) * 100}%`, background: m.l.resultado < 0 ? "#dc2626" : COR.resultado, opacity: sobre === null || sobre === i ? 1 : 0.35, minHeight: m.l.resultado ? 3 : 0 }} />
            {sobre === i && (
              <div className={`pointer-events-none absolute bottom-full z-20 mb-2 w-52 rounded-xl bg-slate-900 p-3 text-xs text-white shadow-xl ${i > meses.length / 2 ? "right-0" : "left-0"}`}>
                <p className="mb-1.5 font-semibold capitalize">{nomeMes(m.mes)}</p>
                <p className="flex justify-between"><span>Receita</span><b>{brl(m.l.receita)}</b></p>
                <p className="flex justify-between"><span>Lucro das vendas</span><b>{brl(m.l.lucroVendas)}</b></p>
                <p className="flex justify-between"><span>Despesas</span><b>{brl(m.l.despesas)}</b></p>
                <p className="flex justify-between"><span>Resultado</span><b>{brl(m.l.resultado)}</b></p>
                <p className="flex justify-between text-slate-300"><span>Margem líquida</span><b>{m.l.receita ? pct(m.l.margem) : "—"}</b></p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-4 pt-2">
        {meses.map((m) => (
          <div key={m.mes} className="flex-1 text-center">
            <p className="text-[11px] font-medium capitalize text-slate-600">{nomeMes(m.mes, true)}</p>
            <p className={`text-[10px] ${m.l.margem < 0 ? "text-red-600" : "text-slate-400"}`}>{m.l.receita ? pct(m.l.margem) : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DrePage() {
  const [mes, setMes] = useState(mesAtual());
  const [vendas, setVendas] = useState<VendaDre[] | null>(null);
  const [despesas, setDespesas] = useState<Expense[]>([]);
  const [todasCats, setTodasCats] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  // Investimento em ads (Mercado Livre e Shopee) de cada mês, puxado automático das plataformas
  const [ads, setAds] = useState<Record<string, { valor: number; erros: string[] }>>({});
  const [carregandoAds, setCarregandoAds] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ category: "aluguel", nova: "", description: "", amount: "" });
  const [editando, setEditando] = useState<{ id: string; valor: string } | null>(null);

  // Vendas dos últimos 6 meses (até o mês escolhido) e despesas dos mesmos meses
  const carregar = useCallback(async () => {
    setErro("");
    setVendas(null);
    const de = intervaloDoMes(somarMes(mes, -5)).inicio;
    const ate = intervaloDoMes(mes).fim;
    const todas: VendaDre[] = [];
    for (let i = 0; i < 100000; i += 1000) {
      const r = await supabase.from("sales").select("sold_at, sale_price, cost_price, fees_total, shipping_cost, tax_amount")
        .gte("sold_at", new Date(`${de}T00:00:00-03:00`).toISOString()).lt("sold_at", new Date(`${ate}T00:00:00-03:00`).toISOString()).order("sold_at").range(i, i + 999);
      if (r.error) { setErro(r.error.message); break; }
      todas.push(...((r.data ?? []) as VendaDre[]));
      if ((r.data ?? []).length < 1000) break;
    }
    const d = await supabase.from("expenses").select("*").gte("month_ref", de).lt("month_ref", ate).order("created_at", { ascending: false });
    if (d.error) setErro(d.error.message);
    const cats = await supabase.from("expenses").select("category").limit(5000);
    setTodasCats(Array.from(new Set(((cats.data ?? []) as { category: string }[]).map((c) => c.category))));
    setVendas(todas);
    setDespesas((d.data ?? []) as Expense[]);
  }, [mes]);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    let vivo = true;
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const meses = Array.from({ length: 6 }, (_, i) => somarMes(mes, i - 5)).filter((m) => `${m}-01` <= hoje && !(m in ads));
    if (!meses.length) return;
    setCarregandoAds(true);
    Promise.all(
      meses.map(async (m) => {
        const ultimo = new Date(new Date(`${intervaloDoMes(m).fim}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
        try {
          const r = await apiFetch<{ contas: { nome: string; gasto: number; erro?: string }[] }>(`/api/ads?de=${m}-01&ate=${ultimo < hoje ? ultimo : hoje}`);
          return [m, { valor: r.contas.reduce((t, c) => t + (c.erro ? 0 : Number(c.gasto) || 0), 0), erros: r.contas.filter((c) => c.erro).map((c) => `${c.nome}: ${c.erro}`) }] as const;
        } catch (e) {
          return [m, { valor: 0, erros: [e instanceof Error ? e.message : String(e)] }] as const;
        }
      })
    ).then((res) => {
      if (!vivo) return;
      setAds((a) => ({ ...a, ...Object.fromEntries(res) }));
      setCarregandoAds(false);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  const mesDe = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const despMes = useMemo(() => despesas.filter((d) => d.month_ref.slice(0, 7) === mes), [despesas, mes]);
  const calc = useMemo(() => {
    const vs = vendas ?? [];
    const meses = Array.from({ length: 6 }, (_, i) => somarMes(mes, i - 5)).map((m) => ({
      mes: m,
      l: calcular(vs.filter((v) => mesDe(v.sold_at) === m), despesas.filter((d) => d.month_ref.slice(0, 7) === m).reduce((t, d) => t + n(d.amount), 0), ads[m]?.valor ?? 0),
    }));
    return { atual: meses[5].l, anterior: meses[4].l, meses };
  }, [vendas, despesas, mes, ads]);
  const l = calc.atual, p = calc.anterior;

  // Ponto de equilíbrio: faturamento que paga as despesas fixas com a margem de contribuição atual
  const mc = l.receita > 0 ? l.lucroVendas / l.receita : 0;
  const equilibrio = mc > 0 ? (l.despesas + l.ads) / mc : null;

  const categorias = useMemo(() => {
    const prontas = CATEGORIAS_DESPESA.map((c) => ({ id: c.id, label: c.label }));
    const extras = todasCats.filter((c) => !prontas.some((x) => x.id === c)).map((c) => ({ id: c, label: c }));
    return [...prontas, ...extras];
  }, [todasCats]);
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    despMes.forEach((d) => m.set(d.category, (m.get(d.category) ?? 0) + n(d.amount)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [despMes]);
  const maxCat = Math.max(1, ...porCategoria.map((c) => c[1]));

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const uid = await lojaAtual();
    if (!uid) return;
    const categoria = form.category === "__nova" ? form.nova.trim() : form.category;
    if (!categoria) return setErro("Digite o nome da nova categoria.");
    const { error } = await supabase.from("expenses").insert({
      store_id: uid, category: categoria, description: form.description.trim() || rotuloCat(categoria), amount: num(form.amount), month_ref: intervaloDoMes(mes).inicio,
    });
    if (error) return setErro(error.message);
    setForm({ category: categoria, nova: "", description: "", amount: "" });
    carregar();
  }
  async function remover(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    carregar();
  }
  async function salvarValor() {
    if (!editando) return;
    await supabase.from("expenses").update({ amount: num(editando.valor) }).eq("id", editando.id);
    setEditando(null);
    carregar();
  }
  // Copia as despesas do mês anterior para o mês escolhido (aluguel, salários etc. que se repetem)
  async function copiarAnterior() {
    const uid = await lojaAtual();
    const ant = despesas.filter((d) => d.month_ref.slice(0, 7) === somarMes(mes, -1));
    if (!uid || !ant.length) return setMsg("O mês anterior não tem despesas para copiar.");
    if (!confirm(`Copiar ${ant.length} ${ant.length === 1 ? "despesa" : "despesas"} de ${nomeMes(somarMes(mes, -1))} para ${nomeMes(mes)}? Depois você ajusta os valores que mudaram.`)) return;
    const { error } = await supabase.from("expenses").insert(ant.map((d) => ({ store_id: uid, category: d.category, description: d.description, amount: n(d.amount), month_ref: intervaloDoMes(mes).inicio })));
    if (error) return setErro(error.message);
    setMsg(`${ant.length} despesas copiadas.`);
    carregar();
  }

  const linhas: { t: string; v: number; ant: number; forte?: boolean; menos?: boolean; inverso?: boolean; cor?: string }[] = [
    { t: "Receita bruta", v: l.receita, ant: p.receita, forte: true, cor: COR.receita },
    { t: "Custo dos produtos", v: l.custo, ant: p.custo, menos: true, inverso: true, cor: COR.custo },
    { t: "Taxas dos marketplaces", v: l.taxas, ant: p.taxas, menos: true, inverso: true, cor: COR.taxas },
    { t: "Frete", v: l.frete, ant: p.frete, menos: true, inverso: true, cor: COR.frete },
    { t: "Impostos", v: l.impostos, ant: p.impostos, menos: true, inverso: true, cor: COR.impostos },
    { t: "Lucro das vendas (margem de contribuição)", v: l.lucroVendas, ant: p.lucroVendas, forte: true, cor: COR.lucro },
    { t: "Ads (Mercado Livre e Shopee) · automático", v: l.ads, ant: p.ads, menos: true, inverso: true, cor: COR.ads },
    { t: "Despesas do mês", v: l.despesas, ant: p.despesas, menos: true, inverso: true, cor: COR.despesas },
    { t: "Resultado líquido", v: l.resultado, ant: p.resultado, forte: true, cor: COR.resultado },
  ];

  const kpis = [
    { t: "Receita bruta", v: brl(l.receita), d: <Delta a={l.receita} b={p.receita} />, cor: COR.receita },
    { t: "Lucro das vendas", v: brl(l.lucroVendas), d: <Delta a={l.lucroVendas} b={p.lucroVendas} />, cor: COR.lucro },
    { t: "Despesas do mês", v: brl(l.despesas), d: <Delta a={l.despesas} b={p.despesas} inverso />, cor: COR.despesas },
    { t: "Resultado líquido", v: brl(l.resultado), d: <Delta a={l.resultado} b={p.resultado} />, cor: l.resultado < 0 ? "#dc2626" : COR.resultado, destaque: true },
    { t: "Margem líquida", v: pct(l.margem), d: <span className="text-[11px] text-slate-500">mês anterior {p.receita ? pct(p.margem) : "—"}</span>, cor: "#0ea5e9" },
    { t: "Ponto de equilíbrio", v: equilibrio != null ? brl(equilibrio) : "—", d: <span className="text-[11px] text-slate-500">{equilibrio != null && l.receita ? (l.receita >= equilibrio ? "✔ atingido" : `faltam ${brl(equilibrio - l.receita)}`) : "faturamento que paga as despesas"}</span>, cor: "#64748b" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">DRE</h1>
          <p className="mt-1 text-sm text-slate-500">Demonstrativo de resultado de <span className="capitalize">{nomeMes(mes)}</span>, comparado com o mês anterior.</p>
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-ghost" onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior">‹</button>
          <div><label className="label">Mês</label><input type="month" className="input" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
          <button className="btn-ghost" onClick={() => setMes(somarMes(mes, 1))} aria-label="Próximo mês">›</button>
        </div>
      </div>

      {erro && <div className="card text-sm text-red-700">{erro}</div>}
      {(carregandoAds || (ads[mes]?.erros.length ?? 0) > 0 || despMes.some((d) => d.category === "marketing")) && (
        <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-[13px] text-cyan-900">
          {carregandoAds && <p>Buscando o investimento em ads do Mercado Livre e da Shopee…</p>}
          {(ads[mes]?.erros ?? []).map((e) => <p key={e}>Ads não incluído de {e}</p>)}
          {despMes.some((d) => d.category === "marketing") && (
            <p>O investimento em ads já entra automático. Se a despesa em &quot;Marketing e anúncios&quot; for o mesmo ads, apague-a para não contar duas vezes.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.t} className="card relative overflow-hidden !p-4">
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: k.cor }} />
            <p className="text-xs font-medium text-slate-500">{k.t}</p>
            <p className={`mt-1 font-display text-2xl font-bold ${k.destaque ? (l.resultado < 0 ? "text-red-600" : "text-emerald-700") : "text-slate-900"}`}>{vendas ? k.v : "…"}</p>
            <div className="mt-1">{vendas && k.d}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="card xl:col-span-3">
          <h2 className="font-semibold text-slate-900">Da receita ao resultado</h2>
          <p className="mb-6 text-xs text-slate-500">Cada coluna mostra quanto sai da receita até sobrar o resultado líquido</p>
          {vendas ? <Cascata l={l} /> : <p className="py-20 text-center text-sm text-slate-400">Carregando…</p>}
        </div>
        <div className="card xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Últimos 6 meses</h2>
              <p className="text-xs text-slate-500">Passe o mouse para ver os números de cada mês</p>
            </div>
            <span className="flex items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.receita }} />Receita</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.resultado }} />Resultado</span>
            </span>
          </div>
          {vendas ? <Historico meses={calc.meses} /> : <p className="py-16 text-center text-sm text-slate-400">Carregando…</p>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="card overflow-x-auto xl:col-span-3 !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Demonstrativo</th>
                <th className="px-3 py-3 text-right font-medium">{nomeMes(mes, true)}</th>
                <th className="px-3 py-3 text-right font-medium">% receita</th>
                <th className="px-3 py-3 text-right font-medium">{nomeMes(somarMes(mes, -1), true)}</th>
                <th className="px-5 py-3 text-right font-medium">Variação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((x) => (
                <tr key={x.t} className={`border-t border-slate-100 ${x.forte ? "bg-slate-50/80 font-semibold" : "text-slate-600"}`}>
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.cor }} />{x.menos ? "(−) " : x.forte && x.t !== "Receita bruta" ? "= " : ""}{x.t}</span>
                  </td>
                  <td className={`px-3 py-2.5 text-right ${x.t === "Resultado líquido" && x.v < 0 ? "text-red-600" : "text-slate-900"}`}>{brl(x.v)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{l.receita ? pct((x.v / l.receita) * 100) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{brl(x.ant)}</td>
                  <td className="px-5 py-2.5 text-right"><Delta a={x.v} b={x.ant} inverso={x.inverso} /></td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td className="px-5 py-2.5 font-semibold">Margem líquida</td>
                <td className={`px-3 py-2.5 text-right font-semibold ${l.margem < 0 ? "text-red-600" : "text-slate-900"}`}>{pct(l.margem)}</td>
                <td />
                <td className="px-3 py-2.5 text-right text-slate-500">{p.receita ? pct(p.margem) : "—"}</td>
                <td className="px-5 py-2.5 text-right text-[11px] text-slate-500">{p.receita ? `${(l.margem - p.margem >= 0 ? "+" : "")}${(l.margem - p.margem).toFixed(1).replace(".", ",")} p.p.` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card xl:col-span-2">
          <h2 className="font-semibold text-slate-900">Despesas por categoria</h2>
          <p className="mb-4 text-xs text-slate-500">{l.despesas ? `${brl(l.despesas)} no mês · ${l.receita ? pct((l.despesas / l.receita) * 100) : "—"} da receita` : "Cadastre as despesas abaixo"}</p>
          {porCategoria.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma despesa neste mês.</p>
          ) : (
            <ul className="space-y-3">
              {porCategoria.map(([c, v]) => (
                <li key={c}>
                  <div className="mb-1 flex justify-between text-sm"><span className="text-slate-700">{rotuloCat(c)}</span><span className="font-semibold text-slate-900">{brl(v)} <span className="text-xs font-normal text-slate-500">{pct((v / (l.despesas || 1)) * 100)}</span></span></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(v / maxCat) * 100}%`, background: COR.despesas }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">Despesas de <span className="capitalize">{nomeMes(mes)}</span></h2>
            <p className="text-xs text-slate-500">Aluguel, energia, funcionários, embalagem, combustível… Escolha uma categoria pronta ou crie a sua.</p>
          </div>
          <button className="btn-ghost" onClick={copiarAnterior}>Copiar despesas de {nomeMes(somarMes(mes, -1), true)}</button>
        </div>
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}

        <form onSubmit={adicionar} className="grid gap-3 md:grid-cols-[1.2fr_1.5fr_0.8fr_auto] md:items-end">
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              <option value="__nova">+ Nova categoria…</option>
            </select>
            {form.category === "__nova" && (
              <input className="input mt-2" autoFocus placeholder="Nome da categoria (ex.: Manutenção)" value={form.nova} onChange={(e) => setForm({ ...form, nova: e.target.value })} />
            )}
          </div>
          <div><label className="label">Descrição</label><input className="input" placeholder="ex.: Aluguel do galpão" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label className="label">Valor (R$)</label><input className="input" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <button className="btn">Adicionar</button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2.5 text-left font-medium">Categoria</th><th className="px-4 py-2.5 text-left font-medium">Descrição</th><th className="px-4 py-2.5 text-right font-medium">Valor</th><th className="px-4 py-2.5 text-right font-medium">% da receita</th><th className="w-32" /></tr>
            </thead>
            <tbody>
              {despMes.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={5}>Nenhuma despesa neste mês.</td></tr>}
              {despMes.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5"><span className="rounded-full bg-pink-50 px-2.5 py-0.5 text-xs font-medium text-pink-700">{rotuloCat(d.category)}</span></td>
                  <td className="px-4 py-2.5 text-slate-700">{d.description}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                    {editando?.id === d.id ? (
                      <input className="input ml-auto w-28 text-right" inputMode="decimal" autoFocus value={editando.valor}
                        onChange={(e) => setEditando({ id: d.id, valor: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") salvarValor(); if (e.key === "Escape") setEditando(null); }}
                        onBlur={salvarValor} />
                    ) : (
                      <button className="hover:underline" title="Clique para mudar o valor" onClick={() => setEditando({ id: d.id, valor: String(d.amount).replace(".", ",") })}>{brl(n(d.amount))}</button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{l.receita ? pct((n(d.amount) / l.receita) * 100) : "—"}</td>
                  <td className="px-4 py-2.5 text-right"><button onClick={() => remover(d.id)} className="text-xs text-red-600 hover:underline">Excluir</button></td>
                </tr>
              ))}
              {despMes.length > 0 && (
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-4 py-2.5" colSpan={2}>Total</td>
                  <td className="px-4 py-2.5 text-right">{brl(l.despesas)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{l.receita ? pct((l.despesas / l.receita) * 100) : "—"}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
