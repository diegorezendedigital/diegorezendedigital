import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections } from "@/lib/server/ml";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ML_API = "https://api.mercadolibre.com";
const DIA = 86_400_000;
const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);

export type Devolucao = {
  mp: "mercado_livre" | "shopee";
  conta: string;
  contaNome: string;
  id: string; // id da reclamação (ML) ou return_sn (Shopee)
  pedido: string;
  data: string; // ISO
  tipo: string; // reclamação, devolução, mediação…
  motivo: string;
  status: string; // texto já traduzido
  aberta: boolean;
  resultado: "comprador" | "vendedor" | "andamento" | "cancelada";
  produto: string;
  sku: string | null;
  qtd: number;
  venda: number; // valor da venda
  reembolso: number; // valor devolvido ao comprador
  freteIda: number; // frete da venda pago pelo vendedor
  freteVolta: number; // frete da devolução cobrado do vendedor
  produtoPerdido: number; // custo do produto quando ele não volta
  produtoVoltou: boolean | null;
  custo: number; // custo total estimado para o vendedor
  link?: string;
};

type Venda = { order_number: string; pack_id: string | null; title: string | null; sku: string | null; quantity: number | null; sale_price: number | null; shipping_cost: number | null; cost_price: number | null };

// Roda tarefas com no máximo `lim` ao mesmo tempo
async function emLotes<T, R>(itens: T[], lim: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(lim, itens.length) }, async () => {
      while (i < itens.length) {
        const k = i++;
        out[k] = await fn(itens[k]);
      }
    })
  );
  return out;
}

async function mlGetJson(token: string, path: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String((j as { message?: string }).message || `Mercado Livre respondeu ${r.status}`));
  return j as Record<string, unknown>;
}

// Motivo pelo prefixo do código quando a API não devolve o nome
function motivoPorCodigo(cod: string) {
  if (cod.startsWith("PNR")) return "Produto não chegou";
  if (cod.startsWith("PDD")) return "Produto com defeito ou diferente do anúncio";
  if (cod.startsWith("CS")) return "Cancelamento da compra";
  return cod || "—";
}

const STATUS_DEV_ML: Record<string, string> = {
  pending: "Devolução criada",
  label_generated: "Etiqueta gerada",
  shipped: "Produto a caminho de volta",
  delivered: "Produto chegou de volta",
  not_delivered: "Produto não chegou de volta",
  closed: "Devolução encerrada",
  expired: "Devolução expirada",
  cancelled: "Devolução cancelada",
  failed: "Devolução falhou",
  return_to_buyer: "Voltando para o comprador",
};

async function devolucoesML(storeId: string, conta: { ml_user_id: string; nome: string }, de: string, ate: string, vendas: (pedidos: string[]) => Promise<Map<string, Venda>>): Promise<Devolucao[]> {
  const token = await getAccessToken(storeId, conta.ml_user_id);
  if (!token) throw new Error("Conta sem acesso. Reconecte em Integrações.");
  const faixa = `date_created:after:${de}T00:00:00.000-03:00,before:${ate}T23:59:59.999-03:00`;
  const claims: Record<string, unknown>[] = [];
  for (let off = 0; off < 300; off += 50) {
    const j = await mlGetJson(token, `/post-purchase/v1/claims/search?player_role=respondent&player_user_id=${conta.ml_user_id}&range=${encodeURIComponent(faixa)}&sort=date_created:desc&limit=50&offset=${off}`);
    const d = (j.data as Record<string, unknown>[]) ?? [];
    claims.push(...d);
    const total = n((j.paging as { total?: number })?.total);
    if (d.length < 50 || claims.length >= total) break;
  }
  const doPedido = claims.filter((c) => !c.resource || c.resource === "order");
  const mapa = await vendas(doPedido.map((c) => String(c.resource_id)));
  const nomes = new Map<string, string>();

  return emLotes(doPedido.slice(0, 150), 5, async (c): Promise<Devolucao> => {
    const id = String(c.id);
    const pedido = String(c.resource_id ?? "");
    const v = mapa.get(pedido);
    const codigo = String(c.reason_id ?? "");
    // Nome do motivo
    let motivo = nomes.get(codigo);
    if (!motivo) {
      motivo = await mlGetJson(token, `/post-purchase/v1/claims/reasons/${codigo}`)
        .then((r) => String(r.detail || r.name || "") || motivoPorCodigo(codigo))
        .catch(() => motivoPorCodigo(codigo));
      nomes.set(codigo, motivo);
    }
    const aberta = String(c.status) !== "closed";
    const resolucao = (c.resolution ?? {}) as { reason?: string; benefited?: string[] };
    const ganhouComprador = (resolucao.benefited ?? []).includes("complainant");
    const ganhouVendedor = (resolucao.benefited ?? []).includes("respondent");
    const resultado: Devolucao["resultado"] = aberta ? "andamento" : ganhouComprador ? "comprador" : ganhouVendedor ? "vendedor" : "cancelada";

    // Devolução ligada à reclamação: status e frete de volta
    let freteVolta = 0;
    let produtoVoltou: boolean | null = null;
    let statusDev = "";
    const temDevolucao = ((c.related_entities as string[]) ?? []).includes("return");
    if (temDevolucao) {
      try {
        const ret = await mlGetJson(token, `/post-purchase/v2/claims/${id}/returns`);
        statusDev = String(ret.status ?? "");
        const envios = ((ret.shipments as { shipment_id?: number; status?: string }[]) ?? []).filter((s) => s.shipment_id);
        produtoVoltou = envios.some((s) => s.status === "delivered") || statusDev === "delivered" ? true : ["not_delivered", "expired", "failed"].includes(statusDev) ? false : null;
        for (const s of envios) {
          const custos = await mlGetJson(token, `/shipments/${s.shipment_id}/costs`, { "x-format-new": "true" }).catch(() => null);
          if (!custos) continue;
          const eu = conta.ml_user_id;
          const rec = custos.receiver as { user_id?: number; cost?: number } | undefined;
          const env = (custos.senders as { user_id?: number; cost?: number }[]) ?? [];
          freteVolta += (rec && String(rec.user_id) === eu ? n(rec.cost) : 0) + env.filter((x) => String(x.user_id) === eu).reduce((t, x) => t + n(x.cost), 0);
        }
      } catch {
        /* segue sem os dados da devolução */
      }
    }
    if (resolucao.reason === "prefered_to_keep_product") produtoVoltou = false;

    const venda = n(v?.sale_price);
    const reembolso = resultado === "comprador" ? venda : 0;
    const freteIda = resultado === "comprador" ? n(v?.shipping_cost) : 0;
    // Produto perdido: comprador ganhou e o produto não voltou
    const produtoPerdido = resultado === "comprador" && produtoVoltou !== true && (produtoVoltou === false || !temDevolucao) ? n(v?.cost_price) : 0;
    const tipoTxt = String(c.stage) === "dispute" ? "Mediação" : temDevolucao ? "Devolução" : String(c.type) === "cancel_purchase" ? "Cancelamento" : "Reclamação";
    return {
      mp: "mercado_livre",
      conta: conta.ml_user_id,
      contaNome: conta.nome,
      id,
      pedido,
      data: String(c.date_created ?? ""),
      tipo: tipoTxt,
      motivo,
      status: STATUS_DEV_ML[statusDev] ?? (aberta ? (String(c.stage) === "dispute" ? "Em mediação" : "Aberta") : "Encerrada"),
      aberta,
      resultado,
      produto: v?.title ?? "—",
      sku: v?.sku ?? null,
      qtd: n(v?.quantity) || 1,
      venda,
      reembolso,
      freteIda,
      freteVolta: Math.round(freteVolta * 100) / 100,
      produtoPerdido,
      produtoVoltou,
      custo: Math.round((freteIda + freteVolta + produtoPerdido) * 100) / 100,
      link: `https://www.mercadolivre.com.br/vendas/${pedido}/detalhe`,
    };
  });
}

const STATUS_SHOPEE: Record<string, string> = {
  REQUESTED: "Pedido de devolução",
  ACCEPTED: "Devolução aceita",
  CANCELLED: "Cancelada",
  JUDGING: "Em análise da Shopee",
  CLOSED: "Encerrada",
  PROCESSING: "Em andamento",
  SELLER_DISPUTE: "Em disputa",
  REFUND_PAID: "Reembolsado",
};

type RetornoShopee = {
  return_sn?: number | string;
  order_sn?: string;
  status?: string;
  reason?: string;
  text_reason?: string;
  refund_amount?: number;
  create_time?: number;
  needs_logistics?: boolean;
  item?: { name?: string; item_sku?: string; variation_sku?: string; amount?: number }[];
};

const MOTIVO_SHOPEE: Record<string, string> = {
  NOT_RECEIPT: "Produto não chegou",
  WRONG_ITEM: "Produto errado",
  ITEM_DAMAGED: "Produto danificado",
  DIFFERENT_DESCRIPTION: "Diferente do anúncio",
  MUTUAL_AGREE: "Acordo com o vendedor",
  OTHER: "Outro motivo",
  ITEM_WRONGDAMAGED: "Produto errado ou danificado",
  CHANGE_MIND: "Desistência",
  ITEM_MISSING: "Faltou item",
  EXPECTATION_FAILED: "Não atendeu à expectativa",
  ITEM_FAKE: "Produto falsificado",
  PHYSICAL_DMG: "Dano físico",
  FUNCTIONAL_DMG: "Defeito de funcionamento",
};

async function devolucoesShopee(storeId: string, loja: { shop_id: string; nome: string }, de: string, ate: string, vendas: (pedidos: string[]) => Promise<Map<string, Venda>>): Promise<Devolucao[]> {
  const token = await tokenShopee(storeId, loja.shop_id);
  if (!token) throw new Error("Loja sem acesso. Autorize de novo em Integrações.");
  const lista: RetornoShopee[] = [];
  // A Shopee aceita no máximo 15 dias por consulta
  let ini = new Date(`${de}T00:00:00-03:00`).getTime();
  const fim = new Date(`${ate}T23:59:59-03:00`).getTime();
  while (ini <= fim) {
    const f = Math.min(fim, ini + 15 * DIA - 1000);
    for (let pg = 0; pg < 10; pg++) {
      const r = await shopeeGet<{ response?: { return?: RetornoShopee[]; more?: boolean } }>(token, loja.shop_id, "/api/v2/returns/get_return_list", {
        page_no: pg,
        page_size: 100,
        create_time_from: Math.floor(ini / 1000),
        create_time_to: Math.floor(f / 1000),
      });
      lista.push(...(r.response?.return ?? []));
      if (!r.response?.more) break;
    }
    ini = f + 1000;
  }
  const mapa = await vendas(lista.map((x) => String(x.order_sn ?? "")));

  return emLotes(lista.slice(0, 150), 5, async (x): Promise<Devolucao> => {
    const pedido = String(x.order_sn ?? "");
    const v = mapa.get(pedido);
    // Frete de volta cobrado do vendedor vem do extrato do pedido
    let freteVolta = 0;
    let freteIdaExtrato: number | null = null;
    try {
      const e = await shopeeGet<{ response?: { order_income?: Record<string, number> } }>(token, loja.shop_id, "/api/v2/payment/get_escrow_detail", { order_sn: pedido });
      const oi = e.response?.order_income ?? {};
      freteVolta = Math.abs(n(oi.reverse_shipping_fee));
      if ("actual_shipping_fee" in oi) freteIdaExtrato = Math.max(0, n(oi.actual_shipping_fee) - n(oi.shopee_shipping_rebate) - n(oi.buyer_paid_shipping_fee));
    } catch {
      /* extrato ainda não liberado */
    }
    const st = String(x.status ?? "");
    const aberta = !["CLOSED", "CANCELLED", "REFUND_PAID"].includes(st);
    const resultado: Devolucao["resultado"] = st === "CANCELLED" ? "cancelada" : st === "REFUND_PAID" || (st === "CLOSED" && n(x.refund_amount) > 0) ? "comprador" : aberta ? "andamento" : "vendedor";
    const reembolso = resultado === "comprador" ? n(x.refund_amount) : 0;
    // Sem logística reversa = reembolso sem devolução: o produto fica com o comprador
    const produtoVoltou = x.needs_logistics === false ? false : null;
    const produtoPerdido = resultado === "comprador" && x.needs_logistics === false ? n(v?.cost_price) : 0;
    const freteIda = resultado === "comprador" ? freteIdaExtrato ?? n(v?.shipping_cost) : 0;
    const it = x.item?.[0];
    return {
      mp: "shopee",
      conta: loja.shop_id,
      contaNome: loja.nome,
      id: String(x.return_sn ?? ""),
      pedido,
      data: x.create_time ? new Date(x.create_time * 1000).toISOString() : "",
      tipo: x.needs_logistics === false ? "Reembolso sem devolução" : "Devolução",
      motivo: MOTIVO_SHOPEE[String(x.reason ?? "")] ?? (x.text_reason || String(x.reason ?? "—")),
      status: STATUS_SHOPEE[st] ?? st,
      aberta,
      resultado,
      produto: it?.name ?? v?.title ?? "—",
      sku: it?.variation_sku || it?.item_sku || v?.sku || null,
      qtd: (x.item ?? []).reduce((t, i) => t + (n(i.amount) || 1), 0) || n(v?.quantity) || 1,
      venda: n(v?.sale_price),
      reembolso,
      freteIda,
      freteVolta,
      produtoPerdido,
      produtoVoltou,
      custo: Math.round((freteIda + freteVolta + produtoPerdido) * 100) / 100,
    };
  });
}

// GET /api/devolucoes?de=AAAA-MM-DD&ate=AAAA-MM-DD → reclamações e devoluções de todas as contas, com custo estimado
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = exigirAba(user, ["devolucoes", "pedidos"]);
  if (bloqueio) return bloqueio;

  const u = new URL(req.url);
  const ok = (x: string | null) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const de = ok(u.searchParams.get("de")) ? u.searchParams.get("de")! : `${hoje.slice(0, 7)}-01`;
  const ate = ok(u.searchParams.get("ate")) ? u.searchParams.get("ate")! : hoje;
  if (de > ate) return NextResponse.json({ error: "Data inicial depois da final" }, { status: 400 });
  if (new Date(ate).getTime() - new Date(de).getTime() > 92 * DIA) return NextResponse.json({ error: "Escolha um período de até 3 meses" }, { status: 400 });

  const admin = supabaseAdmin();
  // Busca as vendas dos pedidos (por número do pedido ou do pacote)
  const vendas = async (pedidos: string[]) => {
    const m = new Map<string, Venda>();
    const ids = Array.from(new Set(pedidos.filter(Boolean)));
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const { data } = await admin
        .from("sales")
        .select("order_number, pack_id, title, sku, quantity, sale_price, shipping_cost, cost_price")
        .eq("store_id", user.id)
        .or(`order_number.in.(${lote.join(",")}),pack_id.in.(${lote.join(",")})`);
      for (const s of (data ?? []) as Venda[]) {
        for (const k of [s.order_number, s.pack_id].filter(Boolean) as string[]) {
          const a = m.get(k);
          // Pacote com vários itens: soma valores e junta os nomes
          if (a && a !== s) {
            m.set(k, {
              ...a,
              title: a.title === s.title ? a.title : `${a.title ?? ""} + ${s.title ?? ""}`,
              sale_price: n(a.sale_price) + n(s.sale_price),
              shipping_cost: Math.max(n(a.shipping_cost), n(s.shipping_cost)),
              cost_price: n(a.cost_price) + n(s.cost_price),
              quantity: n(a.quantity) + n(s.quantity),
            });
          } else m.set(k, s);
        }
      }
    }
    return m;
  };

  const contasML = await listConnections(user.id).catch(() => []);
  const { data: lojasShopee } = await admin.from("shopee_connections").select("shop_id, shop_name, store_name").eq("store_id", user.id);
  const erros: string[] = [];
  const partes = await Promise.all([
    ...contasML.map((c) =>
      devolucoesML(user.id, { ml_user_id: c.ml_user_id, nome: c.store_name || c.nickname || c.ml_user_id }, de, ate, vendas).catch((e) => {
        erros.push(`${c.store_name || c.nickname || "Mercado Livre"}: ${e instanceof Error ? e.message : String(e)}`);
        return [] as Devolucao[];
      })
    ),
    ...(lojasShopee ?? []).map((l) =>
      devolucoesShopee(user.id, { shop_id: String(l.shop_id), nome: String(l.store_name || l.shop_name || l.shop_id) }, de, ate, vendas).catch((e) => {
        erros.push(`${l.store_name || l.shop_name || "Shopee"}: ${e instanceof Error ? e.message : String(e)}`);
        return [] as Devolucao[];
      })
    ),
  ]);
  const itens = partes.flat().sort((a, b) => (a.data < b.data ? 1 : -1));

  // Total de pedidos do período, para a taxa de reclamação
  const { count } = await admin
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("store_id", user.id)
    .gte("sold_at", `${de}T00:00:00-03:00`)
    .lte("sold_at", `${ate}T23:59:59.999-03:00`);

  return NextResponse.json({ de, ate, itens, erros, totalPedidos: count ?? 0 });
}
