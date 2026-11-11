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
  const [mapaMp, setMapaMp] = useState<Record<string, Record<string, number>>>({});
  const [statusMap, setStatusMap] = useState<"todos" | "sim" | "nao">("todos");
  const [mpFiltro, setMpFiltro] = useState<string>("todos");
  const [aba, setAba] = useState<"todos" | "unico" | "multi" | "kit">("todos");
  const [campoBusca, setCampoBusca] = useState<"tudo" | "sku" | "nome" | "ean">("tudo");
  const [estoqueFiltro, setEstoqueFiltro] = useState<"todos" | "com" | "sem">("todos");
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
    // O banco devolve no máximo 1000 linhas por consulta: busca em blocos.
    const todosProdutos: Product[] = [];
    let erroProdutos = "";
    for (let i = 0; i < 50000; i += 1000) {
      const r = await supabase.from("products").select("*").order("name").order("id").range(i, i + 999);
      if (r.error) {
        erroProdutos = r.error.message;
        break;
      }
      todosProdutos.push(...((r.data ?? []) as Product[]));
      if ((r.data ?? []).length < 1000) break;
    }
    const ligacoes: { product_id: string | null; marketplace_id: string }[] = [];
    for (let i = 0; i < 50000; i += 1000) {
      const r = await supabase.from("listings").select("product_id, marketplace_id").order("id").range(i, i + 999);
      if (r.error) break;
      ligacoes.push(...((r.data ?? []) as { product_id: string | null; marketplace_id: string }[]));
      if ((r.data ?? []).length < 1000) break;
    }
    const c = await supabase.from("companies").select("*").order("created_at");
    if (erroProdutos) setErro(erroProdutos);
    setProdutos(todosProdutos);
    setEmpresas((c.data ?? []) as Company[]);
    const cont: Record<string, number> = {};
    const porMp: Record<string, Record<string, number>> = {};
    ligacoes.forEach((x) => {
      if (!x.product_id) return;
      cont[x.product_id] = (cont[x.product_id] || 0) + 1;
      porMp[x.product_id] = porMp[x.product_id] ?? {};
      porMp[x.product_id][x.marketplace_id] = (porMp[x.product_id][x.marketplace_id] || 0) + 1;
    });
    setAnuncios(cont);
    setMapaMp(porMp);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Mapeado = o produto tem pelo menos um anúncio ligado (no marketplace escolhido, ou em qualquer um).
  // Escolher um marketplace sem escolher o status mostra os mapeados nele.
  const mapeadoEm = useCallback(
    (id: string, mp: string) => (mp === "todos" ? (anuncios[id] ?? 0) > 0 : (mapaMp[id]?.[mp] ?? 0) > 0),
    [anuncios, mapaMp]
  );
  const statusEfetivo = statusMap === "todos" && mpFiltro !== "todos" ? "sim" : statusMap;
  const tipoDe = (p: Product) => p.tipo ?? "unico";

  // Filtros (acima das abas). Pesquisa aceita várias entradas separadas por vírgula.
  const filtrados = useMemo(() => {
    const termos = busca
      .split(/[,\n]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return produtos.filter((p) => {
      if (statusEfetivo === "sim" && !mapeadoEm(p.id, mpFiltro)) return false;
      if (statusEfetivo === "nao" && mapeadoEm(p.id, mpFiltro)) return false;
      if (estoqueFiltro === "com" && !(Number(p.stock_qty) > 0)) return false;
      if (estoqueFiltro === "sem" && Number(p.stock_qty) > 0) return false;
      if (termos.length === 0) return true;
      const nome = p.name.toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const ean = p.ean ?? "";
      return termos.some((t) =>
        campoBusca === "sku" ? sku.includes(t) : campoBusca === "nome" ? nome.includes(t) : campoBusca === "ean" ? ean.includes(t) : nome.includes(t) || sku.includes(t) || ean.includes(t)
      );
    });
  }, [produtos, busca, campoBusca, statusEfetivo, mpFiltro, estoqueFiltro, mapeadoEm]);

  const contagem = useMemo(
    () => ({
      todos: filtrados.length,
      unico: filtrados.filter((p) => tipoDe(p) === "unico").length,
      multi: filtrados.filter((p) => tipoDe(p) === "multi").length,
      kit: filtrados.filter((p) => tipoDe(p) === "kit").length,
    }),
    [filtrados]
  );
  const visiveis = useMemo(() => (aba === "todos" ? filtrados : filtrados.filter((p) => tipoDe(p) === aba)), [filtrados, aba]);
  const filtrando = busca.trim() !== "" || statusMap !== "todos" || mpFiltro !== "todos" || estoqueFiltro !== "todos";

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
        // Sem custo na planilha: produto novo entra com custo 0; produto existente mantém o custo e só atualiza nome e demais campos.
        const custo = l.custo != null ? l.custo : antigo ? Number(antigo.cost_price) : 0;
        return {
          store_id: uid,
          sku: l.sku,
          name: l.nome,
          cost_price: custo,
          ean: l.ean ?? antigo?.ean ?? null,
          ncm: l.ncm ?? antigo?.ncm ?? null,
          stock_qty: l.estoque ?? antigo?.stock_qty ?? 0,
          company_id: (l.cnpj && porCnpj.get(semDigitos(l.cnpj))) || antigo?.company_id || null,
          cost_updated_at: antigo && Number(antigo.cost_price) === custo ? antigo.cost_updated_at : agora,
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
      const semCusto = linhas.filter((l) => l.custo == null && !existentes.has(l.sku)).length;
      const custoMudou = linhas.filter((l) => l.custo != null && existentes.has(l.sku) && Number(existentes.get(l.sku)?.cost_price) !== l.custo).length;
      setAviso(
        `${linhas.length} produtos importados (${novos} novos, ${linhas.length - novos} atualizados).` +
          (semCusto > 0 ? ` ${semCusto} entraram sem custo.` : "") +
          (custoMudou > 0 ? ` O custo foi substituído em ${custoMudou}; o custo anterior fica no Histórico.` : "")
      );
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[320px] flex-1 items-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 md:max-w-xl">
          <select className="h-10 border-0 border-r border-slate-200 bg-transparent px-3 text-sm outline-none" value={campoBusca} onChange={(e) => setCampoBusca(e.target.value as typeof campoBusca)} aria-label="Pesquisar em">
            <option value="tudo">Nome / SKU / EAN</option>
            <option value="nome">Nome</option>
            <option value="sku">SKU</option>
            <option value="ean">EAN</option>
          </select>
          <input className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="Separe várias entradas com vírgula" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select className="input h-10 w-auto py-0" value={statusMap} onChange={(e) => setStatusMap(e.target.value as typeof statusMap)} aria-label="Status mapeado">
          <option value="todos">Status mapeado</option>
          <option value="sim">Mapeado</option>
          <option value="nao">Não mapeado</option>
        </select>
        <select className="input h-10 w-auto py-0" value={mpFiltro} onChange={(e) => setMpFiltro(e.target.value)} aria-label="Marketplace">
          <option value="todos">Marketplace</option>
          <option value="mercado_livre">Mercado Livre</option>
          <option value="shopee">Shopee</option>
          <option value="tiktok">TikTok Shop</option>
        </select>
        <select className="input h-10 w-auto py-0" value={estoqueFiltro} onChange={(e) => setEstoqueFiltro(e.target.value as typeof estoqueFiltro)} aria-label="Status de estoque">
          <option value="todos">Status de estoque</option>
          <option value="com">Com estoque</option>
          <option value="sem">Sem estoque</option>
        </select>
        {filtrando && (
          <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => { setBusca(""); setStatusMap("todos"); setMpFiltro("todos"); setEstoqueFiltro("todos"); setCampoBusca("tudo"); }}>
            Limpar filtros
          </button>
        )}
        <span className="ml-auto font-mono text-xs text-slate-500">{visiveis.length} de {produtos.length} produtos</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["todos", "Tudo", contagem.todos],
          ["unico", "Único", contagem.unico],
          ["multi", "Multi-variantes", contagem.multi],
          ["kit", "KIT / Produto aleatório", contagem.kit],
        ] as const).map(([id, nome, qtd]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${aba === id ? "bg-brand text-white" : "bg-white text-slate-600 shadow-soft hover:bg-brand-light"}`}
          >
            {nome} <span className={`ml-1 text-xs ${aba === id ? "text-white/70" : "text-slate-400"}`}>{qtd}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">SKU</th>
              <th className="th">Produto</th>
              <th className="th">Tipo</th>
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
                <td className="td text-slate-500" colSpan={11}>
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
                  <td className="td">{p.name}</td>
                  <td className="td">
                    <select
                      className="input py-1"
                      value={p.tipo ?? "unico"}
                      onChange={async (e) => {
                        const { error } = await supabase.from("products").update({ tipo: e.target.value }).eq("id", p.id);
                        if (error) setErro(error.message);
                        else carregar();
                      }}
                    >
                      <option value="unico">Único</option>
                      <option value="multi">Multi-variantes</option>
                      <option value="kit">KIT / Aleatório</option>
                    </select>
                  </td>
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
                  <td className="td">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{anuncios[p.id] ?? 0}</span>
                      {(
                        [
                          ["mercado_livre", "ML", "Mercado Livre", "bg-[#FFE600] text-[#333]"],
                          ["shopee", "SH", "Shopee", "bg-[#EE4D2D] text-white"],
                          ["tiktok", "TT", "TikTok Shop", "bg-[#111] text-white"],
                        ] as const
                      )
                        .filter(([id]) => (mapaMp[p.id]?.[id] ?? 0) > 0)
                        .map(([id, sigla, nome, cls]) => (
                          <span key={id} title={`Mapeado no ${nome} (${mapaMp[p.id][id]} anúncio${mapaMp[p.id][id] > 1 ? "s" : ""})`} className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${cls}`}>
                            {sigla}
                          </span>
                        ))}
                    </div>
                  </td>
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
                    <td className="td" colSpan={11}>
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
