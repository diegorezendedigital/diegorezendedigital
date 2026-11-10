"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { CATEGORIAS_DESPESA, Expense, Sale, brl, intervaloDoMes, mesAtual, num, pct } from "@/lib/types";

export default function DrePage() {
  const [mes, setMes] = useState(mesAtual());
  const [vendas, setVendas] = useState<Sale[]>([]);
  const [despesas, setDespesas] = useState<Expense[]>([]);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ category: "despesa_fixa", description: "", amount: "" });

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervaloDoMes(mes);
    const ini = new Date(`${inicio}T00:00:00`).toISOString();
    const fi = new Date(`${fim}T00:00:00`).toISOString();
    setErro("");
    const [s, d] = await Promise.all([
      supabase.from("sales").select("*").gte("sold_at", ini).lt("sold_at", fi),
      supabase.from("expenses").select("*").eq("month_ref", inicio).order("created_at", { ascending: false }),
    ]);
    if (s.error) setErro(s.error.message);
    if (d.error) setErro(d.error.message);
    setVendas((s.data ?? []) as Sale[]);
    setDespesas((d.data ?? []) as Expense[]);
  }, [mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionarDespesa(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from("expenses").insert({
      store_id: uid,
      category: form.category,
      description: form.description.trim(),
      amount: num(form.amount),
      month_ref: intervaloDoMes(mes).inicio,
    });
    if (error) {
      setErro(error.message);
      return;
    }
    setForm({ ...form, description: "", amount: "" });
    carregar();
  }

  async function removerDespesa(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    carregar();
  }

  const soma = (f: (s: Sale) => number) => vendas.reduce((a, s) => a + Number(f(s) || 0), 0);
  const receita = soma((s) => s.sale_price);
  const custo = soma((s) => s.cost_price);
  const taxas = soma((s) => s.fees_total);
  const frete = soma((s) => s.shipping_cost);
  const imposto = soma((s) => s.tax_amount);
  const lucroVendas = receita - custo - taxas - frete - imposto;
  const totalDespesas = despesas.reduce((a, d) => a + Number(d.amount), 0);
  const resultado = lucroVendas - totalDespesas;
  const margem = receita > 0 ? (resultado / receita) * 100 : 0;

  const rotulo = (id: string) => CATEGORIAS_DESPESA.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">DRE</h1>
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="card">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <L t="Receita bruta" v={brl(receita)} forte />
            <L t="(-) Custo dos produtos" v={brl(custo)} />
            <L t="(-) Taxas dos marketplaces" v={brl(taxas)} />
            <L t="(-) Frete" v={brl(frete)} />
            <L t="(-) Impostos" v={brl(imposto)} />
            <L t="= Lucro das vendas" v={brl(lucroVendas)} forte />
            <L t="(-) Despesas do mês" v={brl(totalDespesas)} />
            <L t="= Resultado líquido" v={brl(resultado)} forte ruim={resultado < 0} />
            <L t="Margem líquida" v={pct(margem)} ruim={margem < 0} />
          </tbody>
        </table>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Despesas do mês</h2>
        <form onSubmit={adicionarDespesa} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIAS_DESPESA.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="label">Descrição</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div>
            <label className="label">Valor (R$)</label>
            <input className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div className="flex items-end">
            <button className="btn w-full">Adicionar</button>
          </div>
        </form>

        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            {despesas.length === 0 && (
              <tr>
                <td className="td text-slate-500">Nenhuma despesa neste mês.</td>
              </tr>
            )}
            {despesas.map((d) => (
              <tr key={d.id}>
                <td className="td">{rotulo(d.category)}</td>
                <td className="td">{d.description}</td>
                <td className="td text-right">{brl(d.amount)}</td>
                <td className="td text-right">
                  <button onClick={() => removerDespesa(d.id)} className="text-xs text-red-600 hover:underline">Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function L({ t, v, forte, ruim }: { t: string; v: string; forte?: boolean; ruim?: boolean }) {
  return (
    <tr className={forte ? "bg-slate-50" : ""}>
      <td className={`px-3 py-2 ${forte ? "font-semibold" : "text-slate-600"}`}>{t}</td>
      <td className={`px-3 py-2 text-right ${forte ? "font-semibold" : ""} ${ruim ? "text-red-600" : ""}`}>{v}</td>
    </tr>
  );
}
