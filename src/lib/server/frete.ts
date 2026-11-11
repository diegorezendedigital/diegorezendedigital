import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getAccessToken, mlGet } from "@/lib/server/ml";

type Resultado = { atualizados: number; semDados: number; gratisParaComprador: number; total: number };

// Frete que o vendedor paga por anúncio, vindo do Mercado Livre:
// 1) anúncio sem frete grátis → o comprador paga, frete do vendedor = 0;
// 2) com frete grátis → média do frete REAL pago nas últimas vendas desse anúncio (já com o desconto de reputação).
// `forcar` = também sobrescreve o frete que você digitou à mão.
export async function atualizarFretes(storeId: string, opts: { forcar?: boolean } = {}): Promise<Resultado> {
  const admin = supabaseAdmin();
  const { data: anuncios, error } = await admin
    .from("listings")
    .select("id, external_id, ml_user_id, shipping_source")
    .eq("store_id", storeId)
    .eq("marketplace_id", "mercado_livre");
  if (error) throw new Error(error.message);

  const lista = (anuncios ?? []).filter((a) => opts.forcar || a.shipping_source !== "manual");
  const r: Resultado = { atualizados: 0, semDados: 0, gratisParaComprador: 0, total: lista.length };
  if (!lista.length) return r;

  // Frete grátis ou não, direto do anúncio (agrupado por conta)
  const gratis = new Map<string, boolean>();
  const contas = Array.from(new Set(lista.map((a) => a.ml_user_id as string | null)));
  for (const conta of contas) {
    const token = await getAccessToken(storeId, conta as string | null);
    if (!token) continue;
    const ids = lista.filter((a) => a.ml_user_id === conta).map((a) => a.external_id as string);
    for (let i = 0; i < ids.length; i += 20) {
      try {
        const resp = await mlGet<{ body?: { id?: string; shipping?: { free_shipping?: boolean } } }[]>(
          token,
          `/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,shipping`
        );
        (Array.isArray(resp) ? resp : []).forEach((x) => {
          if (x.body?.id && typeof x.body.shipping?.free_shipping === "boolean") gratis.set(x.body.id, x.body.shipping.free_shipping);
        });
      } catch {
        /* sem a informação do anúncio: usa só as vendas */
      }
    }
  }

  for (const a of lista) {
    let valor: number | null = null;
    if (gratis.get(a.external_id as string) === false) {
      valor = 0;
      r.gratisParaComprador++;
    } else {
      const { data: vendas } = await admin
        .from("sales")
        .select("shipping_cost")
        .eq("store_id", storeId)
        .eq("listing_id", a.id)
        .gt("shipping_cost", 0)
        .order("sold_at", { ascending: false })
        .limit(10);
      if (vendas && vendas.length) valor = vendas.reduce((s, v) => s + Number(v.shipping_cost), 0) / vendas.length;
    }
    if (valor == null) {
      r.semDados++;
      continue;
    }
    await admin.from("listings").update({ shipping_cost: Math.round(valor * 100) / 100, shipping_source: "ml" }).eq("id", a.id);
    r.atualizados++;
  }
  return r;
}
