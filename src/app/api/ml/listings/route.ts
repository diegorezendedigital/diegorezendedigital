import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, getConnection, mlGet, taxaDoAnuncio } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 40; // anúncios por chamada; a tela repete até terminar

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
};

// Importa os anúncios ativos do Mercado Livre. Anúncios novos são ligados ao produto de mesmo SKU
// (campo "SKU" do anúncio) e ao CNPJ padrão; os que já existem só atualizam preço, título e taxas,
// sem mexer no que você configurou (produto, CNPJ, margem, limites, preço automático).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const storeId = user.id;
    const conn = await getConnection(storeId);
    if (!conn) return NextResponse.json({ error: "Conecte sua conta do Mercado Livre primeiro" }, { status: 400 });
    const token = await getAccessToken(storeId);
    if (!token) return NextResponse.json({ error: "Conexão com o Mercado Livre expirada" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const offset = Math.max(Number(body.offset) || 0, 0);

    const busca = await mlGet<{ results?: string[]; paging?: { total?: number } }>(
      token,
      `/users/${conn.ml_user_id}/items/search?status=active&limit=${PAGE}&offset=${offset}`
    );
    const ids = busca.results ?? [];
    const total = busca.paging?.total ?? ids.length;

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
    for (let i = 0; i < itens.length; i += 5) {
      await Promise.all(
        itens.slice(i, i + 5).map(async (it) => {
          const t = await taxaDoAnuncio(token, Number(it.price) || 0, it.category_id ?? null, it.listing_type_id ?? null);
          if (t) taxas.set(it.id, t);
        })
      );
    }

    const admin = supabaseAdmin();
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
      title: it.title,
      price: Number(it.price) || 0,
      status: it.status ?? null,
      permalink: it.permalink ?? null,
      thumbnail: it.thumbnail ?? null,
      category_id: it.category_id ?? null,
      listing_type_id: it.listing_type_id ?? null,
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
      const skus = novos.map((i) => (i.seller_custom_field || "").trim()).filter(Boolean);
      const porSku = new Map<string, string>();
      if (skus.length) {
        const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", storeId).in("sku", skus);
        (prods ?? []).forEach((p) => porSku.set(p.sku as string, p.id as string));
      }
      const { data: padrao } = await admin.from("companies").select("id").eq("store_id", storeId).eq("is_default", true).maybeSingle();
      const registros = novos.map((it) => ({
        ...campos(it),
        product_id: porSku.get((it.seller_custom_field || "").trim()) ?? null,
        company_id: padrao?.id ?? null,
      }));
      const { error } = await admin.from("listings").upsert(registros, { onConflict: "store_id,external_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    const proximo = offset + ids.length;
    return NextResponse.json({
      processed: ids.length,
      created: novos.length,
      updated: atualizar.length,
      total,
      next_offset: proximo,
      has_more: ids.length > 0 && proximo < total,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao importar anúncios" }, { status: 500 });
  }
}
