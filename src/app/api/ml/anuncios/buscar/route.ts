import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { skuDoItem } from "@/lib/server/sku-ml";
import { getAccessToken, listConnections, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// Procura direto no Mercado Livre (código MLB, SKU, family ID ou user product) e traz o anúncio para o sistema.
// body: { termo }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    const termo = String(b.termo ?? "").trim().replace(/^#/, "");
    if (!termo) return NextResponse.json({ error: "Informe o que procurar" }, { status: 400 });
    const admin = supabaseAdmin();
    const conexoes = await listConnections(user.id);
    const notas: string[] = [];
    const achados = new Map<string, { item: ItemML; ml_user_id: string; conta: string; company_id: string | null }>();
    const soNumeros = /^\d+$/.test(termo);
    const mlb = /^MLB\d+$/i.test(termo) ? termo.toUpperCase() : soNumeros && termo.length <= 13 ? `MLB${termo}` : null;
    const tenta = async (rotulo: string, f: () => Promise<void>) => {
      try {
        await f();
      } catch (e) {
        notas.push(`${rotulo}: ${e instanceof Error ? e.message.slice(0, 120) : "erro"}`);
      }
    };

    for (const c of conexoes) {
      const token = await getAccessToken(user.id, c.ml_user_id);
      if (!token) continue;
      const conta = c.store_name || c.nickname || c.ml_user_id;
      const ids = new Set<string>();

      if (mlb) await tenta(`item ${mlb}`, async () => {
        const it = await mlGet<ItemML & { seller_id?: number }>(token, `/items/${mlb}`);
        if (it?.id && String((it as { seller_id?: number }).seller_id ?? c.ml_user_id) === String(c.ml_user_id)) ids.add(it.id);
      });
      await tenta("busca por SKU", async () => {
        const r = await mlGet<{ results?: string[] }>(token, `/users/${c.ml_user_id}/items/search?sku=${encodeURIComponent(termo)}`);
        (r.results ?? []).forEach((i) => ids.add(i));
      });
      if (soNumeros && termo.length > 13) {
        await tenta("família", async () => {
          const r = await mlGet<{ user_products_ids?: string[]; user_products?: { id?: string }[] }>(token, `/sites/MLB/user-products-families/${termo}`);
          const ups = r.user_products_ids ?? (r.user_products ?? []).map((u) => u.id ?? "").filter(Boolean);
          for (const up of ups.slice(0, 80)) {
            const q = await mlGet<{ results?: string[] }>(token, `/users/${c.ml_user_id}/items/search?user_product_id=${encodeURIComponent(up)}`).catch(() => ({ results: [] as string[] }));
            (q.results ?? []).forEach((i) => ids.add(i));
          }
        });
      }
      if (/^MLBU/i.test(termo)) {
        await tenta("user product", async () => {
          const q = await mlGet<{ results?: string[] }>(token, `/users/${c.ml_user_id}/items/search?user_product_id=${encodeURIComponent(termo.toUpperCase())}`);
          (q.results ?? []).forEach((i) => ids.add(i));
        });
      }

      const lista = Array.from(ids);
      for (let i = 0; i < lista.length; i += 20) {
        const r = await mlGet<{ code: number; body: ItemML }[]>(token, `/items?ids=${lista.slice(i, i + 20).join(",")}`);
        r.forEach((x) => {
          if (x.code === 200 && x.body) achados.set(x.body.id, { item: x.body, ml_user_id: c.ml_user_id, conta, company_id: (c as { company_id?: string | null }).company_id ?? null });
        });
      }

      // Irmãos da mesma família dos itens achados
      const familias = new Set(Array.from(achados.values()).map((a) => a.item.family_id).filter(Boolean).map(String));
      if (familias.size > 0) {
        for (const f of Array.from(familias)) {
          await tenta(`irmãos da família ${f}`, async () => {
            const r = await mlGet<{ user_products_ids?: string[] }>(token, `/sites/MLB/user-products-families/${f}`);
            const novos: string[] = [];
            for (const up of (r.user_products_ids ?? []).slice(0, 80)) {
              const q = await mlGet<{ results?: string[] }>(token, `/users/${c.ml_user_id}/items/search?user_product_id=${encodeURIComponent(up)}`).catch(() => ({ results: [] as string[] }));
              (q.results ?? []).forEach((i) => !achados.has(i) && novos.push(i));
            }
            for (let i = 0; i < novos.length; i += 20) {
              const rr = await mlGet<{ code: number; body: ItemML }[]>(token, `/items?ids=${novos.slice(i, i + 20).join(",")}`);
              rr.forEach((x) => {
                if (x.code === 200 && x.body) achados.set(x.body.id, { item: x.body, ml_user_id: c.ml_user_id, conta, company_id: null });
              });
            }
          });
        }
      }
    }

    // Grava/atualiza no sistema
    const lista = Array.from(achados.values());
    if (lista.length) {
      const { data: padrao } = await admin.from("companies").select("id").eq("store_id", user.id).eq("is_default", true).maybeSingle();
      const { data: existentes } = await admin.from("listings").select("external_id").eq("store_id", user.id).in("external_id", lista.map((a) => a.item.id));
      const ja = new Set((existentes ?? []).map((x) => x.external_id as string));
      const agora = new Date().toISOString();
      const campos = (a: (typeof lista)[number]) => {
        const it = a.item;
        const sku = skuDoItem(it);
        return {
          store_id: user.id,
          marketplace_id: "mercado_livre",
          external_id: it.id,
          ml_user_id: a.ml_user_id,
          title: it.title,
          price: Number(it.price) || 0,
          status: it.status ?? null,
          permalink: it.permalink ?? null,
          thumbnail: it.thumbnail ?? null,
          category_id: it.category_id ?? null,
          listing_type_id: it.listing_type_id ?? null,
          ...(sku ? { sku } : {}),
          ...(it.user_product_id ? { user_product_id: String(it.user_product_id) } : {}),
          ...(it.family_id ? { family_id: String(it.family_id) } : {}),
          ...(it.family_name ? { family_name: String(it.family_name) } : {}),
          last_synced_at: agora,
        };
      };
      const atualizar = lista.filter((a) => ja.has(a.item.id)).map(campos);
      if (atualizar.length) await admin.from("listings").upsert(atualizar, { onConflict: "store_id,external_id" });
      const novos = lista.filter((a) => !ja.has(a.item.id));
      if (novos.length) {
        const skus = novos.map((a) => skuDoItem(a.item)).filter(Boolean);
        const porSku = new Map<string, string>();
        if (skus.length) {
          const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", user.id).in("sku", skus);
          (prods ?? []).forEach((p) => porSku.set(p.sku as string, p.id as string));
        }
        const { error } = await admin.from("listings").upsert(
          novos.map((a) => ({ ...campos(a), product_id: porSku.get(skuDoItem(a.item)) ?? null, company_id: a.company_id ?? padrao?.id ?? null })),
          { onConflict: "store_id,external_id", ignoreDuplicates: true }
        );
        if (error) throw new Error(error.message);
      }
    }

    return NextResponse.json({
      encontrados: lista.map((a) => ({ id: a.item.id, titulo: a.item.title, sku: skuDoItem(a.item), status: a.item.status ?? "", family_id: a.item.family_id ? String(a.item.family_id) : null, user_product_id: a.item.user_product_id ?? null, conta: a.conta })),
      novos: lista.filter((a) => true).length,
      notas,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
