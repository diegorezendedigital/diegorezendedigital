import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { skuDoItem } from "@/lib/server/sku-ml";
import { getAccessToken, itensDoML } from "@/lib/server/ml";
import { chaveSku, chaveSkuFraca } from "@/lib/sku";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Anuncio = { id: string; external_id: string; sku: string | null; product_id: string | null; ml_user_id: string | null };

// Liga automaticamente cada anúncio SEM produto ao produto do armazém que tem exatamente o mesmo SKU.
// 1) anúncios sem SKU gravado têm o SKU buscado no Mercado Livre; 2) o SKU é comparado sem diferenciar maiúsculas, acentos nem espaço/hífen.
// Anúncios já ligados a um produto não são alterados.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["anuncios", "armazem"]); if (semAcesso) return semAcesso; }
  const inicio = Date.now();
  try {
    const admin = supabaseAdmin();
    const storeId = user.id;

    const anuncios: Anuncio[] = [];
    for (let i = 0; i < 20000; i += 1000) {
      const { data, error } = await admin
        .from("listings")
        .select("id, external_id, sku, product_id, ml_user_id")
        .eq("store_id", storeId)
        .eq("marketplace_id", "mercado_livre")
        .order("created_at")
        .range(i, i + 999);
      if (error) throw new Error(error.message);
      anuncios.push(...((data ?? []) as Anuncio[]));
      if ((data ?? []).length < 1000) break;
    }

    // 1) SKU dos anúncios que ainda não têm (só os que precisam: sem produto ligado)
    const precisam = anuncios.filter((a) => !a.product_id && !(a.sku ?? "").trim());
    const porConta = new Map<string, Anuncio[]>();
    precisam.forEach((a) => porConta.set(a.ml_user_id ?? "", [...(porConta.get(a.ml_user_id ?? "") ?? []), a]));
    let semAcesso = 0;
    let parcial = false;
    for (const [conta, lista] of Array.from(porConta.entries())) {
      let token: string | null = null;
      try {
        token = await getAccessToken(storeId, conta || null);
      } catch {
        token = null;
      }
      if (!token) {
        semAcesso += lista.length;
        continue;
      }
      for (let i = 0; i < lista.length; i += 20) {
        if (Date.now() - inicio > 40000) {
          parcial = true;
          break;
        }
        const lote = lista.slice(i, i + 20);
        try {
          const corpos = await itensDoML<{ id?: string; seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[]; variations?: { seller_custom_field?: string | null; attributes?: { id?: string; value_name?: string | null }[] }[] }>(
            token,
            lote.map((a) => a.external_id)
          );
          const achados = new Map<string, string>();
          corpos.forEach((b) => {
            if (!b?.id) return;
            const v = skuDoItem(b);
            if (v) achados.set(b.id, v);
          });
          await Promise.all(
            lote
              .filter((a) => achados.has(a.external_id))
              .map((a) => {
                a.sku = achados.get(a.external_id) as string;
                return admin.from("listings").update({ sku: a.sku }).eq("id", a.id);
              })
          );
        } catch {
          /* segue com os próximos */
        }
      }
      if (parcial) break;
    }

    // 2) Produtos do armazém por SKU (exato)
    const produtos = new Map<string, string[]>();
    const fracos = new Map<string, Set<string>>();
    for (let i = 0; i < 20000; i += 1000) {
      const { data, error } = await admin.from("products").select("id, sku").eq("store_id", storeId).range(i, i + 999);
      if (error) throw new Error(error.message);
      (data ?? []).forEach((p) => {
        const k = chaveSku(String(p.sku ?? ""));
        if (!k) return;
        produtos.set(k, [...(produtos.get(k) ?? []), p.id as string]);
        const w = chaveSkuFraca(String(p.sku ?? ""));
        if (w) fracos.set(w, (fracos.get(w) ?? new Set<string>()).add(p.id as string));
      });
      if ((data ?? []).length < 1000) break;
    }

    const r = { analisados: anuncios.length, jaLigados: 0, vinculados: 0, semSku: 0, semProduto: 0, duplicados: 0, parcial, semAcesso, skusSemProduto: [] as string[] };
    const ligar: { id: string; product_id: string }[] = [];
    const faltando = new Set<string>();
    for (const a of anuncios) {
      if (a.product_id) {
        r.jaLigados++;
        continue;
      }
      const s = (a.sku ?? "").trim();
      if (!s) {
        r.semSku++;
        continue;
      }
      const fraco = fracos.get(chaveSkuFraca(s));
      const ids = produtos.get(chaveSku(s)) ?? (fraco && fraco.size === 1 ? Array.from(fraco) : undefined);
      if (!ids) {
        r.semProduto++;
        faltando.add(s);
      } else if (ids.length > 1) {
        r.duplicados++;
      } else {
        ligar.push({ id: a.id, product_id: ids[0] });
      }
    }
    for (let i = 0; i < ligar.length; i += 25) {
      await Promise.all(ligar.slice(i, i + 25).map((l) => admin.from("listings").update({ product_id: l.product_id }).eq("id", l.id)));
      r.vinculados += Math.min(25, ligar.length - i);
    }
    r.skusSemProduto = Array.from(faltando).slice(0, 10);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao vincular por SKU" }, { status: 500 });
  }
}
