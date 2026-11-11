import type { SupabaseClient } from "@supabase/supabase-js";
import type { Listing, Product } from "@/lib/types";
import { calcularLucro } from "@/lib/pricing";
import { entradaDoAnuncio } from "@/lib/anuncio";
import { getAccessToken, listConnections, mlGet, mlPost } from "./ml";
import { carregarContexto } from "./reprice";

export const MARGEM_MINIMA_PADRAO = 10; // % — usada quando o anúncio não define a própria

export type ResumoPromo = { avaliados: number; entraram: number; recusados: number; erros: number; parcial: boolean };

type PromoBruta = { id?: string; type?: string; status?: string; name?: string; deadline_date?: string; finish_date?: string };
type ItemBruto = {
  id?: string;
  status?: string;
  price?: number;
  min_discounted_price?: number;
  max_discounted_price?: number;
  suggested_discounted_price?: number;
};

// Para cada anúncio cujo SKU (produto do armazém) tem "promoção automática" ligada: se o Mercado Livre o convida para uma promoção e a margem no preço
// da promoção (taxa, frete, imposto e custo já descontados) atinge a margem mínima definida, ele entra sozinho.
// Entra sempre no MAIOR preço permitido (menor desconto), que é o que mais protege a margem.
export async function rodarPromocoesAutomaticas(admin: SupabaseClient, storeId: string, limiteMs = 50000): Promise<ResumoPromo> {
  const inicio = Date.now();
  const r: ResumoPromo = { avaliados: 0, entraram: 0, recusados: 0, erros: 0, parcial: false };
  const restante = () => limiteMs - (Date.now() - inicio);

  const ctx = await carregarContexto(admin, storeId);
  // A regra é por SKU: o produto do armazém define se participa e qual a margem mínima (que pode ser negativa).
  const regra = (pid: string | null) => (pid ? (ctx.produtos.get(pid) as (Product & { promo_auto?: boolean; promo_min_margin?: number | null }) | undefined) : undefined);
  const { data } = await admin.from("listings").select("*").eq("store_id", storeId).eq("marketplace_id", "mercado_livre");
  const anuncios = ((data ?? []) as Listing[]).filter((a) => !!regra(a.product_id)?.promo_auto);
  if (!anuncios.length) return r;
  const contas = await listConnections(storeId);

  for (const conta of contas) {
    const meus = new Map(anuncios.filter((a) => a.ml_user_id === conta.ml_user_id).map((a) => [a.external_id, a]));
    if (!meus.size) continue;
    let token: string | null = null;
    try {
      token = await getAccessToken(storeId, conta.ml_user_id);
    } catch {
      token = null;
    }
    if (!token) continue;

    let promos: PromoBruta[] = [];
    try {
      const resp = await mlGet<{ results?: PromoBruta[] } | PromoBruta[]>(token, `/seller-promotions/users/${conta.ml_user_id}?app_version=v2`);
      promos = Array.isArray(resp) ? resp : resp.results ?? [];
    } catch {
      r.erros++;
      continue;
    }

    for (const p of promos) {
      if (!p.id || !p.type) continue;
      if (p.status !== "started" && p.status !== "pending" && p.status !== "programmed") continue;
      if (p.deadline_date && new Date(p.deadline_date).getTime() < Date.now()) continue;

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
        } catch {
          r.erros++;
          break;
        }

        for (const it of itens) {
          const a = it.id ? meus.get(it.id) : undefined;
          if (!a || it.status !== "candidate") continue;
          r.avaliados++;

          const preco = it.max_discounted_price ?? it.suggested_discounted_price ?? it.price ?? null;
          const rg = regra(a.product_id);
          const minimo = rg?.promo_min_margin != null ? Number(rg.promo_min_margin) : MARGEM_MINIMA_PADRAO;
          const prod = a.product_id ? ctx.produtos.get(a.product_id) : undefined;
          const emp = (a.company_id && ctx.empresas.get(a.company_id)) || ctx.empresaPadrao;
          const entrada = entradaDoAnuncio(a, prod, emp || null, Number(a.fee_percent ?? 12), Number(a.fee_fixed ?? 6));
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

          if (!entrada || preco == null || !(preco > 0)) {
            await admin.from("promo_actions").upsert(
              { ...registro, status: "recusada", message: !entrada ? "Sem produto ligado ou sem custo cadastrado." : "O Mercado Livre não informou o preço da promoção." },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.recusados++;
            continue;
          }

          const calc = calcularLucro(preco, entrada);
          if (calc.margem < minimo) {
            await admin.from("promo_actions").upsert(
              { ...registro, price: preco, margin: calc.margem, status: "recusada", message: `Margem de ${calc.margem.toFixed(1)}% abaixo do mínimo de ${minimo}%.` },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.recusados++;
            continue;
          }

          try {
            await mlPost(token, `/seller-promotions/items/${encodeURIComponent(a.external_id)}?app_version=v2`, {
              promotion_id: p.id,
              promotion_type: p.type,
              deal_price: Math.round(preco * 100) / 100,
            });
            await admin.from("promo_actions").upsert(
              { ...registro, price: preco, margin: calc.margem, status: "entrou", message: `Entrou a ${calc.margem.toFixed(1)}% de margem (mínimo ${minimo}%).` },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.entraram++;
          } catch (e) {
            await admin.from("promo_actions").upsert(
              { ...registro, price: preco, margin: calc.margem, status: "erro", message: e instanceof Error ? e.message : "Erro ao entrar na promoção" },
              { onConflict: "store_id,item_id,promotion_id" }
            );
            r.erros++;
          }
        }
        if (!depois || itens.length === 0) break;
      }
    }
  }
  return r;
}
