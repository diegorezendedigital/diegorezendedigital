import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";
import { calcularLucro } from "@/lib/pricing";
import { CANAIS, faixaDoPreco } from "@/lib/taxas-publicas";
import type { Company, Product } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MARKETPLACE_ID = "shopee";
const JANELA_DIAS = 15; // a Shopee só deixa buscar pedidos em períodos de até 15 dias
const PAGINA = 50; // pedidos por chamada (a tela repete até terminar)
const NAO_CONTAM = new Set(["UNPAID", "CANCELLED", "IN_CANCEL"]);

type ItemPedido = {
  item_id: number;
  item_name?: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
};
type Pedido = {
  order_sn: string;
  order_status?: string;
  create_time?: number;
  recipient_address?: { state?: string };
  item_list?: ItemPedido[];
};
type Renda = {
  commission_fee?: number;
  service_fee?: number;
  seller_transaction_fee?: number;
  credit_card_transaction_fee?: number;
  voucher_from_seller?: number;
  actual_shipping_fee?: number;
  shopee_shipping_rebate?: number;
  buyer_paid_shipping_fee?: number;
};

const n = (v: unknown) => Number(v) || 0;
const chaveAnuncio = (i: ItemPedido) => (n(i.model_id) > 0 ? `${i.item_id}:${i.model_id}` : String(i.item_id));

// Importa os pedidos pagos da Shopee como vendas (uma linha por item). Mesmas regras do Mercado Livre:
// o custo vem do produto do armazém ligado ao anúncio, na data da venda, e o imposto do regime do CNPJ do anúncio.
// Taxas e frete vêm do extrato do pedido (escrow) quando a Shopee já o liberou; antes disso usa a tabela de taxas da Shopee.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["pedidos", "anuncios", "inicio", "integracoes"]); if (semAcesso) return semAcesso; }
  try {
    const storeId = user.id;
    const body = await req.json().catch(() => ({}));
    const shopId = String(body.shop_id ?? "");
    if (!shopId) return NextResponse.json({ error: "Informe a loja" }, { status: 400 });
    const token = await tokenShopee(storeId, shopId);
    if (!token) return NextResponse.json({ error: "Conecte sua loja da Shopee primeiro (Integrações)" }, { status: 400 });

    const dias = Math.min(Math.max(Number(body.days) || 30, 1), 90);
    const janela = Math.max(Number(body.janela) || 0, 0);
    const cursor = body.cursor ? String(body.cursor) : "";
    const totalJanelas = Math.ceil(dias / JANELA_DIAS);
    const agoraS = Math.floor(Date.now() / 1000);
    const de = agoraS - dias * 86400 + janela * JANELA_DIAS * 86400;
    const ate = Math.min(de + JANELA_DIAS * 86400, agoraS);

    const lista = await shopeeGet<{ response?: { more?: boolean; next_cursor?: string; order_list?: { order_sn: string }[] } }>(token, shopId, "/api/v2/order/get_order_list", {
      time_range_field: "create_time",
      time_from: de,
      time_to: ate,
      page_size: PAGINA,
      ...(cursor ? { cursor } : {}),
    });
    const sns = (lista.response?.order_list ?? []).map((o) => o.order_sn);
    const maisNaJanela = !!lista.response?.more;
    const proximoCursor = lista.response?.next_cursor ?? "";

    const proxima = maisNaJanela ? { janela, cursor: proximoCursor } : janela + 1 < totalJanelas ? { janela: janela + 1, cursor: "" } : null;
    const admin = supabaseAdmin();
    const resposta = (extra: { processed: number; imported: number; listings_created: number }) =>
      NextResponse.json({ ...extra, janela: proxima?.janela ?? janela, cursor: proxima?.cursor ?? "", total_janelas: totalJanelas, has_more: !!proxima });

    if (sns.length === 0) {
      if (!proxima) await admin.from("shopee_connections").update({ last_synced_at: new Date().toISOString() }).eq("store_id", storeId).eq("shop_id", shopId);
      return resposta({ processed: 0, imported: 0, listings_created: 0 });
    }

    const det = await shopeeGet<{ response?: { order_list?: Pedido[] } }>(token, shopId, "/api/v2/order/get_order_detail", {
      order_sn_list: sns.join(","),
      response_optional_fields: "item_list,recipient_address,pay_time,total_amount",
    });
    const pedidos = (det.response?.order_list ?? []).filter((p) => !NAO_CONTAM.has(String(p.order_status)) && (p.item_list?.length ?? 0) > 0);

    // Extrato (taxas, frete) de cada pedido — melhor esforço
    const renda = new Map<string, Renda>();
    for (let i = 0; i < pedidos.length; i += 5) {
      await Promise.all(
        pedidos.slice(i, i + 5).map(async (p) => {
          try {
            const e = await shopeeGet<{ response?: { order_income?: Renda } }>(token, shopId, "/api/v2/payment/get_escrow_detail", { order_sn: p.order_sn });
            if (e.response?.order_income) renda.set(p.order_sn, e.response.order_income);
          } catch {
            /* sem extrato ainda: usa a tabela de taxas */
          }
        })
      );
    }

    // Empresa, anúncios e produtos
    const { data: emps } = await admin.from("companies").select("*").eq("store_id", storeId);
    const empresas = new Map<string, Company>();
    let empresaPadrao: Company | null = null;
    ((emps ?? []) as Company[]).forEach((c) => {
      empresas.set(c.id, c);
      if (c.is_default) empresaPadrao = c;
    });
    const { data: conn } = await admin.from("shopee_connections").select("company_id").eq("store_id", storeId).eq("shop_id", shopId).maybeSingle();
    const empresaDaLoja = (conn?.company_id as string | null) ?? (empresaPadrao as Company | null)?.id ?? null;

    const itens = new Map<string, ItemPedido>();
    pedidos.forEach((p) => p.item_list!.forEach((i) => itens.set(chaveAnuncio(i), i)));
    const chaves = Array.from(itens.keys());

    type Anuncio = { id: string; product_id: string | null; company_id: string | null; units: number };
    const anuncios = new Map<string, Anuncio>();
    const skuDe = (i: ItemPedido) => (i.model_sku || i.item_sku || "").trim();
    const { data: existentes } = await admin.from("listings").select("id, external_id, product_id, company_id, units").eq("store_id", storeId).in("external_id", chaves);
    (existentes ?? []).forEach((l) => anuncios.set(l.external_id as string, { id: l.id, product_id: l.product_id, company_id: l.company_id, units: Number(l.units) || 1 }));

    // Produtos do armazém por SKU (sem diferenciar maiúsculas/minúsculas nem espaços)
    const normSku = (x: string) => x.trim().toLowerCase();
    const porSku = new Map<string, string>();
    {
      const skusPedido = Array.from(new Set(Array.from(itens.values()).map((i) => normSku(skuDe(i))).filter(Boolean)));
      if (skusPedido.length) {
        for (let de = 0; ; de += 1000) {
          const { data: prods } = await admin.from("products").select("id, sku").eq("store_id", storeId).not("sku", "is", null).range(de, de + 999);
          (prods ?? []).forEach((p) => { const k = normSku(String(p.sku ?? "")); if (k && skusPedido.includes(k) && !porSku.has(k)) porSku.set(k, p.id as string); });
          if (!prods || prods.length < 1000) break;
        }
      }
    }

    // Anúncios que já existiam sem produto ligado: liga pelo SKU do pedido (assim a venda pega o custo do armazém)
    for (const [c, an] of Array.from(anuncios.entries())) {
      if (an.product_id) continue;
      const pid = porSku.get(normSku(skuDe(itens.get(c)!)));
      if (!pid) continue;
      const { error } = await admin.from("listings").update({ product_id: pid }).eq("id", an.id).is("product_id", null);
      if (!error) an.product_id = pid;
    }

    // Produto do armazém com o mesmo SKU de cada item (reserva quando o anúncio está ligado a um produto sem custo ou que não existe mais)
    const prodPorChave = new Map<string, string>();
    chaves.forEach((c) => { const pid = porSku.get(normSku(skuDe(itens.get(c)!))); if (pid) prodPorChave.set(c, pid); });

    let anunciosCriados = 0;
    const faltam = chaves.filter((c) => !anuncios.has(c));
    if (faltam.length) {
      const novos = faltam.map((c) => {
        const i = itens.get(c)!;
        const nome = i.item_name || c;
        return {
          store_id: storeId,
          marketplace_id: MARKETPLACE_ID,
          external_id: c,
          ml_user_id: shopId,
          title: i.model_name ? `${nome} - ${i.model_name}` : nome,
          price: n(i.model_discounted_price) || n(i.model_original_price),
          ...(skuDe(i) ? { sku: skuDe(i) } : {}),
          product_id: porSku.get(normSku(skuDe(i))) ?? null,
          company_id: empresaDaLoja,
        };
      });
      const { data: criados, error } = await admin.from("listings").upsert(novos, { onConflict: "store_id,external_id", ignoreDuplicates: true }).select("id, external_id, product_id, company_id, units");
      if (error) throw new Error(error.message);
      (criados ?? []).forEach((l) => anuncios.set(l.external_id as string, { id: l.id, product_id: l.product_id, company_id: l.company_id, units: Number(l.units) || 1 }));
      anunciosCriados = criados?.length ?? 0;
    }

    const produtos = new Map<string, Product>();
    const prodIds = Array.from(new Set([...Array.from(anuncios.values()).map((a) => a.product_id), ...Array.from(prodPorChave.values())].filter(Boolean))) as string[];
    if (prodIds.length) {
      const { data: prods } = await admin.from("products").select("*").in("id", prodIds);
      ((prods ?? []) as Product[]).forEach((p) => produtos.set(p.id, p));
    }
    type CustoHist = { product_id: string; cost_price: number; icms_credit: number; pis_credit: number; cofins_credit: number; valid_from: string };
    const historico = new Map<string, CustoHist[]>();
    if (prodIds.length) {
      const { data: hs } = await admin.from("product_costs").select("*").in("product_id", prodIds).order("valid_from", { ascending: true });
      ((hs ?? []) as CustoHist[]).forEach((h) => historico.set(h.product_id, [...(historico.get(h.product_id) ?? []), h]));
    }
    const custoEm = (prod: Product, data: string) => {
      const lista = (historico.get(prod.id) ?? []).filter((h) => Number(h.cost_price) > 0);
      const t = new Date(data).getTime();
      const vigente = [...lista].reverse().find((h) => new Date(h.valid_from).getTime() <= t) ?? lista[0];
      return vigente
        ? { custo: Number(vigente.cost_price), credito: Number(vigente.icms_credit) + Number(vigente.pis_credit) + Number(vigente.cofins_credit) }
        : { custo: Number(prod.cost_price), credito: Number(prod.icms_credit) + Number(prod.pis_credit) + Number(prod.cofins_credit) };
    };

    const canal = CANAIS.find((c) => c.id === "shopee")!;
    // A parte fixa da taxa só é gravada se a coluna já existir no banco (migração 20261203)
    const temColunaFixa = !(await admin.from("sales").select("fees_fixed").limit(1)).error;
    const vendas = pedidos.flatMap((p) => {
      const itensP = p.item_list!;
      const soldAt = new Date(n(p.create_time) * 1000).toISOString();
      const valores = itensP.map((i) => (n(i.model_discounted_price) || n(i.model_original_price)) * (n(i.model_quantity_purchased) || 1));
      const totalPedido = valores.reduce((a, b) => a + b, 0) || 1;
      const r = renda.get(p.order_sn);
      // Taxas do pedido: do extrato quando existe; senão, pela tabela de taxas por faixa de preço (por item)
      const taxasExtrato = r ? n(r.commission_fee) + n(r.service_fee) + n(r.seller_transaction_fee) + n(r.credit_card_transaction_fee) + n(r.voucher_from_seller) : null;
      const freteLiquido = r ? Math.max(0, n(r.actual_shipping_fee) - n(r.shopee_shipping_rebate) - n(r.buyer_paid_shipping_fee)) : 0;
      const freteComprador = r ? n(r.buyer_paid_shipping_fee) : 0;
      return itensP.map((it, idx) => {
        const q = n(it.model_quantity_purchased) || 1;
        const preco = valores[idx];
        const an = anuncios.get(chaveAnuncio(it));
        const prodAn = an?.product_id ? produtos.get(an.product_id) : undefined;
        const histAn = prodAn ? custoEm(prodAn, soldAt) : { custo: 0, credito: 0 };
        const prodSkuId = prodPorChave.get(chaveAnuncio(it));
        const prodSku = prodSkuId && prodSkuId !== prodAn?.id ? produtos.get(prodSkuId) : undefined;
        const histSku = prodSku ? custoEm(prodSku, soldAt) : { custo: 0, credito: 0 };
        // Usa o produto ligado ao anúncio; se ele não tem custo (ou não existe mais), usa o produto com o mesmo SKU
        const usaSku = !(histAn.custo > 0) && histSku.custo > 0;
        const prod = usaSku ? prodSku : prodAn;
        const unidades = (usaSku ? 1 : an?.units ?? 1) * q;
        const hist = usaSku ? histSku : histAn;
        const custo = hist.custo * unidades;
        const credito = hist.credito * unidades;
        const empresa = (an?.company_id && empresas.get(an.company_id)) || (empresaPadrao as Company | null);
        let taxa: number;
        const unit = preco / q;
        const faixa = faixaDoPreco(canal, unit);
        const fixaTabela = (faixa.fixa === "metade" ? unit / 2 : faixa.fixa) * q;
        if (taxasExtrato !== null) taxa = (taxasExtrato * preco) / totalPedido;
        else taxa = (unit * faixa.comissao) / 100 * q + fixaTabela;
        const taxaFixa = Math.min(taxa, fixaTabela); // parte fixa (R$ por item) dentro da tarifa total
        const freteVenda = idx === 0 ? freteLiquido : 0;
        const imposto = empresa ? Math.max(0, calcularLucro(preco, { custo, credito, feePct: 0, feeFixo: taxa, frete: freteVenda, empresa }).impostos) : 0;
        return {
          store_id: storeId,
          product_id: prod?.id ?? null,
          listing_id: an?.id ?? null,
          marketplace_id: MARKETPLACE_ID,
          quantity: q,
          sale_price: preco,
          cost_price: custo,
          fees_total: Math.round(taxa * 100) / 100,
          ...(temColunaFixa ? { fees_fixed: Math.round(taxaFixa * 100) / 100 } : {}),
          shipping_cost: freteVenda,
          tax_amount: Math.round(imposto * 100) / 100,
          sold_at: soldAt,
          external_id: `${p.order_sn}:${chaveAnuncio(it)}`,
          order_number: p.order_sn,
          title: it.model_name && it.item_name ? `${it.item_name} - ${it.model_name}` : it.item_name || chaveAnuncio(it),
          sku: skuDe(it) || prod?.sku || null,
          buyer_state: p.recipient_address?.state ?? null,
          buyer_shipping: idx === 0 ? freteComprador : 0,
          pack_id: null,
          ml_user_id: shopId,
        };
      });
    });

    // Vendas que já têm custo ficam congeladas (só recebem dados do pedido, taxas e frete); as novas entram completas.
    let importadas = 0;
    if (vendas.length) {
      const { data: ja } = await admin.from("sales").select("id, external_id, cost_price, cost_manual").eq("store_id", storeId).in("external_id", vendas.map((v) => v.external_id));
      const jaMap = new Map<string, { id: string; cost_price: number; cost_manual: boolean }>(
        (ja ?? []).map((x) => [x.external_id as string, { id: x.id as string, cost_price: Number(x.cost_price), cost_manual: !!x.cost_manual }])
      );
      const novas = vendas.filter((v) => {
        const e = jaMap.get(v.external_id);
        return !e || e.cost_price === 0;
      });
      const congeladas = vendas.filter((v) => !novas.includes(v));
      if (novas.length) {
        const { data: ins, error } = await admin.from("sales").upsert(novas, { onConflict: "store_id,external_id" }).select("id");
        if (error) throw new Error(error.message);
        importadas = ins?.length ?? 0;
      }
      await Promise.all(
        congeladas.map((v) =>
          admin
            .from("sales")
            .update({
              order_number: v.order_number,
              title: v.title,
              ...(v.sku ? { sku: v.sku } : {}),
              buyer_state: v.buyer_state,
              buyer_shipping: v.buyer_shipping,
              ml_user_id: v.ml_user_id,
              listing_id: v.listing_id,
              fees_total: v.fees_total,
              ...(temColunaFixa ? { fees_fixed: (v as { fees_fixed?: number }).fees_fixed ?? 0 } : {}),
              shipping_cost: v.shipping_cost,
              ...(jaMap.get(v.external_id)?.cost_manual ? {} : { tax_amount: v.tax_amount }),
            })
            .eq("id", (jaMap.get(v.external_id) as { id: string }).id)
        )
      );
    }

    if (!proxima) await admin.from("shopee_connections").update({ last_synced_at: new Date().toISOString() }).eq("store_id", storeId).eq("shop_id", shopId);
    return resposta({ processed: pedidos.length, imported: importadas, listings_created: anunciosCriados });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao sincronizar a Shopee" }, { status: 500 });
  }
}
