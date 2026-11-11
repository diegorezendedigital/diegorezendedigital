import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getAccessToken } from "@/lib/server/ml";
import { carregarContexto, reajustarAnuncio } from "@/lib/server/reprice";
import { rodarPromocoesAutomaticas } from "@/lib/server/promocoes-auto";
import type { Listing } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rodada diária (agendada no vercel.json): reajusta os anúncios com "preço automático" ligado.
// A Vercel envia "Authorization: Bearer <CRON_SECRET>"; sem o segredo configurado, a rota se recusa a rodar.
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const admin = supabaseAdmin();
  const { data } = await admin.from("listings").select("*").eq("auto_price", true).order("last_repriced_at", { ascending: true, nullsFirst: true });
  const porLoja = new Map<string, Listing[]>();
  ((data ?? []) as Listing[]).forEach((l) => porLoja.set(l.store_id, [...(porLoja.get(l.store_id) ?? []), l]));

  const resumo = { aplicados: 0, sem_mudanca: 0, ignorados: 0, erros: 0 };
  for (const [storeId, lista] of Array.from(porLoja.entries())) {
    const ctx = await carregarContexto(admin, storeId);
    const tokens = new Map<string, string | null>();
    for (const l of lista) {
      if (Date.now() - inicio > 40000) return NextResponse.json({ ...resumo, parcial: true });
      const chave = l.ml_user_id ?? "";
      if (!tokens.has(chave)) {
        try {
          tokens.set(chave, await getAccessToken(storeId, l.ml_user_id));
        } catch {
          tokens.set(chave, null);
        }
      }
      const token = tokens.get(chave);
      if (!token) {
        resumo.ignorados++;
        continue;
      }
      const r = await reajustarAnuncio(admin, token, l, ctx, true);
      if (r.status === "aplicado") resumo.aplicados++;
      else if (r.status === "sem_mudanca") resumo.sem_mudanca++;
      else if (r.status === "erro") resumo.erros++;
      else resumo.ignorados++;
    }
  }

  // Promoções do Mercado Livre: entra sozinho onde a margem mínima é atingida.
  const promos = { avaliados: 0, entraram: 0, recusados: 0, erros: 0 };
  const { data: comPromo } = await admin.from("products").select("store_id").eq("promo_auto", true);
  for (const storeId of Array.from(new Set<string>((comPromo ?? []).map((x) => x.store_id as string)))) {
    const restante = 55000 - (Date.now() - inicio);
    if (restante < 10000) return NextResponse.json({ ...resumo, promocoes: promos, parcial: true });
    try {
      const pr = await rodarPromocoesAutomaticas(admin, storeId, restante);
      promos.avaliados += pr.avaliados;
      promos.entraram += pr.entraram;
      promos.recusados += pr.recusados;
      promos.erros += pr.erros;
    } catch {
      promos.erros++;
    }
  }
  return NextResponse.json({ ...resumo, promocoes: promos });
}
