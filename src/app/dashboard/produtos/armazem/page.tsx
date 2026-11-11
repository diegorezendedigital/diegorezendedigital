"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { Company, CustoProduto, Product, brl, campo, formatarCnpj, mensagemErro, num } from "@/lib/types";
import { LinhaProduto, baixarModelo, lerPlanilha } from "@/lib/planilha";

type Painel = null | "manual" | "excel";

const formVazio = { sku: "", nome: "", custo: "", ean: "", ncm: "", estoque: "", company: "" };

export default function ArmazemPage() {
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [anuncios, setAnuncios] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [histId, setHistId] = useState<string | null>(null);
  const [hist, setHist] = useState<CustoProduto[]>([]);
  const [histCusto, setHistCusto] = useState("");
  const [histData, setHistData] = useState("");
  const [painel, setPainel] = useState<Painel>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [form, setForm] = useState(formVazio);

  // Importação por planilha
  const [linhas, setLinhas] = useState<LinhaProduto[]>([]);
  const [errosPlanilha, setErrosPlanilha] = useState<string[]>([]);
  const [arquivo, setArquivo] = useState("");
  const [importando, setImportando] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    const [p, c, l] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase.from("companies").select("*").order("created_at"),
      supabase.from("listings").select("product_id"),
    ]);
    if (p.error) setErro(p.error.message);
    setProdutos((p.data ?? []) as Product[]);
    setEmpresas((c.data ?? []) as Company[]);
    const cont: Record<string, number> = {};
    (l.data ?? []).forEach((x: { product_id: string | null }) => {
      if (x.product_id) cont[x.product_id] = (cont[x.product_id] || 0) + 1;
    });
    setAnuncios(cont);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || (p.ean ?? "").includes(q));
  }, [produtos, busca]);

  const semDigitos = (s: string | null) => String(s ?? "").replace(/\D/g, "");

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const sku = form.sku.trim();
    if (produtos.some((p) => p.sku === sku)) {
      setErro(`Já existe um produto com o SKU ${sku}.`);
      return;
    }
    const { error } = await supabase.from("products").insert({
      store_id: uid,
      sku,
      name: form.nome.trim(),
      cost_price: num(form.custo),
      ean: form.ean.trim() || null,
      ncm: form.ncm.trim() || null,
      stock_qty: num(form.estoque),
      company_id: form.company || null,
      cost_updated_at: new Date().toISOString(),
    });
    if (error) {
      setErro(error.message);
      return;
    }
    setForm(formVazio);
    setAviso("Produto cadastrado.");
    carregar();
  }

  async function salvarCampo(p: Product, campoNome: "cost_price" | "stock_qty", valor: string) {
    const v = num(valor);
    if (v === Number(p[campoNome])) return;
    const alteracao: Record<string, number | string> = { [campoNome]: v };
    if (campoNome === "cost_price") alteracao.cost_updated_at = new Date().toISOString();
    const { error } = await supabase.from("products").update(alteracao).eq("id", p.id);
    if (error) {
      setErro(error.message);
      return;
    }
    // Só preenche vendas que ainda estão sem custo; as que já têm custo gravado não mudam.
    carregar();
  }

  async function abrirHistorico(p: Product) {
    if (histId === p.id) {
      setHistId(null);
      return;
    }
    setHistId(p.id);
    setHistCusto("");
    setHistData("");
    await carregarHistorico(p.id);
  }

  async function carregarHistorico(id: string) {
    const r = await supabase.from("product_costs").select("*").eq("product_id", id).order("valid_from", { ascending: false });
    if (r.error) setErro(r.error.message);
    setHist((r.data ?? []) as CustoProduto[]);
  }

  // Registra um custo que valeu a partir de uma data (ex.: o que você pagou há um ano). Não muda o custo atual do produto.
  async function adicionarCusto(p: Product) {
    setErro("");
    if (!histData || !(num(histCusto) > 0)) {
      setErro("Informe a data e o custo.");
      return;
    }
    const { error } = await supabase.from("product_costs").insert({
      store_id: p.store_id,
      product_id: p.id,
      cost_price: num(histCusto),
      valid_from: new Date(`${histData}T00:00:00-03:00`).toISOString(),
    });
    if (error) {
      setErro(error.message);
      return;
    }
    setHistCusto("");
    setHistData("");
    await carregarHistorico(p.id);
  }

  async function removerCusto(c: CustoProduto) {
    if (!confirm("Remover esta linha do histórico de custo?")) return;
    const { error } = await supabase.from("product_costs").delete().eq("id", c.id);
    if (error) setErro(error.message);
    else await carregarHistorico(c.product_id);
  }

  async function salvarPromo(p: Product, alteracao: { promo_auto?: boolean; promo_min_margin?: number | null }) {
    setErro("");
    const { error } = await supabase.from("products").update(alteracao).eq("id", p.id);
    if (error) {
      setErro(error.message);
      return;
    }
    carregar();
  }

  async function trocarEmpresa(p: Product, id: string) {
    const { error } = await supabase.from("products").update({ company_id: id || null }).eq("id", p.id);
    if (error) setErro(error.message);
    else carregar();
  }

  async function remover(p: Product) {
    if (!confirm(`Excluir "${p.name}"?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) setErro("Não foi possível excluir: o produto tem vendas registradas.");
    else carregar();
  }

  /* ---------- Planilha ---------- */
  async function escolherArquivo(f: File | undefined) {
    setErro("");
    setAviso("");
    setLinhas([]);
    setErrosPlanilha([]);
    if (!f) return;
    setArquivo(f.name);
    try {
      const r = await lerPlanilha(f);
      setLinhas(r.linhas);
      setErrosPlanilha(r.erros);
    } catch (e) {
      setErro("Não consegui ler o arquivo. Use o modelo em Excel (.xlsx). " + mensagemErro(e));
    }
  }

  async function importar() {
    setErro("");
    setAviso("");
    setImportando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");

      // O que já existe: campos em branco na planilha não apagam o que está salvo.
      const existentes = new Map<string, Product>();
      const skus = linhas.map((l) => l.sku);
      for (let i = 0; i < skus.length; i += 200) {
        const r = await supabase.from("products").select("*").in("sku", skus.slice(i, i + 200));
        if (r.error) throw new Error(r.error.message);
        (r.data ?? []).forEach((p) => existentes.set(p.sku as string, p as Product));
      }

      const porCnpj = new Map(empresas.map((c) => [semDigitos(c.cnpj), c.id]));
      const agora = new Date().toISOString();
      const registros = linhas.map((l) => {
        const antigo = existentes.get(l.sku);
        return {
          store_id: uid,
          sku: l.sku,
          name: l.nome,
          cost_price: l.custo,
          ean: l.ean ?? antigo?.ean ?? null,
          ncm: l.ncm ?? antigo?.ncm ?? null,
          stock_qty: l.estoque ?? antigo?.stock_qty ?? 0,
          company_id: (l.cnpj && porCnpj.get(semDigitos(l.cnpj))) || antigo?.company_id || null,
          cost_updated_at: antigo && Number(antigo.cost_price) === l.custo ? antigo.cost_updated_at : agora,
        };
      });

      const ids: string[] = [];
      for (let i = 0; i < registros.length; i += 200) {
        const r = await supabase
          .from("products")
          .upsert(registros.slice(i, i + 200), { onConflict: "store_id,sku" })
          .select("id");
        if (r.error) throw new Error(r.error.message);
        (r.data ?? []).forEach((x) => ids.push(x.id as string));
      }

      const novos = linhas.filter((l) => !existentes.has(l.sku)).length;
      setAviso(`${linhas.length} produtos importados (${novos} novos, ${linhas.length - novos} atualizados).`);
      setLinhas([]);
      setArquivo("");
      if (entrada.current) entrada.current.value = "";
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setImportando(false);
    }
  }

  const f = (k: keyof typeof formVazio, v: string) => setForm((x) => ({ ...x, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Produtos armazém</h1>
          <p className="mt-1 text-sm text-slate-600">O cadastro dos produtos que você tem em estoque, com o custo de cada um.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={painel === "excel" ? "btn" : "btn-ghost"} onClick={() => setPainel(painel === "excel" ? null : "excel")}>
            Importar planilha
          </button>
          <Link href="/dashboard/produtos/nfe" className="btn-ghost">
            Importar XML da nota
          </Link>
          <button className={painel === "manual" ? "btn" : "btn"} onClick={() => setPainel(painel === "manual" ? null : "manual")}>
            Novo produto
          </button>
        </div>
      </div>

      {painel === "manual" && (
        <form onSubmit={adicionar} className="card grid grid-cols-2 gap-3 md:grid-cols-6">
          <div>
            <label className="label">SKU *</label>
            <input className="input" value={form.sku} onChange={(e) => f("sku", e.target.value)} required />
          </div>
          <div className="col-span-2">
            <label className="label">Nome *</label>
            <input className="input" value={form.nome} onChange={(e) => f("nome", e.target.value)} required />
          </div>
          <div>
            <label className="label">Custo (R$) *</label>
            <input className="input" inputMode="decimal" value={form.custo} onChange={(e) => f("custo", e.target.value)} required />
          </div>
          <div>
            <label className="label">Estoque</label>
            <input className="input" inputMode="decimal" value={form.estoque} onChange={(e) => f("estoque", e.target.value)} />
          </div>
          <div>
            <label className="label">EAN</label>
            <input className="input" inputMode="numeric" value={form.ean} onChange={(e) => f("ean", e.target.value)} />
          </div>
          <div>
            <label className="label">NCM</label>
            <input className="input" inputMode="numeric" value={form.ncm} onChange={(e) => f("ncm", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">CNPJ de compra</label>
            <select className="input" value={form.company} onChange={(e) => f("company", e.target.value)}>
              <option value="">Nenhum</option>
              {empresas.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex items-end md:col-span-2">
            <button className="btn">Cadastrar</button>
          </div>
        </form>
      )}

      {painel === "excel" && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-ghost" onClick={() => baixarModelo()}>Baixar modelo (.xlsx)</button>
            <span className="text-sm text-slate-600">Preencha o modelo e envie abaixo. SKUs que já existem são atualizados.</span>
          </div>
          <div>
            <input
              ref={entrada}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
              className="block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm hover:file:bg-slate-100"
            />
          </div>
          {arquivo && (
            <div className="space-y-2 text-sm">
              <p>
                <strong>{linhas.length}</strong> linhas prontas para importar em <span className="font-mono text-xs">{arquivo}</span>.
              </p>
              {errosPlanilha.length > 0 && (
                <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-red-700">
                  {errosPlanilha.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              {linhas.length > 0 && (
                <button className="btn" onClick={importar} disabled={importando}>
                  {importando ? "Importando…" : `Importar ${linhas.length} produtos`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}

      <div className="flex items-center justify-between gap-3">
        <input className="input max-w-xs" placeholder="Buscar por nome, SKU ou EAN" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="font-mono text-xs text-slate-500">{visiveis.length} de {produtos.length} produtos</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">SKU</th>
              <th className="th">Produto</th>
              <th className="th">CNPJ de compra</th>
              <th className="th">Custo un.</th>
              <th className="th">Créditos un.</th>
              <th className="th">Estoque</th>
              <th className="th">Anúncios</th>
              <th className="th" title="Entrar sozinho nas promoções do Mercado Livre que dão a margem mínima deste SKU">Promo auto</th>
              <th className="th" title="Margem líquida mínima para aceitar uma promoção. Pode ser negativa (ex.: -5) para aceitar prejuízo.">Margem mín. promo %</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visiveis.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={10}>
                  {produtos.length === 0 ? "Nenhum produto ainda. Use “Novo produto”, a planilha ou o XML da nota." : "Nada encontrado para essa busca."}
                </td>
              </tr>
            )}
            {visiveis.map((p) => {
              const aberto = histId === p.id;
              const cred = Number(p.icms_credit) + Number(p.pis_credit) + Number(p.cofins_credit);
              return (
                <Fragment key={p.id}>
                <tr>
                  <td className="td font-mono text-xs">{p.sku}</td>
                  <td className="td max-w-[280px] truncate" title={p.name}>{p.name}</td>
                  <td className="td">
                    <select className="input py-1" value={p.company_id ?? ""} onChange={(e) => trocarEmpresa(p, e.target.value)}>
                      <option value="">—</option>
                      {empresas.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.cnpj ? ` · ${formatarCnpj(c.cnpj)}` : ""}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <input
                      key={`c${p.id}${p.cost_price}`}
                      className="input w-24 py-1"
                      inputMode="decimal"
                      defaultValue={campo(Number(p.cost_price))}
                      onBlur={(e) => salvarCampo(p, "cost_price", e.target.value)}
                    />
                  </td>
                  <td className="td text-slate-600" title="ICMS + PIS + COFINS por unidade, vindos do XML (valem no Lucro Real)">
                    {cred > 0 ? brl(cred) : "—"}
                  </td>
                  <td className="td">
                    <input
                      key={`e${p.id}${p.stock_qty}`}
                      className="input w-20 py-1"
                      inputMode="decimal"
                      defaultValue={campo(Number(p.stock_qty))}
                      onBlur={(e) => salvarCampo(p, "stock_qty", e.target.value)}
                    />
                  </td>
                  <td className="td font-mono text-xs">{anuncios[p.id] ?? 0}</td>
                  <td className="td">
                    <input
                      type="checkbox"
                      checked={!!p.promo_auto}
                      title="Entrar sozinho nas promoções que dão a margem mínima deste SKU"
                      onChange={(e) => salvarPromo(p, { promo_auto: e.target.checked })}
                    />
                  </td>
                  <td className="td">
                    <input
                      key={`pm${p.id}${p.promo_min_margin ?? ""}`}
                      className="input w-20 py-1"
                      inputMode="decimal"
                      placeholder="10"
                      defaultValue={p.promo_min_margin != null ? campo(Number(p.promo_min_margin)) : ""}
                      onBlur={(e) => {
                        const txt = e.target.value.trim();
                        const v = txt === "" ? null : num(txt);
                        if (v !== (p.promo_min_margin == null ? null : Number(p.promo_min_margin))) salvarPromo(p, { promo_min_margin: v });
                      }}
                    />
                  </td>
                  <td className="td whitespace-nowrap">
                    <button onClick={() => abrirHistorico(p)} className="mr-3 text-xs text-brand hover:underline">Histórico</button>
                    <button onClick={() => remover(p)} className="text-xs text-red-700 hover:underline">Excluir</button>
                  </td>
                </tr>
                {aberto && (
                  <tr className="bg-slate-50">
                    <td className="td" colSpan={10}>
                      <div className="space-y-2 py-1">
                        <p className="text-xs text-slate-600">
                          Histórico de custo. Cada venda usa o custo vigente na data dela. Ao alterar o custo acima, uma linha nova é criada com a data de hoje.
                        </p>
                        <table className="text-sm">
                          <tbody>
                            {hist.map((c) => (
                              <tr key={c.id}>
                                <td className="pr-6 font-mono text-xs">a partir de {new Date(c.valid_from).toLocaleDateString("pt-BR")}</td>
                                <td className="pr-6">{brl(Number(c.cost_price))}</td>
                                <td>
                                  <button onClick={() => removerCusto(c)} className="text-xs text-red-700 hover:underline">remover</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="label">Valeu a partir de</label>
                            <input type="date" className="input py-1" value={histData} onChange={(e) => setHistData(e.target.value)} />
                          </div>
                          <div>
                            <label className="label">Custo un. (R$)</label>
                            <input className="input w-28 py-1" inputMode="decimal" value={histCusto} onChange={(e) => setHistCusto(e.target.value)} />
                          </div>
                          <button className="btn-ghost" onClick={() => adicionarCusto(p)}>Adicionar custo antigo</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Altere custo ou estoque direto na tabela; ao sair do campo, o valor é salvo. Mudar o custo vale só para as vendas daqui para frente: as vendas antigas guardam o custo da época. O botão Histórico mostra cada custo e a data em que passou a valer.</p>
    </div>
  );
}
