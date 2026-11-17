"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { brl, pct } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";
import { lojaAtual } from "@/lib/loja";

type Venda = {
  sold_at: string; sale_price: number; profit: number | null; cost_price: number | null; quantity: number | null;
  fees_total: number | null; shipping_cost: number | null; tax_amount: number | null;
  marketplace_id: string | null; order_number: string | null; external_id: string | null; title: string | null; ml_user_id: string | null;
};
type ContaML = {
  ml_user_id: string; nickname: string | null; level_id?: string | null; power_seller_status?: string | null; ml_error?: string;
  metrics?: { claims?: { rate?: number }; delayed_handling_time?: { rate?: number }; cancellations?: { rate?: number } } | null;
};
type LojaShopee = { shop_id: string; nome: string; nota?: number | null; penalidade?: number | null; falhas?: number; erro?: string };
type ContaShopee = { shop_id: string; shop_name: string | null; store_name: string | null; refresh_expires_at: string | null };
type Periodo = "hoje" | "ontem" | "7d" | "mes";

const TZ = "America/Sao_Paulo";
const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const hora = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
const somaDias = (n: number) => dia(new Date(Date.now() + n * 86400_000));
const curto = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toFixed(1).replace(".", ",")} mil` : brl(v));

// Cores por papel (paleta validada: separáveis com e sem daltonismo; os valores sempre aparecem escritos ao lado)
const COR = { faturamento: "#5B3DF5", lucro: "#1baf7a", custo: "#2a78d6", taxas: "#eb6834", frete: "#6250d6", impostos: "#eda100" };
const MP: Record<string, { nome: string; cor: string }> = {
  mercado_livre: { nome: "Mercado Livre", cor: "#F5D300" },
  shopee: { nome: "Shopee", cor: "#EE4D2D" },
  tiktok_shop: { nome: "TikTok Shop", cor: "#111111" },
};
const NIVEIS = ["#ef4444", "#fb923c", "#facc15", "#a3e635", "#22c55e"];
const MEDALHA: Record<string, string> = { platinum: "MercadoLíder Platinum", gold: "MercadoLíder Gold", silver: "MercadoLíder" };
const NOTA_SHOPEE: Record<number, { t: string; c: string }> = {
  1: { t: "Ruim", c: "bg-red-50 text-red-700" },
  2: { t: "Precisa melhorar", c: "bg-amber-50 text-amber-700" },
  3: { t: "Bom", c: "bg-emerald-50 text-emerald-700" },
  4: { t: "Excelente", c: "bg-emerald-100 text-emerald-800" },
};

function resumo(vs: Venda[]) {
  const n = (x: number | null | undefined) => Number(x) || 0;
  const pedidos = new Set(vs.map((v) => v.order_number || (v.external_id ?? "").split(":")[0])).size;
  const faturamento = vs.reduce((t, v) => t + n(v.sale_price), 0);
  const lucro = vs.reduce((t, v) => t + n(v.profit), 0);
  return {
    pedidos, faturamento, lucro,
    unidades: vs.reduce((t, v) => t + (n(v.quantity) || 1), 0),
    custo: vs.reduce((t, v) => t + n(v.cost_price), 0),
    taxas: vs.reduce((t, v) => t + n(v.fees_total), 0),
    frete: vs.reduce((t, v) => t + n(v.shipping_cost), 0),
    impostos: vs.reduce((t, v) => t + n(v.tax_amount), 0),
    margem: faturamento > 0 ? (lucro / faturamento) * 100 : 0,
    ticket: pedidos > 0 ? faturamento / pedidos : 0,
    // Retorno sobre o investimento: lucro ÷ custo dos produtos (só das vendas com custo informado)
    roi: (() => {
      const comCusto = vs.filter((v) => n(v.cost_price) > 0);
      const c = comCusto.reduce((t, v) => t + n(v.cost_price), 0);
      return c > 0 ? (comCusto.reduce((t, v) => t + n(v.profit), 0) / c) * 100 : 0;
    })(),
    semCusto: vs.filter((v) => !(n(v.cost_price) > 0)).length,
  };
}
type Resumo = ReturnType<typeof resumo>;

function Delta({ a, b, pontos = false }: { a: number; b: number; pontos?: boolean }) {
  if (pontos) {
    const d = a - b;
    if (!b && !a) return null;
    return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${d >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1).replace(".", ",")} p.p.</span>;
  }
  if (!b) return <span className="text-[11px] text-slate-400">sem base</span>;
  const d = ((a - b) / Math.abs(b)) * 100;
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${d >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}%</span>;
}

// Mini gráfico de linha dos últimos 7 dias dentro de cada card
function Sparkline({ valores, cor }: { valores: number[]; cor: string }) {
  const max = Math.max(...valores, 0), min = Math.min(...valores, 0);
  const amp = max - min || 1;
  const pts = valores.map((v, i) => `${(i / Math.max(valores.length - 1, 1)) * 100},${28 - ((v - min) / amp) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <polygon points={`0,30 ${pts} 100,30`} fill={cor} opacity="0.1" />
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Icone({ d, cor }: { d: string; cor: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${cor}1A`, color: cor }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
    </span>
  );
}
const ICONES = {
  faturamento: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  lucro: "M3 17l6-6 4 4 8-8M14 7h7v7",
  margem: "M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  pedidos: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  ticket: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  roi: "M3 3v18h18M7 14l4-4 4 4 5-5",
  unidades: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
};

// Gráfico de colunas: faturamento e lucro por hora (hoje/ontem) ou por dia (7 dias / mês), com o pico destacado
function Evolucao({ pontos, rotuloPico }: { pontos: { rotulo: string; dica: string; r: Resumo }[]; rotuloPico: string }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const max = Math.max(1, ...pontos.map((p) => p.r.faturamento));
  const iPico = pontos.reduce((m, p, i) => (p.r.faturamento > pontos[m].r.faturamento ? i : m), 0);
  const pico = pontos[iPico];
  const comVenda = pontos.filter((p) => p.r.faturamento > 0).length;
  const total = pontos.reduce((t, p) => t + p.r.faturamento, 0);
  const linhas = [1, 0.75, 0.5, 0.25];
  const mostrarRotulo = (i: number) => pontos.length <= 12 || i % Math.ceil(pontos.length / 12) === 0;
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Pico de venda</p>
          <p className="text-sm font-semibold text-slate-900">{pico && pico.r.faturamento > 0 ? `${pico.dica} · ${brl(pico.r.faturamento)}` : "—"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Média por {rotuloPico}</p>
          <p className="text-sm font-semibold text-slate-900">{comVenda ? brl(total / comVenda) : "—"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{rotuloPico === "hora" ? "Horas" : "Dias"} com venda</p>
          <p className="text-sm font-semibold text-slate-900">{comVenda} de {pontos.length}</p>
        </div>
      </div>
      <div className="relative pt-6">
        <div className="absolute inset-x-0 top-6 h-48">
          {linhas.map((l) => (
            <div key={l} className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ top: `${(1 - l) * 100}%` }}>
              <span className="absolute -top-2.5 right-0 bg-white pl-1 text-[10px] text-slate-400">{curto(max * l)}</span>
            </div>
          ))}
        </div>
        <div className="relative flex h-48 items-end gap-[2px] border-b border-slate-200 pr-14">
          {pontos.map((p, i) => {
            const hF = (p.r.faturamento / max) * 100;
            const hL = (Math.max(0, p.r.lucro) / max) * 100;
            const ehPico = i === iPico && p.r.faturamento > 0;
            return (
              <div key={p.rotulo + i} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
                {ehPico && (
                  <span className="absolute z-10 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ bottom: `${hF}%`, marginBottom: 6 }}>
                    Pico
                  </span>
                )}
                <div className="flex h-full w-full max-w-[34px] items-end gap-[2px]">
                  <div className="w-1/2 rounded-t transition-opacity" style={{ height: `${hF}%`, background: COR.faturamento, opacity: sobre === null || sobre === i ? (ehPico ? 1 : 0.75) : 0.3, minHeight: p.r.faturamento > 0 ? 3 : 0 }} />
                  <div className="w-1/2 rounded-t transition-opacity" style={{ height: `${hL}%`, background: COR.lucro, opacity: sobre === null || sobre === i ? 1 : 0.3, minHeight: p.r.lucro > 0 ? 3 : 0 }} />
                </div>
                {sobre === i && (
                  <div className={`pointer-events-none absolute bottom-full z-20 mb-2 w-48 rounded-xl bg-slate-900 p-3 text-xs text-white shadow-xl ${i > pontos.length / 2 ? "right-0" : "left-0"}`}>
                    <p className="mb-1.5 font-semibold">{p.dica}</p>
                    <p className="flex justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COR.faturamento }} />Faturamento</span><b>{brl(p.r.faturamento)}</b></p>
                    <p className="flex justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COR.lucro }} />Lucro</span><b>{brl(p.r.lucro)}</b></p>
                    <p className="flex justify-between text-slate-300"><span>Pedidos</span><b>{p.r.pedidos}</b></p>
                    <p className="flex justify-between text-slate-300"><span>Margem</span><b>{p.r.faturamento ? pct(p.r.margem) : "—"}</b></p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-[2px] pr-14 pt-1.5">
          {pontos.map((p, i) => (
            <span key={p.rotulo + i} className="flex-1 text-center text-[10px] text-slate-500">{mostrarRotulo(i) ? p.rotulo : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Rosca "para onde vai o dinheiro": cada fatia com espaço de 2px entre elas
function Rosca({ partes, centro, sub }: { partes: { nome: string; valor: number; cor: string }[]; centro: string; sub: string }) {
  const total = partes.reduce((t, p) => t + Math.max(0, p.valor), 0);
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
          {total > 0 && partes.map((p) => {
            const frac = Math.max(0, p.valor) / total;
            const len = Math.max(0, frac * C - 2);
            const el = <circle key={p.nome} cx="70" cy="70" r={R} fill="none" stroke={p.cor} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
            acc += frac * C;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold text-slate-900">{centro}</span>
          <span className="text-[11px] text-slate-500">{sub}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {partes.map((p) => (
          <li key={p.nome} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.cor }} />
            <span className="min-w-0 flex-1 text-slate-600">{p.nome}</span>
            <span className="whitespace-nowrap font-semibold text-slate-900">{brl(p.valor)}</span>
            <span className="w-12 shrink-0 text-right text-xs text-slate-500">{total ? `${((Math.max(0, p.valor) / total) * 100).toFixed(1).replace(".", ",")}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function InicioPage() {
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [erro, setErro] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [ml, setMl] = useState<ContaML[] | null>(null);
  const [shopee, setShopee] = useState<LojaShopee[] | null>(null);
  const [contasShopee, setContasShopee] = useState<ContaShopee[]>([]);
  const [nome, setNome] = useState("");
  const [nomeLoja, setNomeLoja] = useState("");
  const [atualizado, setAtualizado] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const n = (data.user?.user_metadata?.name as string | undefined) || (data.user?.user_metadata?.full_name as string | undefined) || "";
      setNome(n.split(" ")[0]);
      const lid = await lojaAtual();
      if (lid) supabase.from("stores").select("name").eq("id", lid).maybeSingle().then(({ data: l }) => setNomeLoja((l?.name as string) ?? ""));
      // Do começo do mês anterior até agora (para comparar mês com mês e 7 dias com os 7 anteriores)
      const hoje = dia(new Date());
      const [a, m] = hoje.split("-").map(Number);
      const mesAnt = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
      const desde = new Date(`${mesAnt}T00:00:00-03:00`).toISOString();
      const todas: Venda[] = [];
      try {
        for (let i = 0; i < 100000; i += 1000) {
          const r = await supabase
            .from("sales")
            .select("sold_at, sale_price, profit, cost_price, quantity, fees_total, shipping_cost, tax_amount, marketplace_id, order_number, external_id, title, ml_user_id")
            .gte("sold_at", desde).order("sold_at").range(i, i + 999);
          if (r.error) throw new Error(r.error.message);
          todas.push(...((r.data ?? []) as Venda[]));
          if ((r.data ?? []).length < 1000) break;
        }
        setVendas(todas);
        setAtualizado(new Date());
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        setVendas([]);
      }
    })();
    apiFetch<{ accounts: ContaML[] }>("/api/ml/status").then((r) => setMl(r.accounts)).catch(() => setMl([]));
    apiFetch<{ lojas: LojaShopee[] }>("/api/shopee/saude").then((r) => setShopee(r.lojas)).catch(() => setShopee([]));
    apiFetch<{ accounts: ContaShopee[] }>("/api/shopee/accounts").then((r) => setContasShopee(r.accounts ?? [])).catch(() => {});
  }, []);

  const calc = useMemo(() => {
    const vs = (vendas ?? []).map((v) => ({ ...v, d: dia(new Date(v.sold_at)) }));
    const hoje = dia(new Date());
    const ontem = somaDias(-1);
    const mes = hoje.slice(0, 7);
    const diaDoMes = Number(hoje.slice(8, 10));
    const [a, m] = hoje.split("-").map(Number);
    const mesAnt = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
    const filtro: Record<Periodo, (d: string) => boolean> = {
      hoje: (d) => d === hoje,
      ontem: (d) => d === ontem,
      "7d": (d) => d >= somaDias(-6),
      mes: (d) => d.startsWith(mes),
    };
    const anterior: Record<Periodo, (d: string) => boolean> = {
      hoje: (d) => d === ontem,
      ontem: (d) => d === somaDias(-2),
      "7d": (d) => d >= somaDias(-13) && d < somaDias(-6),
      mes: (d) => d.startsWith(mesAnt) && Number(d.slice(8, 10)) <= diaDoMes,
    };
    const atual = vs.filter((v) => filtro[periodo](v.d));

    // Evolução: por hora em hoje/ontem, por dia no resto
    let pontos: { rotulo: string; dica: string; r: Resumo }[];
    if (periodo === "hoje" || periodo === "ontem") {
      pontos = Array.from({ length: 24 }, (_, h) => ({ rotulo: `${h}h`, dica: `${String(h).padStart(2, "0")}h às ${String(h + 1).padStart(2, "0")}h`, r: resumo(atual.filter((v) => hora(v.sold_at) === h)) }));
    } else {
      const n = periodo === "7d" ? 7 : diaDoMes;
      pontos = Array.from({ length: n }, (_, i) => {
        const d = periodo === "7d" ? somaDias(i - 6) : `${mes}-${String(i + 1).padStart(2, "0")}`;
        const dt = new Date(`${d}T12:00:00`);
        return {
          rotulo: periodo === "7d" ? dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "") : String(i + 1),
          dica: dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" }),
          r: resumo(atual.filter((v) => v.d === d)),
        };
      });
    }

    const ultimos7 = Array.from({ length: 7 }, (_, i) => resumo(vs.filter((v) => v.d === somaDias(i - 6))));
    const porMp = Object.keys(MP).map((id) => ({ id, ...resumo(atual.filter((v) => (v.marketplace_id || "mercado_livre") === id)) }));

    // Mais vendidos do período (pelo título da venda)
    const prod = new Map<string, Venda[]>();
    for (const v of atual) {
      const t = (v.title || "Sem título").trim();
      prod.set(t, [...(prod.get(t) ?? []), v]);
    }
    const top = Array.from(prod.entries()).map(([t, l]) => ({ titulo: t, mp: l[0].marketplace_id || "mercado_livre", ...resumo(l) })).sort((x, y) => y.faturamento - x.faturamento).slice(0, 6);

    return { atual: resumo(atual), antes: resumo(vs.filter((v) => anterior[periodo](v.d))), pontos, ultimos7, porMp, top };
  }, [vendas, periodo]);

  const ROTULO: Record<Periodo, string> = { hoje: "Hoje", ontem: "Ontem", "7d": "7 dias", mes: "Este mês" };
  const COMPARA: Record<Periodo, string> = { hoje: "vs. ontem", ontem: "vs. anteontem", "7d": "vs. 7 dias antes", mes: "vs. mesmo período do mês passado" };
  const a = calc.atual, b = calc.antes;
  const carregando = vendas === null;
  const vencendo = contasShopee.filter((c) => c.refresh_expires_at && new Date(c.refresh_expires_at).getTime() - Date.now() < 15 * 86400_000);
  const maxTop = Math.max(1, ...calc.top.map((t) => t.faturamento));

  // Resumo do período em texto, para mandar pelo WhatsApp (abre o WhatsApp com a mensagem pronta)
  function enviarWhatsApp() {
    const quando = periodo === "hoje" ? "de hoje" : periodo === "ontem" ? "de ontem" : periodo === "7d" ? "dos últimos 7 dias" : "do mês";
    const data = new Date().toLocaleDateString("pt-BR", { timeZone: TZ });
    const linhas = [
      `📊 *Resumo ${quando}${nomeLoja ? ` — ${nomeLoja}` : ""}*`,
      `_${data}_`,
      "",
      `🛒 Pedidos: *${a.pedidos}* (${a.unidades} un.)`,
      `💰 Faturamento: *${brl(a.faturamento)}*`,
      `✅ Lucro: *${brl(a.lucro)}*`,
      `📈 Margem: *${pct(a.margem)}* · ROI: *${pct(a.roi)}*`,
      `🧾 Ticket médio: ${brl(a.ticket)}`,
    ];
    const mps = calc.porMp.filter((m) => m.faturamento > 0);
    if (mps.length) {
      linhas.push("", "*Por marketplace*");
      mps.forEach((m) => linhas.push(`• ${MP[m.id].nome}: ${m.pedidos} pedidos · ${brl(m.faturamento)} · lucro ${brl(m.lucro)}`));
    }
    if (calc.top[0]) linhas.push("", `🏆 Mais vendido: ${calc.top[0].titulo.slice(0, 60)} (${brl(calc.top[0].faturamento)})`);
    if (periodo !== "mes" && b.faturamento) {
      const d = ((a.faturamento - b.faturamento) / Math.abs(b.faturamento)) * 100;
      linhas.push(`${d >= 0 ? "⬆️" : "⬇️"} Faturamento ${d >= 0 ? "+" : ""}${d.toFixed(0)}% ${COMPARA[periodo]}`);
    }
    if (a.semCusto) linhas.push("", `⚠️ ${a.semCusto} ${a.semCusto === 1 ? "venda" : "vendas"} sem custo informado: o lucro real pode ser menor.`);
    linhas.push("", "Detalhes: https://www.diegorezendedigital.com.br/dashboard");
    window.open(`https://wa.me/?text=${encodeURIComponent(linhas.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  const cards = [
    { k: "faturamento", t: "Faturamento", v: brl(a.faturamento), d: <Delta a={a.faturamento} b={b.faturamento} />, s: calc.ultimos7.map((x) => x.faturamento), cor: COR.faturamento },
    { k: "lucro", t: "Lucro", v: brl(a.lucro), d: <Delta a={a.lucro} b={b.lucro} />, s: calc.ultimos7.map((x) => x.lucro), cor: COR.lucro, destaque: a.lucro < 0 ? "text-red-600" : "text-emerald-700" },
    { k: "margem", t: "Margem", v: pct(a.margem), d: <Delta a={a.margem} b={b.margem} pontos />, s: calc.ultimos7.map((x) => x.margem), cor: "#0ea5e9" },
    { k: "roi", t: "ROI", v: pct(a.roi), d: <Delta a={a.roi} b={b.roi} pontos />, s: calc.ultimos7.map((x) => x.roi), cor: "#8b5cf6" },
    { k: "pedidos", t: "Pedidos", v: String(a.pedidos), d: <Delta a={a.pedidos} b={b.pedidos} />, s: calc.ultimos7.map((x) => x.pedidos), cor: "#f59e0b" },
    { k: "ticket", t: "Ticket médio", v: brl(a.ticket), d: <Delta a={a.ticket} b={b.ticket} />, s: calc.ultimos7.map((x) => x.ticket), cor: "#ec4899" },
    { k: "unidades", t: "Unidades vendidas", v: String(a.unidades), d: <Delta a={a.unidades} b={b.unidades} />, s: calc.ultimos7.map((x) => x.unidades), cor: "#64748b" },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a1a8c] via-[#5B3DF5] to-[#8b5cf6] p-6 text-white shadow-card">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-white/70">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</p>
            <h1 className="font-display text-3xl font-bold">{nome ? `Olá, ${nome}` : "Início"}</h1>
            <p className="mt-1 text-sm text-white/80">
              {carregando ? "Carregando seus números…" : (
                <>Você vendeu <b>{brl(a.faturamento)}</b> em <b>{a.pedidos}</b> {a.pedidos === 1 ? "pedido" : "pedidos"} {periodo === "hoje" ? "hoje" : periodo === "ontem" ? "ontem" : periodo === "7d" ? "nos últimos 7 dias" : "neste mês"}, com <b>{brl(a.lucro)}</b> de lucro.</>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex rounded-full bg-white/15 p-1 backdrop-blur">
              {(Object.keys(ROTULO) as Periodo[]).map((p) => (
                <button key={p} onClick={() => setPeriodo(p)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${periodo === p ? "bg-white text-[#2a1a8c] shadow" : "text-white/85 hover:bg-white/10"}`}>
                  {ROTULO[p]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={enviarWhatsApp}
              disabled={carregando}
              title="Abre o WhatsApp com o resumo do período escolhido já escrito"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-1.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(37,211,102,0.55)] transition hover:shadow-[0_0_24px_rgba(37,211,102,0.9)] disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20.5l1.6-5.4A8.5 8.5 0 1 1 21 11.5z" />
              </svg>
              Enviar resumo no WhatsApp
            </button>
            {atualizado && <span className="text-[11px] text-white/60">Atualizado às {atualizado.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {COMPARA[periodo]}</span>}
          </div>
        </div>
      </div>

      {erro && <div className="card text-sm text-red-700">{erro}</div>}

      {/* Indicadores */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <div key={c.k} className="card relative overflow-hidden !p-4">
            <div className="flex items-center justify-between">
              <Icone d={ICONES[c.k]} cor={c.cor} />
              {!carregando && c.d}
            </div>
            <p className="mt-3 text-xs font-medium text-slate-500">{c.t}</p>
            <p className={`font-display text-2xl font-bold ${"destaque" in c && c.destaque ? c.destaque : "text-slate-900"}`}>{carregando ? "…" : c.v}</p>
            <div className="mt-2"><Sparkline valores={c.s} cor={c.cor} /></div>
            <p className="text-[10px] text-slate-400">últimos 7 dias</p>
          </div>
        ))}
      </div>

      {a.semCusto > 0 && (
        <Link href="/dashboard/pedidos" className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 hover:bg-amber-100">
          <span>⚠ <b>{a.semCusto}</b> {a.semCusto === 1 ? "venda" : "vendas"} sem custo informado neste período: o lucro aparece maior que o real.</span>
          <span className="font-medium">Informar custos →</span>
        </Link>
      )}

      {/* Evolução + para onde vai o dinheiro */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Faturamento e lucro {periodo === "hoje" || periodo === "ontem" ? "por hora" : "por dia"}</h2>
              <p className="text-xs text-slate-500">Passe o mouse nas colunas para ver os valores</p>
            </div>
            <span className="flex items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.faturamento }} />Faturamento</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.lucro }} />Lucro</span>
            </span>
          </div>
          {carregando ? <p className="py-16 text-center text-sm text-slate-400">Carregando…</p> : <Evolucao pontos={calc.pontos} rotuloPico={periodo === "hoje" || periodo === "ontem" ? "hora" : "dia"} />}
        </div>
        <div className="card">
          <h2 className="font-semibold text-slate-900">Para onde vai o dinheiro</h2>
          <p className="mb-4 text-xs text-slate-500">Divisão do faturamento do período</p>
          <Rosca
            centro={pct(a.margem)}
            sub="de margem"
            partes={[
              { nome: "Custo dos produtos", valor: a.custo, cor: COR.custo },
              { nome: "Taxas do marketplace", valor: a.taxas, cor: COR.taxas },
              { nome: "Frete pago por você", valor: a.frete, cor: COR.frete },
              { nome: "Impostos", valor: a.impostos, cor: COR.impostos },
              { nome: "Lucro", valor: a.lucro, cor: COR.lucro },
            ]}
          />
        </div>
      </div>

      {/* Marketplaces + mais vendidos */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold text-slate-900">Por marketplace</h2>
          <p className="mb-4 text-xs text-slate-500">Participação no faturamento do período</p>
          <div className="mb-5 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {calc.porMp.filter((m) => m.faturamento > 0).map((m, i) => (
              <div key={m.id} title={`${MP[m.id].nome}: ${a.faturamento ? ((m.faturamento / a.faturamento) * 100).toFixed(1) : 0}%`} style={{ width: `${a.faturamento ? (m.faturamento / a.faturamento) * 100 : 0}%`, background: MP[m.id].cor, marginLeft: i ? 2 : 0 }} />
            ))}
          </div>
          <div className="divide-y divide-slate-100">
            {calc.porMp.map((m) => {
              const part = a.faturamento ? (m.faturamento / a.faturamento) * 100 : 0;
              return (
                <div key={m.id} className={`flex items-center gap-3 py-3 ${m.faturamento === 0 ? "opacity-50" : ""}`}>
                  <MarcaMP mp={m.id} tamanho={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{MP[m.id].nome}</p>
                    <p className="text-xs text-slate-500">{m.pedidos} {m.pedidos === 1 ? "pedido" : "pedidos"} · ticket {brl(m.ticket)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{brl(m.faturamento)}</p>
                    <p className="text-xs text-slate-500">{part.toFixed(1).replace(".", ",")}% do total</p>
                  </div>
                  <div className="w-24 text-right">
                    <p className={`text-sm font-semibold ${m.lucro < 0 ? "text-red-600" : "text-emerald-700"}`}>{brl(m.lucro)}</p>
                    <p className="text-xs text-slate-500">margem {m.faturamento ? pct(m.margem) : "—"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Mais vendidos</h2>
              <p className="text-xs text-slate-500">Por faturamento no período</p>
            </div>
            <Link href="/dashboard/relatorios" className="text-xs font-medium text-brand hover:underline">Ver relatórios →</Link>
          </div>
          {calc.top.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{carregando ? "Carregando…" : "Sem vendas no período."}</p>
          ) : (
            <ol className="space-y-3">
              {calc.top.map((t, i) => (
                <li key={t.titulo} className="flex items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <MarcaMP mp={t.mp} tamanho={14} />
                      <p className="truncate text-sm text-slate-800" title={t.titulo}>{t.titulo}</p>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full" style={{ width: `${(t.faturamento / maxTop) * 100}%`, background: COR.faturamento }} />
                    </div>
                  </div>
                  <div className="w-28 text-right">
                    <p className="text-sm font-semibold text-slate-900">{brl(t.faturamento)}</p>
                    <p className="text-[11px] text-slate-500">{t.unidades} un · <span className={t.lucro < 0 ? "text-red-600" : "text-emerald-700"}>{t.faturamento ? pct(t.margem) : "—"}</span></p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Reputação */}
      <div>
        <h2 className="mb-3 font-semibold text-slate-900">Reputação das contas</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ml === null && <div className="card text-sm text-slate-500">Carregando Mercado Livre…</div>}
          {ml?.map((c) => {
            const nivel = c.level_id ? Number(c.level_id.split("_")[0]) : 0;
            const m = c.metrics;
            const taxas = [["Reclamações", m?.claims?.rate], ["Atrasos", m?.delayed_handling_time?.rate], ["Cancelamentos", m?.cancellations?.rate]] as [string, number | undefined][];
            return (
              <div key={c.ml_user_id} className="card space-y-3 !p-4">
                <div className="flex items-center gap-2">
                  <MarcaMP mp="mercado_livre" tamanho={24} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{c.nickname ?? c.ml_user_id}</p>
                    <p className="text-[11px] text-slate-500">{c.power_seller_status ? MEDALHA[c.power_seller_status] ?? c.power_seller_status : "Mercado Livre"}</p>
                  </div>
                </div>
                {c.ml_error ? (
                  <p className="text-xs text-red-600">Sem acesso: reconecte em Integrações</p>
                ) : (
                  <>
                    <div className="flex gap-1">
                      {NIVEIS.map((cor, i) => (
                        <span key={cor} className="h-2 flex-1 rounded-full" style={{ background: i + 1 === nivel ? cor : `${cor}33`, boxShadow: i + 1 === nivel ? `0 0 0 2px #fff, 0 0 0 3px ${cor}` : undefined }} />
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {taxas.map(([t, v]) => (
                        <div key={t} className="rounded-xl bg-slate-50 px-2 py-1.5 text-center">
                          <p className={`text-sm font-bold ${v != null && v > 0.02 ? "text-red-600" : "text-slate-900"}`}>{v != null ? `${(v * 100).toFixed(1).replace(".", ",")}%` : "—"}</p>
                          <p className="text-[10px] text-slate-500">{t}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {shopee?.map((s) => (
            <div key={s.shop_id} className="card space-y-3 !p-4">
              <div className="flex items-center gap-2">
                <MarcaMP mp="shopee" tamanho={24} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{s.nome}</p>
                  <p className="text-[11px] text-slate-500">Shopee</p>
                </div>
                {s.nota ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${NOTA_SHOPEE[s.nota]?.c ?? ""}`}>{NOTA_SHOPEE[s.nota]?.t ?? s.nota}</span> : null}
              </div>
              {s.erro ? (
                <p className="text-xs text-slate-500">A Shopee não liberou a saúde da loja: {s.erro}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 px-2 py-1.5 text-center">
                    <p className={`text-sm font-bold ${(s.penalidade ?? 0) > 0 ? "text-red-600" : "text-slate-900"}`}>{s.penalidade ?? 0}</p>
                    <p className="text-[10px] text-slate-500">Pontos de penalidade</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-2 py-1.5 text-center">
                    <p className={`text-sm font-bold ${(s.falhas ?? 0) > 0 ? "text-amber-600" : "text-slate-900"}`}>{s.falhas ?? 0}</p>
                    <p className="text-[10px] text-slate-500">Métricas fora da meta</p>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="card space-y-2 !p-4 opacity-70">
            <div className="flex items-center gap-2">
              <MarcaMP mp="tiktok_shop" tamanho={24} />
              <p className="text-sm font-semibold text-slate-900">TikTok Shop</p>
            </div>
            <p className="text-xs text-slate-500">Em breve: entra quando o app for aprovado e a loja conectada.</p>
          </div>
        </div>
      </div>

      {vencendo.length > 0 && (
        <Link href="/dashboard/integracoes" className="block rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          Autorização da Shopee vencendo em breve: {vencendo.map((c) => `${c.store_name || c.shop_name} (${new Date(c.refresh_expires_at!).toLocaleDateString("pt-BR")})`).join(", ")}. Clique para renovar.
        </Link>
      )}
    </div>
  );
}
