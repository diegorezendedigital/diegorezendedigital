import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Listing, Product } from "@/lib/types";
import { mlDelete, mlGet, mlPost } from "./ml";
import {
  avaliarConvite,
  corpoDeEntrada,
  gravarAcao,
  itemNaPromocao,
  margemMinimaDoSku,
  precisaOferta,
  type CacheML,
  type ItemPromoML,
  type PromoML,
} from "./promocoes-motor";

// Revisão das promoções do Mercado Livre em que o anúncio JÁ ESTÁ, com o custo atual do SKU:
// - promoção em que o vendedor escolhe o preço: se a margem saiu da meta, sai e entra de novo no preço que dá a margem mínima
//   (se a nova entrada for recusada, volta no preço anterior);
// - promoção com preço definido pelo Mercado Livre: se a margem ficou abaixo da mínima, sai.

type PromoDoItem = { id?: string; type?: string; status?: string; price?: number; original_price?: number; name?: string | null; offer_id?: string | null };

const ATIVOS = ["started", "pending", "programmed"];
const IGNORAR = new Set(["PRICE_DISCOUNT", "LIGHTNING", "VOLUME", "SELLER_COUPON_CAMPAIGN", "PRICE_MATCHING_MELI_ALL"]);
const TIPOS_COM_PRECO = new Set(["DEAL", "SELLER_CAMPAIGN", "DOD"]);
const TOLERANCIA_PP = 0.5; // pontos de margem: dentro disso o preço atual é mantido
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const porcento = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export type ResultadoRevisao = { reajustados: number; sairam: number; mantidos: number; erros: number; ultimoErro: string | null; logErro: string | null };

export async function revisarParticipacoes(
  admin: SupabaseClient,
  a: { token: string; mlUserId: string; anuncio: Listing; produto: Product | undefined; empresa: Company | null; cache: CacheML; storeId: string; runId: string; origem: string }
): Promise<ResultadoRevisao> {
  const res: ResultadoRevisao = { reajustados: 0, sairam: 0, mantidos: 0, erros: 0, ultimoErro: null, logErro: null };
  const id = a.anuncio.external_id;
  const minimo = margemMinimaDoSku(a.produto);
  const r = await mlGet<PromoDoItem[] | { results?: PromoDoItem[] }>(a.token, `/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`);
  const lista = (Array.isArray(r) ? r : r?.results ?? []).filter((p) => p.id && p.type && ATIVOS.includes(String(p.status)) && !IGNORAR.has(String(p.type)));

  for (const p of lista) {
    const promo: PromoML = { id: String(p.id), type: String(p.type), name: p.name ?? null };
    const linha = await itemNaPromocao(a.token, promo, id).catch(() => null);
    const atual = Number(linha?.price) || Number(p.price) || 0;
    if (!(atual > 0)) continue;
    const offerId = linha?.offer_id ?? p.offer_id ?? null;
    const base = {
      store_id: a.storeId, ml_user_id: a.mlUserId, item_id: id, promotion_id: promo.id, promotion_type: promo.type,
      promotion_name: promo.name || promo.id, min_margin: minimo, run_id: a.runId, origem: a.origem,
    };
    const log = async (status: "entrou" | "recusada" | "erro", price: number | null, margin: number | null, message: string) => {
      const e = await gravarAcao(admin, { ...base, price, margin, status, message, updated_at: new Date().toISOString() });
      if (e) res.logErro = e;
    };
    const avaliar = (item: ItemPromoML) => avaliarConvite({ token: a.token, mlUserId: a.mlUserId, anuncio: a.anuncio, produto: a.produto, empresa: a.empresa, promo, item, cache: a.cache });

    try {
      // Margem no preço em que o anúncio está hoje, com o custo atual
      const noAtual = await avaliar({ ...(linha ?? {}), price: atual, min_discounted_price: null, max_discounted_price: null, offer_id: offerId });
      if (noAtual.margem == null) continue; // sem custo cadastrado: não há como revisar
      const margemAtual = noAtual.margem;

      const escolhePreco = TIPOS_COM_PRECO.has(promo.type) && !offerId;
      const sair = async (motivo: string) => {
        const q = new URLSearchParams({ promotion_type: promo.type, promotion_id: promo.id, app_version: "v2" });
        if (offerId) q.set("offer_id", offerId);
        await mlDelete(a.token, `/seller-promotions/items/${encodeURIComponent(id)}?${q}`);
        res.sairam++;
        await log("recusada", atual, margemAtual, motivo);
      };

      if (!escolhePreco) {
        // Preço definido pelo Mercado Livre: só dá para ficar ou sair
        if (margemAtual < minimo - 0.005) {
          await sair(`Saiu da promoção: com o custo atual, no preço da promoção (${reais(atual)}) a margem caiu para ${porcento(margemAtual)}, abaixo da mínima de ${porcento(minimo)}.`);
        } else res.mantidos++;
        continue;
      }

      // Vendedor escolhe o preço: preço que dá exatamente a margem mínima dentro da faixa da promoção
      if (Math.abs(margemAtual - minimo) <= TOLERANCIA_PP) {
        res.mantidos++;
        continue;
      }
      const alvo = await avaliar({ ...(linha ?? {}), offer_id: null });
      if (alvo.acao !== "entrar" || alvo.preco == null) {
        if (margemAtual < minimo - 0.005) await sair(`Saiu da promoção: com o custo atual nem no maior preço permitido a margem chega a ${porcento(minimo)} (no preço de ${reais(atual)} fica em ${porcento(margemAtual)}).`);
        else res.mantidos++;
        continue;
      }
      if (Math.abs(alvo.preco - atual) < 0.05) {
        res.mantidos++;
        continue;
      }

      // Reajuste: sai e entra de novo no preço novo; se o Mercado Livre recusar, volta no preço anterior
      const q = new URLSearchParams({ promotion_type: promo.type, promotion_id: promo.id, app_version: "v2" });
      await mlDelete(a.token, `/seller-promotions/items/${encodeURIComponent(id)}?${q}`);
      const urlEntrar = `/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`;
      try {
        await mlPost(a.token, urlEntrar, corpoDeEntrada(promo, { preco: alvo.preco, temFaixa: true }));
        res.reajustados++;
        await log("entrou", alvo.preco, alvo.margem,
          `Preço reajustado pelo custo atual: de ${reais(atual)} (margem ${porcento(margemAtual)}) para ${reais(alvo.preco)} (margem ${porcento(alvo.margem ?? minimo)}, meta ${porcento(minimo)}).`);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : "erro do Mercado Livre";
        try {
          await mlPost(a.token, urlEntrar, corpoDeEntrada(promo, { preco: atual, temFaixa: true }));
          res.erros++;
          res.ultimoErro = `${id} em “${base.promotion_name}”: o Mercado Livre recusou o preço novo (${motivo}); voltei ao preço anterior.`;
          await log("erro", atual, margemAtual, `Não consegui reajustar para ${reais(alvo.preco)} (${motivo}). Voltei ao preço anterior de ${reais(atual)}.`);
        } catch (e2) {
          res.erros++;
          const m2 = e2 instanceof Error ? e2.message : "erro do Mercado Livre";
          res.ultimoErro = `${id} saiu de “${base.promotion_name}” e não consegui voltar: ${m2}`;
          await log("erro", atual, margemAtual, `Saí para reajustar o preço e o Mercado Livre não aceitou a volta (${motivo}; ${m2}). Confira esta promoção no Mercado Livre.`);
        }
      }
    } catch (e) {
      res.erros++;
      res.ultimoErro = `${id} em “${base.promotion_name}”: ${e instanceof Error ? e.message : "erro do Mercado Livre"}`;
    }
  }
  return res;
}
