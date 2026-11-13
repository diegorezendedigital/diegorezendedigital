import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Listing, Product } from "@/lib/types";
import { calcularLucro, precoParaMargem, type EntradaPreco } from "@/lib/pricing";
import { entradaDoAnuncio } from "@/lib/anuncio";
import { freteML } from "./frete-ml";
import { mlGet, mlPost, taxaDoAnuncio } from "./ml";

// Motor único das promoções automáticas: decide se um convite do Mercado Livre vale a pena (margem mínima do SKU,
// com a taxa e o frete reais no preço da promoção e o bônus do ML) e entra do jeito que cada tipo de promoção exige.
// Usado pela rodada em segundo plano, pelos convites em tempo real (notificações) e pelos botões da tela.

export const MARGEM_MINIMA_PADRAO = 10; // % quando o SKU não define a própria

export type PromoML = { id: string; type: string; name?: string | null; status?: string | null; deadline_date?: string | null; finish_date?: string | null };
export type ItemPromoML = {
  id?: string;
  status?: string;
  price?: number | null;
  original_price?: number | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  offer_id?: string | null;
  stock?: { min?: number | null; max?: number | null } | null; // relâmpago: estoque que precisa ser reservado
};

// Como cada tipo aceita a entrada (seller-promotions v2):
// - oferta pronta do ML (offer_id "CANDIDATE-…", preço fixo): SMART, PRICE_MATCHING, PRE_NEGOTIATED, UNHEALTHY_STOCK, BANK
// - o vendedor escolhe o preço (deal_price, dentro da faixa): DEAL, SELLER_CAMPAIGN, DOD
// - só aceitar (o preço sai das porcentagens do ML e do vendedor): MARKETPLACE_CAMPAIGN
const TIPOS_COM_OFERTA = new Set(["SMART", "PRICE_MATCHING", "PRE_NEGOTIATED", "UNHEALTHY_STOCK", "BANK"]);
const TIPOS_COM_PRECO = new Set(["DEAL", "SELLER_CAMPAIGN", "DOD", "LIGHTNING"]);
const NAO_AUTOMATICOS: Record<string, string> = {
  LIGHTNING: "Oferta relâmpago reserva estoque: você decide na lista da promoção.",
  VOLUME: "Desconto por quantidade não tem um preço único para calcular a margem: você decide na lista da promoção.",
  SELLER_COUPON_CAMPAIGN: "Cupom do vendedor: configure direto no Mercado Livre.",
  PRICE_DISCOUNT: "Desconto criado por você: não é um convite.",
  PRICE_MATCHING_MELI_ALL: "O Mercado Livre ativa essa sozinho (100% por conta dele).",
};

export const precisaOferta = (tipo: string) => TIPOS_COM_OFERTA.has(tipo);
// Convites que não entram sozinhos, mas que você pode aceitar pela lista da promoção
export const paraVoceDecidir = (tipo: string) => tipo === "LIGHTNING" || tipo === "VOLUME";
export const motivoNaoAutomatico = (tipo: string): string | null => NAO_AUTOMATICOS[tipo] ?? null;

const centavos = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const porcento = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

// Corpo do POST /seller-promotions/items/{id} conforme o tipo
export function corpoDeEntrada(
  promo: { id: string; type: string },
  opcoes: { offerId?: string | null; preco?: number | null; temFaixa?: boolean; estoque?: number | null }
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { promotion_id: promo.id, promotion_type: promo.type };
  if (opcoes.offerId) corpo.offer_id = opcoes.offerId;
  const mandaPreco = opcoes.preco != null && opcoes.preco > 0 && (TIPOS_COM_PRECO.has(promo.type) || (!opcoes.offerId && opcoes.temFaixa));
  if (mandaPreco) corpo.deal_price = centavos(Number(opcoes.preco));
  // Oferta relâmpago: o Mercado Livre exige informar quantas unidades ficam reservadas para ela
  if (promo.type === "LIGHTNING") corpo.stock = Math.max(1, Math.floor(Number(opcoes.estoque) || 1));
  return corpo;
}

// A linha do anúncio dentro da promoção (com offer_id, faixa de preço e porcentagens), filtrando pelo item
export async function itemNaPromocao(token: string, promo: { id: string; type: string }, itemId: string): Promise<ItemPromoML | null> {
  const q = new URLSearchParams({ promotion_type: promo.type, item_id: itemId, app_version: "v2" });
  const r = await mlGet<{ results?: ItemPromoML[] }>(token, `/seller-promotions/promotions/${encodeURIComponent(promo.id)}/items?${q}`);
  return (r.results ?? []).find((x) => x.id === itemId) ?? null;
}

export type CacheML = { taxa: Map<string, { pct: number; fixo: number } | null>; frete: Map<string, number | null> };
export const novoCache = (): CacheML => ({ taxa: new Map(), frete: new Map() });

export type Decisao = {
  acao: "entrar" | "recusar";
  preco: number | null;
  margem: number | null;
  minimo: number;
  frete: number | null;
  taxa: number | null;
  bonus: number;
  lucro: number | null;
  corpo?: Record<string, unknown>;
  motivo: string;
};

type Avaliacao = {
  token: string;
  mlUserId: string;
  anuncio: Listing;
  produto: Product | undefined;
  empresa: Company | null;
  promo: PromoML;
  item: ItemPromoML;
  cache: CacheML;
};

export function margemMinimaDoSku(produto: Product | undefined): number {
  const v = produto?.promo_min_margin;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : MARGEM_MINIMA_PADRAO;
}

// Decide se entra e em que preço. Faixa de preço (o vendedor escolhe): o preço que entrega exatamente a margem mínima,
// conferindo a taxa e o frete reais do Mercado Livre nesse preço. Preço fixo (oferta pronta ou só aceite): entra se a margem chegar ao mínimo.
export async function avaliarConvite(a: Avaliacao): Promise<Decisao> {
  const { token, mlUserId, anuncio, produto, empresa, promo, item, cache } = a;
  const minimo = margemMinimaDoSku(produto);
  const base = { minimo, preco: null, margem: null, frete: null, taxa: null, lucro: null, bonus: 0 };

  const naoAuto = motivoNaoAutomatico(promo.type);
  if (naoAuto) return { ...base, acao: "recusar", motivo: naoAuto };

  const entrada = entradaDoAnuncio(anuncio, produto, empresa, Number(anuncio.fee_percent ?? 12), Number(anuncio.fee_fixed ?? 6));
  if (!entrada) return { ...base, acao: "recusar", motivo: "SKU sem custo cadastrado: cadastre o custo no armazém para a promoção automática decidir." };

  const original = Number(item.original_price) || Number(anuncio.price) || 0;
  const pctML = Number(item.meli_percentage) || 0;
  const pctVendedor = Number(item.seller_percentage) || 0;
  const bonus = pctML > 0 && original > 0 ? centavos((original * pctML) / 100) : 0;
  const offerId = item.offer_id || null;
  const faixaMin = item.min_discounted_price != null && Number(item.min_discounted_price) > 0 ? Number(item.min_discounted_price) : null;
  const faixaMax = item.max_discounted_price != null && Number(item.max_discounted_price) > 0 ? Number(item.max_discounted_price) : null;
  const temFaixa = !offerId && faixaMin != null && faixaMax != null && faixaMax >= faixaMin;

  // Taxa e frete reais do Mercado Livre em um preço (com cache por rodada)
  const realEm = async (preco: number): Promise<EntradaPreco> => {
    const kTaxa = `${anuncio.category_id ?? ""}|${anuncio.listing_type_id ?? ""}|${preco.toFixed(2)}`;
    const kFrete = `${anuncio.external_id}|${preco.toFixed(2)}`;
    const [taxa, frete] = await Promise.all([
      cache.taxa.has(kTaxa) ? Promise.resolve(cache.taxa.get(kTaxa) ?? null) : taxaDoAnuncio(token, preco, anuncio.category_id, anuncio.listing_type_id),
      cache.frete.has(kFrete) ? Promise.resolve(cache.frete.get(kFrete) ?? null) : freteML(token, mlUserId, anuncio.external_id, preco),
    ]);
    cache.taxa.set(kTaxa, taxa);
    cache.frete.set(kFrete, frete);
    return { ...entrada, feePct: taxa?.pct ?? entrada.feePct, feeFixo: taxa?.fixo ?? entrada.feeFixo, frete: frete ?? entrada.frete };
  };
  const contaEm = (preco: number, e: EntradaPreco) => {
    const r = calcularLucro(preco, e);
    const lucro = r.lucro + bonus;
    return { lucro, margem: preco > 0 ? (lucro / preco) * 100 : 0, taxa: r.taxaMarketplace, frete: e.frete };
  };
  const decisao = (acao: "entrar" | "recusar", preco: number, c: ReturnType<typeof contaEm>, motivo: string): Decisao => ({
    acao,
    preco: centavos(preco),
    margem: c.margem,
    minimo,
    frete: c.frete,
    taxa: c.taxa,
    bonus,
    lucro: c.lucro,
    motivo,
    ...(acao === "entrar" ? { corpo: corpoDeEntrada(promo, { offerId, preco, temFaixa }) } : {}),
  });
  const resumo = (preco: number, c: ReturnType<typeof contaEm>) =>
    `preço ${reais(preco)} · taxa ${reais(c.taxa)} · frete ${reais(c.frete)}${bonus > 0 ? ` · bônus ML ${reais(bonus)}` : ""} · lucro ${reais(c.lucro)}`;

  if (temFaixa) {
    // Busca o preço que entrega exatamente a margem; o frete e a taxa mudam por faixa de preço, então confere no ML e refaz a conta.
    // Se o preço cair numa faixa mais barata (ex.: abaixo de R$ 79, sem frete), desce até a margem exata nessa faixa.
    let e: EntradaPreco = entrada;
    let melhor: { preco: number; c: ReturnType<typeof contaEm> } | null = null;
    let ultimo: { preco: number; c: ReturnType<typeof contaEm> } | null = null;
    for (let volta = 0; volta < 4; volta++) {
      const alvo = precoParaMargem(minimo, { ...e, frete: Math.max(0, e.frete - bonus) });
      if (alvo == null) break;
      const preco = centavos(Math.min(Math.max(alvo, faixaMin as number), faixaMax as number));
      const real = await realEm(preco);
      const c = contaEm(preco, real);
      ultimo = { preco, c };
      if (c.margem >= minimo - 0.005) {
        if (!melhor || preco < melhor.preco) melhor = { preco, c };
        const deNovo = precoParaMargem(minimo, { ...real, frete: Math.max(0, real.frete - bonus) });
        if (deNovo == null || deNovo >= preco - 0.01 || preco <= (faixaMin as number) + 0.001) break;
      } else if (preco >= (faixaMax as number) - 0.001) {
        break;
      }
      e = real;
    }
    if (melhor) {
      const { preco, c } = melhor;
      const nota = preco <= (faixaMin as number) + 0.001 && c.margem > minimo + 0.05 ? " (no preço mínimo da promoção a margem já passa da meta)" : "";
      return decisao("entrar", preco, c, `Entrou a ${porcento(c.margem)} de margem (meta ${porcento(minimo)})${nota} · ${resumo(preco, c)}.`);
    }
    if (ultimo) {
      return decisao(
        "recusar",
        ultimo.preco,
        ultimo.c,
        `Nem no preço máximo da promoção (${reais(faixaMax as number)}) a margem chega a ${porcento(minimo)}: fica em ${porcento(ultimo.c.margem)}.`
      );
    }
    return { ...base, bonus, acao: "recusar", motivo: `Com essa taxa e esse frete a margem de ${porcento(minimo)} é impossível.` };
  }

  // Preço fixo: o da oferta; sem ele, o que sai das porcentagens do ML e do vendedor; para tipos em que o vendedor define, o sugerido
  let preco = Number(item.price) || 0;
  if (!(preco > 0) && TIPOS_COM_PRECO.has(promo.type)) preco = Number(item.suggested_discounted_price) || Number(item.max_discounted_price) || 0;
  if (!(preco > 0) && original > 0 && pctML + pctVendedor > 0) preco = original * (1 - (pctML + pctVendedor) / 100);
  if (!(preco > 0)) return { ...base, bonus, acao: "recusar", motivo: "O Mercado Livre não informou o preço desta promoção." };
  if (precisaOferta(promo.type) && !offerId) return { ...base, bonus, acao: "recusar", motivo: "O Mercado Livre não mandou a oferta (offer_id) deste convite: tente de novo mais tarde." };

  preco = centavos(preco);
  const c = contaEm(preco, await realEm(preco));
  if (c.margem < minimo - 0.005) {
    return decisao("recusar", preco, c, `No preço da promoção (${reais(preco)}) a margem fica em ${porcento(c.margem)}, abaixo da meta de ${porcento(minimo)}.`);
  }
  return decisao("entrar", preco, c, `Entrou a ${porcento(c.margem)} de margem (meta ${porcento(minimo)}) · ${resumo(preco, c)}.`);
}

export type LinhaAcao = {
  store_id: string;
  ml_user_id: string;
  item_id: string;
  promotion_id: string;
  promotion_type: string;
  promotion_name: string;
  price: number | null;
  margin: number | null;
  min_margin: number | null;
  status: "entrou" | "recusada" | "erro";
  message: string;
  updated_at: string;
  run_id?: string | null;
  origem?: string | null;
};

// Grava no log. Se o banco ainda não tem as colunas novas (SQL pendente), grava sem elas.
export async function gravarAcao(admin: SupabaseClient, linha: LinhaAcao): Promise<string | null> {
  const { error } = await admin.from("promo_actions").upsert(linha, { onConflict: "store_id,item_id,promotion_id" });
  if (!error) return null;
  if (/run_id|origem/i.test(error.message || "")) {
    const { run_id: _r, origem: _o, ...semExtras } = linha;
    const r2 = await admin.from("promo_actions").upsert(semExtras, { onConflict: "store_id,item_id,promotion_id" });
    return r2.error ? r2.error.message : null;
  }
  return error.message || "Erro ao gravar o log";
}

export type ResultadoConvite = { status: "entrou" | "recusada" | "erro"; mensagem: string; logErro: string | null };

// Avalia um convite, entra se valer a pena e registra no log. Nunca lança erro.
export async function decidirEEntrar(
  admin: SupabaseClient,
  a: Avaliacao & { storeId: string; runId?: string | null; origem: string }
): Promise<ResultadoConvite> {
  const linhaBase = {
    store_id: a.storeId,
    ml_user_id: a.mlUserId,
    item_id: a.anuncio.external_id,
    promotion_id: a.promo.id,
    promotion_type: a.promo.type,
    promotion_name: a.promo.name || a.promo.id,
    min_margin: margemMinimaDoSku(a.produto),
    run_id: a.runId ?? null,
    origem: a.origem,
  };
  let d: Decisao;
  try {
    d = await avaliarConvite(a);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao calcular a margem";
    const logErro = await gravarAcao(admin, { ...linhaBase, price: null, margin: null, status: "erro", message: msg, updated_at: new Date().toISOString() });
    return { status: "erro", mensagem: msg, logErro };
  }
  if (d.acao === "recusar") {
    const logErro = await gravarAcao(admin, { ...linhaBase, price: d.preco, margin: d.margem, status: "recusada", message: d.motivo, updated_at: new Date().toISOString() });
    return { status: "recusada", mensagem: d.motivo, logErro };
  }
  try {
    const resp = await mlPost<{ price?: number; offer_id?: string }>(a.token, `/seller-promotions/items/${encodeURIComponent(a.anuncio.external_id)}?app_version=v2`, d.corpo);
    const precoFinal = Number(resp?.price) > 0 ? Number(resp.price) : d.preco;
    const logErro = await gravarAcao(admin, { ...linhaBase, price: precoFinal, margin: d.margem, status: "entrou", message: d.motivo, updated_at: new Date().toISOString() });
    return { status: "entrou", mensagem: d.motivo, logErro };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao entrar na promoção";
    // "Candidate not valid": o convite expirou ou o anúncio deixou de ser elegível; não é falha do sistema
    if (/candidate not valid|invalid candidate/i.test(msg)) {
      const texto = "O Mercado Livre não aceitou o convite (Candidate not valid): ele expirou ou o anúncio deixou de ser elegível. Se voltar a ser convidado, entra na próxima aplicação.";
      const logErro = await gravarAcao(admin, { ...linhaBase, price: d.preco, margin: d.margem, status: "recusada", message: texto, updated_at: new Date().toISOString() });
      return { status: "recusada", mensagem: texto, logErro };
    }
    // Se o anúncio já está na promoção (entrou por outra rodada, por um convite em tempo real ou pela tela), não é erro
    const agora = await itemNaPromocao(a.token, a.promo, a.anuncio.external_id).catch(() => null);
    if (agora && ["started", "pending", "programmed"].includes(String(agora.status))) {
      const texto = `${d.motivo} (já estava na promoção)`;
      const logErro = await gravarAcao(admin, { ...linhaBase, price: Number(agora.price) > 0 ? Number(agora.price) : d.preco, margin: d.margem, status: "entrou", message: texto, updated_at: new Date().toISOString() });
      return { status: "entrou", mensagem: texto, logErro };
    }
    const logErro = await gravarAcao(admin, { ...linhaBase, price: d.preco, margin: d.margem, status: "erro", message: `O Mercado Livre recusou a entrada: ${msg}`, updated_at: new Date().toISOString() });
    return { status: "erro", mensagem: msg, logErro };
  }
}
