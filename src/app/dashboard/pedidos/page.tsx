"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { sincronizarVendas } from "@/lib/sincronizar";
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
  const [aba, setAba] = useState<"lista" | "resumo">("lista");
  const [busca, setBusca] = useState("");
  const [reprocessando, setReprocessando] = useState(false);
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
      if (inicio > fim) {
        setErro("A data inicial é depois da final.");
        setLinhas([]);
        return;
      }
      // O banco devolve no máximo 1000 linhas por consulta: busca em blocos.
      const vendas: Sale[] = [];
      for (let de0 = 0; de0 < 20000; de0 += 1000) {
        const r = await supabase.from("sales").select("*").gte("sold_at", inicio).lte("sold_at", fim).order("sold_at", { ascending: false }).range(de0, de0 + 999);
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
  }, [de, ate]);

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
          <button className="btn" onClick={reprocessar} disabled={reprocessando}>
            {reprocessando ? "Reprocessando…" : "Reprocessar pedidos"}
          </button>
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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Resumo t="Pedidos" v={String(visiveis.length)} />
        <Resumo t="Faturamento" v={brl(totalPreco)} />
        <Resumo t="Sobrou" v={brl(totalSobra)} cls={cor(totalSobra)} />
        <Resumo t="Margem / ROI" v={`${margemTotal != null ? pct(margemTotal) : "—"} / ${roiTotal != null ? pct(roiTotal) : "—"}`} />
      </div>

      <div className="flex gap-6 border-b border-slate-200">
        {(["lista", "resumo"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setAba(x)}
            className={`-mb-px border-b-2 pb-2 text-sm ${aba === x ? "border-brand font-medium text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {x === "lista" ? "Pedidos" : "Resumo"}
          </button>
        ))}
      </div>

      {aba === "resumo" ? (
        <Painel
          total={totalPreco}
          partes={[
            { nome: "Custo dos produtos", valor: totalCusto, cor: "#A3A399" },
            { nome: "Taxa do marketplace", valor: totalTaxa, cor: "#C99A2E" },
            { nome: "Frete pago por você", valor: totalFrete, cor: "#B65E3B" },
            { nome: "Impostos", valor: totalImpostos, cor: "#767669" },
            { nome: "Sobrou", valor: Math.max(0, totalSobra), cor: "#0F3D2E" },
          ]}
          itens={[
            ["Faturamento", brl(totalPreco)],
            ["Quantidade de pedidos", String(visiveis.length)],
            ["Total de taxa", brl(totalTaxa)],
            ["Total de frete pago por você", brl(totalFrete)],
            ["Frete pago pelo comprador", brl(totalFreteComprador)],
            ["Total de impostos", brl(totalImpostos)],
            ["Custo dos produtos", brl(totalCusto)],
            ["Sobrou", brl(totalSobra)],
          ]}
        />
      ) : (
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
                    <th className="px-4 py-4 text-right">Comissão</th>
                    <th className="px-4 py-4 text-right">Frete</th>
                    <th className="px-4 py-4 text-right">Impostos</th>
                    <th className="px-4 py-4 text-right">Custo</th>
                    <th className="px-4 py-4 text-right">Sobrou</th>
                    <th className="px-4 py-4 text-right">Margem contrib.</th>
                    <th className="px-5 py-4 text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => (
                    <Fragment key={l.id}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className="px-5 py-5">
                          <div className="font-mono text-sm">{l.pedido}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {new Date(l.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {l.conta ? ` · ${l.conta}` : ""}
                          </div>
                        </td>
                        <td className="max-w-[340px] px-4 py-5 leading-snug">{l.produto}</td>
                        <td className="px-4 py-5 font-mono text-xs">{l.sku || "—"}</td>
                        <td className="px-4 py-5">{l.uf}</td>
                        <td className="px-4 py-5 text-right">{brl(l.preco)}</td>
                        <td className="px-4 py-5 text-right">{brl(l.comissao)}</td>
                        <td className="px-4 py-5 text-right">{brl(l.frete)}</td>
                        <td className="px-4 py-5 text-right">{brl(l.impostos)}</td>
                        <td className="px-4 py-5 text-right">
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
                        <td className={`px-4 py-5 text-right font-semibold ${cor(l.sobra)}`}>{brl(l.sobra)}</td>
                        <td className={`px-4 py-5 text-right ${cor(l.margem)}`}>{pct(l.margem)}</td>
                        <td className={`px-5 py-5 text-right ${l.roi == null ? "" : cor(l.roi)}`}>{l.roi == null ? "—" : pct(l.roi)}</td>
                      </tr>
                      {editId === l.id && (
                        <tr className="border-b border-slate-100 bg-amber-50">
                          <td className="px-5 py-4" colSpan={12}>
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
                    <td className="px-5 py-4" colSpan={4}>Total ({visiveis.length})</td>
                    <td className="px-4 py-4 text-right">{brl(totalPreco)}</td>
                    <td className="px-4 py-4 text-right">{brl(totalTaxa)}</td>
                    <td className="px-4 py-4 text-right">{brl(totalFrete)}</td>
                    <td className="px-4 py-4 text-right">{brl(totalImpostos)}</td>
                    <td className="px-4 py-4 text-right">{brl(totalCusto)}</td>
                    <td className={`px-4 py-4 text-right ${cor(totalSobra)}`}>{brl(totalSobra)}</td>
                    <td className="px-4 py-4 text-right">{margemTotal != null ? pct(margemTotal) : "—"}</td>
                    <td className="px-5 py-4 text-right">{roiTotal != null ? pct(roiTotal) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Sobrou = venda − comissão − frete − impostos − custo. Margem de contribuição = sobrou ÷ venda. Retorno sobre o investimento (ROI) = sobrou ÷ custo do produto.
          </p>
        </>
      )}
    </div>
  );
}

function Resumo({ t, v, cls = "" }: { t: string; v: string; cls?: string }) {
  return (
    <div className="card">
      <div className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{t}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{v}</div>
    </div>
  );
}

type Parte = { nome: string; valor: number; cor: string };

// Resumo do período: totais e um gráfico de pizza de para onde vai cada real do faturamento.
function Painel({ total, partes, itens }: { total: number; partes: Parte[]; itens: [string, string][] }) {
  const soma = partes.reduce((a, p) => a + p.valor, 0);
  const R = 90;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="card flex flex-col items-center gap-5">
        {soma > 0 ? (
          <svg viewBox="0 0 220 220" className="h-56 w-56 -rotate-90" role="img" aria-label="Para onde vai o faturamento">
            {partes.map((p) => {
              const fatia = (p.valor / soma) * C;
              const el = (
                <circle key={p.nome} cx="110" cy="110" r={R} fill="none" stroke={p.cor} strokeWidth="38" strokeDasharray={`${fatia} ${C - fatia}`} strokeDashoffset={-acumulado} />
              );
              acumulado += fatia;
              return el;
            })}
          </svg>
        ) : (
          <p className="py-16 text-sm text-slate-500">Sem vendas neste período.</p>
        )}
        <ul className="w-full space-y-1.5 text-sm">
          {partes.map((p) => (
            <li key={p.nome} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.cor }} />
                {p.nome}
              </span>
              <span className="font-mono text-xs text-slate-600">
                {brl(p.valor)} · {total > 0 ? pct((p.valor / total) * 100) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card h-fit">
        <dl className="divide-y divide-slate-100">
          {itens.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-3">
              <dt className="text-slate-600">{k}</dt>
              <dd className="text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
