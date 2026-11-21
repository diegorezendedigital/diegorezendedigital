import type { supabaseAdmin } from "./supabase-admin";
import { IndiceSku, chaveSku, chaveSkuFraca } from "@/lib/sku";

type Admin = ReturnType<typeof supabaseAdmin>;

// Todos os SKUs do armazém da loja, prontos para achar o produto de um SKU escrito de qualquer jeito
// (maiúsculas, acento, espaço ou hífen). Busca em blocos: o banco devolve no máximo 1000 linhas por consulta.
export async function indiceSkuArmazem(admin: Admin, storeId: string): Promise<IndiceSku<string>> {
  const ix = new IndiceSku<string>();
  for (let i = 0; ; i += 1000) {
    const { data, error } = await admin.from("products").select("id, sku, cost_price").eq("store_id", storeId).not("sku", "is", null).order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((p) => ix.add(String(p.sku ?? ""), p.id as string, Number(p.cost_price) > 0 ? 1 : 0));
    if (!data || data.length < 1000) break;
  }
  return ix;
}

// Produtos do armazém com o SKU informado: os que casam igual (sem diferenciar acento/caixa/espaço/hífen);
// se nenhum, os que casam só pelas letras e números. Quem chama decide se aceita apenas um resultado.
export async function produtosDoSku(admin: Admin, storeId: string, sku: string): Promise<{ id: string; sku: string; cost_price: number | null }[]> {
  const k = chaveSku(sku);
  const w = chaveSkuFraca(sku);
  if (!k) return [];
  const fortes: { id: string; sku: string; cost_price: number | null }[] = [];
  const fracos: { id: string; sku: string; cost_price: number | null }[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await admin.from("products").select("id, sku, cost_price").eq("store_id", storeId).not("sku", "is", null).order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { id: string; sku: string; cost_price: number | null }[]) {
      if (chaveSku(p.sku) === k) fortes.push(p);
      else if (w && chaveSkuFraca(p.sku) === w) fracos.push(p);
    }
    if (!data || data.length < 1000) break;
  }
  return fortes.length ? fortes : fracos;
}
