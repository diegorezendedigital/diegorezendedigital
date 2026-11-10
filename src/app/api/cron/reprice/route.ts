import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getAccessToken } from "@/lib/server/ml";
import { carregarContexto, reajustarAnuncio } from "@/lib/server/reprice";
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
      if (Date.now() - inicio > 50000) return NextResponse.json({ ...resumo, parcial: true });
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
  return NextResponse.json(resumo);
}
