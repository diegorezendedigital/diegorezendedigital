"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/supabase/client";
import { brl } from "@/lib/types";

type Loja = { shop_id: string; shop_name: string | null; store_name?: string | null };
type Relampago = { flash_sale_id: number; status?: number; start_time: number; end_time: number; enabled_item_count?: number; item_count?: number; type?: number; remindme_count?: number; click_count?: number };
type Desconto = { discount_id: number; discount_name: string; status: string; start_time: number; end_time: number };
type Cupom = {
  voucher_id: number; voucher_code?: string; voucher_name?: string; voucher_type?: number; reward_type?: number;
  usage_quantity?: number; current_usage?: number; start_time: number; end_time: number; voucher_purpose?: number;
  discount_amount?: number; percentage?: number; max_price?: number; min_basket_price?: number;
};
type Dados = { relampago: Relampago[]; descontos: Desconto[]; cupons: Cupom[]; erros: Record<string, string> };
type Aba = "relampago" | "descontos" | "cupons";

const dataHora = (s: number) =>
  new Date(s * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function situacao(inicio: number, fim: number) {
  const agora = Date.now() / 1000;
  if (agora < inicio) return { t: "Programada", c: "bg-sky-50 text-sky-700" };
  if (agora > fim) return { t: "Encerrada", c: "bg-slate-100 text-slate-500" };
  return { t: "Acontecendo", c: "bg-emerald-50 text-emerald-700" };
}

function Selo({ inicio, fim }: { inicio: number; fim: number }) {
  const s = situacao(inicio, fim);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.t}</span>;
}

const RELAMPAGO_STATUS: Record<number, string> = { 0: "Excluída", 1: "Ativa", 2: "Desativada", 3: "Recusada pela Shopee" };
const PROPOSITO: Record<number, string> = { 0: "Público", 1: "Privado", 2: "Live", 3: "Vídeo" };

function beneficio(c: Cupom) {
  if (c.reward_type === 2) return `${c.percentage ?? 0}% off${c.max_price ? ` (até ${brl(c.max_price)})` : ""}`;
  if (c.reward_type === 3) return `${c.percentage ?? 0}% em moedas`;
  return `${brl(c.discount_amount ?? 0)} off`;
}

export default function PromocoesShopeePage() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loja, setLoja] = useState("");
  const [periodo, setPeriodo] = useState<"ativas" | "encerradas">("ativas");
  const [aba, setAba] = useState<Aba>("relampago");
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    apiFetch<{ accounts: Loja[] }>("/api/shopee/accounts")
      .then((r) => {
        setLojas(r.accounts ?? []);
        if (r.accounts?.[0]) setLoja(r.accounts[0].shop_id);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, []);

  const carregar = useCallback(async () => {
    if (!loja) return;
    setCarregando(true);
    setErro("");
    try {
      setDados(await apiFetch<Dados>(`/api/shopee/promocoes?shop_id=${loja}&periodo=${periodo}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [loja, periodo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const contagem = { relampago: dados?.relampago.length ?? 0, descontos: dados?.descontos.length ?? 0, cupons: dados?.cupons.length ?? 0 };
  const ABAS: [Aba, string][] = [["relampago", "Oferta relâmpago"], ["descontos", "Promoções de desconto"], ["cupons", "Cupons"]];
  const erroAba = dados?.erros?.[aba];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Central de promoções · Shopee</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Acompanhe as ofertas relâmpago, as promoções de desconto e os cupons da sua loja na Shopee.
        </p>
      </div>

      {lojas.length === 0 && !erro ? (
        <div className="card text-sm text-slate-600">
          Nenhuma loja da Shopee conectada. <Link href="/dashboard/integracoes" className="text-brand underline">Conectar em Integrações</Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Loja</label>
            <select className="input" value={loja} onChange={(e) => setLoja(e.target.value)}>
              {lojas.map((l) => (
                <option key={l.shop_id} value={l.shop_id}>{l.store_name || l.shop_name || l.shop_id}</option>
              ))}
            </select>
          </div>
          <div className="flex rounded-xl bg-white p-1 shadow-sm">
            {(["ativas", "encerradas"] as const).map((p) => (
              <button key={p} onClick={() => setPeriodo(p)} className={`rounded-lg px-4 py-2 text-sm font-medium ${periodo === p ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {p === "ativas" ? "Acontecendo e programadas" : "Encerradas"}
              </button>
            ))}
          </div>
          <button onClick={carregar} disabled={carregando} className="btn-ghost">{carregando ? "Atualizando…" : "Atualizar"}</button>
        </div>
      )}

      {erro && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{erro}</div>}

      {loja && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist">
            {ABAS.map(([id, nome]) => (
              <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${aba === id ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                {nome} <span className="ml-1 opacity-70">{contagem[id]}</span>
              </button>
            ))}
          </div>

          {erroAba && (
            <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
              A Shopee não liberou esta consulta: {erroAba}. Pode faltar permissão de promoções no app da Shopee.
            </div>
          )}

          <div className="card overflow-x-auto p-0 tabela-pro">
            {carregando ? (
              <p className="p-5 text-sm text-slate-500">Carregando…</p>
            ) : aba === "relampago" ? (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Início</th><th className="th">Fim</th><th className="th">Situação</th><th className="th">Status</th><th className="th text-right">Produtos ativos</th><th className="th text-right">Lembretes</th><th className="th text-right">Cliques</th></tr></thead>
                <tbody>
                  {dados?.relampago.length ? dados.relampago.sort((a, b) => a.start_time - b.start_time).map((f) => (
                    <tr key={f.flash_sale_id} className="border-t border-slate-100">
                      <td className="td">{dataHora(f.start_time)}</td>
                      <td className="td">{dataHora(f.end_time)}</td>
                      <td className="td"><Selo inicio={f.start_time} fim={f.end_time} /></td>
                      <td className="td">{RELAMPAGO_STATUS[f.status ?? -1] ?? "—"}</td>
                      <td className="td text-right">{f.enabled_item_count ?? 0} de {f.item_count ?? 0}</td>
                      <td className="td text-right">{f.remindme_count ?? 0}</td>
                      <td className="td text-right">{f.click_count ?? 0}</td>
                    </tr>
                  )) : <tr><td className="td text-slate-500" colSpan={7}>Nenhuma oferta relâmpago {periodo === "ativas" ? "acontecendo ou programada" : "encerrada"}.</td></tr>}
                </tbody>
              </table>
            ) : aba === "descontos" ? (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Promoção</th><th className="th">Início</th><th className="th">Fim</th><th className="th">Situação</th></tr></thead>
                <tbody>
                  {dados?.descontos.length ? dados.descontos.sort((a, b) => a.start_time - b.start_time).map((d) => (
                    <tr key={d.discount_id} className="border-t border-slate-100">
                      <td className="td font-medium">{d.discount_name}</td>
                      <td className="td">{dataHora(d.start_time)}</td>
                      <td className="td">{dataHora(d.end_time)}</td>
                      <td className="td"><Selo inicio={d.start_time} fim={d.end_time} /></td>
                    </tr>
                  )) : <tr><td className="td text-slate-500" colSpan={4}>Nenhuma promoção de desconto {periodo === "ativas" ? "acontecendo ou programada" : "encerrada"}.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Cupom</th><th className="th">Código</th><th className="th">Benefício</th><th className="th">Pedido mínimo</th><th className="th">Vale para</th><th className="th">Tipo</th><th className="th text-right">Usados</th><th className="th">Período</th><th className="th">Situação</th></tr></thead>
                <tbody>
                  {dados?.cupons.length ? dados.cupons.sort((a, b) => a.start_time - b.start_time).map((c) => (
                    <tr key={c.voucher_id} className="border-t border-slate-100">
                      <td className="td font-medium">{c.voucher_name || "—"}</td>
                      <td className="td font-mono text-xs">{c.voucher_code || "—"}</td>
                      <td className="td">{beneficio(c)}</td>
                      <td className="td">{c.min_basket_price ? brl(c.min_basket_price) : "—"}</td>
                      <td className="td">{c.voucher_type === 2 ? "Produtos" : "Loja toda"}</td>
                      <td className="td">{PROPOSITO[c.voucher_purpose ?? -1] ?? "—"}</td>
                      <td className="td text-right">{c.current_usage ?? 0} de {c.usage_quantity ?? 0}</td>
                      <td className="td whitespace-nowrap">{dataHora(c.start_time)} a {dataHora(c.end_time)}</td>
                      <td className="td"><Selo inicio={c.start_time} fim={c.end_time} /></td>
                    </tr>
                  )) : <tr><td className="td text-slate-500" colSpan={9}>Nenhum cupom {periodo === "ativas" ? "acontecendo ou programado" : "encerrado"}.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
