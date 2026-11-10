"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Marketplace, Product, brl, calcularTaxas, num, pct } from "@/lib/types";

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [mps, setMps] = useState<Marketplace[]>([]);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", cost: "", price: "", mp: "mercado_livre" });

  const carregar = useCallback(async () => {
    const [p, m] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("marketplaces").select("*").order("name"),
    ]);
    if (p.error) setErro(p.error.message);
    setProdutos((p.data ?? []) as Product[]);
    setMps((m.data ?? []) as Marketplace[]);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from("products").insert({
      store_id: uid,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      cost_price: num(form.cost),
      sale_price: num(form.price),
      marketplace_id: form.mp || null,
    });
    if (error) {
      setErro(error.message);
      return;
    }
    setForm({ ...form, name: "", sku: "", cost: "", price: "" });
    carregar();
  }

  async function salvarCampo(p: Product, campo: "cost_price" | "sale_price", valor: string) {
    const v = num(valor);
    if (v === Number(p[campo])) return;
    const { error } = await supabase.from("products").update({ [campo]: v }).eq("id", p.id);
    if (error) {
      setErro(error.message);
      return;
    }
    // Atualiza o custo das vendas já registradas desse produto.
    if (campo === "cost_price") await supabase.rpc("recalc_sales_cost", { p_product: p.id });
    carregar();
  }

  async function remover(p: Product) {
    if (!confirm(`Excluir "${p.name}"?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) setErro("Não foi possível excluir: o produto tem vendas registradas.");
    else carregar();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Produtos</h1>

      <form onSubmit={adicionar} className="card grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2">
          <label className="label">Nome</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="label">SKU</label>
          <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </div>
        <div>
          <label className="label">Custo (R$)</label>
          <input className="input" inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required />
        </div>
        <div>
          <label className="label">Preço de venda (R$)</label>
          <input className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        </div>
        <div>
          <label className="label">Marketplace</label>
          <select className="input" value={form.mp} onChange={(e) => setForm({ ...form, mp: e.target.value })}>
            {mps.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-6">
          <button className="btn">Adicionar produto</button>
        </div>
      </form>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Produto</th>
              <th className="th">Marketplace</th>
              <th className="th">Custo</th>
              <th className="th">Preço</th>
              <th className="th">Taxas</th>
              <th className="th">Lucro</th>
              <th className="th">Margem</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {produtos.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={8}>Nenhum produto ainda. Adicione acima ou importe do Mercado Livre.</td>
              </tr>
            )}
            {produtos.map((p) => {
              const mp = mps.find((m) => m.id === p.marketplace_id);
              const taxas = mp ? calcularTaxas(Number(p.sale_price), mp).totalTaxas : 0;
              const lucro = Number(p.sale_price) - Number(p.cost_price) - taxas;
              const margem = Number(p.sale_price) > 0 ? (lucro / Number(p.sale_price)) * 100 : 0;
              return (
                <tr key={p.id}>
                  <td className="td max-w-[260px] truncate" title={p.name}>
                    {p.name}
                    {p.sku && <span className="ml-2 text-xs text-slate-400">{p.sku}</span>}
                  </td>
                  <td className="td">{mp?.name ?? "—"}</td>
                  <td className="td">
                    <input
                      key={`c${p.id}${p.cost_price}`}
                      className="input w-24 py-1"
                      inputMode="decimal"
                      defaultValue={String(p.cost_price).replace(".", ",")}
                      onBlur={(e) => salvarCampo(p, "cost_price", e.target.value)}
                    />
                  </td>
                  <td className="td">
                    <input
                      key={`v${p.id}${p.sale_price}`}
                      className="input w-24 py-1"
                      inputMode="decimal"
                      defaultValue={String(p.sale_price).replace(".", ",")}
                      onBlur={(e) => salvarCampo(p, "sale_price", e.target.value)}
                    />
                  </td>
                  <td className="td">{brl(taxas)}</td>
                  <td className={`td font-medium ${lucro < 0 ? "text-red-600" : "text-emerald-700"}`}>{brl(lucro)}</td>
                  <td className={`td ${margem < 0 ? "text-red-600" : ""}`}>{pct(margem)}</td>
                  <td className="td">
                    <button onClick={() => remover(p)} className="text-xs text-red-600 hover:underline">Excluir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Altere custo ou preço direto na tabela; ao sair do campo, o valor é salvo. Mudar o custo atualiza as vendas já registradas desse produto.</p>
    </div>
  );
}
