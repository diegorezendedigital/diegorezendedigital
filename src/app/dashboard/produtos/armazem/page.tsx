"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { Company, CustoProduto, Product, brl, campo, formatarCnpj, mensagemErro, num } from "@/lib/types";
import { LinhaProduto, baixarModelo, lerPlanilha } from "@/lib/planilha";
import { analisarAnuncio } from "@/lib/anuncio";
import type { Listing } from "@/lib/types";

type Painel = null | "manual" | "excel";
type Componente = { id: string; kit_id: string; component_id: string; quantity: number };

const formVazio = { sku: "", nome: "", custo: "", ean: "", ncm: "", estoque: "", company: "", tipo: "unico", cores: "", tamanhos: "", kitDeGrupo: "", kitGrupo: "", kitN: "2", kitPrefixo: "" };

export default function ArmazemPage() {
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [anuncios, setAnuncios] = useState<Record<string, number>>({});
  const [anunciosDoProduto, setAnunciosDoProduto] = useState<Record<string, Listing[]>>({});
  const [busca, setBusca] = useState("");
  const [mapaMp, setMapaMp] = useState<Record<string, Record<string, number>>>({});
  const [statusMap, setStatusMap] = useState<"todos" | "sim" | "nao">("todos");
  const [mpFiltro, setMpFiltro] = useState<string>("todos");
  const [aba, setAba] = useState<"todos" | "unico" | "multi" | "kit">("todos");
  const [campoBusca, setCampoBusca] = useState<"tudo" | "sku" | "nome" | "ean">("tudo");
  const [estoqueFiltro, setEstoqueFiltro] = useState<"todos" | "com" | "sem">("todos");
  const [grupoFiltro, setGrupoFiltro] = useState<string | null>(null);
  const [custoFiltro, setCustoFiltro] = useState<"todos" | "sem" | "com">("todos");
  const [qtdLinhas, setQtdLinhas] = useState(100);
  // Kits: composição (peças + quantidade)
  const [componentes, setComponentes] = useState<Record<string, Componente[]>>({});
  const [kitAberto, setKitAberto] = useState<string | null>(null);
  const [kitBusca, setKitBusca] = useState("");
  const [kitQtd, setKitQtd] = useState("1");
  const [histId, setHistId] = useState<string | null>(null);
  const [hist, setHist] = useState<CustoProduto[]>([]);
  const [histCusto, setHistCusto] = useState("");
  const [histData, setHistData] = useState("");
  const [painel, setPainel] = useState<Painel>(null);
  // Edição de custo em massa
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [massaAberta, setMassaAberta] = useState(false);
  const [massaModo, setMassaModo] = useState<"valor" | "percentual">("valor");
  const [massaValor, setMassaValor] = useState("");
  const [massaData, setMassaData] = useState("");
  const [massaBusy, setMassaBusy] = useState(false);
  const [promoAberta, setPromoAberta] = useState(false);
  const [promoAuto, setPromoAuto] = useState<"manter" | "ligar" | "desligar">("ligar");
  const [promoMargemModo, setPromoMargemModo] = useState<"manter" | "definir" | "padrao">("definir");
  const [promoMargem, setPromoMargem] = useState("");
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
    const ligacoes: Listing[] = [];
    for (let i = 0; i < 50000; i += 1000) {
      const r = await supabase.from("listings").select("id, product_id, marketplace_id, external_id, title, price, units, shipping_cost, fee_percent, fee_fixed, company_id, target_margin").order("id").range(i, i + 999);
      if (r.error) break;
      ligacoes.push(...((r.data ?? []) as unknown as Listing[]));
      if ((r.data ?? []).length < 1000) break;
    }
    const c = await supabase.from("companies").select("*").order("created_at");
    const comp = await supabase.from("product_components").select("id, kit_id, component_id, quantity");
    const porKit: Record<string, Componente[]> = {};
    ((comp.error ? [] : comp.data ?? []) as Componente[]).forEach((x) => {
      (porKit[x.kit_id] = porKit[x.kit_id] ?? []).push({ ...x, quantity: Number(x.quantity) });
    });
    setComponentes(porKit);
    if (erroProdutos) setErro(erroProdutos);
    setProdutos(todosProdutos);
    setEmpresas((c.data ?? []) as Company[]);
    const cont: Record<string, number> = {};
    const porMp: Record<string, Record<string, number>> = {};
    const listas: Record<string, Listing[]> = {};
    ligacoes.forEach((x) => {
      if (!x.product_id) return;
      (listas[x.product_id] = listas[x.product_id] ?? []).push(x);
      cont[x.product_id] = (cont[x.product_id] || 0) + 1;
      porMp[x.product_id] = porMp[x.product_id] ?? {};
      porMp[x.product_id][x.marketplace_id] = (porMp[x.product_id][x.marketplace_id] || 0) + 1;
    });
    setAnuncios(cont);
    setAnunciosDoProduto(listas);
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
      if (grupoFiltro && p.grupo !== grupoFiltro) return false;
      if (custoFiltro === "sem" && Number(p.cost_price) > 0) return false;
      if (custoFiltro === "com" && !(Number(p.cost_price) > 0)) return false;
      if (termos.length === 0) return true;
      const nome = `${p.name} ${p.grupo ?? ""}`.toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const ean = p.ean ?? "";
      return termos.some((t) =>
        campoBusca === "sku" ? sku.includes(t) : campoBusca === "nome" ? nome.includes(t) : campoBusca === "ean" ? ean.includes(t) : nome.includes(t) || sku.includes(t) || ean.includes(t)
      );
    });
  }, [produtos, busca, campoBusca, statusEfetivo, mpFiltro, estoqueFiltro, custoFiltro, grupoFiltro, mapeadoEm]);

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
  useEffect(() => setQtdLinhas(100), [busca, campoBusca, statusMap, mpFiltro, estoqueFiltro, custoFiltro, grupoFiltro, aba]);
  const grupos = useMemo(() => {
    const m = new Map<string, number>();
    produtos.forEach((p) => p.grupo && tipoDe(p) !== "kit" && m.set(p.grupo, (m.get(p.grupo) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [produtos]);
  const semCustoQtd = useMemo(() => produtos.filter((p) => !(Number(p.cost_price) > 0)).length, [produtos]);
  const prodPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Composição do kit
  const custoDoKit = (kitId: string) => (componentes[kitId] ?? []).reduce((t, c) => t + c.quantity * Number(prodPorId.get(c.component_id)?.cost_price ?? 0), 0);
  async function adicionarPeca(kit: Product, peca: Product) {
    setErro("");
    const q = Math.max(num(kitQtd) || 1, 0.001);
    const { error } = await supabase.from("product_components").upsert({ store_id: kit.store_id, kit_id: kit.id, component_id: peca.id, quantity: q }, { onConflict: "kit_id,component_id" });
    if (error) return setErro(error.message.includes("product_components") ? "Falta rodar o SQL dos kits no Supabase (veja a mensagem do assistente)." : error.message);
    setKitBusca("");
    setKitQtd("1");
    await carregar();
  }
  async function mudarQtdPeca(c: Componente, valor: string) {
    const q = num(valor);
    if (!(q > 0) || q === c.quantity) return;
    const { error } = await supabase.from("product_components").update({ quantity: q }).eq("id", c.id);
    if (error) setErro(error.message);
    else carregar();
  }
  async function removerPeca(c: Componente) {
    const { error } = await supabase.from("product_components").delete().eq("id", c.id);
    if (error) setErro(error.message);
    else carregar();
  }
  const filtrando = busca.trim() !== "" || statusMap !== "todos" || mpFiltro !== "todos" || estoqueFiltro !== "todos" || custoFiltro !== "todos" || !!grupoFiltro;

  const selVisiveis = useMemo(() => visiveis.filter((p) => sel.has(p.id)), [visiveis, sel]);
  const todosMarcados = visiveis.length > 0 && selVisiveis.length === visiveis.length;
  const hojeISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  function alternar(id: string) {
    setSel((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function marcarTodos() {
    setSel((a) => {
      const n = new Set(a);
      if (todosMarcados) visiveis.forEach((p) => n.delete(p.id));
      else visiveis.forEach((p) => n.add(p.id));
      return n;
    });
  }

  // Aplica o novo custo aos selecionados. Sempre grava no histórico com a data escolhida (padrão: hoje).
  async function aplicarMassa() {
    setErro("");
    setAviso("");
    const v = num(massaValor);
    if (massaValor.trim() === "" || (massaModo === "valor" && !(v >= 0)) || (massaModo === "percentual" && !Number.isFinite(v))) {
      setErro("Informe o novo custo (ou o percentual).");
      return;
    }
    const data = massaData || hojeISO();
    const ehHoje = data >= hojeISO();
    const alvo = selVisiveis.length > 0 ? selVisiveis : produtos.filter((p) => sel.has(p.id));
    if (alvo.length === 0) return;
    const novoDe = (p: Product) => {
      const n = massaModo === "valor" ? v : Number(p.cost_price) * (1 + v / 100);
      return Math.max(0, Math.round(n * 100) / 100);
    };
    const lista = alvo.filter((p) => novoDe(p) !== Number(p.cost_price) || !ehHoje);
    if (lista.length === 0) {
      setAviso("Nenhum produto mudou de custo.");
      return;
    }
    const quando = ehHoje ? "hoje" : `a partir de ${data.split("-").reverse().join("/")}`;
    if (!confirm(`Alterar o custo de ${lista.length} produto(s), valendo ${quando}? O custo anterior fica salvo no histórico.`)) return;
    setMassaBusy(true);
    let feitos = 0;
    let falhas = 0;
    try {
      // Data passada: descobre quais produtos já têm custo registrado depois dela (esses não mudam o custo atual).
      const comCustoPosterior = new Set<string>();
      const validFrom = new Date(`${data}T00:00:00-03:00`).toISOString();
      if (!ehHoje) {
        for (let i = 0; i < lista.length; i += 150) {
          const ids = lista.slice(i, i + 150).map((p) => p.id);
          const r = await supabase.from("product_costs").select("product_id").in("product_id", ids).gt("valid_from", validFrom);
          (r.data ?? []).forEach((x: { product_id: string }) => comCustoPosterior.add(x.product_id));
        }
      }
      for (let i = 0; i < lista.length; i += 10) {
        await Promise.all(
          lista.slice(i, i + 10).map(async (p) => {
            const novo = novoDe(p);
            if (ehHoje) {
              // O gatilho do banco grava a linha do histórico com a data/hora de agora.
              const r = await supabase.from("products").update({ cost_price: novo, cost_updated_at: new Date().toISOString() }).eq("id", p.id);
              if (r.error) falhas++;
              else feitos++;
              return;
            }
            const h = await supabase.from("product_costs").insert({ store_id: p.store_id, product_id: p.id, cost_price: novo, valid_from: validFrom });
            if (h.error) {
              falhas++;
              return;
            }
            if (!comCustoPosterior.has(p.id)) {
              const r = await supabase.from("products").update({ cost_price: novo, cost_updated_at: new Date().toISOString() }).eq("id", p.id);
              if (r.error) {
                falhas++;
                return;
              }
            }
            feitos++;
          })
        );
      }
    } finally {
      setMassaBusy(false);
    }
    setAviso(`Custo alterado em ${feitos} produto(s)${falhas ? `; ${falhas} falharam` : ""}. Tudo ficou registrado no histórico com a data.`);
    setMassaAberta(false);
    setMassaValor("");
    setMassaData("");
    setSel(new Set());
    carregar();
  }

  const semDigitos = (s: string | null) => String(s ?? "").replace(/\D/g, "");

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    // Várias variantes de uma vez: modelo + cores + tamanhos
    if (form.tipo === "multi") {
      const modelo = form.nome.trim();
      const base = form.sku.trim().toUpperCase();
      const partes = (t: string) => t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      const cores = partes(form.cores);
      const tamanhos = partes(form.tamanhos);
      if (!modelo || !base) return setErro("Informe o nome do modelo e o SKU base.");
      if (cores.length === 0 && tamanhos.length === 0) return setErro("Informe pelo menos as cores ou os tamanhos (separados por vírgula).");
      const combos: { cor: string; tam: string }[] = [];
      (cores.length ? cores : [""]).forEach((cor) => (tamanhos.length ? tamanhos : [""]).forEach((tam) => combos.push({ cor, tam })));
      if (combos.length > 300) return setErro(`Seriam ${combos.length} variantes; o máximo por vez é 300.`);
      const existentes = new Set(produtos.map((p) => p.sku));
      const novos = combos
        .map(({ cor, tam }) => ({
          sku: [base, cor, tam].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, ""),
          name: `${modelo} - ${[cor, tam].filter(Boolean).join(" / ")}`,
        }))
        .filter((x) => !existentes.has(x.sku));
      if (novos.length === 0) return setErro("Todas essas variantes já existem.");
      const { error } = await supabase.from("products").insert(
        novos.map((x) => ({
          store_id: uid,
          tipo: "multi",
          grupo: modelo,
          sku: x.sku,
          name: x.name,
          cost_price: num(form.custo),
          ncm: form.ncm.trim() || null,
          stock_qty: num(form.estoque),
          company_id: form.company || null,
          cost_updated_at: new Date().toISOString(),
        }))
      );
      if (error) return setErro(error.message.includes("grupo") ? "Falta rodar o SQL do grupo de variantes no Supabase (veja a mensagem do assistente)." : error.message);
      setForm(formVazio);
      setAviso(`${novos.length} variantes criadas no grupo “${modelo}”${combos.length - novos.length ? ` (${combos.length - novos.length} já existiam)` : ""}.`);
      setAba("multi");
      setGrupoFiltro(modelo);
      await carregar();
      return;
    }
    // Um kit para cada variante de um grupo (ex.: “Kit 2 bermudas” de cada cor e tamanho)
    if (form.tipo === "kit" && form.kitDeGrupo === "sim") {
      const n = num(form.kitN) || 0;
      const pecas = produtos.filter((p) => p.grupo === form.kitGrupo && tipoDe(p) !== "kit");
      if (!form.kitGrupo || pecas.length === 0) return setErro("Escolha um grupo de variantes.");
      if (!(n > 0)) return setErro("Informe quantas peças de cada variante entram no kit.");
      const prefixo = (form.kitPrefixo.trim() || `KIT${n}-`).toUpperCase();
      const existentes = new Set(produtos.map((p) => p.sku));
      const novos = pecas.filter((p) => !existentes.has(prefixo + p.sku));
      if (novos.length === 0) return setErro(`Já existem kits com o prefixo ${prefixo} para todas as variantes.`);
      const grupoKit = `Kit ${n} - ${form.kitGrupo}`;
      const { data: criados, error } = await supabase
        .from("products")
        .insert(
          novos.map((p) => ({
            store_id: uid,
            tipo: "kit",
            grupo: grupoKit,
            sku: prefixo + p.sku,
            name: `Kit ${n} - ${p.name}`,
            cost_price: Number(p.cost_price) * n,
            stock_qty: 0,
            company_id: p.company_id,
            cost_updated_at: new Date().toISOString(),
          }))
        )
        .select("id, sku");
      if (error) return setErro(error.message.includes("grupo") ? "Falta rodar o SQL do grupo de variantes no Supabase (veja a mensagem do assistente)." : error.message);
      const idPorSku = new Map((criados ?? []).map((k) => [k.sku as string, k.id as string]));
      const { error: e2 } = await supabase.from("product_components").insert(
        novos.map((p) => ({ store_id: uid, kit_id: idPorSku.get(prefixo + p.sku) as string, component_id: p.id, quantity: n })).filter((x) => x.kit_id)
      );
      if (e2) return setErro(e2.message.includes("product_components") ? "Falta rodar o SQL dos kits no Supabase." : e2.message);
      setForm(formVazio);
      setAviso(`${novos.length} kits criados (${n} peça(s) de cada variante do grupo “${form.kitGrupo}”). O custo de cada kit é a soma das peças e acompanha o custo da variante.`);
      setAba("kit");
      setGrupoFiltro(grupoKit);
      await carregar();
      return;
    }
    const sku = form.sku.trim();
    if (produtos.some((p) => p.sku === sku)) {
      setErro(`Já existe um produto com o SKU ${sku}.`);
      return;
    }
    const { data: criado, error } = await supabase.from("products").insert({
      store_id: uid,
      tipo: form.tipo,
      sku,
      name: form.nome.trim(),
      cost_price: num(form.custo),
      ean: form.ean.trim() || null,
      ncm: form.ncm.trim() || null,
      stock_qty: num(form.estoque),
      company_id: form.company || null,
      cost_updated_at: new Date().toISOString(),
    }).select("id").single();
    if (error) {
      setErro(error.message);
      return;
    }
    const eraKit = form.tipo === "kit";
    setForm(formVazio);
    setAviso(eraKit ? "Kit cadastrado. Adicione as peças abaixo, em Composição: o custo do kit será a soma delas." : "Produto cadastrado.");
    await carregar();
    if (eraKit && criado) {
      setAba("kit");
      setKitAberto(criado.id as string);
      setKitBusca("");
    }
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

  // Promoção automática em massa: liga/desliga e define a margem mínima de todos os selecionados
  async function aplicarPromoMassa() {
    setErro("");
    setAviso("");
    const alvo = selVisiveis.length > 0 ? selVisiveis : produtos.filter((p) => sel.has(p.id));
    if (alvo.length === 0) return;
    const alteracao: { promo_auto?: boolean; promo_min_margin?: number | null } = {};
    if (promoAuto !== "manter") alteracao.promo_auto = promoAuto === "ligar";
    if (promoMargemModo === "definir") {
      if (promoMargem.trim() === "" || !Number.isFinite(num(promoMargem))) return setErro("Informe a margem mínima (pode ser negativa, ex.: -5).");
      alteracao.promo_min_margin = num(promoMargem);
    } else if (promoMargemModo === "padrao") alteracao.promo_min_margin = null;
    if (Object.keys(alteracao).length === 0) return setErro("Escolha o que alterar.");
    const resumo = [
      promoAuto !== "manter" ? `promoção automática ${promoAuto === "ligar" ? "LIGADA" : "DESLIGADA"}` : "",
      promoMargemModo === "definir" ? `margem mínima ${promoMargem}%` : promoMargemModo === "padrao" ? "margem mínima padrão (10%)" : "",
    ].filter(Boolean).join(" e ");
    if (!confirm(`Aplicar em ${alvo.length} produto(s): ${resumo}?`)) return;
    setMassaBusy(true);
    let falhas = 0;
    try {
      for (let i = 0; i < alvo.length; i += 100) {
        const r = await supabase.from("products").update(alteracao).in("id", alvo.slice(i, i + 100).map((p) => p.id));
        if (r.error) {
          falhas += Math.min(100, alvo.length - i);
          setErro(r.error.message);
        }
      }
    } finally {
      setMassaBusy(false);
    }
    setAviso(`${alvo.length - falhas} produto(s) atualizados: ${resumo}.`);
    setPromoAberta(false);
    setSel(new Set());
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
          <div className="col-span-2">
            <label className="label">Tipo do produto *</label>
            <select className="input" value={form.tipo} onChange={(e) => f("tipo", e.target.value)}>
              <option value="unico">Produto único (unitário)</option>
              <option value="multi">Com variantes (cor, tamanho…)</option>
              <option value="kit">Kit / produto aleatório (soma de outros produtos)</option>
            </select>
            {form.tipo === "kit" && <p className="mt-1 text-xs text-slate-500">O custo do kit vem da soma das peças. Depois de salvar, você escolhe as peças e as quantidades.</p>}
            {form.tipo === "multi" && <p className="mt-1 text-xs text-slate-500">Informe o modelo, as cores e os tamanhos: o sistema cria uma linha para cada combinação.</p>}
          </div>
          {form.tipo === "kit" && grupos.length > 0 && (
            <div className="col-span-2 md:col-span-4">
              <label className="label">Como criar o kit</label>
              <select className="input" value={form.kitDeGrupo} onChange={(e) => f("kitDeGrupo", e.target.value)}>
                <option value="">Um kit só (escolho as peças depois)</option>
                <option value="sim">Um kit para cada variante de um grupo (ex.: Kit 2 bermudas, de cada cor e tamanho)</option>
              </select>
            </div>
          )}
          {form.tipo === "kit" && form.kitDeGrupo === "sim" ? (
            <>
              <div className="col-span-2">
                <label className="label">Grupo de variantes *</label>
                <select className="input" value={form.kitGrupo} onChange={(e) => f("kitGrupo", e.target.value)} required>
                  <option value="">Escolher…</option>
                  {grupos.map(([g, q]) => (
                    <option key={g} value={g}>{g} ({q} variantes)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Peças de cada variante *</label>
                <input className="input" inputMode="decimal" value={form.kitN} onChange={(e) => f("kitN", e.target.value)} required />
              </div>
              <div>
                <label className="label">Prefixo do SKU</label>
                <input className="input" placeholder={`KIT${num(form.kitN) || 2}-`} value={form.kitPrefixo} onChange={(e) => f("kitPrefixo", e.target.value)} />
              </div>
              <p className="col-span-2 text-xs text-slate-500 md:col-span-6">
                Cada kit recebe o SKU do prefixo + SKU da variante (ex.: {(form.kitPrefixo.trim() || `KIT${num(form.kitN) || 2}-`).toUpperCase()}{produtos.find((p) => p.grupo === form.kitGrupo)?.sku ?? "SKU-DA-VARIANTE"}) e o custo da soma das peças, que acompanha o custo da variante.
              </p>
            </>
          ) : (
            <>
              <div>
                <label className="label">{form.tipo === "multi" ? "SKU base *" : "SKU *"}</label>
                <input className="input" placeholder={form.tipo === "multi" ? "CAM-POLO" : ""} value={form.sku} onChange={(e) => f("sku", e.target.value)} required />
              </div>
              <div className="col-span-2">
                <label className="label">{form.tipo === "multi" ? "Nome do modelo *" : "Nome *"}</label>
                <input className="input" placeholder={form.tipo === "multi" ? "Camisa Polo Masculina" : ""} value={form.nome} onChange={(e) => f("nome", e.target.value)} required />
              </div>
              {form.tipo === "multi" && (
                <>
                  <div className="col-span-2">
                    <label className="label">Cores (separe por vírgula)</label>
                    <input className="input" placeholder="Branco, Preto, Azul" value={form.cores} onChange={(e) => f("cores", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Tamanhos (separe por vírgula)</label>
                    <input className="input" placeholder="P, M, G, GG" value={form.tamanhos} onChange={(e) => f("tamanhos", e.target.value)} />
                  </div>
                  <p className="col-span-2 text-xs text-slate-500 md:col-span-6">
                    Serão criadas {(Math.max(form.cores.split(/[,\n]/).filter((x) => x.trim()).length, 1)) * (Math.max(form.tamanhos.split(/[,\n]/).filter((x) => x.trim()).length, 1))} variantes, todas no grupo “{form.nome.trim() || "nome do modelo"}”, com o mesmo custo, estoque e CNPJ abaixo (depois você ajusta cada uma).
                  </p>
                </>
              )}
              <div>
                <label className="label">Custo (R$) *</label>
                <input className="input" inputMode="decimal" value={form.custo} onChange={(e) => f("custo", e.target.value)} required={form.tipo !== "kit"} />
              </div>
            </>
          )}
          <div>
            <label className="label">Estoque</label>
            <input className="input" inputMode="decimal" value={form.estoque} onChange={(e) => f("estoque", e.target.value)} />
          </div>
          {form.tipo !== "multi" && !(form.tipo === "kit" && form.kitDeGrupo === "sim") && (
            <div>
              <label className="label">EAN</label>
              <input className="input" inputMode="numeric" value={form.ean} onChange={(e) => f("ean", e.target.value)} />
            </div>
          )}
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
        <select className="input h-10 w-auto py-0" value={custoFiltro} onChange={(e) => setCustoFiltro(e.target.value as typeof custoFiltro)} aria-label="Status de custo">
          <option value="todos">Status de custo</option>
          <option value="sem">Sem custo ({semCustoQtd})</option>
          <option value="com">Com custo</option>
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

      {grupoFiltro && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-brand-light px-3 py-1 font-medium text-brand">Grupo: {grupoFiltro}</span>
          <button className="text-brand hover:underline" onClick={() => setGrupoFiltro(null)}>Ver todos os produtos</button>
        </div>
      )}
      {sel.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-brand/30 bg-brand-light/40 p-3">
          <span className="text-sm font-semibold">{sel.size} selecionado(s)</span>
          {!massaAberta && (
            <button className="btn" onClick={() => { setMassaAberta(true); setPromoAberta(false); setMassaData(hojeISO()); }}>Editar custo em massa</button>
          )}
          {!promoAberta && (
            <button className="btn" onClick={() => { setPromoAberta(true); setMassaAberta(false); }}>Promoção automática / margem mínima</button>
          )}
          <button className="text-sm text-slate-600 hover:underline" onClick={() => { setSel(new Set()); setMassaAberta(false); setPromoAberta(false); }}>Limpar seleção</button>
          {promoAberta && (
            <div className="flex w-full flex-wrap items-end gap-3">
              <div>
                <label className="label">Promoção automática</label>
                <select className="input h-10 py-0" value={promoAuto} onChange={(e) => setPromoAuto(e.target.value as typeof promoAuto)}>
                  <option value="ligar">Ligar nos selecionados</option>
                  <option value="desligar">Desligar nos selecionados</option>
                  <option value="manter">Não mudar</option>
                </select>
              </div>
              <div>
                <label className="label">Margem mínima da promoção</label>
                <select className="input h-10 py-0" value={promoMargemModo} onChange={(e) => setPromoMargemModo(e.target.value as typeof promoMargemModo)}>
                  <option value="definir">Definir margem (%)</option>
                  <option value="padrao">Usar a padrão (10%)</option>
                  <option value="manter">Não mudar</option>
                </select>
              </div>
              {promoMargemModo === "definir" && (
                <div>
                  <label className="label">Margem mínima (%)</label>
                  <input className="input h-10 w-28" inputMode="decimal" placeholder="10 ou -5" value={promoMargem} onChange={(e) => setPromoMargem(e.target.value)} />
                </div>
              )}
              <button className="btn" disabled={massaBusy} onClick={aplicarPromoMassa}>{massaBusy ? "Aplicando…" : "Aplicar"}</button>
              <button className="btn-ghost" disabled={massaBusy} onClick={() => setPromoAberta(false)}>Cancelar</button>
              <p className="w-full text-xs text-slate-600">Com a promoção automática ligada, ao clicar em “Aplicar promoções” na Central de promoções o sistema entra nas promoções do Mercado Livre desses SKUs, no preço que entrega exatamente a margem mínima. Pode ser negativa para aceitar prejuízo.</p>
            </div>
          )}
          {massaAberta && (
            <div className="flex w-full flex-wrap items-end gap-3">
              <div>
                <label className="label">Como alterar</label>
                <select className="input h-10 py-0" value={massaModo} onChange={(e) => setMassaModo(e.target.value as "valor" | "percentual")}>
                  <option value="valor">Definir novo custo (R$)</option>
                  <option value="percentual">Aumentar/reduzir em %</option>
                </select>
              </div>
              <div>
                <label className="label">{massaModo === "valor" ? "Novo custo un. (R$)" : "Percentual (ex.: 5 ou -10)"}</label>
                <input className="input h-10 w-40" inputMode="decimal" value={massaValor} onChange={(e) => setMassaValor(e.target.value)} placeholder={massaModo === "valor" ? "0,00" : "5"} />
              </div>
              <div>
                <label className="label">Vale a partir de</label>
                <input type="date" className="input h-10" max={hojeISO()} value={massaData} onChange={(e) => setMassaData(e.target.value)} />
              </div>
              <button className="btn" disabled={massaBusy} onClick={aplicarMassa}>{massaBusy ? "Aplicando…" : "Aplicar"}</button>
              <button className="btn-ghost" disabled={massaBusy} onClick={() => setMassaAberta(false)}>Cancelar</button>
              <p className="w-full text-xs text-slate-600">O custo anterior continua no Histórico. Vendas já feitas não mudam; com data passada, só entra no histórico e vale para vendas sem custo gravado.</p>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8"><input type="checkbox" checked={todosMarcados} onChange={marcarTodos} aria-label="Selecionar todos os filtrados" title="Selecionar todos os filtrados" /></th>
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
                <td className="td text-slate-500" colSpan={12}>
                  {produtos.length === 0 ? "Nenhum produto ainda. Use “Novo produto”, a planilha ou o XML da nota." : "Nada encontrado para essa busca."}
                </td>
              </tr>
            )}
            {visiveis.slice(0, qtdLinhas).map((p) => {
              const aberto = histId === p.id;
              const ehKit = tipoDe(p) === "kit";
              const pecas = componentes[p.id] ?? [];
              const kitComposto = ehKit && pecas.length > 0;
              const cred = Number(p.icms_credit) + Number(p.pis_credit) + Number(p.cofins_credit);
              return (
                <Fragment key={p.id}>
                <tr className={sel.has(p.id) ? "bg-brand-light/30" : ""}>
                  <td className="td w-8"><input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} aria-label={`Selecionar ${p.sku}`} /></td>
                  <td className="td font-mono text-xs">{p.sku}</td>
                  <td className="td">
                    {p.name}
                    {p.grupo && (
                      <button type="button" className="ml-2 rounded bg-brand-light px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:underline" title={`Grupo: ${p.grupo}. Clique para ver só este grupo`} onClick={() => setGrupoFiltro(grupoFiltro === p.grupo ? null : p.grupo ?? null)}>
                        grupo · {p.grupo.length > 28 ? p.grupo.slice(0, 28) + "…" : p.grupo}
                      </button>
                    )}
                  </td>
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
                    {kitComposto ? (
                      <div title="Soma do custo das peças do kit. Atualiza sozinho quando o custo de uma peça mudar.">
                        <span className="font-medium">{brl(Number(p.cost_price))}</span>
                        <div className="font-mono text-[10px] text-emerald-700">soma das peças</div>
                      </div>
                    ) : (
                      <input
                        key={`c${p.id}${p.cost_price}`}
                        className="input w-24 py-1"
                        inputMode="decimal"
                        defaultValue={campo(Number(p.cost_price))}
                        onBlur={(e) => salvarCampo(p, "cost_price", e.target.value)}
                      />
                    )}
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
                      <span className="group relative">
                        <span className="cursor-default font-mono text-xs underline decoration-dotted">{anuncios[p.id] ?? 0}</span>
                        {(anunciosDoProduto[p.id]?.length ?? 0) > 0 && (
                          <span className="pointer-events-none absolute left-0 top-full z-40 hidden w-72 pt-1 group-hover:block">
                            <span className="block rounded-xl border border-slate-200 bg-white p-3 text-left text-xs shadow-xl">
                              {anunciosDoProduto[p.id].slice(0, 5).map((l) => {
                                const a = analisarAnuncio(l, p, empresas.find((c) => c.id === l.company_id) ?? empresas[0] ?? null, { pct: 12, fixo: 6 });
                                const roi = a && a.custo > 0 ? (a.lucro / a.custo) * 100 : null;
                                return (
                                  <span key={l.id} className="mb-2 block border-b border-slate-100 pb-2 last:mb-0 last:border-0 last:pb-0">
                                    <span className="block truncate font-mono text-[10px] text-slate-500">{l.external_id}</span>
                                    <span className="block">Preço do anúncio: <b>{brl(Number(l.price))}</b></span>
                                    {a ? (
                                      <span className="block">
                                        Sobra: <b className={a.lucro < 0 ? "text-red-700" : "text-emerald-700"}>{brl(a.lucro)}</b> · Margem: <b>{a.margem.toFixed(1).replace(".", ",")}%</b> · ROI: <b>{roi != null ? roi.toFixed(0) : "—"}%</b>
                                      </span>
                                    ) : (
                                      <span className="block text-slate-400">Sem custo cadastrado para calcular.</span>
                                    )}
                                  </span>
                                );
                              })}
                              {anunciosDoProduto[p.id].length > 5 && <span className="block text-[10px] text-slate-400">+ {anunciosDoProduto[p.id].length - 5} anúncios</span>}
                            </span>
                          </span>
                        )}
                      </span>
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
                    {ehKit && (
                      <button onClick={() => { setKitAberto(kitAberto === p.id ? null : p.id); setKitBusca(""); }} className="mr-3 text-xs font-semibold text-brand hover:underline">
                        Composição{pecas.length ? ` (${pecas.length})` : ""}
                      </button>
                    )}
                    <button onClick={() => abrirHistorico(p)} className="mr-3 text-xs text-brand hover:underline">Histórico</button>
                    <button onClick={() => remover(p)} className="text-xs text-red-700 hover:underline">Excluir</button>
                  </td>
                </tr>
                {kitAberto === p.id && (
                  <tr className="bg-brand-light/30">
                    <td className="td" colSpan={12}>
                      <div className="space-y-3 py-2">
                        <p className="text-sm font-semibold">Composição do kit {p.sku}</p>
                        <p className="text-xs text-slate-600">Escolha os produtos e a quantidade de cada um que entram neste kit. O custo do kit é a soma e se atualiza sozinho sempre que o custo de uma peça mudar (cada mudança fica no Histórico).</p>
                        {pecas.length > 0 && (
                          <table className="text-sm">
                            <thead>
                              <tr className="text-left text-xs text-slate-500">
                                <th className="pr-6 font-medium">Peça</th>
                                <th className="pr-6 font-medium">Quantidade</th>
                                <th className="pr-6 text-right font-medium">Custo un.</th>
                                <th className="pr-6 text-right font-medium">Subtotal</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {pecas.map((c) => {
                                const pc = prodPorId.get(c.component_id);
                                return (
                                  <tr key={c.id}>
                                    <td className="pr-6"><span className="font-mono text-xs">{pc?.sku}</span> · {pc?.name}</td>
                                    <td className="pr-6"><input key={`q${c.id}${c.quantity}`} className="input w-20 py-1" inputMode="decimal" defaultValue={campo(c.quantity)} onBlur={(e) => mudarQtdPeca(c, e.target.value)} /></td>
                                    <td className="pr-6 text-right">{brl(Number(pc?.cost_price ?? 0))}</td>
                                    <td className="pr-6 text-right font-medium">{brl(c.quantity * Number(pc?.cost_price ?? 0))}</td>
                                    <td><button onClick={() => removerPeca(c)} className="text-xs text-red-700 hover:underline">remover</button></td>
                                  </tr>
                                );
                              })}
                              <tr className="border-t border-slate-300">
                                <td className="pr-6 pt-1 font-semibold" colSpan={3}>Custo do kit</td>
                                <td className="pr-6 pt-1 text-right font-semibold">{brl(custoDoKit(p.id))}</td>
                                <td />
                              </tr>
                            </tbody>
                          </table>
                        )}
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="relative">
                            <label className="label">Adicionar peça</label>
                            <input className="input w-72 py-1" placeholder="Buscar SKU ou nome do produto" value={kitBusca} onChange={(e) => setKitBusca(e.target.value)} />
                            {kitBusca.trim() !== "" && (
                              <div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-96 overflow-y-auto rounded-2xl bg-white p-1 shadow-card ring-1 ring-slate-200">
                                {produtos
                                  .filter((x) => x.id !== p.id && tipoDe(x) !== "kit" && `${x.sku} ${x.name}`.toLowerCase().includes(kitBusca.trim().toLowerCase()))
                                  .slice(0, 12)
                                  .map((x) => (
                                    <button key={x.id} type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => adicionarPeca(p, x)}>
                                      <span className="font-mono text-xs">{x.sku}</span> · {x.name} <span className="text-slate-400">· {brl(Number(x.cost_price))}</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="label">Quantidade</label>
                            <input className="input w-20 py-1" inputMode="decimal" value={kitQtd} onChange={(e) => setKitQtd(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {aberto && (
                  <tr className="bg-slate-50">
                    <td className="td" colSpan={12}>
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
      {qtdLinhas < visiveis.length && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={() => setQtdLinhas((n) => n + 100)}>Mostrar mais 100 ({visiveis.length - qtdLinhas} restantes)</button>
          <span className="text-xs text-slate-500">Mostrando {qtdLinhas} de {visiveis.length}. Use a busca ou os filtros para achar direto.</span>
        </div>
      )}
      <p className="text-xs text-slate-500">Altere custo ou estoque direto na tabela; ao sair do campo, o valor é salvo. Mudar o custo vale só para as vendas daqui para frente: as vendas antigas guardam o custo da época. O botão Histórico mostra cada custo e a data em que passou a valer.</p>
    </div>
  );
}
