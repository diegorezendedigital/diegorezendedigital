"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Sale, brl, mensagemErro, pct } from "@/lib/types";

type Linha = {
  id: string;
  data: string;
  pedido: string;
  produto: string;
  sku: string;
  uf: string;
  conta: string;
  preco: number;
  comissao: number;
  frete: number;
  impostos: number;
  custo: number;
  sobra: number;
  margem: number; // sobre o preço de venda
  manual: boolean;
  roi: number | null; // sobre o custo (investimento)
};

const soma = (l: Linha[], k: "preco" | "comissao" | "frete" | "impostos" | "custo" | "sobra") => l.reduce((a, x) => a + x[k], 0);

export default function PedidosPage() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState("");
  const [dias, setDias] = useState("30");
  const [busca, setBusca] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [custoManual, setCustoManual] = useState("");
  const [senha, setSenha] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvarCusto(l: Linha) {
    setErro("");
    const v = Number(custoManual.replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) {
      setErro("Informe o custo total desta venda (maior que zero).");
      return;
    }
    setSalvando(true);
    try {
      await apiFetch("/api/vendas/custo", { method: "POST", body: JSON.stringify({ sale_id: l.id, custo: v, senha }) });
      setEditId(null);
      setCustoManual("");
      setSenha("");
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const desde = new Date(Date.now() - Number(dias) * 24 * 3600 * 1000).toISOString();
      const [v, a, pr, c] = await Promise.all([
        supabase.from("sales").select("*").gte("sold_at", desde).order("sold_at", { ascending: false }).limit(2000),
        supabase.from("listings").select("id, title"),
        supabase.from("products").select("id, sku"),
        supabase.from("ml_connections").select("ml_user_id, nickname"),
      ]);
      if (v.error) throw new Error(v.error.message);
      const titulos = new Map<string, string>((a.data ?? []).map((x: { id: string; title: string }) => [x.id, x.title]));
      const skus = new Map<string, string>((pr.data ?? []).map((x: { id: string; sku: string }) => [x.id, x.sku]));
      const contas = new Map<string, string>((c.data ?? []).map((x: { ml_user_id: string; nickname: string | null }) => [x.ml_user_id, x.nickname ?? x.ml_user_id]));
      setLinhas(
        ((v.data ?? []) as Sale[]).map((s) => {
          const preco = Number(s.sale_price) || 0;
          const custo = Number(s.cost_price) || 0;
          const sobra = Number(s.profit) || 0;
          return {
            id: s.id,
            data: s.sold_at,
            pedido: s.order_number || (s.external_id ?? "").split(":")[0] || "—",
            produto: s.title || (s.listing_id && titulos.get(s.listing_id)) || "—",
            sku: s.sku || (s.product_id && skus.get(s.product_id)) || "",
            uf: s.buyer_state || "—",
            conta: (s.ml_user_id && contas.get(s.ml_user_id)) || "",
            preco,
            comissao: Number(s.fees_total) || 0,
            frete: Number(s.shipping_cost) || 0,
            impostos: Number(s.tax_amount) || 0,
            custo,
            sobra,
            manual: !!s.cost_manual,
            margem: preco > 0 ? (sobra / preco) * 100 : 0,
            roi: custo > 0 ? (sobra / custo) * 100 : null,
          };
        })
      );
    } catch (e) {
      setErro(mensagemErro(e));
      setLinhas([]);
    }
  }, [dias]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) => !q || l.pedido.includes(q) || l.produto.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.uf.toLowerCase() === q);
  }, [linhas, busca]);

  const totalPreco = soma(visiveis, "preco");
  const totalCusto = soma(visiveis, "custo");
  const totalSobra = soma(visiveis, "sobra");
  const semCusto = visiveis.filter((l) => l.custo === 0).length;
  const cor = (v: number) => (v < 0 ? "text-red-700" : "text-emerald-700");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Pedidos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cada venda com taxa, frete, imposto e custo, e quanto sobrou. As vendas chegam pela sincronização em{" "}
          <Link href="/dashboard/integracoes" className="underline">Integrações</Link>.
        </p>
      </div>

      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Período</label>
          <select className="input" value={dias} onChange={(e) => setDias(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Últimos 12 meses</option>
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="label">Buscar (nº do pedido, produto, SKU ou UF)</label>
          <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: 2000012345, fone, SP" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Resumo t="Pedidos" v={String(visiveis.length)} />
        <Resumo t="Faturamento" v={brl(totalPreco)} />
        <Resumo t="Sobrou" v={brl(totalSobra)} cls={cor(totalSobra)} />
        <Resumo
          t="Margem / ROI"
          v={`${totalPreco > 0 ? pct((totalSobra / totalPreco) * 100) : "—"} / ${totalCusto > 0 ? pct((totalSobra / totalCusto) * 100) : "—"}`}
        />
      </div>

      {semCusto > 0 && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {semCusto} {semCusto === 1 ? "venda está" : "vendas estão"} sem custo (anúncio sem produto do armazém ligado), então o lucro dela aparece maior que o real. Ligue o
          anúncio a um produto em Produtos &gt; Anúncios Marketplace e sincronize de novo.
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        {!linhas ? (
          <p className="p-4 text-sm text-slate-500">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nenhum pedido no período. Sincronize as vendas em Integrações.</p>
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="p-3">Pedido</th>
                <th className="p-3">Produto</th>
                <th className="p-3">SKU</th>
                <th className="p-3">UF</th>
                <th className="p-3 text-right">Venda</th>
                <th className="p-3 text-right">Comissão</th>
                <th className="p-3 text-right">Frete</th>
                <th className="p-3 text-right">Impostos</th>
                <th className="p-3 text-right">Custo</th>
                <th className="p-3 text-right">Sobrou</th>
                <th className="p-3 text-right">Margem contrib.</th>
                <th className="p-3 text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <Fragment key={l.id}>
                <tr className="border-b border-slate-100 align-top">
                  <td className="p-3">
                    <div className="font-mono text-xs">{l.pedido}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(l.data).toLocaleDateString("pt-BR")}
                      {l.conta ? ` · ${l.conta}` : ""}
                    </div>
                  </td>
                  <td className="max-w-[260px] p-3">{l.produto}</td>
                  <td className="p-3 font-mono text-xs">{l.sku || "—"}</td>
                  <td className="p-3">{l.uf}</td>
                  <td className="p-3 text-right">{brl(l.preco)}</td>
                  <td className="p-3 text-right">{brl(l.comissao)}</td>
                  <td className="p-3 text-right">{brl(l.frete)}</td>
                  <td className="p-3 text-right">{brl(l.impostos)}</td>
                  <td className="p-3 text-right">
                    {l.custo > 0 ? (
                      <>
                        {brl(l.custo)}
                        {l.manual && <div className="text-[11px] text-slate-500">manual</div>}
                      </>
                    ) : (
                      <button className="text-amber-700 underline" onClick={() => { setEditId(editId === l.id ? null : l.id); setCustoManual(""); setSenha(""); }}>
                        sem custo · informar
                      </button>
                    )}
                  </td>
                  <td className={`p-3 text-right font-semibold ${cor(l.sobra)}`}>{brl(l.sobra)}</td>
                  <td className={`p-3 text-right ${cor(l.margem)}`}>{pct(l.margem)}</td>
                  <td className={`p-3 text-right ${l.roi == null ? "" : cor(l.roi)}`}>{l.roi == null ? "—" : pct(l.roi)}</td>
                </tr>
                {editId === l.id && (
                  <tr className="border-b border-slate-100 bg-amber-50">
                    <td className="p-3" colSpan={12}>
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <label className="label">Custo total desta venda (R$)</label>
                          <input className="input w-36 py-1" inputMode="decimal" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
                        </div>
                        <div>
                          <label className="label">Senha master</label>
                          <input type="password" className="input w-40 py-1" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
                        </div>
                        <button className="btn" onClick={() => salvarCusto(l)} disabled={salvando}>{salvando ? "Salvando…" : "Salvar custo"}</button>
                        <button className="btn-ghost" onClick={() => setEditId(null)}>Cancelar</button>
                        <span className="text-xs text-slate-600">Vale só para esta venda (custo × quantidade já somados). A senha é criada em Configurações.</span>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="p-3" colSpan={4}>Total ({visiveis.length})</td>
                <td className="p-3 text-right">{brl(totalPreco)}</td>
                <td className="p-3 text-right">{brl(soma(visiveis, "comissao"))}</td>
                <td className="p-3 text-right">{brl(soma(visiveis, "frete"))}</td>
                <td className="p-3 text-right">{brl(soma(visiveis, "impostos"))}</td>
                <td className="p-3 text-right">{brl(totalCusto)}</td>
                <td className={`p-3 text-right ${cor(totalSobra)}`}>{brl(totalSobra)}</td>
                <td className="p-3 text-right">{totalPreco > 0 ? pct((totalSobra / totalPreco) * 100) : "—"}</td>
                <td className="p-3 text-right">{totalCusto > 0 ? pct((totalSobra / totalCusto) * 100) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Sobrou = venda − comissão − frete − impostos − custo. Margem de contribuição = sobrou ÷ venda. Retorno sobre o investimento (ROI) = sobrou ÷ custo do produto.
      </p>
    </div>
  );
}

function Resumo({ t, v, cls = "" }: { t: string; v: string; cls?: string }) {
  return (
    <div className="card">
      <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{t}</div>
      <div className={`text-xl font-semibold ${cls}`}>{v}</div>
    </div>
  );
}
