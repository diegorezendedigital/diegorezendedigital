"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, ContaML, Listing, Marketplace, Product, brl, campo, mensagemErro, num, pct } from "@/lib/types";
import { analisarAnuncio } from "@/lib/anuncio";

type Resultado = {
  listing_id: string;
  external_id: string;
  title: string;
  status: "aplicado" | "sugerido" | "sem_mudanca" | "ignorado" | "erro";
  old_price: number;
  new_price?: number;
  motivo?: string;
};

type Filtro = "todos" | "sem_produto" | "auto" | "margem_baixa";

const ROTULO: Record<Resultado["status"], string> = {
  aplicado: "Preço alterado",
  sugerido: "Sugerido",
  sem_mudanca: "Sem mudança",
  ignorado: "Ignorado",
  erro: "Erro",
};

export default function AnunciosPage() {
  const [anuncios, setAnuncios] = useState<Listing[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [mps, setMps] = useState<Marketplace[]>([]);
  const [contas, setContas] = useState<ContaML[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  const carregar = useCallback(async () => {
    const [l, p, c, m] = await Promise.all([
      supabase.from("listings").select("*").order("title"),
      supabase.from("products").select("*").order("name"),
      supabase.from("companies").select("*").order("created_at"),
      supabase.from("marketplaces").select("*"),
    ]);
    if (l.error) setErro(l.error.message);
    setAnuncios((l.data ?? []) as Listing[]);
    setProdutos((p.data ?? []) as Product[]);
    setEmpresas((c.data ?? []) as Company[]);
    setMps((m.data ?? []) as Marketplace[]);
    try {
      setContas((await apiFetch<{ accounts: ContaML[] }>("/api/ml/accounts")).accounts);
    } catch {
      /* sem contas conectadas ou ainda sem a atualização do banco: a tela continua funcionando */
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const prodPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const empPorId = useMemo(() => new Map(empresas.map((c) => [c.id, c])), [empresas]);
  const empresaPadrao = empresas.find((c) => c.is_default) ?? null;

  const taxaPadrao = (l: Listing) => {
    const mp = mps.find((m) => m.id === l.marketplace_id);
    return { pct: mp ? Number(mp.commission_percent) + Number(mp.extra_percent) : 12, fixo: mp ? Number(mp.fixed_fee) : 6 };
  };

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return anuncios
      .map((l) => {
        const prod = l.product_id ? prodPorId.get(l.product_id) : undefined;
        const emp = (l.company_id && empPorId.get(l.company_id)) || empresaPadrao;
        return { l, prod, emp, a: analisarAnuncio(l, prod, emp, taxaPadrao(l)) };
      })
      .filter(({ l, a }) => {
        if (q && !l.title.toLowerCase().includes(q) && !l.external_id.toLowerCase().includes(q)) return false;
        if (filtro === "sem_produto") return !l.product_id;
        if (filtro === "auto") return l.auto_price;
        if (filtro === "margem_baixa") return !!a && a.margem < Number(l.target_margin);
        return true;
      });
  }, [anuncios, prodPorId, empPorId, empresaPadrao, busca, filtro, mps]);

  /* ---------- Importação do Mercado Livre ---------- */
  // TEMPORÁRIO: descobre quais consultas do Mercado Livre trazem comissão e frete de anúncios sem vendas.
  async function testarFrete() {
    setErro("");
    setAviso("Testando consultas ao Mercado Livre…");
    try {
      const r = await apiFetch("/api/ml/diag-frete", { method: "POST", body: JSON.stringify({}) });
      setAviso("Teste feito. Os resultados foram registrados; avise o Claude.");
      console.log(r);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function vincularPorSku() {
    setErro("");
    setAviso("");
    setTrabalhando(true);
    try {
      const r = await apiFetch<{ analisados: number; jaLigados: number; vinculados: number; semSku: number; semProduto: number; duplicados: number; parcial: boolean; semAcesso: number; skusSemProduto: string[] }>("/api/ml/vincular-sku", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setAviso(
        `${r.vinculados} anúncios ligados ao produto de mesmo SKU. ${r.jaLigados} já estavam ligados` +
          (r.semProduto > 0 ? `, ${r.semProduto} têm SKU sem produto igual no armazém (ex.: ${r.skusSemProduto.slice(0, 5).join(", ")})` : "") +
          (r.semSku > 0 ? `, ${r.semSku} estão sem SKU no Mercado Livre` : "") +
          (r.duplicados > 0 ? `, ${r.duplicados} com SKU repetido em mais de um produto (não ligados)` : "") +
          (r.semAcesso > 0 ? `, ${r.semAcesso} de uma conta sem acesso (reconecte em Integrações)` : "") +
          "." +
          (r.parcial ? " A rodada foi parcial; clique de novo para continuar." : "")
      );
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setTrabalhando(false);
    }
  }

  async function puxarFrete() {
    setErro("");
    setAviso("");
    setTrabalhando(true);
    try {
      const r = await apiFetch<{ atualizados: number; semDados: number; gratisParaComprador: number; total: number }>("/api/ml/frete", {
        method: "POST",
        body: JSON.stringify({ forcar: true }),
      });
      setAviso(
        `Frete atualizado em ${r.atualizados} de ${r.total} anúncios (${r.gratisParaComprador} sem frete grátis, em que o comprador paga). ` +
          (r.semDados > 0 ? `${r.semDados} ainda sem vendas para calcular: sincronize os pedidos em Pedidos ou Integrações e tente de novo.` : "")
      );
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setTrabalhando(false);
    }
  }

  async function importar() {
    setErro("");
    setAviso("");
    if (contas.length === 0) {
      setErro("Conecte uma conta do Mercado Livre em Integrações primeiro.");
      return;
    }
    setImportando(true);
    let criados = 0;
    let atualizados = 0;
    try {
      for (const conta of contas) {
        let offset = 0;
        for (;;) {
          const r = await apiFetch<{ created: number; updated: number; total: number; next_offset: number; has_more: boolean }>("/api/ml/listings", {
            method: "POST",
            body: JSON.stringify({ offset, ml_user_id: conta.ml_user_id }),
          });
          criados += r.created;
          atualizados += r.updated;
          offset = r.next_offset;
          setProgresso(`${conta.nickname ?? conta.ml_user_id}: ${Math.min(offset, r.total)} de ${r.total} anúncios…`);
          if (!r.has_more) break;
        }
      }
      setAviso(`${criados} anúncios novos e ${atualizados} atualizados. Anúncios com SKU igual ao de um produto do armazém já vieram ligados a ele.`);
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setImportando(false);
      setProgresso("");
    }
  }

  /* ---------- Edição ---------- */
  async function salvar(l: Listing, alteracao: Partial<Listing>) {
    setErro("");
    const { error } = await supabase.from("listings").update(alteracao).eq("id", l.id);
    if (error) {
      setErro(error.message);
      return;
    }
    setAnuncios((lista) => lista.map((x) => (x.id === l.id ? { ...x, ...alteracao } : x)));
  }

  const numeroOuNulo = (v: string): number | null => (v.trim() === "" ? null : num(v));

  /* ---------- Preço automático ---------- */
  async function calcular(ids: string[], aplicar: boolean) {
    setErro("");
    setAviso("");
    setTrabalhando(true);
    setResultados([]);
    try {
      const todos: Resultado[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const r = await apiFetch<{ results: Resultado[] }>("/api/ml/reprice", {
          method: "POST",
          body: JSON.stringify({ listing_ids: ids.slice(i, i + 10), apply: aplicar }),
        });
        todos.push(...r.results);
      }
      setResultados(todos);
      if (aplicar) await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setTrabalhando(false);
    }
  }

  function aplicarUm(l: Listing) {
    if (!confirm(`Alterar o preço de "${l.title}" no Mercado Livre para atingir a margem de ${campo(Number(l.target_margin))}%?`)) return;
    calcular([l.id], true);
  }

  function rodarAutomaticos() {
    const ids = anuncios.filter((l) => l.auto_price).map((l) => l.id);
    if (ids.length === 0) {
      setErro("Nenhum anúncio com preço automático ligado.");
      return;
    }
    if (!confirm(`Reajustar agora o preço de ${ids.length} anúncio(s) no Mercado Livre?`)) return;
    calcular(ids, true);
  }

  const totalAuto = anuncios.filter((l) => l.auto_price).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Anúncios Marketplace</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Ligue cada anúncio a um produto do armazém e a um CNPJ. Com o preço automático ligado, o sistema ajusta o preço todos os dias para manter a margem que você definiu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {progresso && <span className="font-mono text-xs text-slate-500">{progresso}</span>}
          <button className="btn-ghost" onClick={vincularPorSku} disabled={trabalhando || importando} title="Liga cada anúncio sem produto ao produto do armazém que tem exatamente o mesmo SKU">
            Vincular por SKU
          </button>
          <button className="btn-ghost" onClick={testarFrete} disabled={trabalhando || importando}>
            Teste: frete e taxa
          </button>
          <button className="btn-ghost" onClick={puxarFrete} disabled={trabalhando || importando}>
            Puxar frete do Mercado Livre
          </button>
          <button className="btn-ghost" onClick={rodarAutomaticos} disabled={trabalhando || importando}>
            Rodar preço automático ({totalAuto})
          </button>
          <button className="btn" onClick={importar} disabled={importando}>
            {importando ? "Importando…" : "Importar do Mercado Livre"}
          </button>
        </div>
      </div>

      {empresas.length === 0 && (
        <p className="rounded-md border border-gold/40 bg-goldlight/20 p-3 text-sm text-slate-800">
          Nenhum CNPJ cadastrado: o lucro está sendo calculado sem impostos. Cadastre em Configurações.
        </p>
      )}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}

      {resultados.length > 0 && (
        <div className="card space-y-2 p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">Resultado</h2>
            <button className="text-xs text-slate-500 hover:text-slate-900" onClick={() => setResultados([])}>Fechar</button>
          </div>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-auto">
            {resultados.map((r) => (
              <li key={r.listing_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span
                  className={`badge ${
                    r.status === "aplicado" ? "bg-emerald-100 text-emerald-800" : r.status === "erro" ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {ROTULO[r.status]}
                </span>
                <span className="max-w-[360px] truncate" title={r.title}>{r.title}</span>
                {r.new_price != null && r.new_price !== r.old_price && (
                  <span className="font-mono text-xs">{brl(r.old_price)} → {brl(r.new_price)}</span>
                )}
                {r.motivo && <span className="text-xs text-slate-500">{r.motivo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-64" placeholder="Buscar por título ou código MLB" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="input w-52" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="todos">Todos os anúncios</option>
            <option value="sem_produto">Sem produto ligado</option>
            <option value="auto">Com preço automático</option>
            <option value="margem_baixa">Abaixo da margem desejada</option>
          </select>
        </div>
        <span className="font-mono text-xs text-slate-500">{linhas.length} de {anuncios.length} anúncios</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Anúncio</th>
              <th className="th">Produto do armazém</th>
              <th className="th">CNPJ</th>
              <th className="th">Un.</th>
              <th className="th">Preço</th>
              <th className="th">Custo</th>
              <th className="th">Taxa</th>
              <th className="th">Frete</th>
              <th className="th">Imposto</th>
              <th className="th">Lucro</th>
              <th className="th">Margem</th>
              <th className="th">Meta %</th>
              <th className="th">Mín.</th>
              <th className="th">Máx.</th>
              <th className="th">Sugerido</th>
              <th className="th">Auto</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={17}>
                  {anuncios.length === 0
                    ? "Nenhum anúncio ainda. Conecte o Mercado Livre e clique em “Importar do Mercado Livre”."
                    : "Nenhum anúncio neste filtro."}
                </td>
              </tr>
            )}
            {linhas.map(({ l, a }) => (
              <tr key={l.id} className="align-middle">
                <td className="td max-w-[280px]">
                  <div className="flex items-center gap-2">
                    {l.thumbnail && (
                      <img src={l.thumbnail.replace("http://", "https://")} alt="" className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate" title={l.title}>
                        {l.permalink ? (
                          <a href={l.permalink} target="_blank" rel="noreferrer" className="hover:underline">{l.title}</a>
                        ) : (
                          l.title
                        )}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {l.external_id}
                        {l.sku ? ` · SKU ${l.sku}` : ""}
                        {l.ml_user_id && contas.length > 1 ? ` · ${contas.find((c) => c.ml_user_id === l.ml_user_id)?.nickname ?? l.ml_user_id}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="td">
                  <select
                    className={`input w-52 py-1 ${l.product_id ? "" : "border-gold"}`}
                    value={l.product_id ?? ""}
                    onChange={(e) => salvar(l, { product_id: e.target.value || null })}
                  >
                    <option value="">Escolher produto…</option>
                    {produtos.map((p) => (
                      <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <select className="input w-36 py-1" value={l.company_id ?? ""} onChange={(e) => salvar(l, { company_id: e.target.value || null })}>
                    <option value="">{empresaPadrao ? `Padrão (${empresaPadrao.name})` : "Sem CNPJ"}</option>
                    {empresas.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <input
                    key={`u${l.id}${l.units}`}
                    className="input w-14 py-1"
                    inputMode="numeric"
                    defaultValue={String(l.units)}
                    title="Unidades do armazém em cada venda (kits)"
                    onBlur={(e) => {
                      const v = Math.max(1, Math.round(num(e.target.value)) || 1);
                      if (v !== Number(l.units)) salvar(l, { units: v });
                    }}
                  />
                </td>
                <td className="td font-medium">{brl(l.price)}</td>
                <td className="td text-slate-700">{a ? brl(a.custo) : "—"}</td>
                <td
                  className="td text-slate-700"
                  title={a ? `${pct(a.taxaPct)} do preço + ${brl(a.taxaFixo)} fixo${a.taxaDoML ? " (taxa do Mercado Livre)" : " (taxa padrão: ainda não puxada do Mercado Livre)"}` : ""}
                >
                  {a ? brl(a.taxa) : "—"}
                  {a && <div className={`font-mono text-[10px] ${a.taxaDoML ? "text-emerald-700" : "text-amber-700"}`}>{pct(a.taxaPct)} + {brl(a.taxaFixo)}{a.taxaDoML ? "" : " · padrão"}</div>}
                </td>
                <td className="td">
                  <input
                    key={`f${l.id}${l.shipping_cost}`}
                    className="input w-20 py-1"
                    inputMode="decimal"
                    defaultValue={campo(Number(l.shipping_cost))}
                    title={l.shipping_source === "ml" ? "Frete puxado do Mercado Livre (média do frete real das últimas vendas)" : "Frete médio que você paga por venda"}
                    onBlur={(e) => {
                      const v = num(e.target.value);
                      if (v !== Number(l.shipping_cost)) salvar(l, { shipping_cost: v, shipping_source: "manual" });
                    }}
                  />
                  {l.shipping_source === "ml" && <div className="mt-0.5 font-mono text-[10px] text-emerald-700">ML</div>}
                </td>
                <td className="td text-slate-700">{a ? brl(a.imposto) : "—"}</td>
                <td className={`td font-medium ${a && a.lucro < 0 ? "text-red-700" : "text-emerald-800"}`}>{a ? brl(a.lucro) : "—"}</td>
                <td className={`td ${a && a.margem < Number(l.target_margin) ? "text-red-700" : ""}`}>{a ? pct(a.margem) : "—"}</td>
                <td className="td">
                  <input
                    key={`m${l.id}${l.target_margin}`}
                    className="input w-16 py-1"
                    inputMode="decimal"
                    defaultValue={campo(Number(l.target_margin))}
                    onBlur={(e) => {
                      const v = num(e.target.value);
                      if (v !== Number(l.target_margin)) salvar(l, { target_margin: v });
                    }}
                  />
                </td>
                <td className="td">
                  <input
                    key={`n${l.id}${l.min_price}`}
                    className="input w-20 py-1"
                    inputMode="decimal"
                    defaultValue={l.min_price != null ? campo(Number(l.min_price)) : ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const v = numeroOuNulo(e.target.value);
                      if (v !== (l.min_price == null ? null : Number(l.min_price))) salvar(l, { min_price: v });
                    }}
                  />
                </td>
                <td className="td">
                  <input
                    key={`x${l.id}${l.max_price}`}
                    className="input w-20 py-1"
                    inputMode="decimal"
                    defaultValue={l.max_price != null ? campo(Number(l.max_price)) : ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const v = numeroOuNulo(e.target.value);
                      if (v !== (l.max_price == null ? null : Number(l.max_price))) salvar(l, { max_price: v });
                    }}
                  />
                </td>
                <td className="td">
                  {a ? (
                    a.sugerido != null ? (
                      <span className={Math.abs(a.sugerido - Number(l.price)) < 0.01 ? "text-slate-500" : "font-medium"}>{brl(a.sugerido)}</span>
                    ) : (
                      <span className="text-xs text-red-700" title="A margem desejada é impossível com as taxas e impostos atuais">impossível</span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className="td">
                  <input
                    type="checkbox"
                    checked={l.auto_price}
                    disabled={!l.product_id}
                    title={l.product_id ? "Reajustar o preço automaticamente todo dia" : "Ligue um produto do armazém primeiro"}
                    onChange={(e) => salvar(l, { auto_price: e.target.checked })}
                  />
                </td>
                <td className="td">
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={trabalhando || !l.product_id} onClick={() => aplicarUm(l)}>
                    Aplicar no ML
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="max-w-3xl list-disc space-y-1 pl-5 text-xs text-slate-500">
        <li>Margem = lucro líquido (depois de custo, taxa do marketplace, frete e impostos do CNPJ) dividido pelo preço de venda.</li>
        <li>“Sugerido” é uma estimativa. Ao aplicar, o sistema consulta a taxa real do Mercado Livre para o novo preço e respeita Mín., Máx. e uma variação de no máximo 20% por rodada.</li>
        <li>Para alterar preços, a aplicação no DevCenter precisa ter permissão de leitura e escrita em “Publicação e sincronização”.</li>
      </ul>
    </div>
  );
}
