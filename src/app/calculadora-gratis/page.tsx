"use client";

import { useState } from "react";
import Link from "next/link";
import { brl, num, pct } from "@/lib/types";
import { CANAIS, Canal, CanalId, precoParaMargem, taxasDoPreco } from "@/lib/taxas-publicas";

const campo =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-gold/30";
const rotulo = "mb-1 block font-mono text-xs uppercase tracking-widest text-clay";

export default function CalculadoraGratisPage() {
  const [canalId, setCanalId] = useState<CanalId>("mercado_livre");
  const [preco, setPreco] = useState("");
  const [custo, setCusto] = useState("");
  const [frete, setFrete] = useState("0");
  const [imposto, setImposto] = useState("0");
  const [margemDesejada, setMargemDesejada] = useState("15");
  const [vendedorCpf, setVendedorCpf] = useState(false);
  const [comissaoManual, setComissaoManual] = useState("");
  const [fixaManual, setFixaManual] = useState("");

  const canal = CANAIS.find((c) => c.id === canalId) as Canal;
  const precoN = num(preco);
  const custoN = num(custo);
  const freteN = num(frete);
  const impostoN = num(imposto);
  const margemN = num(margemDesejada);

  // Ajustes manuais valem só para o canal escolhido; a comparação usa as taxas de referência.
  function ajustes(c: Canal) {
    return {
      extraFixa: c.id === "shopee" && vendedorCpf ? 3 : 0,
      comissao: c.id === canalId && comissaoManual.trim() ? num(comissaoManual) : undefined,
      fixa: c.id === canalId && fixaManual.trim() ? num(fixaManual) : undefined,
    };
  }

  function resultado(c: Canal, p: number) {
    const t = taxasDoPreco(c, p, ajustes(c));
    const imp = (p * impostoN) / 100;
    const lucro = p - custoN - freteN - t.total - imp;
    return { ...t, imp, lucro, margem: p > 0 ? (lucro / p) * 100 : 0, roi: custoN > 0 ? (lucro / custoN) * 100 : 0 };
  }

  const r = resultado(canal, precoN);
  const minimo = precoParaMargem(canal, custoN, freteN, impostoN, margemN, ajustes(canal));
  const temPreco = precoN > 0;

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Diego Rezende <span className="text-gold">Digital</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="hover:text-gold transition-colors">
              Entrar
            </Link>
            <Link
              href="/planos"
              className="rounded-full border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors"
            >
              Assinar
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-12 pb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Calculadora gratuita</p>
        <h1 className="font-display text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight">
          Quanto sobra de verdade em cada venda?
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink/70 leading-relaxed">
          Mercado Livre, Shopee e TikTok Shop, com as taxas de cada canal. Sem cadastro, sem login.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Marketplace">
          {CANAIS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === canalId}
              onClick={() => {
                setCanalId(c.id);
                setComissaoManual("");
                setFixaManual("");
              }}
              className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
                c.id === canalId ? "bg-ink text-paper" : "border border-line bg-white hover:border-ink"
              }`}
            >
              {c.nome}
            </button>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-line bg-white p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={rotulo} htmlFor="preco">Preço de venda (R$)</label>
                <input id="preco" className={campo} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="99,90" />
              </div>
              <div>
                <label className={rotulo} htmlFor="custo">Custo do produto (R$)</label>
                <input id="custo" className={campo} inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="40,00" />
              </div>
              <div>
                <label className={rotulo} htmlFor="frete">Frete pago por você (R$)</label>
                <input id="frete" className={campo} inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="imposto">Imposto (%)</label>
                <input id="imposto" className={campo} inputMode="decimal" value={imposto} onChange={(e) => setImposto(e.target.value)} />
              </div>
            </div>

            {canal.id === "shopee" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={vendedorCpf} onChange={(e) => setVendedorCpf(e.target.checked)} />
                Vendo como pessoa física (CPF): R$ 3 a mais por item
              </label>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-ink/70 hover:text-ink">Ajustar as taxas do canal</summary>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className={rotulo} htmlFor="com">Comissão (%)</label>
                  <input id="com" className={campo} inputMode="decimal" value={comissaoManual} onChange={(e) => setComissaoManual(e.target.value)} placeholder={temPreco ? String(r.comissaoPct).replace(".", ",") : "da faixa"} />
                </div>
                <div>
                  <label className={rotulo} htmlFor="fixa">Taxa fixa (R$)</label>
                  <input id="fixa" className={campo} inputMode="decimal" value={fixaManual} onChange={(e) => setFixaManual(e.target.value)} placeholder="da faixa" />
                </div>
              </div>
              <p className="mt-2 text-xs text-ink/50">Em branco, usamos a tabela de referência do canal.</p>
            </details>
            <p className="text-xs text-ink/50">{canal.nota} Confira sempre na sua central do vendedor.</p>
          </div>

          <div className="space-y-4 rounded-2xl bg-inkdeep p-6 font-mono text-sm text-paper shadow-xl">
            <p className="text-xs uppercase tracking-widest text-goldlight">Resultado no {canal.nome}</p>
            <div className="space-y-2">
              <Linha t="Preço de venda" v={brl(precoN)} />
              <Linha t="Custo do produto" v={`− ${brl(custoN)}`} />
              <Linha t={`Comissão (${pct(r.comissaoPct)})`} v={`− ${brl(r.comissao)}`} />
              <Linha t="Taxa fixa" v={`− ${brl(r.fixa)}`} />
              <Linha t="Frete" v={`− ${brl(freteN)}`} />
              <Linha t="Imposto" v={`− ${brl(r.imp)}`} />
            </div>
            <div className="receipt-tick" />
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-widest text-goldlight">Lucro real</span>
              <span className={`text-2xl font-semibold ${temPreco && r.lucro < 0 ? "text-red-300" : "text-goldlight"}`}>
                {brl(temPreco ? r.lucro : 0)}
              </span>
            </div>
            <p className="text-xs text-paper/50">
              Margem {pct(temPreco ? r.margem : 0)} · Retorno sobre o custo {pct(temPreco ? r.roi : 0)}
            </p>

            <div className="border-t border-paper/15 pt-4">
              <label className="text-xs uppercase tracking-widest text-paper/60" htmlFor="mg">Margem que você quer (%)</label>
              <div className="mt-2 flex items-center gap-3">
                <input id="mg" className="w-24 rounded-lg border border-paper/20 bg-transparent px-3 py-2 text-paper outline-none focus:border-goldlight" inputMode="decimal" value={margemDesejada} onChange={(e) => setMargemDesejada(e.target.value)} />
                <span>
                  Preço mínimo: <b className="text-goldlight">{minimo != null && custoN > 0 ? brl(minimo) : custoN > 0 ? "impossível com essas taxas" : "informe o custo"}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {temPreco && (
        <section className="border-t border-line bg-white/40">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <h2 className="font-display text-2xl font-semibold mb-1">O mesmo produto nos 3 canais</h2>
            <p className="text-ink/60 mb-6 text-sm">Pelo mesmo preço de {brl(precoN)}, com as taxas de referência de cada canal.</p>
            <div className="grid gap-4 md:grid-cols-3">
              {CANAIS.map((c) => {
                const x = resultado(c, precoN);
                return (
                  <div key={c.id} className={`rounded-2xl border bg-white p-5 ${c.id === canalId ? "border-ink" : "border-line"}`}>
                    <p className="font-display text-lg font-medium">{c.nome}</p>
                    <p className="mt-3 font-mono text-xs text-ink/50">Taxas do canal</p>
                    <p className="font-mono text-sm">{brl(x.total)}</p>
                    <p className="mt-3 font-mono text-xs text-ink/50">Lucro</p>
                    <p className={`font-mono text-2xl font-semibold ${x.lucro < 0 ? "text-red-700" : ""}`}>{brl(x.lucro)}</p>
                    <p className="font-mono text-xs text-clay">Margem {pct(x.margem)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-line bg-inkdeep text-paper">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold mb-3">Calculou um produto. Agora imagine o catálogo inteiro.</h2>
          <p className="mx-auto mb-8 max-w-xl text-paper/70">
            Com a assinatura você conecta suas lojas, acompanha pedidos e margem real de cada venda e automatiza promoções.
          </p>
          <Link href="/planos" className="inline-block rounded-full bg-gold px-8 py-4 font-medium text-inkdeep hover:bg-goldlight transition-colors">
            Ver planos e assinar
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-ink/50">
        © {new Date().getFullYear()} Diego Rezende Digital · Assessoria Marketplace. Valores de referência, sujeitos a mudança pelos marketplaces.
      </footer>
    </main>
  );
}

function Linha({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-paper/60">{t}</span>
      <span>{v}</span>
    </div>
  );
}
