import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { skuDoItem } from "@/lib/server/sku-ml";
import { getAccessToken, getConnection, mlGet, taxaDoAnuncio } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOTE = 100; // máximo que o Mercado Livre devolve por consulta de lista
const POR_CHAMADA = 300; // anúncios processados por chamada (3 consultas de 100); a tela repete até terminar

type ItemML = {
  id: string;
  title: string;
  price: number;
  status?: string;
  permalink?: string;
  thumbnail?: string;
  category_id?: string;
  listing_type_id?: string;
  seller_custom_field?: string | null;
  user_product_id?: string | null;
  family_id?: string | number | null;
  family_name?: string | null;
  attributes?: { id?: string; value_name?: string | null }[];
  variations?: { seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[] }[];
};

// Importa os anúncios ativos do Mercado Livre. Anúncios novos são ligados ao produto de mesmo SKU
// (campo "SKU" do anúncio) e ao CNPJ padrão; os que já existem só atualizam preço, título e taxas,
// sem mexer no que você configurou (produto, CNPJ, margem, limites, preço automático).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const inicio = Date.now();

  try {
    const storeId = user.id;
    const body = await req.json().catch(() => ({}));
    const conn = await getConnection(storeId, body.ml_user_id ? String(body.ml_user_id) : null);
    if (!conn) return NextResponse.json({ error: "Conecte sua conta do Mercado Livre primeiro (Integrações)" }, { status: 400 });
    const token = await getAccessToken(storeId, conn.ml_user_id);
    if (!token) return NextResponse.json({ error: "Conexão com o Mercado Livre expirada" }, { status: 400 });

    // status: active, paused, under_review... (a tela percorre todos). scroll_id: continua de onde parou (sem o limite de 1000 da paginação comum).
    const status = String(body.status || "active").replace(/[^a-z_]/g, "") || "active";
    let scrollId: string | null = body.scroll_id ? String(body.scroll_id) : null;

    const admin = supabaseAdmin();
    const { data: padrao } = await admin.from("companies").select("id").eq("store_id", storeId).eq("is_default", true).maybeSingle();

    let processados = 0;
    let criados = 0;
    let atualizados = 0;
    let total = 0;
    let acabou = false;

    for (let rodada = 0; processados < POR_CHAMADA; rodada++) {
      if (rodada > 0 && Date.now() - inicio > 30000) break;
      const busca: { results?: string[]; paging?: { total?: number }; scroll_id?: string } = await mlGet(
        token,
        `/users/${conn.ml_user_id}/items/search?status=${status}&search_type=scan&limit=${LOTE}` + (scrollId ? `&scroll_id=${encodeURIComponent(scrollId)}` : "")
      );
      const ids = busca.results ?? [];
      total = busca.paging?.total ?? total;
      if (busca.scroll_id) scrollId = busca.scroll_id;
      if (ids.length === 0) {
        acabou = true;
        break;
      }

      // Detalhes dos anúncios (a API aceita até 20 ids por chamada).
      const itens: ItemML[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20);
        const r = await mlGet<{ code: number; body: ItemML }[]>(token, `/items?ids=${lote.join(",")}`);
        r.forEach((x) => {
          if (x.code === 200 && x.body) itens.push(x.body);
        });
      }

      // Taxas reais de cada anúncio (melhor esforço).
      const taxas = new Map<string, { pct: number; fixo: number }>();
      for (let i = 0; i < itens.length; i += 10) {
        await Promise.all(
          itens.slice(i, i + 10).map(async (it) => {
            const t = await taxaDoAnuncio(token, Number(it.price) || 0, it.category_id ?? null, it.listing_type_id ?? null);
            if (t) taxas.set(it.id, t);
          })
        );
      }

      const agora = new Date().toISOString();
      const { data: existentes } = await admin
        .from("listings")
        .select("external_id")
        .eq("store_id", storeId)
        .in("external_id", itens.map((i) => i.id));
      const jaExiste = new Set((existentes ?? []).map((x) => x.external_id as string));

      const campos = (it: ItemML) => ({
        store_id: storeId,
        marketplace_id: "mercado_livre",
        external_id: it.id,
        ml_user_id: conn.ml_user_id,
        title: it.title,
        price: Number(it.price) || 0,
        status: it.status ?? null,
        permalink: it.permalink ?? null,
        thumbnail: it.thumbnail ?? null,
        category_id: it.category_id ?? null,
        listing_type_id: it.listing_type_id ?? null,
        ...(skuDoItem(it) ? { sku: skuDoItem(it) } : {}),
        ...(it.user_product_id ? { user_product_id: String(it.user_product_id) } : {}),
        ...(it.family_id ? { family_id: String(it.family_id) } : {}),
        ...(it.family_name ? { family_name: String(it.family_name) } : {}),
        fee_percent: taxas.get(it.id)?.pct ?? null,
        fee_fixed: taxas.get(it.id)?.fixo ?? null,
        last_synced_at: agora,
      });

      // Atualiza os que já existem (sem tocar na configuração do usuário).
      const atualizar = itens.filter((i) => jaExiste.has(i.id)).map(campos);
      if (atualizar.length) {
        const { error } = await admin.from("listings").upsert(atualizar, { onConflict: "store_id,external_id" });
        if (error) throw new Error(error.message);
      }

      // Cria os novos, já ligados ao produto de mesmo SKU e ao CNPJ padrão.
      const novos = itens.filter((i) => !jaExiste.has(i.id));
      if (novos.length) {
        const skus = novos.map((i) => skuDoItem(i)).filter(Boolean);
        const porSku = new Map<string, string>();
        if (skus.length) {
          const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", storeId).in("sku", skus);
          (prods ?? []).forEach((p) => porSku.set(p.sku as string, p.id as string));
        }
        const registros = novos.map((it) => ({
          ...campos(it),
          product_id: porSku.get(skuDoItem(it)) ?? null,
          company_id: conn.company_id ?? padrao?.id ?? null,
        }));
        const { error } = await admin.from("listings").upsert(registros, { onConflict: "store_id,external_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }

      processados += ids.length;
      criados += novos.length;
      atualizados += atualizar.length;
      if (ids.length < LOTE) {
        acabou = true;
        break;
      }
    }

    return NextResponse.json({
      processed: processados,
      created: criados,
      updated: atualizados,
      total,
      scroll_id: scrollId,
      has_more: !acabou,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao importar anúncios" }, { status: 500 });
  }
}
