"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Marketplace, Sale, brl, intervaloDoMes, mesAtual, pct } from "@/lib/types";

type SaleRow = Sale & { products: { name: string } | null };

export default function RelatoriosPage() {
  const [mes, setMes] = useState(mesAtual());
  const [vendas, setVendas] = useState<SaleRow[]>([]);
  const [mps, setMps] = useState<Marketplace[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    supabase.from("marketplaces").select("*").then(({ data }) => setMps((data ?? []) as Marketplace[]));
  }, []);

  useEffect(() => {
    const { inicio, fim } = intervaloDoMes(mes);
    const ini = new Date(`${inicio}T00:00:00`).toISOString();
    const fi = new Date(`${fim}T00:00:00`).toISOString();
    setErro("");
    supabase
      .from("sales")
      .select("*, products(name)")
      .gte("sold_at", ini)
      .lt("sold_at", fi)
      .order("sold_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setErro(error.message);
        setVendas((data ?? []) as unknown as SaleRow[]);
      });
  }, [mes]);

  const nomeMp = (id: string | null) => mps.find((m) => m.id === id)?.name ?? "—";

  const totais = useMemo(() => {
    const soma = (f: (s: SaleRow) => number) => vendas.reduce((a, s) => a + Number(f(s) || 0), 0);
    const receita = soma((s) => s.sale_price);
    const lucro = soma((s) => s.profit);
    return {
      receita,
      custo: soma((s) => s.cost_price),
      taxas: soma((s) => s.fees_total),
      frete: soma((s) => s.shipping_cost),
      imposto: soma((s) => s.tax_amount),
      lucro,
      margem: receita > 0 ? (lucro / receita) * 100 : 0,
    };
  }, [vendas]);

  const porMp = useMemo(() => {
    const mapa = new Map<string, { receita: number; lucro: number; qtd: number }>();
    vendas.forEach((s) => {
      const k = s.marketplace_id ?? "—";
      const cur = mapa.get(k) ?? { receita: 0, lucro: 0, qtd: 0 };
      cur.receita += Number(s.sale_price);
      cur.lucro += Number(s.profit);
      cur.qtd += 1;
      mapa.set(k, cur);
    });
    return Array.from(mapa.entries());
  }, [vendas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">Relatórios</h1>
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cartao t="Receita" v={brl(totais.receita)} />
        <Cartao t="Taxas + frete + imposto" v={brl(totais.taxas + totais.frete + totais.imposto)} />
        <Cartao t="Lucro" v={brl(totais.lucro)} ruim={totais.lucro < 0} />
        <Cartao t="Margem" v={pct(totais.margem)} ruim={totais.margem < 0} />
      </div>

      {porMp.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Marketplace</th>
                <th className="th">Vendas</th>
                <th className="th">Receita</th>
                <th className="th">Lucro</th>
                <th className="th">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {porMp.map(([id, v]) => (
                <tr key={id}>
                  <td className="td">{nomeMp(id)}</td>
                  <td className="td">{v.qtd}</td>
                  <td className="td">{brl(v.receita)}</td>
                  <td className="td">{brl(v.lucro)}</td>
                  <td className="td">{pct(v.receita > 0 ? (v.lucro / v.receita) * 100 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Data</th>
              <th className="th">Produto</th>
              <th className="th">Marketplace</th>
              <th className="th">Qtd</th>
              <th className="th">Venda</th>
              <th className="th">Custo</th>
              <th className="th">Taxas</th>
              <th className="th">Frete</th>
              <th className="th">Imposto</th>
              <th className="th">Lucro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vendas.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={10}>Nenhuma venda neste mês.</td>
              </tr>
            )}
            {vendas.map((s) => (
              <tr key={s.id}>
                <td className="td">{new Date(s.sold_at).toLocaleDateString("pt-BR")}</td>
                <td className="td max-w-[220px] truncate">{s.products?.name ?? "—"}</td>
                <td className="td">{nomeMp(s.marketplace_id)}</td>
                <td className="td">{s.quantity}</td>
                <td className="td">{brl(s.sale_price)}</td>
                <td className="td">{brl(s.cost_price)}</td>
                <td className="td">{brl(s.fees_total)}</td>
                <td className="td">{brl(s.shipping_cost)}</td>
                <td className="td">{brl(s.tax_amount)}</td>
                <td className={`td font-medium ${Number(s.profit) < 0 ? "text-red-600" : "text-emerald-700"}`}>{brl(s.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cartao({ t, v, ruim }: { t: string; v: string; ruim?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{t}</div>
      <div className={`text-xl font-bold ${ruim ? "text-red-600" : ""}`}>{v}</div>
    </div>
  );
}
