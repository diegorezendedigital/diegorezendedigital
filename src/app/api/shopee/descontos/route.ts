import { NextResponse } from "next/server";
import { exigirAba, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, shopeePost, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ModeloDesc = { model_id: number; model_name?: string; model_original_price?: number; model_promotion_price?: number; model_normal_stock?: number; model_promotion_stock?: number };
type ItemDesc = {
  item_id: number; item_name?: string; purchase_limit?: number; item_original_price?: number; item_promotion_price?: number;
  normal_stock?: number; promotion_stock?: number; model_list?: ModeloDesc[];
};
type ModeloLoja = {
  model_id: number; tier_index?: number[]; model_sku?: string;
  price_info?: { original_price?: number; current_price?: number }[];
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
};
type Base = { item_id: number; item_name?: string; image?: { image_url_list?: string[] }; price_info?: { original_price?: number }[]; stock_info_v2?: { summary_info?: { total_available_stock?: number } } };

export type Variacao = {
  model_id: number; // 0 quando o anúncio não tem variação
  nome: string;
  sku: string | null;
  preco_original: number;
  preco_promo: number | null; // null = fora da promoção
  estoque: number;
  estoque_promo: number | null;
  ativo: boolean;
};
export type ProdutoDesc = { item_id: number; nome: string; imagem: string | null; limite_compra: number; variacoes: Variacao[] };

const erro = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

async function emLotes<T, R>(lista: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < lista.length; i += n) out.push(...(await Promise.all(lista.slice(i, i + n).map(f))));
  return out;
}

// GET ?shop_id=&discount_id= → produtos da promoção, cada um com todas as variações do anúncio (dentro e fora da promoção)
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const u = new URL(req.url);
  const shopId = u.searchParams.get("shop_id") ?? "";
  const id = Number(u.searchParams.get("discount_id"));
  const token = await tokenShopee(user.id, shopId);
  if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
  try {
    const itens: ItemDesc[] = [];
    let info: Record<string, unknown> = {};
    for (let page_no = 1; page_no <= 20; page_no++) {
      const r = await shopeeGet<{ response?: Record<string, unknown> & { item_list?: ItemDesc[]; more?: boolean } }>(
        token, shopId, "/api/v2/discount/get_discount", { discount_id: id, page_no, page_size: 100 }
      );
      info = r.response ?? {};
      itens.push(...(r.response?.item_list ?? []));
      if (!r.response?.more) break;
    }

    // Foto e nome do anúncio (até 50 por consulta)
    const base = new Map<number, Base>();
    for (let i = 0; i < itens.length; i += 50) {
      const r = await shopeeGet<{ response?: { item_list?: Base[] } }>(token, shopId, "/api/v2/product/get_item_base_info", {
        item_id_list: itens.slice(i, i + 50).map((x) => x.item_id).join(","),
      });
      for (const b of r.response?.item_list ?? []) base.set(b.item_id, b);
    }

    // Todas as variações do anúncio, para mostrar também as que estão fora da promoção
    const produtos = await emLotes(itens, 8, async (it): Promise<ProdutoDesc> => {
      const b = base.get(it.item_id);
      const naPromo = new Map((it.model_list ?? []).map((m) => [m.model_id, m]));
      let variacoes: Variacao[] = [];
      if (it.model_list?.length) {
        try {
          const r = await shopeeGet<{ response?: { tier_variation?: { option_list?: { option: string }[] }[]; model?: ModeloLoja[] } }>(
            token, shopId, "/api/v2/product/get_model_list", { item_id: it.item_id }
          );
          const tiers = r.response?.tier_variation ?? [];
          variacoes = (r.response?.model ?? []).map((m) => {
            const p = naPromo.get(m.model_id);
            const nome = (m.tier_index ?? []).map((t, k) => tiers[k]?.option_list?.[t]?.option ?? "").filter(Boolean).join(",") || p?.model_name || String(m.model_id);
            return {
              model_id: m.model_id, nome, sku: m.model_sku || null,
              preco_original: Number(p?.model_original_price ?? m.price_info?.[0]?.original_price) || 0,
              preco_promo: p ? Number(p.model_promotion_price) || 0 : null,
              estoque: Number(p?.model_normal_stock ?? m.stock_info_v2?.summary_info?.total_available_stock) || 0,
              estoque_promo: p?.model_promotion_stock ?? null,
              ativo: !!p,
            };
          });
        } catch {
          // Sem a lista do anúncio: mostra só as variações que estão na promoção
          variacoes = (it.model_list ?? []).map((m) => ({
            model_id: m.model_id, nome: m.model_name ?? String(m.model_id), sku: null, preco_original: Number(m.model_original_price) || 0,
            preco_promo: Number(m.model_promotion_price) || 0, estoque: Number(m.model_normal_stock) || 0, estoque_promo: m.model_promotion_stock ?? null, ativo: true,
          }));
        }
      } else {
        variacoes = [{
          model_id: 0, nome: "Sem variação", sku: null, preco_original: Number(it.item_original_price) || 0, preco_promo: Number(it.item_promotion_price) || 0,
          estoque: Number(it.normal_stock) || 0, estoque_promo: it.promotion_stock ?? null, ativo: true,
        }];
      }
      return { item_id: it.item_id, nome: it.item_name ?? b?.item_name ?? String(it.item_id), imagem: b?.image?.image_url_list?.[0] ?? null, limite_compra: Number(it.purchase_limit) || 0, variacoes };
    });
    return NextResponse.json({ nome: info.discount_name, inicio: info.start_time, fim: info.end_time, produtos });
  } catch (e) {
    return erro(e, 500);
  }
}

// POST { acao: "salvar", shop_id, discount_id, produtos: [{ item_id, limite_compra, variacoes: [{ model_id, preco_promo }] }] } → muda preços e limite
// POST { acao: "ativar", shop_id, discount_id, item_id, limite_compra, model_id, preco_promo } → coloca a variação na promoção
// POST { acao: "desativar", shop_id, discount_id, item_id, model_id } → tira a variação da promoção
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const b = await req.json().catch(() => ({}));
  const shopId = String(b.shop_id ?? "");
  const discountId = Number(b.discount_id);
  const token = await tokenShopee(user.id, shopId);
  if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
  type Falha = { item_id: number; model_id?: number; fail_message?: string; fail_error?: string };
  const falhas = (l?: Falha[]) => (l ?? []).map((x) => ({ item_id: x.item_id, model_id: x.model_id, motivo: x.fail_message || x.fail_error || "recusado" }));
  try {
    if (b.acao === "desativar") {
      await shopeePost(token, shopId, "/api/v2/discount/delete_discount_item", { discount_id: discountId, item_id: Number(b.item_id), model_id: Number(b.model_id) || 0 });
      return NextResponse.json({ ok: true });
    }
    if (b.acao === "ativar") {
      const preco = Number(b.preco_promo);
      if (!(preco > 0)) return erro("Informe o preço com desconto antes de ativar");
      const item = Number(b.model_id)
        ? { item_id: Number(b.item_id), purchase_limit: Number(b.limite_compra) || 0, model_list: [{ model_id: Number(b.model_id), model_promotion_price: preco }] }
        : { item_id: Number(b.item_id), purchase_limit: Number(b.limite_compra) || 0, item_promotion_price: preco };
      const r = await shopeePost<{ response?: { error_list?: Falha[] } }>(token, shopId, "/api/v2/discount/add_discount_item", { discount_id: discountId, item_list: [item] });
      const f = falhas(r.response?.error_list);
      if (f.length) return erro(`A Shopee recusou: ${f.map((x) => x.motivo).join("; ")}`);
      return NextResponse.json({ ok: true });
    }
    type P = { item_id: number; limite_compra: number; variacoes: { model_id: number; preco_promo: number }[] };
    const produtos = (b.produtos ?? []) as P[];
    if (!produtos.length) return erro("Nada para salvar");
    const item_list = produtos.map((p) =>
      p.variacoes.length === 1 && !p.variacoes[0].model_id
        ? { item_id: p.item_id, purchase_limit: p.limite_compra, item_promotion_price: p.variacoes[0].preco_promo }
        : { item_id: p.item_id, purchase_limit: p.limite_compra, model_list: p.variacoes.map((v) => ({ model_id: v.model_id, model_promotion_price: v.preco_promo })) }
    );
    const r = await shopeePost<{ response?: { error_list?: Falha[] } }>(token, shopId, "/api/v2/discount/update_discount_item", { discount_id: discountId, item_list });
    return NextResponse.json({ ok: true, falhas: falhas(r.response?.error_list) });
  } catch (e) {
    return erro(e, 500);
  }
}
