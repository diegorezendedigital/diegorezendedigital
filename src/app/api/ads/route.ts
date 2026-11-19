import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections } from "@/lib/server/ml";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ML_API = "https://api.mercadolibre.com";
const DIA = 86_400_000;

export type ContaAds = {
  mp: "mercado_livre" | "shopee";
  conta: string; // id da conta (ml_user_id ou shop_id)
  nome: string;
  gasto: number; // investimento em ads no período
  vendasAds: number; // faturamento atribuído aos anúncios
  pedidosAds: number;
  cliques: number;
  impressoes: number;
  faturamento: number; // faturamento total da conta no período (pedidos sincronizados)
  dias: { data: string; gasto: number; vendasAds: number }[];
  erro?: string;
};

// Quebra o período em pedaços de até `max` dias (ML aceita até 90; Shopee até 30)
function pedacos(de: string, ate: string, max: number): [string, string][] {
  const r: [string, string][] = [];
  let ini = new Date(`${de}T12:00:00Z`).getTime();
  const fim = new Date(`${ate}T12:00:00Z`).getTime();
  while (ini <= fim) {
    const f = Math.min(fim, ini + (max - 1) * DIA);
    r.push([new Date(ini).toISOString().slice(0, 10), new Date(f).toISOString().slice(0, 10)]);
    ini = f + DIA;
  }
  return r;
}

const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);

async function mlAds(token: string, path: string, versao: string) {
  const res = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}`, "api-version": versao, "Api-Version": versao }, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json: json as Record<string, unknown> };
}

type Metricas = { cost?: number; total_amount?: number; units_quantity?: number; clicks?: number; prints?: number };

async function adsMercadoLivre(token: string, de: string, ate: string) {
  const adv = await mlAds(token, "/advertising/advertisers?product_id=PADS", "1");
  if (!adv.ok) {
    if (adv.status === 404) throw new Error("Publicidade (Product Ads) não está ativa nesta conta do Mercado Livre.");
    if (adv.status === 401 || adv.status === 403) throw new Error("O aplicativo não tem permissão de Publicidade nesta conta. Ative o escopo de Publicidade no app do Mercado Livre e reconecte a conta.");
    throw new Error(String((adv.json as { message?: string }).message || `Mercado Livre respondeu ${adv.status}`));
  }
  const lista = ((adv.json as { advertisers?: { advertiser_id: number; site_id?: string }[] }).advertisers ?? []);
  if (!lista.length) throw new Error("Publicidade (Product Ads) não está ativa nesta conta do Mercado Livre.");
  const advId = lista[0].advertiser_id;
  const site = lista[0].site_id || "MLB";
  const tot = { gasto: 0, vendasAds: 0, pedidosAds: 0, cliques: 0, impressoes: 0 };
  const porDia = new Map<string, { gasto: number; vendasAds: number }>();
  const metricas = "clicks,prints,cost,acos,total_amount,units_quantity";

  for (const [d1, d2] of pedacos(de, ate, 90)) {
    // Resumo do período (todas as campanhas)
    const q = `limit=50&offset=0&date_from=${d1}&date_to=${d2}&metrics=${metricas}&metrics_summary=true`;
    let r = await mlAds(token, `/advertising/${site}/advertisers/${advId}/product_ads/campaigns/search?${q}`, "2");
    let base = `/advertising/${site}/advertisers/${advId}/product_ads/campaigns/search`;
    if (!r.ok && r.status === 404) {
      base = `/marketplace/advertising/${site}/advertisers/${advId}/product_ads/campaigns/search`;
      r = await mlAds(token, `${base}?${q}`, "2");
    }
    if (!r.ok) throw new Error(String((r.json as { message?: string }).message || `Mercado Livre respondeu ${r.status}`));
    const j = r.json as { metrics_summary?: Metricas; results?: { metrics?: Metricas }[] };
    const s: Metricas = j.metrics_summary ?? (j.results ?? []).reduce<Metricas>((a, c) => {
      const m = c.metrics ?? {};
      return { cost: n(a.cost) + n(m.cost), total_amount: n(a.total_amount) + n(m.total_amount), units_quantity: n(a.units_quantity) + n(m.units_quantity), clicks: n(a.clicks) + n(m.clicks), prints: n(a.prints) + n(m.prints) };
    }, {});
    tot.gasto += n(s.cost);
    tot.vendasAds += n(s.total_amount);
    tot.pedidosAds += n(s.units_quantity);
    tot.cliques += n(s.clicks);
    tot.impressoes += n(s.prints);

    // Gasto por dia (para o gráfico); se falhar, segue só com o total
    const rd = await mlAds(token, `${base}?limit=50&offset=0&date_from=${d1}&date_to=${d2}&metrics=cost,total_amount&aggregation_type=DAILY`, "2").catch(() => null);
    const res = (rd?.ok ? (rd.json as { results?: Record<string, unknown>[] }).results : null) ?? [];
    for (const linha of res) {
      const data = String(linha.date ?? "").slice(0, 10);
      if (!data) continue;
      const m = (linha.metrics ?? linha) as Metricas;
      const a = porDia.get(data) ?? { gasto: 0, vendasAds: 0 };
      a.gasto += n(m.cost);
      a.vendasAds += n(m.total_amount);
      porDia.set(data, a);
    }
  }
  return { ...tot, dias: Array.from(porDia.entries()).map(([data, v]) => ({ data, ...v })) };
}

type DiaShopee = { date?: string; expense?: number; broad_gmv?: number; broad_order?: number; clicks?: number; impression?: number };

async function adsShopee(token: string, shopId: string, de: string, ate: string) {
  const tot = { gasto: 0, vendasAds: 0, pedidosAds: 0, cliques: 0, impressoes: 0 };
  const dias: { data: string; gasto: number; vendasAds: number }[] = [];
  const br = (d: string) => d.split("-").reverse().join("-"); // AAAA-MM-DD → DD-MM-AAAA
  for (const [d1, d2] of pedacos(de, ate, 30)) {
    let r: { response?: DiaShopee[] | { list?: DiaShopee[] } };
    try {
      r = await shopeeGet(token, shopId, "/api/v2/ads/get_all_cpc_ads_daily_performance", { start_date: br(d1), end_date: br(d2) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission|no_permission|not authorized|access/i.test(msg)) throw new Error("O aplicativo não tem permissão de Ads nesta loja Shopee. Ative a permissão de Ads no app da Shopee e autorize a loja de novo em Integrações.");
      throw new Error(msg);
    }
    const lista = Array.isArray(r.response) ? r.response : r.response?.list ?? [];
    for (const d of lista) {
      tot.gasto += n(d.expense);
      tot.vendasAds += n(d.broad_gmv);
      tot.pedidosAds += n(d.broad_order);
      tot.cliques += n(d.clicks);
      tot.impressoes += n(d.impression);
      const data = String(d.date ?? "");
      if (data) dias.push({ data: /^\d{2}-\d{2}-\d{4}$/.test(data) ? data.split("-").reverse().join("-") : data, gasto: n(d.expense), vendasAds: n(d.broad_gmv) });
    }
  }
  return { ...tot, dias };
}

// GET /api/ads?de=AAAA-MM-DD&ate=AAAA-MM-DD → gasto com ads de cada conta (Mercado Livre e Shopee)
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = exigirAba(user, ["ads"]);
  if (bloqueio) return bloqueio;

  const u = new URL(req.url);
  const ok = (x: string | null) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const de = ok(u.searchParams.get("de")) ? u.searchParams.get("de")! : hoje;
  const ate = ok(u.searchParams.get("ate")) ? u.searchParams.get("ate")! : hoje;
  if (de > ate) return NextResponse.json({ error: "Data inicial depois da final" }, { status: 400 });
  if (new Date(ate).getTime() - new Date(de).getTime() > 366 * DIA) return NextResponse.json({ error: "Escolha um período de até 1 ano" }, { status: 400 });

  const admin = supabaseAdmin();

  // Faturamento de cada conta no período (pedidos já sincronizados)
  const faturamento = new Map<string, number>();
  for (let i = 0; ; i += 1000) {
    const { data } = await admin
      .from("sales")
      .select("ml_user_id, sale_price")
      .eq("store_id", user.id)
      .gte("sold_at", `${de}T00:00:00-03:00`)
      .lte("sold_at", `${ate}T23:59:59.999-03:00`)
      .range(i, i + 999);
    (data ?? []).forEach((s) => { const k = String(s.ml_user_id ?? ""); faturamento.set(k, (faturamento.get(k) ?? 0) + n(s.sale_price)); });
    if (!data || data.length < 1000) break;
  }

  const contasML = await listConnections(user.id).catch(() => []);
  const { data: lojasShopee } = await admin.from("shopee_connections").select("shop_id, shop_name, store_name").eq("store_id", user.id);

  const vazio = { gasto: 0, vendasAds: 0, pedidosAds: 0, cliques: 0, impressoes: 0, dias: [] as ContaAds["dias"] };
  const tarefas: Promise<ContaAds>[] = [
    ...contasML.map(async (c): Promise<ContaAds> => {
      const base = { mp: "mercado_livre" as const, conta: c.ml_user_id, nome: c.store_name || c.nickname || c.ml_user_id, faturamento: faturamento.get(c.ml_user_id) ?? 0 };
      try {
        const token = await getAccessToken(user.id, c.ml_user_id);
        if (!token) return { ...base, ...vazio, erro: "Conta sem acesso. Reconecte em Integrações." };
        return { ...base, ...(await adsMercadoLivre(token, de, ate)) };
      } catch (e) {
        return { ...base, ...vazio, erro: e instanceof Error ? e.message : String(e) };
      }
    }),
    ...(lojasShopee ?? []).map(async (l): Promise<ContaAds> => {
      const shopId = String(l.shop_id);
      const base = { mp: "shopee" as const, conta: shopId, nome: String(l.store_name || l.shop_name || shopId), faturamento: faturamento.get(shopId) ?? 0 };
      try {
        const token = await tokenShopee(user.id, shopId);
        if (!token) return { ...base, ...vazio, erro: "Loja sem acesso. Autorize de novo em Integrações." };
        return { ...base, ...(await adsShopee(token, shopId, de, ate)) };
      } catch (e) {
        return { ...base, ...vazio, erro: e instanceof Error ? e.message : String(e) };
      }
    }),
  ];
  const contas = await Promise.all(tarefas);
  return NextResponse.json({ de, ate, contas });
}
