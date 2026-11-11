"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { sincronizarVendas } from "@/lib/sincronizar";
import { Sale, brl, mensagemErro, pct } from "@/lib/types";

type Linha = {
  id: string;
  data: string;
  pedido: string;
  pack: string;
  produto: string;
  sku: string;
  uf: string;
  conta: string;
  preco: number;
  comissao: number;
  frete: number;
  freteComprador: number;
  impostos: number;
  custo: number;
  sobra: number;
  margem: number; // sobre o preço de venda
  manual: boolean;
  roi: number | null; // sobre o custo (investimento)
};

type Chave = "preco" | "comissao" | "frete" | "freteComprador" | "impostos" | "custo" | "sobra";
const soma = (l: Linha[], k: Chave) => l.reduce((a, x) => a + x[k], 0);

// Datas no horário de Brasília
const hojeBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
};
const primeiroDoMes = () => `${hojeBR().slice(0, 8)}01`;

export default function PedidosPage() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState("");
  const [de, setDe] = useState(hojeBR());
  const [ate, setAte] = useState(hojeBR());
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  // Pesquisa em todas as datas: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim().replace(/[,()%*]/g, " ").trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);
  const [reprocessando, setReprocessando] = useState(false);
  const [reprocessandoCustos, setReprocessandoCustos] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [aviso, setAviso] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [custoManual, setCustoManual] = useState("");
  const [senha, setSenha] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function reprocessar() {
    setErro("");
    setAviso("");
    setReprocessando(true);
    try {
      const dias = Math.min(90, Math.max(1, Math.ceil((Date.now() - new Date(`${de}T00:00:00-03:00`).getTime()) / 86400000) + 1));
      const r = await sincronizarVendas(dias, setProgresso);
      if (r.contas === 0) setErro("Nenhuma conta do Mercado Livre conectada. Conecte em Integrações.");
      else setAviso(`Pedidos reprocessados: ${r.vendas} vendas novas ou completadas. O custo de vendas que já tinham custo não foi alterado.`);
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setReprocessando(false);
      setProgresso("");
    }
  }

  async function reprocessarCustos() {
    setErro("");
    setAviso("");
    setReprocessandoCustos(true);
    try {
      const r = await apiFetch<{ analisadas: number; reprocessadas: number; mantidas: number; manuais: number; semCusto: number; parcial: boolean }>("/api/vendas/reprocessar-custos", {
        method: "POST",
        body: JSON.stringify({ de, ate }),
      });
      setAviso(
        `Custos reprocessados no período: ${r.reprocessadas} de ${r.analisadas} vendas atualizadas com o custo da data da venda. ` +
          `${r.mantidas} já estavam corretas ou não têm custo cadastrado na data, ${r.manuais} com custo manual (não mudam)` +
          (r.semCusto > 0 ? `, ${r.semCusto} continuam sem custo (sem produto ligado ou sem custo cadastrado).` : ".") +
          (r.parcial ? " A rodada foi parcial; clique de novo para continuar." : "")
      );
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setReprocessandoCustos(false);
    }
  }

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
      const inicio = new Date(`${de}T00:00:00-03:00`).toISOString();
      const fim = new Date(`${ate}T23:59:59.999-03:00`).toISOString();
      if (!buscaAtiva && inicio > fim) {
        setErro("A data inicial é depois da final.");
        setLinhas([]);
        return;
      }
      // O banco devolve no máximo 1000 linhas por consulta: busca em blocos.
      const vendas: Sale[] = [];
      for (let de0 = 0; de0 < 20000; de0 += 1000) {
        let consulta = supabase.from("sales").select("*");
        consulta = buscaAtiva
          ? consulta.or(`order_number.ilike.%${buscaAtiva}%,pack_id.ilike.%${buscaAtiva}%,title.ilike.%${buscaAtiva}%,sku.ilike.%${buscaAtiva}%,external_id.ilike.%${buscaAtiva}%,buyer_state.ilike.${buscaAtiva}`)
          : consulta.gte("sold_at", inicio).lte("sold_at", fim);
        const r = await consulta.order("sold_at", { ascending: false }).range(de0, de0 + 999);
        if (r.error) throw new Error(r.error.message);
        vendas.push(...((r.data ?? []) as Sale[]));
        if ((r.data ?? []).length < 1000) break;
      }
      const [a, pr, c] = await Promise.all([
        supabase.from("listings").select("id, title"),
        supabase.from("products").select("id, sku"),
        supabase.from("ml_connections").select("ml_user_id, nickname"),
      ]);
      const titulos = new Map<string, string>((a.data ?? []).map((x: { id: string; title: string }) => [x.id, x.title]));
      const skus = new Map<string, string>((pr.data ?? []).map((x: { id: string; sku: string }) => [x.id, x.sku]));
      const contas = new Map<string, string>((c.data ?? []).map((x: { ml_user_id: string; nickname: string | null }) => [x.ml_user_id, x.nickname ?? x.ml_user_id]));
      setLinhas(
        vendas.map((s) => {
          const preco = Number(s.sale_price) || 0;
          const custo = Number(s.cost_price) || 0;
          const sobra = Number(s.profit) || 0;
          return {
            id: s.id,
            data: s.sold_at,
            pack: s.pack_id || "",
            pedido: s.order_number || (s.external_id ?? "").split(":")[0] || "—",
            produto: s.title || (s.listing_id && titulos.get(s.listing_id)) || "—",
            sku: s.sku || (s.product_id && skus.get(s.product_id)) || "",
            uf: s.buyer_state || "—",
            conta: (s.ml_user_id && contas.get(s.ml_user_id)) || "",
            preco,
            comissao: Number(s.fees_total) || 0,
            frete: Number(s.shipping_cost) || 0,
            freteComprador: Number(s.buyer_shipping) || 0,
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
  }, [de, ate, buscaAtiva]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) => !q || l.pedido.toLowerCase().includes(q) || l.pack.includes(q) || l.produto.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.uf.toLowerCase() === q);
  }, [linhas, busca]);

  // Um pedido com vários produtos vira uma linha só (valores somados, produtos listados dentro dela).
  const grupos = useMemo(() => {
    const mapa = new Map<string, Linha[]>();
    visiveis.forEach((l) => mapa.set(l.pack || l.pedido, [...(mapa.get(l.pack || l.pedido) ?? []), l]));
    return Array.from(mapa.values()).map((itens) => {
      const p = itens[0];
      const preco = soma(itens, "preco");
      const custo = soma(itens, "custo");
      const sobra = soma(itens, "sobra");
      return {
        ...p,
        pedido: p.pack || p.pedido,
        pedidosML: Array.from(new Set(itens.map((i) => i.pedido))),
        itens,
        preco,
        custo,
        sobra,
        comissao: soma(itens, "comissao"),
        frete: soma(itens, "frete"),
        freteComprador: soma(itens, "freteComprador"),
        impostos: soma(itens, "impostos"),
        manual: itens.some((i) => i.manual),
        margem: preco > 0 ? (sobra / preco) * 100 : 0,
        roi: custo > 0 ? (sobra / custo) * 100 : null,
        pendente: itens.find((i) => !(i.custo > 0)),
      };
    });
  }, [visiveis]);

  const totalPreco = soma(visiveis, "preco");
  const totalCusto = soma(visiveis, "custo");
  const totalSobra = soma(visiveis, "sobra");
  const totalTaxa = soma(visiveis, "comissao");
  const totalFrete = soma(visiveis, "frete");
  const totalFreteComprador = soma(visiveis, "freteComprador");
  const totalImpostos = soma(visiveis, "impostos");
  const semCusto = visiveis.filter((l) => l.custo === 0).length;
  const cor = (v: number) => (v < 0 ? "text-red-700" : "text-emerald-700");
  const margemTotal = totalPreco > 0 ? (totalSobra / totalPreco) * 100 : null;
  const roiTotal = totalCusto > 0 ? (totalSobra / totalCusto) * 100 : null;

  const atalho = (a: string, b: string) => {
    setDe(a);
    setAte(b);
  };
  const hoje = hojeBR();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="mt-1 text-sm text-slate-600">
            Por padrão, só os pedidos de hoje. Escolha as datas para ver vendas antigas. As vendas chegam pela sincronização em{" "}
            <Link href="/dashboard/integracoes" className="underline">Integrações</Link>.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={reprocessarCustos} disabled={reprocessando || reprocessandoCustos} title="Recalcula o custo das vendas do período com o custo cadastrado na data de cada venda">
              {reprocessandoCustos ? "Reprocessando custos…" : "Reprocessar custos"}
            </button>
            <button className="btn" onClick={reprocessar} disabled={reprocessando || reprocessandoCustos}>
              {reprocessando ? "Reprocessando…" : "Reprocessar pedidos"}
            </button>
          </div>
          {progresso && <span className="font-mono text-[11px] text-slate-500">{progresso}</span>}
        </div>
      </div>

      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}

      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="label">De</label>
          <input type="date" className="input" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <label className="label">Até</label>
          <input type="date" className="input" value={ate} min={de} max={hoje} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["Hoje", hoje, hoje],
            ["Ontem", somarDias(hoje, -1), somarDias(hoje, -1)],
            ["7 dias", somarDias(hoje, -6), hoje],
            ["30 dias", somarDias(hoje, -29), hoje],
            ["Este mês", primeiroDoMes(), hoje],
          ].map(([nome, a, b]) => (
            <button key={nome} className={`rounded-md border px-3 py-2 text-sm ${de === a && ate === b ? "border-brand bg-brand-light text-brand" : "border-slate-200 text-slate-700 hover:bg-slate-100"}`} onClick={() => atalho(a, b)}>
              {nome}
            </button>
          ))}
        </div>
        <div className="min-w-[240px] flex-1">
          <label className="label">Buscar (nº do pedido, produto, SKU ou UF)</label>
          <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: 2000012345, jaqueta, SP" />
          {busca.trim() && <div className="mt-1 text-[11px] text-slate-500">Pesquisando em todas as datas, ignorando o filtro de período.</div>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Resumo t="Pedidos" v={String(grupos.length)} />
          <Resumo t="Faturamento" v={brl(totalPreco)} />
          <Resumo t="Sobrou" v={brl(totalSobra)} cls={cor(totalSobra)} />
          <Resumo t="Taxa do marketplace" v={brl(totalTaxa)} sub={pDe(totalTaxa, totalPreco)} />
          <Resumo t="Frete pago por você" v={brl(totalFrete)} sub={pDe(totalFrete, totalPreco)} />
          <Resumo t="Frete pago pelo comprador" v={brl(totalFreteComprador)} sub={pDe(totalFreteComprador, totalPreco)} />
          <Resumo t="Impostos" v={brl(totalImpostos)} sub={pDe(totalImpostos, totalPreco)} />
          <Resumo t="Custo dos produtos" v={brl(totalCusto)} sub={pDe(totalCusto, totalPreco)} />
          <Resumo t="Margem / ROI" v={`${margemTotal != null ? pct(margemTotal) : "—"} / ${roiTotal != null ? pct(roiTotal) : "—"}`} />
        </div>
        <Pizza
          total={totalPreco}
          partes={[
            { nome: "Custo dos produtos", valor: totalCusto, cor: "#A3A399" },
            { nome: "Taxa do marketplace", valor: totalTaxa, cor: "#C99A2E" },
            { nome: "Frete pago por você", valor: totalFrete, cor: "#B65E3B" },
            { nome: "Impostos", valor: totalImpostos, cor: "#767669" },
            { nome: "Sobrou", valor: Math.max(0, totalSobra), cor: "#0F3D2E" },
          ]}
        />
      </div>

      {(
        <>
          {semCusto > 0 && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              {semCusto} {semCusto === 1 ? "venda está" : "vendas estão"} sem custo (anúncio sem produto do armazém ligado), então o lucro dela aparece maior que o real. Ligue o anúncio
              a um produto em Produtos &gt; Anúncios Marketplace e reprocesse os pedidos.
            </p>
          )}

          <div className="card overflow-x-auto p-0">
            {!linhas ? (
              <p className="p-5 text-sm text-slate-500">Carregando…</p>
            ) : visiveis.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">Nenhum pedido neste período. Escolha outras datas ou reprocesse os pedidos.</p>
            ) : (
              <table className="w-full min-w-[1400px] text-[15px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-4">Pedido</th>
                    <th className="px-4 py-4">Produto</th>
                    <th className="px-4 py-4">SKU</th>
                    <th className="px-4 py-4">UF</th>
                    <th className="px-4 py-4 text-right">Venda</th>
                    <th className="px-4 py-4 text-right" title="Venda – comissão – frete: o que o marketplace libera para você">Repasse</th>
                    <th className="px-4 py-4 text-right">Comissão</th>
                    <th className="px-4 py-4 text-right">Frete</th>
                    <th className="px-4 py-4 text-right" title="Informativo: não entra na conta do lucro">Frete comprador</th>
                    <th className="px-4 py-4 text-right">Impostos</th>
                    <th className="px-4 py-4 text-right">Custo</th>
                    <th className="px-4 py-4 text-right">Sobrou</th>
                    <th className="px-4 py-4 text-right">Margem contrib.</th>
                    <th className="px-5 py-4 text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((l) => (
                    <Fragment key={l.id}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className="px-5 py-5">
                          <div className="font-mono text-sm">{l.pedido}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {new Date(l.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {l.conta ? ` · ${l.conta}` : ""}
                          </div>
                          {l.pedidosML.length > 1 && <div className="mt-0.5 font-mono text-[10px] text-slate-400">pedidos {l.pedidosML.map((x) => x.slice(-6)).join(" · ")}</div>}
                        </td>
                        <td className="max-w-[340px] px-4 py-5 leading-snug">
                          {l.itens.map((i) => (
                            <div key={i.id} className={l.itens.length > 1 ? "mb-1.5 last:mb-0" : ""}>
                              {i.produto}
                              {l.itens.length > 1 && i.sku && <span className="ml-2 font-mono text-[11px] text-slate-500">{i.sku}</span>}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-5 font-mono text-xs">
                          {l.itens.length > 1 ? `${l.itens.length} itens` : l.sku || "—"}
                        </td>
                        <td className="px-4 py-5">{l.uf}</td>
                        {(() => {
                          const rep = l.preco - l.comissao - l.frete;
                          const f = (n: number) => pCel(n, l.preco);
                          return (
                            <>
                              <td className="px-4 py-5 text-right">
                                <Tip titulo="Venda" nota={l.itens.length > 1 ? "Soma do preço dos itens do pacote (preço unitário × quantidade). Não inclui o frete que o comprador pagou." : "Preço do produto × quantidade vendida. Não inclui o frete que o comprador pagou."}>
                                  {brl(l.preco)}
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right font-medium">
                                <Tip titulo="Repasse: o que o marketplace libera" linhas={[["Venda", brl(l.preco)], ["− Comissão", brl(l.comissao)], ["− Frete (por sua conta)", brl(l.frete)], ["= Repasse", brl(rep)]]} nota="Ainda não desconta imposto nem custo do produto. Confere com o “Total” do Detalhe do recebimento do Mercado Livre.">
                                  {brl(rep)}
                                  <Pc v={f(rep)} />
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right">
                                <Tip titulo="Comissão (tarifa de venda)" linhas={[["Cobrado pelo ML", brl(l.comissao)], ["% da venda", f(l.comissao) ?? "—"]]} nota="Tarifa de venda do Mercado Livre (percentual + valor fixo por unidade, quando houver).">
                                  {brl(l.comissao)}
                                  <Pc v={f(l.comissao)} />
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right">
                                <Tip titulo="Frete pago por você" linhas={[["Mercado Envios (sua conta)", brl(l.frete)], ["% da venda", f(l.frete) ?? "—"]]} nota="Em pacote com vários pedidos o frete é cobrado uma vez só.">
                                  {brl(l.frete)}
                                  <Pc v={f(l.frete)} />
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right text-slate-500">
                                <Tip titulo="Frete pago pelo comprador" nota="Só informativo: esse valor não entra na conta do lucro.">
                                  {brl(l.freteComprador)}
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right">
                                <Tip titulo="Impostos" linhas={[["Imposto calculado", brl(l.impostos)], ["% da venda", f(l.impostos) ?? "—"]]} nota="Calculado pelo regime do CNPJ ligado ao anúncio (Simples Nacional ou Lucro Real), configurado em Configurações.">
                                  {brl(l.impostos)}
                                  <Pc v={f(l.impostos)} />
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right">
                                {l.custo > 0 && (
                                  <Tip titulo="Custo do produto" linhas={[["Custo total da venda", brl(l.custo)], ["% da venda", f(l.custo) ?? "—"]]} nota={l.manual ? "Informado manualmente com a senha master." : "Custo cadastrado no Armazém na data da venda × unidades. Mudar o custo depois não altera esta venda."}>
                                    {brl(l.custo)}
                                    <Pc v={f(l.custo)} />
                                    {l.manual && <div className="text-[11px] text-slate-500">manual</div>}
                                  </Tip>
                                )}
                                {l.pendente && (
                                  <button className="block w-full text-right text-amber-700 underline" onClick={() => { const id = l.pendente!.id; setEditId(editId === id ? null : id); setCustoManual(""); setSenha(""); }}>
                                    {l.itens.length > 1 ? "item sem custo · informar" : "sem custo · informar"}
                                  </button>
                                )}
                              </td>
                              <td className={`px-4 py-5 text-right font-semibold ${cor(l.sobra)}`}>
                                <Tip titulo="Sobrou (lucro da venda)" linhas={[["Venda", brl(l.preco)], ["− Comissão", brl(l.comissao)], ["− Frete", brl(l.frete)], ["− Impostos", brl(l.impostos)], ["− Custo", brl(l.custo)], ["= Sobrou", brl(l.sobra)]]}>
                                  {brl(l.sobra)}
                                </Tip>
                              </td>
                              <td className={`px-4 py-5 text-right ${cor(l.margem)}`}>
                                <Tip titulo="Margem de contribuição" linhas={[["Sobrou", brl(l.sobra)], ["÷ Venda", brl(l.preco)], ["= Margem", pct(l.margem)]]} nota="Quanto de cada R$ 100 vendidos virou lucro.">
                                  {pct(l.margem)}
                                </Tip>
                              </td>
                              <td className={`px-5 py-5 text-right ${l.roi == null ? "" : cor(l.roi)}`}>
                                <Tip titulo="ROI: retorno sobre o investimento" linhas={[["Sobrou", brl(l.sobra)], ["÷ Custo do produto", brl(l.custo)], ["= ROI", l.roi == null ? "—" : pct(l.roi)]]} nota="Quanto você ganhou para cada R$ 100 investidos no produto. Sem custo cadastrado, não dá para calcular.">
                                  {l.roi == null ? "—" : pct(l.roi)}
                                </Tip>
                              </td>
                            </>
                          );
                        })()}
                      </tr>
                      {l.pendente && editId === l.pendente.id && (
                        <tr className="border-b border-slate-100 bg-amber-50">
                          <td className="px-5 py-4" colSpan={14}>
                            <div className="flex flex-wrap items-end gap-2">
                              <div>
                                <label className="label">Custo total desta venda (R$)</label>
                                <input className="input w-36 py-1" inputMode="decimal" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
                              </div>
                              <div>
                                <label className="label">Senha master</label>
                                <input type="password" className="input w-40 py-1" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
                              </div>
                              <button className="btn" onClick={() => salvarCusto(l.pendente!)} disabled={salvando}>{salvando ? "Salvando…" : "Salvar custo"}</button>
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
                    <td className="px-5 py-4" colSpan={4}>Total ({grupos.length})</td>
                    {(() => {
                      const repT = totalPreco - totalTaxa - totalFrete;
                      return (
                        <>
                          <td className="px-4 py-4 text-right">
                            <Tip titulo="Venda total" nota="Soma das vendas listadas.">{brl(totalPreco)}</Tip>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Tip titulo="Repasse total" linhas={[["Venda", brl(totalPreco)], ["− Comissão", brl(totalTaxa)], ["− Frete", brl(totalFrete)], ["= Repasse", brl(repT)]]}>
                              {brl(repT)}
                              <Pc v={pCel(repT, totalPreco)} />
                            </Tip>
                          </td>
                          <td className="px-4 py-4 text-right">{brl(totalTaxa)}<Pc v={pCel(totalTaxa, totalPreco)} /></td>
                          <td className="px-4 py-4 text-right">{brl(totalFrete)}<Pc v={pCel(totalFrete, totalPreco)} /></td>
                          <td className="px-4 py-4 text-right text-slate-500">{brl(totalFreteComprador)}</td>
                          <td className="px-4 py-4 text-right">{brl(totalImpostos)}<Pc v={pCel(totalImpostos, totalPreco)} /></td>
                          <td className="px-4 py-4 text-right">{brl(totalCusto)}<Pc v={pCel(totalCusto, totalPreco)} /></td>
                          <td className={`px-4 py-4 text-right ${cor(totalSobra)}`}>
                            <Tip titulo="Sobrou total" linhas={[["Venda", brl(totalPreco)], ["− Comissão", brl(totalTaxa)], ["− Frete", brl(totalFrete)], ["− Impostos", brl(totalImpostos)], ["− Custo", brl(totalCusto)], ["= Sobrou", brl(totalSobra)]]}>
                              {brl(totalSobra)}
                            </Tip>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Tip titulo="Margem de contribuição" linhas={[["Sobrou", brl(totalSobra)], ["÷ Venda", brl(totalPreco)]]}>{margemTotal != null ? pct(margemTotal) : "—"}</Tip>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Tip titulo="ROI" linhas={[["Sobrou", brl(totalSobra)], ["÷ Custo", brl(totalCusto)]]}>{roiTotal != null ? pct(roiTotal) : "—"}</Tip>
                          </td>
                        </>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Repasse = venda – comissão – frete (o que o marketplace libera). Sobrou = venda − comissão − frete − impostos − custo. Margem de contribuição = sobrou ÷ venda. Retorno sobre o investimento (ROI) = sobrou ÷ custo do produto.
          </p>
        </>
      )}
    </div>
  );
}

type TipLinha = [string, string];
// Balãozinho que explica de onde veio o número (aparece ao passar o mouse).
function Tip({ titulo, linhas, nota, children, className = "" }: { titulo: string; linhas?: TipLinha[]; nota?: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={`inline-block cursor-help ${className}`}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: Math.min(r.left + r.width / 2, window.innerWidth - 170), y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <div
          className="pointer-events-none fixed z-[100] w-80 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2.5 text-left text-xs font-normal normal-case leading-snug text-white shadow-xl"
          style={{ left: Math.max(170, pos.x), top: pos.y - 8 }}
        >
          <div className="mb-1 font-semibold">{titulo}</div>
          {linhas?.map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3 font-mono text-[11px]">
              <span className="text-slate-300">{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {nota && <div className="mt-1 text-slate-300">{nota}</div>}
        </div>
      )}
    </div>
  );
}

const pDe = (parte: number, base: number) => (base > 0 ? `${((parte / base) * 100).toFixed(1).replace(".", ",")}% do faturamento` : undefined);
const pCel = (parte: number, base: number) => (base > 0 && parte > 0 ? `${((parte / base) * 100).toFixed(1).replace(".", ",")}%` : null);
const Pc = ({ v }: { v: string | null }) => (v ? <div className="font-mono text-[11px] text-slate-500">{v}</div> : null);

function Resumo({ t, v, cls = "", sub }: { t: string; v: string; cls?: string; sub?: string }) {
  return (
    <div className="card">
      <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{t}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{v}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

type Parte = { nome: string; valor: number; cor: string };

// Para onde vai cada real do faturamento do período (pizza minimalista).
function Pizza({ total, partes }: { total: number; partes: Parte[] }) {
  const soma = partes.reduce((a, p) => a + p.valor, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <div className="card flex items-center gap-5">
      {soma > 0 ? (
        <svg viewBox="0 0 180 180" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label="Para onde vai o faturamento">
          {partes.map((p) => {
            const fatia = (p.valor / soma) * C;
            const el = <circle key={p.nome} cx="90" cy="90" r={R} fill="none" stroke={p.cor} strokeWidth="30" strokeDasharray={`${fatia} ${C - fatia}`} strokeDashoffset={-acumulado} />;
            acumulado += fatia;
            return el;
          })}
        </svg>
      ) : (
        <p className="w-40 shrink-0 text-center text-sm text-slate-500">Sem vendas neste período.</p>
      )}
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.nome} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.cor }} />
              <span className="truncate">{p.nome}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-slate-600">{total > 0 ? pct((p.valor / total) * 100) : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
