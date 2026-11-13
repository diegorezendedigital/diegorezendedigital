import type { SupabaseClient } from "@supabase/supabase-js";
import type { Listing, Product } from "@/lib/types";
import { calcularLucro, precoParaMargem } from "@/lib/pricing";
import { freteML } from "./frete-ml";
import { entradaDoAnuncio } from "@/lib/anuncio";
import { getAccessToken, listConnections, mlGet, mlPost } from "./ml";
import { carregarContexto } from "./reprice";

export const MARGEM_MINIMA_PADRAO = 10; // % — usada quando o anúncio não define a própria

export type ResumoPromo = { avaliados: number; entraram: number; recusados: number; erros: number; parcial: boolean; logErro?: string; totalPromos: number; concluidas: string[]; motivo?: string; inicioISO?: string };

type PromoBruta = { id?: string; type?: string; status?: string; name?: string; deadline_date?: string; finish_date?: string };
type ItemBruto = {
  id?: string;
  status?: string;
  price?: number;
  min_discounted_price?: number;
  max_discounted_price?: number;
  suggested_discounted_price?: number;
  original_price?: number;
  meli_percentage?: number;
  offer_id?: string;
  offers?: { id?: string; offer_id?: string }[];
};

// Para cada anúncio cujo SKU (produto do armazém) tem "promoção automática" ligada: se o Mercado Livre o convida para uma promoção e a margem no preço
// da promoção (taxa, frete, imposto e custo já descontados) atinge a margem mínima definida, ele entra sozinho.
// Entra no preço que entrega EXATAMENTE a margem definida (arredondada para cima, em centavos), usando o frete real do Mercado Livre
// naquele preço e o bônus do Mercado Livre da promoção. Se esse preço fica abaixo do mínimo permitido, entra no mínimo (margem maior);
// se fica acima do máximo permitido, a promoção não dá a margem e o anúncio fica de fora.
export async function rodarPromocoesAutomaticas(
  admin: SupabaseClient,
  storeId: string,
  limiteMs = 50000,
  // ja: promoções (conta:id) que uma chamada anterior desta mesma rodada já terminou; desde: início da rodada (pares já registrados nela não são refeitos)
  retomar: { ja?: string[]; desde?: string } = {}
): Promise<ResumoPromo> {
  const inicio = Date.now();
  const r: ResumoPromo = { avaliados: 0, entraram: 0, recusados: 0, erros: 0, parcial: false, totalPromos: 0, concluidas: [], inicioISO: retomar.desde ?? new Date(inicio).toISOString() };
  const jaFeitas = new Set(retomar.ja ?? []);
  const restante = () => limiteMs - (Date.now() - inicio);
  // Grava o log da participação e avisa se o banco recusou (ex.: tabela promo_actions ainda não criada)
  const gravarLog = async (linha: Record<string, unknown>, opcoes: { onConflict: string }) => {
    const { error } = await admin.from("promo_actions").upsert(linha, opcoes);
    if (error && !r.logErro) r.logErro = error.message;
  };

  const ctx = await carregarContexto(admin, storeId);
  // A regra é por SKU: o produto do armazém define se participa e qual a margem mínima (que pode ser negativa).
  const regra = (pid: string | null) => (pid ? (ctx.produtos.get(pid) as (Product & { promo_auto?: boolean; promo_min_margin?: number | null }) | undefined) : undefined);
  const { data } = await admin.from("listings").select("*").eq("store_id", storeId).eq("marketplace_id", "mercado_livre");
  const anuncios = ((data ?? []) as Listing[]).filter((a) => !!regra(a.product_id)?.promo_auto);
  if (!anuncios.length) {
    r.motivo = "Nenhum SKU está com “Promo auto” marcado e ligado a um anúncio do Mercado Livre.";
    return r;
  }
  const contas = await listConnections(storeId);
  // Pares anúncio+promoção que esta rodada já registrou (recusados/erros): não refaz ao continuar
  const feitosNaRodada = new Set<string>();
  if (retomar.desde) {
    const { data: reg } = await admin.from("promo_actions").select("item_id, promotion_id").eq("store_id", storeId).gte("updated_at", retomar.desde).limit(5000);
    ((reg ?? []) as { item_id: string; promotion_id: string }[]).forEach((x) => feitosNaRodada.add(`${x.item_id}|${x.promotion_id}`));
  }

  // Primeiro levanta as promoções abertas de cada conta, para saber o total (barra de progresso) antes de entrar em qualquer uma
  const planos: { conta: (typeof contas)[number]; meus: Map<string, Listing>; token: string; promos: PromoBruta[] }[] = [];
  for (const conta of contas) {
    const meus = new Map(anuncios.filter((a) => a.ml_user_id === conta.ml_user_id).map((a) => [a.external_id, a]));
    if (!meus.size) continue;
    let token: string | null = null;
    try {
      token = await getAccessToken(storeId, conta.ml_user_id);
    } catch {
      token = null;
    }
    if (!token) {
      r.erros++;
      r.motivo = `A conta ${conta.ml_user_id} está sem acesso ao Mercado Livre: reconecte em Integrações.`;
      continue;
    }
    let promos: PromoBruta[] = [];
    try {
      const resp = await mlGet<{ results?: PromoBruta[] } | PromoBruta[]>(token, `/seller-promotions/users/${conta.ml_user_id}?app_version=v2`);
      promos = Array.isArray(resp) ? resp : resp.results ?? [];
    } catch (e) {
      r.erros++;
      r.motivo = `Não consegui ler as promoções da conta ${conta.ml_user_id}: ${e instanceof Error ? e.message : "erro do Mercado Livre"}`;
      continue;
    }
    promos = promos.filter(
      (p) => p.id && p.type && (p.status === "started" || p.status === "pending" || p.status === "programmed") && !(p.deadline_date && new Date(p.deadline_date).getTime() < Date.now())
    );
    r.totalPromos += promos.length;
    planos.push({ conta, meus, token, promos });
  }

  for (const { conta, meus, token, promos } of planos) {
    for (const p of promos) {
      if (!p.id || !p.type) continue;
      const chave = `${conta.ml_user_id}:${p.id}`;
      if (jaFeitas.has(chave)) {
        r.concluidas.push(chave);
        continue;
      }

      let depois: string | null = null;
      for (let pagina = 0; pagina < 8; pagina++) {
        if (restante() < 8000) {
          r.parcial = true;
          return r;
        }
        const q = new URLSearchParams({ promotion_type: p.type, app_version: "v2", limit: "50" });
        if (depois) q.set("search_after", depois);
        let itens: ItemBruto[] = [];
        try {
          const resp = await mlGet<{ results?: ItemBruto[]; paging?: { searchAfter?: string; search_after?: string } }>(
            token,
            `/seller-promotions/promotions/${encodeURIComponent(p.id)}/items?${q}`
          );
          itens = resp.results ?? [];
          depois = resp.paging?.searchAfter ?? resp.paging?.search_after ?? null;
        } catch (e) {
          r.erros++;
          r.motivo = `Não consegui ler os anúncios da promoção ${p.name ?? p.id}: ${e instanceof Error ? e.message : "erro do Mercado Livre"}`;
          break;
        }

        for (const it of itens) {
          const a = it.id ? meus.get(it.id) : undefined;
          if (!a || it.status !== "candidate") continue;
          if (feitosNaRodada.has(`${a.external_id}|${p.id}`)) continue;
          r.avaliados++;

          const rg = regra(a.product_id);
          const minimo = rg?.promo_min_margin != null ? Number(rg.promo_min_margin) : MARGEM_MINIMA_PADRAO;
          const prod = a.product_id ? ctx.produtos.get(a.product_id) : undefined;
          const emp = (a.company_id && ctx.empresas.get(a.company_id)) || ctx.empresaPadrao;
          const entrada = entradaDoAnuncio(a, prod, emp || null, Number(a.fee_percent ?? 12), Number(a.fee_fixed ?? 6));
          const bonus = Number(it.meli_percentage) > 0 && Number(it.original_price) > 0 ? Math.round(Number(it.original_price) * Number(it.meli_percentage)) / 100 : 0;
          const faixaMin = it.min_discounted_price ?? null;
          const faixaMax = it.max_discounted_price ?? null;
          let preco: number | null = null;
          let freteUsado = entrada?.frete ?? 0;
          let inalcancavel = false;
          if (entrada) {
            if (faixaMin != null && faixaMax != null) {
              // Preço que dá a margem exata; o frete depende do preço, então confirma com o Mercado Livre e refaz até estabilizar
              let frete = entrada.frete;
              let alvo: number | null = null;
              for (let volta = 0; volta < 3; volta++) {
                alvo = precoParaMargem(minimo, { ...entrada, frete: Math.max(0, frete - bonus) });
                if (alvo == null) break;
                const real = await freteML(token, conta.ml_user_id, a.external_id, Math.min(Math.max(alvo, faixaMin), faixaMax));
                if (real == null || Math.abs(real - frete) < 0.005) {
                  if (real != null) frete = real;
                  break;
                }
                frete = real;
              }
              freteUsado = frete;
              if (alvo != null) {
                if (alvo > faixaMax + 0.001) preco = null;
                else preco = Math.min(Math.max(alvo, faixaMin), faixaMax);
              }
              if (preco == null) inalcancavel = true;
            } else {
              preco = it.max_discounted_price ?? it.suggested_discounted_price ?? it.price ?? null;
              if (preco != null && preco > 0) {
                const real = await freteML(token, conta.ml_user_id, a.external_id, preco);
                if (real != null) freteUsado = real;
              }
            }
          }
          const registro = {
            store_id: storeId,
            ml_user_id: conta.ml_user_id,
            item_id: a.external_id,
            promotion_id: p.id,
            promotion_type: p.type,
            promotion_name: p.name ?? p.id,
            min_margin: minimo,
            updated_at: new Date().toISOString(),
          };

          if (entrada && inalcancavel) {
            await gravarLog(
              { ...registro, status: "recusada", message: `Nem no preço máximo da promoção (${(faixaMax ?? 0).toFixed(2)}) a margem chega a ${minimo}%.` },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.recusados++;
            continue;
          }
          if (!entrada || preco == null || !(preco > 0)) {
            await gravarLog(
              { ...registro, status: "recusada", message: !entrada ? "Sem produto ligado ou sem custo cadastrado." : "O Mercado Livre não informou o preço da promoção." },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.recusados++;
            continue;
          }

          // Margem no preço escolhido, com o frete real desse preço e o bônus do Mercado Livre
          const base = calcularLucro(preco, { ...entrada, frete: freteUsado });
          const lucroFinal = base.lucro + bonus;
          const calc = { margem: preco > 0 ? (lucroFinal / preco) * 100 : 0 };
          if (calc.margem < minimo - 0.005) {
            await gravarLog(
              { ...registro, price: preco, margin: calc.margem, status: "recusada", message: `Margem de ${calc.margem.toFixed(1)}% abaixo do mínimo de ${minimo}%.` },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.recusados++;
            continue;
          }

          try {
            // Campanhas do tipo "Impulsione suas vendas" (SMART) trazem uma oferta pronta do Mercado Livre: exigem o offer_id e têm preço fixo
            const ofertaId = it.offer_id ?? it.offers?.[0]?.offer_id ?? it.offers?.[0]?.id;
            const corpo: Record<string, unknown> = { promotion_id: p.id, promotion_type: p.type };
            if (ofertaId) corpo.offer_id = ofertaId;
            if (!ofertaId || (faixaMin != null && faixaMax != null)) corpo.deal_price = Math.round(preco * 100) / 100;
            await mlPost(token, `/seller-promotions/items/${encodeURIComponent(a.external_id)}?app_version=v2`, corpo);
            await gravarLog(
              { ...registro, price: preco, margin: calc.margem, status: "entrou", message: `Entrou a ${calc.margem.toFixed(1).replace(".", ",")}% de margem (meta ${minimo}%) · preço R$ ${preco.toFixed(2).replace(".", ",")} · frete R$ ${freteUsado.toFixed(2).replace(".", ",")}${bonus > 0 ? ` · bônus ML R$ ${bonus.toFixed(2).replace(".", ",")}` : ""} · lucro R$ ${lucroFinal.toFixed(2).replace(".", ",")}.` },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.entraram++;
          } catch (e) {
            await gravarLog(
              { ...registro, price: preco, margin: calc.margem, status: "erro", message: e instanceof Error ? e.message : "Erro ao entrar na promoção" },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.erros++;
          }
        }
        if (!depois || itens.length === 0) break;
      }
      r.concluidas.push(chave);
    }
  }
  return r;
}
