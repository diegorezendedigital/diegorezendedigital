"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Product, brl, campo, num, pct } from "@/lib/types";
import { calcularLucro, precoParaMargem, type EntradaPreco } from "@/lib/pricing";
import { CANAIS } from "@/lib/taxas-publicas";

const TIKTOK = CANAIS.find((c) => c.id === "tiktok_shop")!;

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Comp = { kit_id: string; component_id: string; quantity: number };

export default function CalculadoraTikTok() {
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [componentes, setComponentes] = useState<Comp[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [produto, setProduto] = useState<Product | null>(null);

  const [imposto, setImposto] = useState("10");
  const [preco, setPreco] = useState("");
  const [custo, setCusto] = useState("");
  const [frete, setFrete] = useState("0");
  const [afiliado, setAfiliado] = useState("8");
  const [margemAlvo, setMargemAlvo] = useState("15");
  const [comissaoManual, setComissaoManual] = useState("");
  const [tarifaManual, setTarifaManual] = useState("");

  useEffect(() => {
    (async () => {
      const todos: Product[] = [];
      for (let i = 0; ; i += 1000) {
        const r = await supabase.from("products").select("*").order("name").order("id").range(i, i + 999);
        const lote = (r.data ?? []) as Product[];
        todos.push(...lote);
        if (lote.length < 1000) break;
      }
      const c = await supabase.from("product_components").select("kit_id, component_id, quantity");
      setProdutos(todos);
      setComponentes((c.data ?? []) as Comp[]);
      setCarregando(false);
    })();
  }, []);

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Custo e créditos de imposto por unidade; o kit soma as peças.
  function custoDe(p: Product): { custo: number; credito: number } {
    const cred = (x: Product) => Number(x.icms_credit ?? 0) + Number(x.pis_credit ?? 0) + Number(x.cofins_credit ?? 0);
    if (p.tipo === "kit") {
      return componentes
        .filter((c) => c.kit_id === p.id)
        .reduce(
          (t, c) => {
            const pc = porId.get(c.component_id);
            return {
              custo: t.custo + c.quantity * Number(pc?.cost_price ?? 0),
              credito: t.credito + c.quantity * (pc ? cred(pc) : 0),
            };
          },
          { custo: 0, credito: 0 }
        );
    }
    return { custo: Number(p.cost_price ?? 0), credito: cred(p) };
  }

  const sugestoes = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    return produtos
      .filter((p) => p.tipo !== "multi")
      .filter((p) => {
        const alvo = semAcento(`${p.name} ${p.sku ?? ""} ${p.ean ?? ""}`);
        return termos.every((t) => alvo.includes(t));
      })
      .slice(0, 8);
  }, [busca, produtos]);

  function escolher(p: Product) {
    setProduto(p);
    setBusca(p.name);
    setAberta(false);
    setCusto(campo(custoDe(p).custo));
    if (Number(p.sale_price) > 0) setPreco(campo(Number(p.sale_price)));
  }

  function limpar() {
    setProduto(null);
    setBusca("");
    setCusto("");
  }

  // Imposto simples: % sobre o preço de venda, editável (padrão 10%).
  const empresa: EntradaPreco["empresa"] = {
    regime: "simples",
    simples_aliquota: num(imposto),
    icms_pct: 0,
    pis_pct: 0,
    cofins_pct: 0,
    irpj_csll_pct: 0,
  };
  const precoN = num(preco);
  const custoN = num(custo);
  const margemN = num(margemAlvo);

  // Tarifa da faixa do preço (ou os valores digitados à mão).
  function taxasDe(p: number) {
    const f = TIKTOK.faixas.find((x) => p <= x.ate) ?? TIKTOK.faixas[TIKTOK.faixas.length - 1];
    const com = comissaoManual.trim() ? num(comissaoManual) : f.comissao;
    const fixa = tarifaManual.trim() ? num(tarifaManual) : typeof f.fixa === "number" ? f.fixa : 0;
    return { com, fixa };
  }

  function entrada(p: number): EntradaPreco {
    const t = taxasDe(p);
    return { custo: custoN, credito: 0, feePct: t.com + num(afiliado), feeFixo: t.fixa, frete: num(frete), empresa };
  }

  const t = taxasDe(precoN);
  const r = calcularLucro(precoN, entrada(precoN));
  const comissaoR = (precoN * t.com) / 100;
  const afiliadoR = (precoN * num(afiliado)) / 100;
  const roi = custoN > 0 ? (r.lucro / custoN) * 100 : 0;

  // Menor preço que entrega a margem, faixa por faixa (a tarifa muda no limite de R$ 50).
  function precoMinimo(m: number): number | null {
    let inicio = 0;
    for (const f of TIKTOK.faixas) {
      const ent = entrada(Math.min(f.ate, inicio + 0.01));
      const p = precoParaMargem(m, ent);
      if (p != null && p <= f.ate) {
        if (p > inicio) return p;
        const piso = inicio + 0.01;
        if (calcularLucro(piso, entrada(piso)).margem >= m) return piso;
      }
      inicio = f.ate;
    }
    return null;
  }

  const minimo = custoN > 0 ? precoMinimo(margemN) : null;
  const tabela = [0, 10, 15, 20, 25, 30];

  if (carregando) return <p className="text-sm text-slate-500">Carregando seus produtos…</p>;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="relative">
          <label className="label">Buscar produto pelo nome, SKU ou EAN</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setAberta(true);
                if (produto) setProduto(null);
              }}
              onFocus={() => setAberta(true)}
              onBlur={() => setTimeout(() => setAberta(false), 150)}
              placeholder={produtos.length ? "Digite para buscar…" : "Nenhum produto cadastrado ainda"}
            />
            {(produto || busca) && (
              <button type="button" className="btn-ghost" onClick={limpar}>Limpar</button>
            )}
          </div>
          {aberta && sugestoes.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox">
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-500">{p.sku ? `SKU ${p.sku}` : "sem SKU"}{p.tipo === "kit" ? " · kit" : ""}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-600">custo {brl(custoDe(p).custo)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {aberta && busca.trim() && sugestoes.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">Nenhum produto encontrado. Você também pode digitar o custo abaixo.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Preço de venda (R$)</label>
              <input className="input" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
              <p className="mt-1 text-[11px] text-slate-500">Depois do desconto do vendedor</p>
            </div>
            <div>
              <label className="label">Custo do produto (R$)</label>
              <input className="input" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} />
              {produto && <p className="mt-1 text-[11px] text-slate-500">Puxado do armazém</p>}
            </div>
            <div>
              <label className="label">Frete pago por você (R$)</label>
              <input className="input" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} />
            </div>
            <div>
              <label className="label">Imposto (%)</label>
              <input className="input" inputMode="decimal" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </div>
            <div>
              <label className="label">Comissão do afiliado (%)</label>
              <input className="input" inputMode="decimal" value={afiliado} onChange={(e) => setAfiliado(e.target.value)} />
            </div>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">Ajustar as taxas do TikTok Shop</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Comissão (%)</label>
                <input className="input" inputMode="decimal" value={comissaoManual} onChange={(e) => setComissaoManual(e.target.value)} placeholder={String(taxasDe(precoN).com)} />
              </div>
              <div>
                <label className="label">Tarifa por item (R$)</label>
                <input className="input" inputMode="decimal" value={tarifaManual} onChange={(e) => setTarifaManual(e.target.value)} placeholder={String(taxasDe(precoN).fixa)} />
              </div>
            </div>
          </details>
          <p className="text-xs text-slate-500">{TIKTOK.nota} Confira no Seller Center.</p>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Resultado no TikTok Shop</h2>
          <dl className="space-y-1 text-sm">
            <Linha t="Preço de venda" v={brl(precoN)} />
            <Linha t="(-) Custo do produto" v={brl(custoN)} />
            <Linha t={`(-) Comissão (${pct(t.com)})`} v={brl(comissaoR)} />
            <Linha t="(-) Tarifa por item" v={brl(t.fixa)} />
            {afiliadoR > 0 && <Linha t={`(-) Afiliado (${pct(num(afiliado))})`} v={brl(afiliadoR)} />}
            <Linha t="(-) Frete" v={brl(num(frete))} />
            <Linha t={`(-) Imposto (${pct(num(imposto))})`} v={brl(r.impostos)} />
          </dl>
          <div className={`rounded-lg p-3 ${precoN > 0 && r.lucro < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
            <div className="text-xs">Sobra por venda</div>
            <div className="text-2xl font-bold">{brl(precoN > 0 ? r.lucro : 0)}</div>
            <div className="text-sm">Margem que sobra: <b>{pct(precoN > 0 ? r.margem : 0)}</b> do preço · Retorno sobre o custo {pct(precoN > 0 ? roi : 0)}</div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <label className="label">Margem desejada (%)</label>
            <div className="flex items-center gap-3">
              <input className="input w-24" inputMode="decimal" value={margemAlvo} onChange={(e) => setMargemAlvo(e.target.value)} />
              <span className="text-sm">
                Preço mínimo: <b>{custoN <= 0 ? "informe o custo" : minimo != null ? brl(minimo) : "impossível com essas taxas"}</b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {custoN > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Preço para cada margem</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-4">Margem</th>
                  <th className="py-1 pr-4">Preço de venda</th>
                  <th className="py-1">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {tabela.map((m) => {
                  const p = precoMinimo(m);
                  return (
                    <tr key={m} className="border-t border-slate-100">
                      <td className="py-1 pr-4">{m}%</td>
                      <td className="py-1 pr-4 font-medium">{p != null ? brl(p) : "—"}</td>
                      <td className="py-1">{p != null ? brl(calcularLucro(p, entrada(p)).lucro) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
