"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Marketplace, Product, brl, calcularTaxas, campo, num, pct } from "@/lib/types";

export default function CalculadoraPage() {
  const [mps, setMps] = useState<Marketplace[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [mpId, setMpId] = useState("mercado_livre");
  const [produtoId, setProdutoId] = useState("");
  const [preco, setPreco] = useState("");
  const [custo, setCusto] = useState("");
  const [frete, setFrete] = useState("0");
  const [imposto, setImposto] = useState("0");
  const [margemDesejada, setMargemDesejada] = useState("15");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("marketplaces").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
    ]).then(([m, p]) => {
      setMps((m.data ?? []) as Marketplace[]);
      setProdutos((p.data ?? []) as Product[]);
    });
  }, []);

  function escolherProduto(id: string) {
    setProdutoId(id);
    const p = produtos.find((x) => x.id === id);
    if (p) {
      setPreco(campo(Number(p.sale_price)));
      setCusto(campo(Number(p.cost_price)));
      if (p.marketplace_id) setMpId(p.marketplace_id);
    }
  }

  const mp = mps.find((m) => m.id === mpId);
  const precoN = num(preco);
  const custoN = num(custo);
  const freteN = num(frete);
  const impostoN = (precoN * num(imposto)) / 100;
  const taxas = mp ? calcularTaxas(precoN, mp) : null;
  const totalTaxas = taxas?.totalTaxas ?? 0;
  const lucro = precoN - custoN - totalTaxas - freteN - impostoN;
  const margem = precoN > 0 ? (lucro / precoN) * 100 : 0;
  const roi = custoN > 0 ? (lucro / custoN) * 100 : 0;

  // Preço mínimo para atingir a margem desejada: P = (custo + frete + taxa fixa) / (1 - comissão% - extra% - imposto% - margem%)
  let precoIdeal: number | null = null;
  if (mp) {
    const denom = 1 - (Number(mp.commission_percent) + Number(mp.extra_percent) + num(imposto) + num(margemDesejada)) / 100;
    if (denom > 0) precoIdeal = (custoN + freteN + Number(mp.fixed_fee)) / denom;
  }

  async function registrarVenda() {
    setMsg("");
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid || !mp || precoN <= 0) {
      setMsg("Informe o preço de venda.");
      return;
    }
    const { error } = await supabase.from("sales").insert({
      store_id: uid,
      product_id: produtoId || null,
      marketplace_id: mp.id,
      quantity: 1,
      sale_price: precoN,
      cost_price: custoN,
      fees_total: totalTaxas,
      shipping_cost: freteN,
      tax_amount: impostoN,
    });
    setMsg(error ? error.message : "Venda registrada! Veja em Relatórios e DRE.");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Calculadora de margem</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <div>
            <label className="label">Usar produto cadastrado (opcional)</label>
            <select className="input" value={produtoId} onChange={(e) => escolherProduto(e.target.value)}>
              <option value="">— digitar manualmente —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Marketplace</label>
            <select className="input" value={mpId} onChange={(e) => setMpId(e.target.value)}>
              {mps.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {mp && (
              <p className="mt-1 text-xs text-slate-500">
                Comissão {pct(Number(mp.commission_percent))} + taxa fixa {brl(mp.fixed_fee)}
                {Number(mp.extra_percent) > 0 ? ` + extra ${pct(Number(mp.extra_percent))}` : ""}. {mp.notes}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Preço de venda (R$)</label>
              <input className="input" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
            </div>
            <div>
              <label className="label">Custo do produto (R$)</label>
              <input className="input" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} />
            </div>
            <div>
              <label className="label">Frete pago por você (R$)</label>
              <input className="input" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} />
            </div>
            <div>
              <label className="label">Imposto (%)</label>
              <input className="input" inputMode="decimal" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Resultado</h2>
          <dl className="space-y-1 text-sm">
            <Linha t="Preço de venda" v={brl(precoN)} />
            <Linha t="(-) Custo do produto" v={brl(custoN)} />
            <Linha t="(-) Taxas do marketplace" v={brl(totalTaxas)} />
            <Linha t="(-) Frete" v={brl(freteN)} />
            <Linha t="(-) Imposto" v={brl(impostoN)} />
          </dl>
          <div className={`rounded-lg p-3 ${lucro < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
            <div className="text-xs">Lucro por venda</div>
            <div className="text-2xl font-bold">{brl(lucro)}</div>
            <div className="text-sm">Margem {pct(margem)} · Retorno sobre o custo {pct(roi)}</div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <label className="label">Margem desejada (%)</label>
            <div className="flex items-center gap-3">
              <input className="input w-24" inputMode="decimal" value={margemDesejada} onChange={(e) => setMargemDesejada(e.target.value)} />
              <span className="text-sm">
                Preço mínimo: <b>{precoIdeal != null ? brl(precoIdeal) : "impossível com essas taxas"}</b>
              </span>
            </div>
          </div>

          <button onClick={registrarVenda} className="btn-ghost">Registrar como venda</button>
          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function Linha({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{t}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
