"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { sincronizarVendas } from "@/lib/sincronizar";
import MarcaMP from "@/components/MarcaMP";
import { CANAIS, faixaDoPreco } from "@/lib/taxas-publicas";
import { Sale, brl, mensagemErro, pct } from "@/lib/types";

type Linha = {
  id: string;
  data: string;
  pedido: string;
  pack: string;
  produto: string;
  sku: string;
  uf: string;
  contaId: string;
  preco: number;
  comissao: number;
  comissaoPadrao: number; // comissão percentual padrão da faixa de preço (Shopee)
  taxaFixa: number; // parte fixa (R$) da tarifa, quando o marketplace informa (Shopee)
  mp: string;
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

// Ordenação da tabela: clique no título da coluna (1º clique: maior → menor; 2º: menor → maior; 3º: volta ao normal)
type ColOrdem = "data" | "produto" | "sku" | "uf" | "preco" | "repasse" | "comissao" | "frete" | "freteComprador" | "impostos" | "custo" | "sobra" | "margem" | "roi";
type Ordem = { col: ColOrdem; dir: "asc" | "desc" };
const ORDEM_PADRAO: Ordem = { col: "data", dir: "desc" };
const CANAL_SHOPEE = CANAIS.find((c) => c.id === "shopee")!;
// Comissão percentual padrão da Shopee para o preço do item (a tabela por faixa de preço)
const comissaoPadraoShopee = (preco: number, qtd: number) => (preco * faixaDoPreco(CANAL_SHOPEE, preco / Math.max(qtd, 1)).comissao) / 100;
const NOME_MP: Record<string, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee", tiktok_shop: "TikTok Shop" };
const COLUNAS_TEXTO = new Set<ColOrdem>(["produto", "sku", "uf"]);
const NOME_COLUNA: Record<ColOrdem, string> = {
  data: "data do pedido",
  produto: "produto",
  sku: "SKU",
  uf: "UF",
  preco: "venda",
  repasse: "repasse",
  comissao: "comissão",
  frete: "frete",
  freteComprador: "frete do comprador",
  impostos: "impostos",
  custo: "custo",
  sobra: "sobrou",
  margem: "margem de contribuição",
  roi: "ROI",
};
const sentido = (o: Ordem) =>
  o.col === "data" ? (o.dir === "desc" ? "mais recentes primeiro" : "mais antigos primeiro") : COLUNAS_TEXTO.has(o.col) ? (o.dir === "asc" ? "A → Z" : "Z → A") : o.dir === "desc" ? "maior para o menor" : "menor para o maior";
const soma = (l: Linha[], k: Chave) => l.reduce((a, x) => a + x[k], 0);

// Datas no horário de Brasília
const hojeBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
};
const primeiroDoMes = () => `${hojeBR().slice(0, 8)}01`;

const MP_ESTILO: Record<string, { sigla: string; cls: string }> = {
  "Mercado Livre": { sigla: "ML", cls: "bg-[#FFE600] text-[#333]" },
  Shopee: { sigla: "SH", cls: "bg-[#EE4D2D] text-white" },
  "TikTok Shop": { sigla: "TT", cls: "bg-[#111] text-white" },
};

const ID_MP: Record<string, string> = { "Mercado Livre": "mercado_livre", Shopee: "shopee", "TikTok Shop": "tiktok_shop" };

// Caixa de seleção da loja, com as lojas agrupadas por marketplace
// Caixa de seleção de lojas: marque uma ou várias; nenhuma marcada = todas
function SeletorLoja({ lojas, valor, onChange, rotulo = "Loja", textoTodas = "Todas as lojas", direita = false }: { lojas: { id: string; nome: string; mp: string }[]; valor: string[]; onChange: (ids: string[]) => void; rotulo?: string; textoTodas?: string; direita?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);
  const marcadas = lojas.filter((l) => valor.includes(l.id));
  const alternar = (ids: string[], ligar: boolean) => {
    const novo = new Set(valor);
    ids.forEach((id) => (ligar ? novo.add(id) : novo.delete(id)));
    // Todas marcadas é o mesmo que "todas as lojas"
    onChange(novo.size === lojas.length ? [] : Array.from(novo));
  };
  const mpsMarcados = Array.from(new Set(marcadas.map((l) => l.mp)));
  const linha = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50";
  return (
    <div className="relative" ref={ref}>
      <label className="label">{rotulo}</label>
      <button type="button" onClick={() => setAberto(!aberto)} aria-haspopup="listbox" aria-expanded={aberto} className="input flex h-[38px] w-60 items-center justify-between gap-2 py-0 text-left">
        <span className="flex min-w-0 items-center gap-2">
          {mpsMarcados.map((mp) => <MarcaMP key={mp} mp={ID_MP[mp] ?? "mercado_livre"} />)}
          <span className="truncate">{marcadas.length === 0 ? textoTodas : marcadas.length === 1 ? marcadas[0].nome : `${marcadas.length} lojas`}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-slate-400 transition-transform ${aberto ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div role="listbox" aria-multiselectable="true" className={`absolute ${direita ? "right-0" : "left-0"} top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl`}>
          <label className={`${linha} ${valor.length === 0 ? "bg-brand-light font-semibold text-brand" : ""}`}>
            <input type="checkbox" checked={valor.length === 0} onChange={() => onChange([])} />
            {textoTodas}
          </label>
          {["Mercado Livre", "Shopee", "TikTok Shop"].map((mp) => {
            const doMp = lojas.filter((x) => x.mp === mp);
            if (doMp.length === 0) return null;
            const ids = doMp.map((x) => x.id);
            const qtd = ids.filter((id) => valor.includes(id)).length;
            return (
              <div key={mp} className="mt-1.5 border-t border-slate-100 pt-1.5">
                <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600" title={`Marcar todas as lojas ${mp}`}>
                  <input type="checkbox" checked={qtd === ids.length} ref={(el) => { if (el) el.indeterminate = qtd > 0 && qtd < ids.length; }} onChange={(e) => alternar(ids, e.target.checked)} />
                  <MarcaMP mp={ID_MP[mp] ?? "mercado_livre"} tamanho={16} />
                  {mp}
                </label>
                {doMp.map((l) => {
                  const on = valor.includes(l.id);
                  return (
                    <label key={l.id} className={`${linha} pl-7 ${on ? "font-semibold text-brand" : ""}`}>
                      <input type="checkbox" checked={on} onChange={(e) => alternar([l.id], e.target.checked)} />
                      <span className="truncate">{l.nome}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
          <div className="mt-1.5 flex justify-end border-t border-slate-100 pt-1.5">
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand-light" onClick={() => setAberto(false)}>Pronto</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Janela para escolher quais lojas entram: marcar o marketplace marca todas as lojas dele
function ModalLojas({ titulo, lojas, onClose, onConfirmar }: { titulo: string; lojas: { id: string; nome: string; mp: string }[]; onClose: () => void; onConfirmar: (ids: string[]) => void }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(lojas.map((l) => l.id)));
  const grupos = ["Mercado Livre", "Shopee", "TikTok Shop"].map((mp) => ({ mp, itens: lojas.filter((l) => l.mp === mp) })).filter((g) => g.itens.length > 0);
  const todas = lojas.length > 0 && marcadas.size === lojas.length;
  const alternar = (ids: string[], ligar: boolean) =>
    setMarcadas((atual) => {
      const novo = new Set(atual);
      ids.forEach((id) => (ligar ? novo.add(id) : novo.delete(id)));
      return novo;
    });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const caixa = "h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#4F46E5]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-900">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>
        <div className="px-5 py-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-800">
            <input type="checkbox" className={caixa} checked={todas} onChange={(e) => alternar(lojas.map((l) => l.id), e.target.checked)} />
            Selecionar todas as lojas
          </label>
          {grupos.map((g) => {
            const ids = g.itens.map((l) => l.id);
            const qtd = ids.filter((id) => marcadas.has(id)).length;
            return (
              <div key={g.mp} className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-2 border-t border-slate-100 pt-4">
                <label className="flex w-40 cursor-pointer items-center gap-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className={caixa}
                    checked={qtd === ids.length}
                    ref={(el) => {
                      if (el) el.indeterminate = qtd > 0 && qtd < ids.length;
                    }}
                    onChange={(e) => alternar(ids, e.target.checked)}
                  />
                  {g.mp}
                </label>
                <div className="flex flex-1 flex-wrap gap-x-6 gap-y-2">
                  {g.itens.map((l) => (
                    <label key={l.id} className="flex min-w-[150px] cursor-pointer items-center gap-2.5 text-sm text-slate-800">
                      <input type="checkbox" className={caixa} checked={marcadas.has(l.id)} onChange={(e) => alternar([l.id], e.target.checked)} />
                      <span className="max-w-[200px] truncate" title={l.nome}>{l.nome}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" disabled={marcadas.size === 0} onClick={() => onConfirmar(todas ? [] : Array.from(marcadas))}>Sincronizar</button>
        </div>
      </div>
    </div>
  );
}

export default function PedidosPage() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [lojas, setLojas] = useState<{ id: string; nome: string; mp: string }[]>([]);
  const [erro, setErro] = useState("");
  const [de, setDe] = useState(hojeBR());
  const [ate, setAte] = useState(hojeBR());
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  // Loja (conta do Mercado Livre) escolhida: "" = todas juntas. A escolha fica lembrada neste navegador.
  const [lojaSel, setLojaSel] = useState<string[]>([]);
  const [soSemCusto, setSoSemCusto] = useState(false);
  // Lojas = contas do Mercado Livre conectadas (a tabela de conexões é protegida: vem pela API)
  useEffect(() => {
    // Mercado Livre e Shopee carregam juntas, para uma não apagar a outra
    const ml = apiFetch<{ accounts: { ml_user_id: string; nickname: string | null; store_name?: string | null }[] }>("/api/ml/accounts")
      .then((r) => r.accounts.map((c) => ({ id: String(c.ml_user_id), nome: c.store_name || c.nickname || String(c.ml_user_id), mp: "Mercado Livre" })))
      .catch(() => [] as { id: string; nome: string; mp: string }[]);
    const sh = apiFetch<{ accounts: { shop_id: string; shop_name: string | null; store_name?: string | null }[] }>("/api/shopee/accounts")
      .then((r) => (r.accounts ?? []).map((c) => ({ id: String(c.shop_id), nome: c.store_name || c.shop_name || String(c.shop_id), mp: "Shopee" })))
      .catch(() => [] as { id: string; nome: string; mp: string }[]);
    Promise.all([ml, sh]).then(([a, b]) => setLojas([...a.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")), ...b.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"))]));
  }, []);
  const nomeLoja = (id: string) => lojas.find((x) => x.id === id)?.nome ?? "";
  useEffect(() => {
    try {
      setLojaSel((localStorage.getItem("pedidos.loja") || "").split(",").filter(Boolean));
    } catch {
      /* navegador sem armazenamento */
    }
  }, []);
  const escolherLoja = (ids: string[]) => {
    setLojaSel(ids);
    try {
      localStorage.setItem("pedidos.loja", ids.join(","));
    } catch {
      /* ignora */
    }
  };
  // Pesquisa em todas as datas: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim().replace(/[,()%*]/g, " ").trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);
  const [ordem, setOrdem] = useState<Ordem>(ORDEM_PADRAO);
  useEffect(() => {
    try {
      const salva = JSON.parse(localStorage.getItem("pedidos.ordem") || "null") as Ordem | null;
      if (salva && salva.col in NOME_COLUNA && (salva.dir === "asc" || salva.dir === "desc")) setOrdem(salva);
    } catch {
      /* sem armazenamento local: ordem normal */
    }
  }, []);
  function ordenarPor(col: ColOrdem) {
    setOrdem((o) => {
      const primeira: Ordem["dir"] = COLUNAS_TEXTO.has(col) ? "asc" : "desc";
      const nova: Ordem = o.col !== col ? { col, dir: primeira } : o.dir === primeira ? { col, dir: primeira === "desc" ? "asc" : "desc" } : ORDEM_PADRAO;
      try {
        localStorage.setItem("pedidos.ordem", JSON.stringify(nova));
      } catch {
        /* ignora */
      }
      return nova;
    });
  }
  function ordemNormal() {
    setOrdem(ORDEM_PADRAO);
    try {
      localStorage.removeItem("pedidos.ordem");
    } catch {
      /* ignora */
    }
  }
  const [reprocessando, setReprocessando] = useState(false);
  const [modalLojas, setModalLojas] = useState<null | "pedidos" | "custos">(null);
  const [reprocessandoCustos, setReprocessandoCustos] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [fracaoProg, setFracaoProg] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [custoManual, setCustoManual] = useState("");
  const [senha, setSenha] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function reprocessar(lojaIds: string[]) {
    setErro("");
    setAviso("");
    setReprocessando(true);
    try {
      const dias = Math.min(90, Math.max(1, Math.ceil((Date.now() - new Date(`${de}T00:00:00-03:00`).getTime()) / 86400000) + 1));
      const r = await sincronizarVendas(dias, (t, f) => { setProgresso(t); if (f != null) setFracaoProg(f); }, lojaIds);
      if (r.contas === 0) setErro("Nenhuma loja conectada (Mercado Livre ou Shopee). Conecte em Integrações.");
      else setAviso(`Pedidos reprocessados: ${r.vendas} vendas novas ou completadas. O custo de vendas que já tinham custo não foi alterado.`);
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setReprocessando(false);
      setProgresso("");
      setFracaoProg(null);
    }
  }

  async function reprocessarCustos(lojaIds: string[]) {
    setErro("");
    setAviso("");
    setReprocessandoCustos(true);
    try {
      const r = await apiFetch<{ analisadas: number; reprocessadas: number; mantidas: number; manuais: number; semCusto: number; parcial: boolean }>("/api/vendas/reprocessar-custos", {
        method: "POST",
        body: JSON.stringify({ de, ate, lojas: lojaIds }),
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
      const r = await apiFetch<{ produto?: string; sku?: string | null }>("/api/vendas/custo", { method: "POST", body: JSON.stringify({ sale_id: l.id, custo: v, senha }) });
      setAviso(
        r.produto === "sim"
          ? `Custo salvo na venda e também no produto ${r.sku ?? ""} do armazém.`
          : r.produto === "ja_tinha_custo"
          ? `Custo salvo na venda. O produto ${r.sku ?? ""} já tinha custo no armazém, então ele não foi alterado.`
          : "Custo salvo na venda. Não achei produto do armazém ligado a ela (ligue em Anúncios Marketplace para atualizar o custo do produto)."
      );
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
      const [a, pr] = await Promise.all([
        supabase.from("listings").select("id, title, ml_user_id"),
        supabase.from("products").select("id, sku"),
      ]);
      const titulos = new Map<string, string>((a.data ?? []).map((x: { id: string; title: string }) => [x.id, x.title]));
      const skus = new Map<string, string>((pr.data ?? []).map((x: { id: string; sku: string }) => [x.id, x.sku]));
      // Venda antiga sem a conta gravada: usa a conta do anúncio
      const contaDoAnuncio = new Map<string, string>((a.data ?? []).filter((x: { ml_user_id?: string | null }) => x.ml_user_id).map((x: { id: string; ml_user_id: string }) => [x.id, x.ml_user_id]));
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
            contaId: s.ml_user_id || (s.listing_id && contaDoAnuncio.get(s.listing_id)) || "",
            preco,
            comissao: Number(s.fees_total) || 0,
            taxaFixa: Number(s.fees_fixed) || 0,
            comissaoPadrao: s.marketplace_id === "shopee" ? comissaoPadraoShopee(preco, Number(s.quantity) || 1) : 0,
            mp: s.marketplace_id || "mercado_livre",
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

  // Atualização automática: enquanto a aba estiver aberta e visível, busca os pedidos de hoje a cada 5 minutos.
  const [autoLigado, setAutoLigado] = useState(true);
  const [ultimaAuto, setUltimaAuto] = useState<Date | null>(null);
  const [rodandoAuto, setRodandoAuto] = useState(false);
  const ocupadoRef = useRef(false);
  ocupadoRef.current = reprocessando || reprocessandoCustos || rodandoAuto;
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;
  useEffect(() => {
    try { setAutoLigado(localStorage.getItem("pedidos_auto") !== "0"); } catch { /* sem armazenamento */ }
  }, []);
  useEffect(() => {
    if (!autoLigado) return;
    async function rodada() {
      if (ocupadoRef.current || document.visibilityState !== "visible") return;
      setRodandoAuto(true);
      try {
        await sincronizarVendas(1, () => {});
        setUltimaAuto(new Date());
        await carregarRef.current();
      } catch {
        /* falha silenciosa: tenta de novo na próxima rodada */
      } finally {
        setRodandoAuto(false);
      }
    }
    const t = setInterval(rodada, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [autoLigado]);

  const baseFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) => (lojaSel.length === 0 || lojaSel.includes(l.contaId)) && (!q || l.pedido.toLowerCase().includes(q) || l.pack.includes(q) || l.produto.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.uf.toLowerCase() === q));
  }, [linhas, busca, lojaSel]);
  // Pedidos (um pedido pode ter vários itens) que ainda têm alguma venda sem custo
  const pedidosSemCusto = useMemo(() => new Set(baseFiltrada.filter((l) => l.custo === 0).map((l) => l.pack || l.pedido)).size, [baseFiltrada]);
  const visiveis = useMemo(() => (soSemCusto ? baseFiltrada.filter((l) => l.custo === 0) : baseFiltrada), [baseFiltrada, soSemCusto]);

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
        taxaFixa: itens.reduce((t, i) => t + i.taxaFixa, 0),
        comissaoPadrao: itens.reduce((t, i) => t + i.comissaoPadrao, 0),
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

  // Pedidos na ordem escolhida; vazios (ROI sem custo, SKU em branco) ficam sempre por último
  const ordenados = useMemo(() => {
    type Grupo = (typeof grupos)[number];
    const valor = (g: Grupo): number | string | null => {
      switch (ordem.col) {
        case "data":
          return new Date(g.data).getTime();
        case "produto":
          return (g.produto || "").toLowerCase();
        case "sku":
          return (g.sku || "").toLowerCase();
        case "uf":
          return g.uf === "—" ? "" : g.uf;
        case "repasse":
          return g.preco - g.comissao - g.frete;
        case "roi":
          return g.roi;
        default:
          return g[ordem.col];
      }
    };
    const fator = ordem.dir === "asc" ? 1 : -1;
    return [...grupos].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const aVazio = va == null || va === "";
      const bVazio = vb == null || vb === "";
      if (aVazio || bVazio) return aVazio && bVazio ? 0 : aVazio ? 1 : -1;
      const r = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR", { numeric: true }) : (va as number) - (vb as number);
      return r !== 0 ? fator * r : new Date(b.data).getTime() - new Date(a.data).getTime();
    });
  }, [grupos, ordem]);

  // Título de coluna clicável para ordenar
  const cab = (col: ColOrdem, rotulo: string, espaco = "px-4 py-4", direita = false, dica?: string) => {
    const ativa = ordem.col === col;
    return (
      <th className={`${espaco} ${direita ? "text-right" : ""}`} title={dica} aria-sort={ativa ? (ordem.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => ordenarPor(col)}
          className={`inline-flex items-center gap-1 transition-colors hover:text-slate-900 ${ativa ? "text-slate-900" : ""}`}
          title={`Ordenar por ${NOME_COLUNA[col]}`}
        >
          {rotulo}
          <span className={`text-[10px] ${ativa ? "text-brand" : "text-slate-300"}`} aria-hidden="true">
            {ativa ? (ordem.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  const totalPreco = soma(visiveis, "preco");
  const totalCusto = soma(visiveis, "custo");
  const totalSobra = soma(visiveis, "sobra");
  const totalTaxa = soma(visiveis, "comissao");
  const totalFrete = soma(visiveis, "frete");
  const totalFreteComprador = soma(visiveis, "freteComprador");
  const totalImpostos = soma(visiveis, "impostos");
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
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500" title="Enquanto esta tela estiver aberta, os pedidos de hoje são buscados nos marketplaces a cada 5 minutos">
            <input type="checkbox" checked={autoLigado} onChange={(e) => { setAutoLigado(e.target.checked); try { localStorage.setItem("pedidos_auto", e.target.checked ? "1" : "0"); } catch { /* sem armazenamento */ } }} />
            Atualizar a cada 5 min
            {rodandoAuto ? <span className="text-brand">· atualizando…</span> : ultimaAuto ? <span>· última às {ultimaAuto.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span> : null}
          </label>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <button className="btn-ghost" onClick={() => setModalLojas("custos")} disabled={reprocessando || reprocessandoCustos} title="Recalcula o custo das vendas do período com o custo cadastrado na data de cada venda">
              {reprocessandoCustos ? "Reprocessando custos…" : "Reprocessar custos"}
            </button>
            <button className="btn" onClick={() => setModalLojas("pedidos")} disabled={reprocessando || reprocessandoCustos}>
              {reprocessando ? "Reprocessando…" : "Reprocessar pedidos"}
            </button>
          </div>
          {progresso && (
            <div className="w-80 max-w-full">
              {fracaoProg != null && (
                <div className="mb-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fracaoProg * 100)}>
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500" style={{ width: `${Math.max(3, fracaoProg * 100)}%` }} />
                  </div>
                  <span className="w-9 text-right font-mono text-[11px] font-semibold text-slate-700">{Math.round(fracaoProg * 100)}%</span>
                </div>
              )}
              <p className="truncate text-right font-mono text-[11px] text-slate-500">{progresso}</p>
            </div>
          )}
        </div>
      </div>
      {modalLojas && (
        <ModalLojas
          titulo={modalLojas === "pedidos" ? "Reprocessar pedidos" : "Reprocessar custos"}
          lojas={lojas}
          onClose={() => setModalLojas(null)}
          onConfirmar={(ids) => {
            const qual = modalLojas;
            setModalLojas(null);
            if (qual === "pedidos") reprocessar(ids);
            else reprocessarCustos(ids);
          }}
        />
      )}

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
        {lojas.length > 0 && <SeletorLoja lojas={lojas} valor={lojaSel} onChange={escolherLoja} />}
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
            { nome: "Custo dos produtos", valor: totalCusto, cor: "#D9D2F5" },
            { nome: "Taxa do marketplace", valor: totalTaxa, cor: "#B7A8FF" },
            { nome: "Frete pago por você", valor: totalFrete, cor: "#8E78FF" },
            { nome: "Impostos", valor: totalImpostos, cor: "#5B3DF5" },
            { nome: "Sobrou", valor: Math.max(0, totalSobra), cor: "#1D1840" },
          ]}
        />
      </div>

      {(
        <>
          {(pedidosSemCusto > 0 || soSemCusto) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <p>
                {pedidosSemCusto > 0 ? (
                  <>
                    Você tem <b>{pedidosSemCusto} {pedidosSemCusto === 1 ? "pedido" : "pedidos"}</b> sem ter informado o custo, então o lucro {pedidosSemCusto === 1 ? "dele aparece" : "deles aparece"} maior que o real.
                    Informe o custo na linha ou ligue o anúncio a um produto em Produtos &gt; Anúncios Marketplace e reprocesse os pedidos.
                  </>
                ) : (
                  <>Nenhum pedido sem custo neste período.</>
                )}
              </p>
              <button className={soSemCusto ? "btn" : "btn-ghost"} onClick={() => setSoSemCusto(!soSemCusto)}>
                {soSemCusto ? "Mostrar todos os pedidos" : "Ver só pedidos sem custo"}
              </button>
            </div>
          )}

          {(ordem.col !== ORDEM_PADRAO.col || ordem.dir !== ORDEM_PADRAO.dir) && (
            <p className="text-sm text-slate-600">
              Ordenado por <b>{NOME_COLUNA[ordem.col]}</b> ({sentido(ordem)}).{" "}
              <button type="button" className="font-medium text-brand underline" onClick={ordemNormal}>
                Voltar para os mais recentes
              </button>
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
                  <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
                    {cab("data", "Pedido", "px-5 py-4")}
                    {cab("produto", "Produto")}
                    {cab("sku", "SKU")}
                    {cab("uf", "UF")}
                    {cab("preco", "Venda", "px-4 py-4", true)}
                    {cab("repasse", "Repasse", "px-4 py-4", true, "Venda – comissão – frete: o que o marketplace libera para você")}
                    {cab("comissao", "Comissão", "px-4 py-4", true)}
                    {cab("frete", "Frete", "px-4 py-4", true)}
                    {cab("freteComprador", "Frete comprador", "px-4 py-4", true, "Informativo: não entra na conta do lucro")}
                    {cab("impostos", "Impostos", "px-4 py-4", true)}
                    {cab("custo", "Custo", "px-4 py-4", true)}
                    {cab("sobra", "Sobrou", "px-4 py-4", true)}
                    {cab("margem", "Margem contrib.", "px-4 py-4", true)}
                    {cab("roi", "ROI", "px-5 py-4", true)}
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map((l) => (
                    <Fragment key={l.id}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className="px-5 py-5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <MarcaMP mp={l.mp} />
                            <span className="font-mono text-sm">{l.pedido}</span>
                            {lojas.length > 1 && nomeLoja(l.contaId) && <span className="rounded bg-brand-light px-1.5 py-0.5 text-[10px] font-semibold text-brand">{nomeLoja(l.contaId)}</span>}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {new Date(l.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {lojas.length <= 1 && nomeLoja(l.contaId) ? ` · ${nomeLoja(l.contaId)}` : ""}
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
                                <Tip titulo={`Repasse · ${NOME_MP[l.mp] ?? "Marketplace"}`} linhas={[["Venda", brl(l.preco)], ["− Comissão" + (l.taxaFixa > 0 ? " + taxa fixa" : ""), brl(l.comissao)], ["− Frete (por sua conta)", brl(l.frete)], ["= Repasse", brl(rep)]]} nota={`Ainda não desconta imposto nem custo do produto. ${l.mp === "shopee" ? "Confere com o extrato do pedido na Shopee." : "Confere com o “Total” do Detalhe do recebimento do Mercado Livre."}`}>
                                  {brl(rep)}
                                  <Pc v={f(rep)} />
                                </Tip>
                              </td>
                              <td className="px-4 py-5 text-right">
                                <Tip
                                  titulo={`Comissão · ${NOME_MP[l.mp] ?? "Marketplace"}`}
                                  linhas={
                                    l.taxaFixa > 0
                                      ? [
                                          ["Comissão padrão", `${brl(l.comissaoPadrao)} · ${f(l.comissaoPadrao) ?? "—"}`],
                                          ["Taxa fixa", `${brl(l.taxaFixa)} · ${f(l.taxaFixa) ?? "—"}`],
                                          ["Demais taxas", `${brl(Math.max(0, l.comissao - l.comissaoPadrao - l.taxaFixa))} · ${f(Math.max(0, l.comissao - l.comissaoPadrao - l.taxaFixa)) ?? "—"}`],
                                          ["Total cobrado", `${brl(l.comissao)} · ${f(l.comissao) ?? "—"}`],
                                        ]
                                      : [[`Cobrado ${l.mp === "shopee" ? "pela" : "pelo"} ${NOME_MP[l.mp] ?? "marketplace"}`, brl(l.comissao)], ["% da venda", f(l.comissao) ?? "—"]]
                                  }
                                  nota={l.mp === "shopee" ? "Tarifa da Shopee: comissão padrão (por faixa de preço) + taxa fixa por item + demais taxas do extrato (serviço adicional, transação…)." : "Tarifa de venda do Mercado Livre (percentual + valor fixo por unidade, quando houver)."}
                                >
                                  {brl(l.comissao)}
                                  <Pc v={f(l.comissao)} />
                                  {l.taxaFixa > 0 && <div className="text-[11px] text-slate-500">fixa {brl(l.taxaFixa)} · demais {brl(Math.max(0, l.comissao - l.comissaoPadrao - l.taxaFixa))}</div>}
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
                                {l.pendente && editId === l.pendente.id && (
                                  <div className="ml-auto flex w-40 flex-col gap-1.5 text-left" onKeyDown={(e) => { if (e.key === "Enter") salvarCusto(l.pendente!); if (e.key === "Escape") setEditId(null); }}>
                                    <input autoFocus className="input py-1 text-right text-[13px]" inputMode="decimal" placeholder="Custo total (R$)" title="Custo total desta venda (custo × quantidade)" value={custoManual} onChange={(e) => setCustoManual(e.target.value)} />
                                    <input type="password" className="input py-1 text-[13px]" placeholder="Senha master" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} />
                                    <div className="flex gap-1.5">
                                      <button className="btn flex-1 !px-2 !py-1 text-xs" onClick={() => salvarCusto(l.pendente!)} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
                                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditId(null)}>Cancelar</button>
                                    </div>
                                  </div>
                                )}
                                {l.pendente && editId !== l.pendente.id && (
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
      <div className="text-[13px] font-medium text-slate-500">{t}</div>
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
        <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 180 180" className="h-40 w-40 -rotate-90" role="img" aria-label="Para onde vai o faturamento">
          {partes.map((p) => {
            const fatia = (p.valor / soma) * C;
            const el = <circle key={p.nome} cx="90" cy="90" r={R} fill="none" stroke={p.cor} strokeWidth="24" strokeDasharray={`${fatia} ${C - fatia}`} strokeDashoffset={-acumulado} />;
            acumulado += fatia;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold">{total > 0 ? pct((partes[partes.length - 1].valor / total) * 100) : "—"}</span>
          <span className="text-xs text-slate-500">sobrou</span>
        </div>
        </div>
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
