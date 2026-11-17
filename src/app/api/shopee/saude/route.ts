import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Metrica = { metric_name?: string; current_period?: number | null; unit?: number; target?: { value?: number; comparator?: string } };

// Saúde de cada loja Shopee: nota geral de desempenho e pontos de penalidade.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data } = await supabaseAdmin().from("shopee_connections").select("shop_id, shop_name, store_name").eq("store_id", user.id);
  const lojas = await Promise.all(
    (data ?? []).map(async (c) => {
      const base = { shop_id: c.shop_id as string, nome: (c.store_name || c.shop_name || c.shop_id) as string };
      const token = await tokenShopee(user.id, base.shop_id);
      if (!token) return { ...base, erro: "Sem acesso" };
      const [perf, pen] = await Promise.all([
        shopeeGet<{ response?: { overall_performance?: { rating?: number; fulfillment_failed?: number; listing_failed?: number; custom_service_failed?: number }; metric_list?: Metrica[] } }>(
          token, base.shop_id, "/api/v2/account_health/get_shop_performance", {}
        ).catch((e) => ({ erro: e instanceof Error ? e.message : String(e) } as { erro: string })),
        shopeeGet<{ response?: { penalty_points?: { overall_penalty_points?: number } } }>(token, base.shop_id, "/api/v2/account_health/shop_penalty", {}).catch(() => null),
      ]);
      if ("erro" in perf) return { ...base, erro: perf.erro };
      const o = perf.response?.overall_performance ?? {};
      const metricas = (perf.response?.metric_list ?? [])
        .filter((m) => m.metric_name && m.current_period != null)
        .slice(0, 6)
        .map((m) => ({ nome: m.metric_name!, atual: Number(m.current_period), unidade: m.unit ?? 0, meta: m.target?.value ?? null, comparador: m.target?.comparator ?? null }));
      return {
        ...base,
        nota: o.rating ?? null, // 1 ruim, 2 precisa melhorar, 3 bom, 4 excelente
        falhas: (o.fulfillment_failed ?? 0) + (o.listing_failed ?? 0) + (o.custom_service_failed ?? 0),
        penalidade: pen?.response?.penalty_points?.overall_penalty_points ?? null,
        metricas,
      };
    })
  );
  return NextResponse.json({ lojas });
}
