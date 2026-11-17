"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { brl, pct } from "@/lib/types";

type Venda = { sold_at: string; sale_price: number; profit: number | null; cost_price: number | null; marketplace_id: string | null; order_number: string | null; external_id: string | null };
type ContaML = {
  ml_user_id: string; nickname: string | null; level_id?: string | null; power_seller_status?: string | null; ml_error?: string;
  metrics?: { claims?: { rate?: number }; delayed_handling_time?: { rate?: number }; cancellations?: { rate?: number }; sales?: { completed?: number } } | null;
};
type LojaShopee = { shop_id: string; nome: string; nota?: number | null; penalidade?: number | null; falhas?: number; erro?: string };
type ContaShopee = { shop_id: string; shop_name: string | null; store_name: string | null; refresh_expires_at: string | null };
type Periodo = "hoje" | "ontem" | "7d" | "mes";

const TZ = "America/Sao_Paulo";
const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const MP: Record<string, { nome: string; cor: string }> = {
  mercado_livre: { nome: "Mercado Livre", cor: "bg-yellow-400" },
  shopee: { nome: "Shopee", cor: "bg-orange-500" },
  tiktok_shop: { nome: "TikTok Shop", cor: "bg-slate-900" },
};

// Termômetro do Mercado Livre: nível 1 (vermelho) a 5 (verde)
const NIVEIS = ["bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-lime-400", "bg-green-500"];
const MEDALHA: Record<string, string> = { platinum: "MercadoLíder Platinum", gold: "MercadoLíder Gold", silver: "MercadoLíder" };
const NOTA_SHOPEE: Record<number, { t: string; c: string }> = {
  1: { t: "Ruim", c: "bg-red-50 text-red-700" },
  2: { t: "Precisa melhorar", c: "bg-amber-50 text-amber-700" },
  3: { t: "Bom", c: "bg-emerald-50 text-emerald-700" },
  4: { t: "Excelente", c: "bg-emerald-100 text-emerald-800" },
};

function resumo(vs: Venda[]) {
  const pedidos = new Set(vs.map((v) => v.order_number || (v.external_id ?? "").split(":")[0])).size;
  const faturamento = vs.reduce((t, v) => t + (Number(v.sale_price) || 0), 0);
  const lucro = vs.reduce((t, v) => t + (Number(v.profit) || 0), 0);
  const semCusto = vs.filter((v) => !(Number(v.cost_price) > 0)).length;
  return { pedidos, faturamento, lucro, margem: faturamento > 0 ? (lucro / faturamento) * 100 : 0, semCusto };
}

function Variacao({ atual, antes }: { atual: number; antes: number }) {
  if (!antes) return null;
  const d = ((atual - antes) / Math.abs(antes)) * 100;
  return <span className={`text-xs font-medium ${d >= 0 ? "text-emerald-600" : "text-red-600"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}%</span>;
}

export default function InicioPage() {
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [erro, setErro] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [ml, setMl] = useState<ContaML[] | null>(null);
  const [shopee, setShopee] = useState<LojaShopee[] | null>(null);
  const [contasShopee, setContasShopee] = useState<ContaShopee[]>([]);
  const [nome, setNome] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const n = (data.user?.user_metadata?.name as string | undefined) || (data.user?.user_metadata?.full_name as string | undefined) || "";
      setNome(n.split(" ")[0]);
      // Vendas do começo do mês (ou dos últimos 14 dias, o que for antes) até agora
      const hoje = new Date();
      const inicioMes = new Date(`${dia(hoje).slice(0, 8)}01T00:00:00-03:00`);
      const quatorze = new Date(Date.now() - 14 * 86400_000);
      const desde = (inicioMes < quatorze ? inicioMes : quatorze).toISOString();
      const todas: Venda[] = [];
      try {
        for (let i = 0; i < 50000; i += 1000) {
          const r = await supabase.from("sales").select("sold_at, sale_price, profit, cost_price, marketplace_id, order_number, external_id").gte("sold_at", desde).order("sold_at").range(i, i + 999);
          if (r.error) throw new Error(r.error.message);
          todas.push(...((r.data ?? []) as Venda[]));
          if ((r.data ?? []).length < 1000) break;
        }
        setVendas(todas);
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
    const vs = vendas ?? [];
    const hoje = dia(new Date());
    const ontem = dia(new Date(Date.now() - 86400_000));
    const seteAtras = dia(new Date(Date.now() - 6 * 86400_000));
    const catorzeAtras = dia(new Date(Date.now() - 13 * 86400_000));
    const mes = hoje.slice(0, 7);
    const comDia = vs.map((v) => ({ ...v, d: dia(new Date(v.sold_at)) }));
    const filtro: Record<Periodo, (d: string) => boolean> = {
      hoje: (d) => d === hoje,
      ontem: (d) => d === ontem,
      "7d": (d) => d >= seteAtras,
      mes: (d) => d.startsWith(mes),
    };
    const anterior: Record<Periodo, (d: string) => boolean> = {
      hoje: (d) => d === ontem,
      ontem: (d) => d === dia(new Date(Date.now() - 2 * 86400_000)),
      "7d": (d) => d >= catorzeAtras && d < seteAtras,
      mes: () => false,
    };
    const atual = comDia.filter((v) => filtro[periodo](v.d));
    const porMp = Object.keys(MP).map((id) => ({ id, ...resumo(atual.filter((v) => (v.marketplace_id || "mercado_livre") === id)) }));
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = dia(new Date(Date.now() - (6 - i) * 86400_000));
      const r = resumo(comDia.filter((v) => v.d === d));
      return { d, ...r };
    });
    return { atual: resumo(atual), antes: resumo(comDia.filter((v) => anterior[periodo](v.d))), porMp, dias };
  }, [vendas, periodo]);

  const maxDia = Math.max(1, ...calc.dias.map((d) => d.faturamento));
  const vencendo = contasShopee.filter((c) => c.refresh_expires_at && new Date(c.refresh_expires_at).getTime() - Date.now() < 15 * 86400_000);
  const ROTULO: Record<Periodo, string> = { hoje: "Hoje", ontem: "Ontem", "7d": "7 dias", mes: "Este mês" };
  const COMPARA: Record<Periodo, string> = { hoje: "vs. ontem", ontem: "vs. anteontem", "7d": "vs. 7 dias antes", mes: "" };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{nome ? `Olá, ${nome}` : "Início"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}
          </p>
        </div>
        <div className="flex rounded-full bg-white p-1 shadow-soft">
          {(Object.keys(ROTULO) as Periodo[]).map((p) => (
            <button key={p} onClick={() => setPeriodo(p)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${periodo === p ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {ROTULO[p]}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className="card text-sm text-red-700">{erro}</div>}

      {/* Números do período */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { t: "Pedidos", v: vendas ? String(calc.atual.pedidos) : "…", a: calc.atual.pedidos, b: calc.antes.pedidos },
          { t: "Faturamento", v: vendas ? brl(calc.atual.faturamento) : "…", a: calc.atual.faturamento, b: calc.antes.faturamento },
          { t: "Lucro", v: vendas ? brl(calc.atual.lucro) : "…", a: calc.atual.lucro, b: calc.antes.lucro, cor: calc.atual.lucro < 0 ? "text-red-600" : "text-emerald-700" },
          { t: "Margem", v: vendas ? pct(calc.atual.margem) : "…", a: calc.atual.margem, b: calc.antes.margem },
        ].map((k) => (
          <div key={k.t} className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.t} · {ROTULO[periodo].toLowerCase()}</p>
            <p className={`mt-2 font-display text-3xl font-bold ${k.cor ?? "text-slate-900"}`}>{k.v}</p>
            {COMPARA[periodo] && vendas && (
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <Variacao atual={k.a} antes={k.b} /> {k.b ? COMPARA[periodo] : "sem dado para comparar"}
              </p>
            )}
          </div>
        ))}
      </div>

      {calc.atual.semCusto > 0 && (
        <Link href="/dashboard/pedidos" className="card flex items-center justify-between border border-amber-200 bg-amber-50 text-sm text-amber-800 hover:bg-amber-100">
          <span><b>{calc.atual.semCusto}</b> {calc.atual.semCusto === 1 ? "venda" : "vendas"} sem custo informado neste período: o lucro aparece maior que o real.</span>
          <span className="font-medium">Informar custos →</span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Por marketplace */}
        <div className="card lg:col-span-1">
          <h2 className="font-semibold">Por marketplace</h2>
          <div className="mt-3 space-y-3">
            {calc.porMp.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <span className={`h-8 w-1.5 rounded-full ${MP[m.id].cor}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{MP[m.id].nome}</p>
                  <p className="text-xs text-slate-500">{m.pedidos} {m.pedidos === 1 ? "pedido" : "pedidos"} · lucro {brl(m.lucro)}</p>
                </div>
                <p className="text-sm font-semibold">{brl(m.faturamento)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Últimos 7 dias */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Últimos 7 dias</h2>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand/30" />Faturamento</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Lucro</span>
            </span>
          </div>
          <div className="mt-4 flex h-40 items-end gap-3">
            {calc.dias.map((d) => (
              <div key={d.d} className="group flex flex-1 flex-col items-center gap-1" title={`${d.pedidos} pedidos · ${brl(d.faturamento)} · lucro ${brl(d.lucro)}`}>
                <div className="relative flex h-32 w-full items-end justify-center">
                  <div className="w-full max-w-[44px] rounded-t-lg bg-brand/30" style={{ height: `${(d.faturamento / maxDia) * 100}%` }} />
                  <div className="absolute bottom-0 w-1/2 max-w-[22px] rounded-t-md bg-emerald-500" style={{ height: `${(Math.max(0, d.lucro) / maxDia) * 100}%` }} />
                </div>
                <span className="text-[11px] text-slate-500">{new Date(`${d.d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reputação */}
      <div>
        <h2 className="mb-3 font-semibold">Reputação das contas</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ml === null && <div className="card text-sm text-slate-500">Carregando Mercado Livre…</div>}
          {ml?.map((c) => {
            const nivel = c.level_id ? Number(c.level_id.split("_")[0]) : 0;
            const m = c.metrics;
            const taxas = [
              ["Reclamações", m?.claims?.rate],
              ["Atrasos", m?.delayed_handling_time?.rate],
              ["Cancelamentos", m?.cancellations?.rate],
            ] as [string, number | undefined][];
            return (
              <div key={c.ml_user_id} className="card space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold"><span className="mr-1.5 rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">ML</span>{c.nickname ?? c.ml_user_id}</p>
                  {c.power_seller_status && <span className="text-[11px] text-slate-500">{MEDALHA[c.power_seller_status] ?? c.power_seller_status}</span>}
                </div>
                {c.ml_error ? (
                  <p className="text-xs text-red-600">Sem acesso: reconecte em Integrações</p>
                ) : (
                  <>
                    <div className="flex gap-1">
                      {NIVEIS.map((cor, i) => (
                        <span key={cor} className={`h-2 flex-1 rounded-full ${i + 1 === nivel ? cor : i + 1 < nivel ? `${cor} opacity-30` : "bg-slate-100"}`} />
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-slate-600">
                      {taxas.map(([t, v]) => (
                        <span key={t}>{t} <b className={v != null && v > 0.02 ? "text-red-600" : ""}>{v != null ? `${(v * 100).toFixed(1).replace(".", ",")}%` : "—"}</b></span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {shopee?.map((s) => (
            <div key={s.shop_id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold"><span className="mr-1.5 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">SH</span>{s.nome}</p>
                {s.nota ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${NOTA_SHOPEE[s.nota]?.c ?? ""}`}>{NOTA_SHOPEE[s.nota]?.t ?? s.nota}</span> : null}
              </div>
              {s.erro ? (
                <p className="text-xs text-slate-500">A Shopee não liberou a saúde da loja: {s.erro}</p>
              ) : (
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Pontos de penalidade <b className={(s.penalidade ?? 0) > 0 ? "text-red-600" : ""}>{s.penalidade ?? "—"}</b></span>
                  <span>Métricas fora da meta <b className={(s.falhas ?? 0) > 0 ? "text-amber-600" : ""}>{s.falhas ?? 0}</b></span>
                </div>
              )}
            </div>
          ))}
          <div className="card space-y-2 opacity-70">
            <p className="text-sm font-semibold"><span className="mr-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">TT</span>TikTok Shop</p>
            <p className="text-xs text-slate-500">Em breve: entra quando o app for aprovado e a loja conectada.</p>
          </div>
        </div>
      </div>

      {vencendo.length > 0 && (
        <Link href="/dashboard/integracoes" className="card block border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Autorização da Shopee vencendo em breve: {vencendo.map((c) => `${c.store_name || c.shop_name} (${new Date(c.refresh_expires_at!).toLocaleDateString("pt-BR")})`).join(", ")}. Clique para renovar.
        </Link>
      )}
    </div>
  );
}
