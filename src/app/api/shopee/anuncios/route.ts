import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";
import { CANAIS, faixaDoPreco } from "@/lib/taxas-publicas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 50; // máximo de anúncios que a Shopee devolve por consulta de lista
const POR_CHAMADA = 100; // anúncios por chamada; a tela repete até terminar

type ItemBase = {
  item_id: number;
  item_name?: string;
  item_sku?: string;
  item_status?: string;
  has_model?: boolean;
  category_id?: number;
  price_info?: { current_price?: number }[];
  image?: { image_url_list?: string[] };
};
type Modelo = { model_id: number; model_sku?: string; model_name?: string; price_info?: { current_price?: number }[] };

// Importa os anúncios da Shopee. Cada variação vira um anúncio (external_id = item:modelo). Anúncios novos são ligados
// ao produto de mesmo SKU e ao CNPJ padrão; os que já existem só atualizam título, preço e foto, sem mexer na sua configuração.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const inicio = Date.now();
  try {
    const storeId = user.id;
    const body = await req.json().catch(() => ({}));
    const shopId = String(body.shop_id ?? "");
    if (!shopId) return NextResponse.json({ error: "Informe a loja" }, { status: 400 });
    const token = await tokenShopee(storeId, shopId);
    if (!token) return NextResponse.json({ error: "Conecte sua loja da Shopee primeiro (Integrações)" }, { status: 400 });

    const status = ["NORMAL", "UNLIST", "BANNED"].includes(String(body.status)) ? String(body.status) : "NORMAL";
    let offset = Math.max(Number(body.offset) || 0, 0);

    const admin = supabaseAdmin();
    const { data: conn } = await admin.from("shopee_connections").select("company_id").eq("store_id", storeId).eq("shop_id", shopId).maybeSingle();
    const { data: padrao } = await admin.from("companies").select("id").eq("store_id", storeId).eq("is_default", true).maybeSingle();
    const empresaId = (conn?.company_id as string | null) ?? (padrao?.id as string | undefined) ?? null;
    const canal = CANAIS.find((c) => c.id === "shopee")!;

    let lidos = 0;
    let criados = 0;
    let atualizados = 0;
    let total = 0;
    let acabou = false;

    while (lidos < POR_CHAMADA) {
      if (lidos > 0 && Date.now() - inicio > 30000) break;
      const lista = await shopeeGet<{ response?: { item?: { item_id: number }[]; total_count?: number; has_next_page?: boolean; next_offset?: number } }>(
        token, shopId, "/api/v2/product/get_item_list", { offset, page_size: PAGINA, item_status: status }
      );
      const ids = (lista.response?.item ?? []).map((i) => i.item_id);
      total = lista.response?.total_count ?? total;
      if (ids.length === 0) {
        acabou = true;
        break;
      }

      const base = await shopeeGet<{ response?: { item_list?: ItemBase[] } }>(token, shopId, "/api/v2/product/get_item_base_info", { item_id_list: ids.join(",") });
      const itens = base.response?.item_list ?? [];

      // Variações (cores/tamanhos): uma consulta por produto que tem variação
      type Linha = { externalId: string; titulo: string; preco: number; sku: string; itemId: number; foto: string | null; status: string | null; categoria: string | null };
      const linhas: Linha[] = [];
      const comModelo = itens.filter((i) => i.has_model);
      const modelos = new Map<number, Modelo[]>();
      for (let i = 0; i < comModelo.length; i += 5) {
        await Promise.all(
          comModelo.slice(i, i + 5).map(async (it) => {
            try {
              const m = await shopeeGet<{ response?: { model?: Modelo[] } }>(token, shopId, "/api/v2/product/get_model_list", { item_id: it.item_id });
              modelos.set(it.item_id, m.response?.model ?? []);
            } catch {
              modelos.set(it.item_id, []);
            }
          })
        );
      }
      for (const it of itens) {
        const foto = it.image?.image_url_list?.[0] ?? null;
        const nome = it.item_name || String(it.item_id);
        const comum = { itemId: it.item_id, foto, status: it.item_status ?? null, categoria: it.category_id ? String(it.category_id) : null };
        const ms = it.has_model ? modelos.get(it.item_id) ?? [] : [];
        if (ms.length > 0) {
          for (const m of ms) {
            linhas.push({
              ...comum,
              externalId: `${it.item_id}:${m.model_id}`,
              titulo: m.model_name ? `${nome} - ${m.model_name}` : nome,
              preco: Number(m.price_info?.[0]?.current_price) || 0,
              sku: (m.model_sku || it.item_sku || "").trim(),
            });
          }
        } else {
          linhas.push({ ...comum, externalId: String(it.item_id), titulo: nome, preco: Number(it.price_info?.[0]?.current_price) || 0, sku: (it.item_sku || "").trim() });
        }
      }

      const { data: existentes } = await admin.from("listings").select("external_id").eq("store_id", storeId).in("external_id", linhas.map((l) => l.externalId));
      const jaExiste = new Set((existentes ?? []).map((x) => x.external_id as string));
      const agora = new Date().toISOString();
      const campos = (l: Linha) => {
        const f = faixaDoPreco(canal, l.preco);
        return {
          store_id: storeId,
          marketplace_id: "shopee",
          external_id: l.externalId,
          ml_user_id: shopId,
          title: l.titulo,
          price: l.preco,
          status: l.status === "NORMAL" ? "active" : (l.status ?? "").toLowerCase() || null,
          permalink: `https://shopee.com.br/product/${shopId}/${l.itemId}`,
          thumbnail: l.foto,
          category_id: l.categoria,
          ...(l.sku ? { sku: l.sku } : {}),
          fee_percent: f.comissao,
          fee_fixed: f.fixa === "metade" ? l.preco / 2 : f.fixa,
          last_synced_at: agora,
        };
      };

      const atualizar = linhas.filter((l) => jaExiste.has(l.externalId)).map(campos);
      if (atualizar.length) {
        const { error } = await admin.from("listings").upsert(atualizar, { onConflict: "store_id,external_id" });
        if (error) throw new Error(error.message);
      }
      const novos = linhas.filter((l) => !jaExiste.has(l.externalId));
      if (novos.length) {
        const skus = novos.map((l) => l.sku).filter(Boolean);
        const porSku = new Map<string, string>();
        if (skus.length) {
          const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", storeId).in("sku", skus);
          (prods ?? []).forEach((p) => porSku.set(p.sku as string, p.id as string));
        }
        const registros = novos.map((l) => ({ ...campos(l), product_id: porSku.get(l.sku) ?? null, company_id: empresaId }));
        const { error } = await admin.from("listings").upsert(registros, { onConflict: "store_id,external_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }

      lidos += ids.length;
      criados += novos.length;
      atualizados += atualizar.length;
      offset = lista.response?.next_offset ?? offset + ids.length;
      if (!lista.response?.has_next_page) {
        acabou = true;
        break;
      }
    }

    if (acabou) await admin.from("shopee_connections").update({ last_synced_at: new Date().toISOString() }).eq("store_id", storeId).eq("shop_id", shopId);

    return NextResponse.json({ processed: lidos, created: criados, updated: atualizados, total, next_offset: offset, has_more: !acabou });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao importar anúncios da Shopee" }, { status: 500 });
  }
}
