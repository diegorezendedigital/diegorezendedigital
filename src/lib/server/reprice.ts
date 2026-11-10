import type { SupabaseClient } from "@supabase/supabase-js";
import { Company, Listing, Product } from "@/lib/types";
import { precoParaMargem, calcularLucro, EntradaPreco } from "@/lib/pricing";
import { entradaDoAnuncio as entradaBase } from "@/lib/anuncio";
import { mlPut, taxaDoAnuncio } from "./ml";

// Quanto o preço pode mudar de uma vez (proteção contra erro de cadastro, como custo digitado errado).
export const VARIACAO_MAXIMA = 0.2;

export type ResultadoPreco = {
  listing_id: string;
  external_id: string;
  title: string;
  status: "aplicado" | "sugerido" | "sem_mudanca" | "ignorado" | "erro";
  old_price: number;
  new_price?: number;
  margem_atual?: number;
  motivo?: string;
};

export type ContextoLoja = {
  produtos: Map<string, Product>;
  empresas: Map<string, Company>;
  empresaPadrao: Company | null;
};

export async function carregarContexto(admin: SupabaseClient, storeId: string): Promise<ContextoLoja> {
  const [p, c] = await Promise.all([
    admin.from("products").select("*").eq("store_id", storeId),
    admin.from("companies").select("*").eq("store_id", storeId),
  ]);
  const empresas = (c.data ?? []) as Company[];
  return {
    produtos: new Map(((p.data ?? []) as Product[]).map((x) => [x.id, x])),
    empresas: new Map(empresas.map((x) => [x.id, x])),
    empresaPadrao: empresas.find((x) => x.is_default) ?? null,
  };
}

function entradaDoAnuncio(l: Listing, ctx: ContextoLoja, feePct: number, feeFixo: number): EntradaPreco | null {
  const prod = l.product_id ? ctx.produtos.get(l.product_id) : undefined;
  const emp = (l.company_id && ctx.empresas.get(l.company_id)) || ctx.empresaPadrao;
  return entradaBase(l, prod, emp || null, feePct, feeFixo);
}

// Calcula (e, se pedido, aplica no Mercado Livre) o preço que entrega a margem desejada do anúncio.
export async function reajustarAnuncio(
  admin: SupabaseClient,
  token: string,
  l: Listing,
  ctx: ContextoLoja,
  aplicar: boolean
): Promise<ResultadoPreco> {
  const base = { listing_id: l.id, external_id: l.external_id, title: l.title, old_price: Number(l.price) };

  const e0 = entradaDoAnuncio(l, ctx, Number(l.fee_percent ?? 12), Number(l.fee_fixed ?? 6));
  if (!e0) return { ...base, status: "ignorado", motivo: "Sem produto ligado ou sem custo cadastrado." };

  const atual = calcularLucro(Number(l.price), e0);

  // A taxa do Mercado Livre muda com o preço: repete o cálculo com a taxa real do preço candidato.
  let preco = Number(l.price);
  let pct = Number(l.fee_percent ?? 12);
  let fixo = Number(l.fee_fixed ?? 6);
  let alvo: number | null = null;
  for (let i = 0; i < 4; i++) {
    const taxa = await taxaDoAnuncio(token, preco, l.category_id, l.listing_type_id);
    if (taxa) {
      pct = taxa.pct;
      fixo = taxa.fixo;
    }
    const e = entradaDoAnuncio(l, ctx, pct, fixo) as EntradaPreco;
    alvo = precoParaMargem(Number(l.target_margin), e);
    if (alvo == null) break;
    if (Math.abs(alvo - preco) < 0.01) break;
    preco = alvo;
  }
  if (alvo == null) {
    return { ...base, status: "ignorado", margem_atual: atual.margem, motivo: "A margem desejada é impossível com as taxas e impostos atuais." };
  }

  // Limites do anúncio e variação máxima por rodada.
  const antigo = Number(l.price);
  let novo = alvo;
  novo = Math.min(novo, antigo * (1 + VARIACAO_MAXIMA));
  novo = Math.max(novo, antigo * (1 - VARIACAO_MAXIMA));
  if (l.min_price != null) novo = Math.max(novo, Number(l.min_price));
  if (l.max_price != null) novo = Math.min(novo, Number(l.max_price));
  novo = Math.round(novo * 100) / 100;

  if (Math.abs(novo - antigo) < 0.01) {
    return { ...base, status: "sem_mudanca", new_price: antigo, margem_atual: atual.margem, motivo: "O preço já entrega a margem desejada (ou está no limite)." };
  }
  if (!aplicar) return { ...base, status: "sugerido", new_price: novo, margem_atual: atual.margem };

  try {
    await mlPut(token, `/items/${l.external_id}`, { price: novo });
    await admin
      .from("listings")
      .update({ price: novo, fee_percent: pct, fee_fixed: fixo, last_repriced_at: new Date().toISOString() })
      .eq("id", l.id);
    await admin.from("price_changes").insert({
      store_id: l.store_id,
      listing_id: l.id,
      old_price: antigo,
      new_price: novo,
      ok: true,
      reason: `Margem alvo ${Number(l.target_margin)}%`,
    });
    return { ...base, status: "aplicado", new_price: novo, margem_atual: atual.margem };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao alterar o preço";
    await admin.from("price_changes").insert({
      store_id: l.store_id,
      listing_id: l.id,
      old_price: antigo,
      new_price: novo,
      ok: false,
      reason: msg,
    });
    return { ...base, status: "erro", new_price: novo, margem_atual: atual.margem, motivo: msg };
  }
}
