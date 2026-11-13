import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Listing, Product } from "@/lib/types";
import { getAccessToken, mlGet } from "./ml";
import { decidirEEntrar, itemNaPromocao, motivoNaoAutomatico, novoCache, type PromoML } from "./promocoes-motor";

// Convites em tempo real: o Mercado Livre avisa (tópico public_candidates) quando um anúncio é convidado para uma promoção.
// Se o SKU tem "Promo auto", o sistema decide e entra na hora, sem esperar a próxima rodada.

export type Notificacao = { id?: string; store_id: string; ml_user_id: string; topic: string; resource: string };

type InfoConvite = { item_id?: string; promotion_id?: string; type?: string; status?: string | { id?: string } };

const situacao = (s: InfoConvite["status"]) => (typeof s === "string" ? s : s?.id ?? "").toLowerCase();

async function lerRecurso(token: string, topic: string, resource: string): Promise<InfoConvite | null> {
  const prefixo = topic === "public_offers" ? "OFFER" : "CANDIDATE";
  const codigo = resource.match(new RegExp(`${prefixo}-[A-Z]{3}\\d+-[\\w-]+`, "i"))?.[0];
  const caminhos: string[] = [];
  if (codigo) caminhos.push(`/seller-promotions/${topic === "public_offers" ? "offers" : "candidates"}/${encodeURIComponent(codigo)}?app_version=v2`);
  if (resource.startsWith("/")) caminhos.push(`${resource}${resource.includes("?") ? "&" : "?"}app_version=v2`);
  for (const caminho of caminhos) {
    try {
      const r = await mlGet<InfoConvite>(token, caminho);
      if (r?.item_id && r?.promotion_id) return r;
    } catch {
      /* tenta o próximo formato */
    }
  }
  return null;
}

// O código do convite/oferta já traz o anúncio (CANDIDATE-MLB123-…): dá para descartar sem chamar o Mercado Livre
async function foraDaAutomacao(admin: SupabaseClient, n: Notificacao): Promise<string | null> {
  const item = n.resource.match(/(?:CANDIDATE|OFFER)-([A-Z]{3}\d+)-/i)?.[1]?.toUpperCase();
  if (!item) return null;
  const { data: l } = await admin.from("listings").select("product_id").eq("store_id", n.store_id).eq("external_id", item).maybeSingle();
  const productId = (l as { product_id?: string | null } | null)?.product_id;
  if (!l) return n.topic === "public_offers" ? `Oferta de ${item} (anúncio fora do sistema).` : null;
  if (!productId) return `Anúncio ${item} sem SKU do armazém ligado.`;
  const { data: p } = await admin.from("products").select("promo_auto, promo_min_margin, sku").eq("id", productId).maybeSingle();
  const prod = p as { promo_auto?: boolean; promo_min_margin?: number | null; sku?: string | null } | null;
  return prod?.promo_auto && prod.promo_min_margin != null ? null : `SKU ${prod?.sku ?? item} sem “Promo auto” e margem definida: nada a fazer.`;
}

// Processa uma notificação e devolve um texto curto do que aconteceu (gravado em ml_notificacoes.resultado)
export async function processarNotificacao(admin: SupabaseClient, n: Notificacao): Promise<string> {
  const descartada = await foraDaAutomacao(admin, n);
  if (descartada) return descartada;
  const token = await getAccessToken(n.store_id, n.ml_user_id).catch(() => null);
  if (!token) return "Conta sem acesso ao Mercado Livre: reconecte em Integrações.";
  const info = await lerRecurso(token, n.topic, n.resource);
  if (!info?.item_id || !info.promotion_id || !info.type) return "Não consegui ler o convite no Mercado Livre.";
  if (n.topic === "public_offers") return `Oferta ${situacao(info.status) || "atualizada"}: ${info.item_id} em ${info.promotion_id}.`;
  if (situacao(info.status) && situacao(info.status) !== "candidate") return `Convite já não está aberto (${situacao(info.status)}).`;

  const { data: anuncio } = await admin
    .from("listings")
    .select("*")
    .eq("store_id", n.store_id)
    .eq("external_id", info.item_id)
    .maybeSingle();
  const a = anuncio as Listing | null;
  if (!a) return `Anúncio ${info.item_id} ainda não está no sistema (entra na próxima rodada depois de importado).`;
  if (!a.product_id) return `Anúncio ${info.item_id} sem SKU do armazém ligado.`;
  const { data: prod } = await admin.from("products").select("*").eq("id", a.product_id).maybeSingle();
  const produto = prod as Product | null;
  if (!produto?.promo_auto || produto.promo_min_margin == null) return `SKU ${produto?.sku ?? info.item_id} sem “Promo auto” e margem definida: nada a fazer.`;

  // Já entrou antes nesta promoção? Não repete.
  const { data: ja } = await admin
    .from("promo_actions")
    .select("status")
    .eq("store_id", n.store_id)
    .eq("item_id", info.item_id)
    .eq("promotion_id", info.promotion_id)
    .maybeSingle();
  if ((ja as { status?: string } | null)?.status === "entrou") return "Já tinha entrado nesta promoção.";

  let promo: PromoML = { id: info.promotion_id, type: info.type, name: info.promotion_id };
  try {
    const q = new URLSearchParams({ promotion_type: info.type, app_version: "v2" });
    const det = await mlGet<PromoML>(token, `/seller-promotions/promotions/${encodeURIComponent(info.promotion_id)}?${q}`);
    promo = { ...promo, name: det?.name || promo.name, status: det?.status ?? null, deadline_date: det?.deadline_date ?? null };
  } catch {
    /* sem o nome: usa o código */
  }
  const manual = motivoNaoAutomatico(info.type);
  const item = manual ? { id: info.item_id, status: "candidate" } : await itemNaPromocao(token, promo, info.item_id).catch(() => null);
  if (!item) return "O Mercado Livre não devolveu os dados do convite.";
  if (item.status && item.status !== "candidate") return `Convite já não está aberto (${item.status}).`;

  const { data: emps } = await admin.from("companies").select("*").eq("store_id", n.store_id);
  const empresas = (emps ?? []) as Company[];
  const empresa = empresas.find((x) => x.id === a.company_id) ?? empresas.find((x) => x.is_default) ?? null;
  const r = await decidirEEntrar(admin, {
    token,
    mlUserId: n.ml_user_id,
    anuncio: a,
    produto,
    empresa,
    promo,
    item,
    cache: novoCache(),
    storeId: n.store_id,
    runId: null,
    origem: "notificacao",
  });
  const rotulo = r.status === "entrou" ? "Entrou" : r.status === "recusada" ? "Ficou de fora" : "Erro";
  return `${rotulo}: ${info.item_id} em “${promo.name}”. ${r.mensagem}`.slice(0, 500);
}

// Notificações que não foram processadas na hora (a função caiu, o ML demorou): tenta de novo, até 5 vezes
export async function reprocessarPendentes(admin: SupabaseClient, limite = 20, prazoMs = 25_000): Promise<number> {
  const inicio = Date.now();
  const antes = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data, error } = await admin
    .from("ml_notificacoes")
    .select("id, store_id, ml_user_id, topic, resource, tentativas")
    .is("processada_em", null)
    .lt("recebida_em", antes)
    .lt("tentativas", 5)
    .order("recebida_em")
    .limit(limite);
  if (error) return 0;
  let feitas = 0;
  for (const n of (data ?? []) as (Notificacao & { id: string; tentativas: number })[]) {
    if (Date.now() - inicio > prazoMs) break;
    await admin.from("ml_notificacoes").update({ tentativas: (n.tentativas || 0) + 1 }).eq("id", n.id);
    try {
      const resultado = await processarNotificacao(admin, n);
      await admin.from("ml_notificacoes").update({ processada_em: new Date().toISOString(), resultado }).eq("id", n.id);
      feitas++;
    } catch (e) {
      await admin.from("ml_notificacoes").update({ resultado: e instanceof Error ? e.message.slice(0, 300) : "erro" }).eq("id", n.id);
    }
  }
  return feitas;
}
