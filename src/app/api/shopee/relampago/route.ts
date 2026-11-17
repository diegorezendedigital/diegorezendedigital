import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { shopeePost, tokenShopee } from "@/lib/server/shopee";
import { criarOfertaComItens, editarItensOferta, horariosDisponiveis, horariosOcupados, itensDaOferta, margensDosItens, type ItemRelampago, type MudancaRelampago } from "@/lib/server/shopee-relampago";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const erro = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

// GET ?shop_id=&flash_sale_id=  → produtos da oferta (com margem)
// GET ?shop_id=&horarios=1&dias=7 → horários livres para criar oferta
// GET ?shop_id=&anuncios=1 → anúncios da Shopee importados, para montar uma oferta nova
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const u = new URL(req.url);
  const shopId = u.searchParams.get("shop_id") ?? "";
  try {
    if (u.searchParams.get("anuncios")) {
      const { data } = await supabaseAdmin()
        .from("listings").select("external_id, title, price, thumbnail, sku, status").eq("store_id", user.id).eq("marketplace_id", "shopee").eq("ml_user_id", shopId).order("title").limit(3000);
      return NextResponse.json({ anuncios: data ?? [] });
    }
    const token = await tokenShopee(user.id, shopId);
    if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
    if (u.searchParams.get("horarios")) {
      const dias = Math.min(Math.max(Number(u.searchParams.get("dias")) || 7, 1), 14);
      const agora = Math.floor(Date.now() / 1000);
      const [lista, ocup] = await Promise.all([horariosDisponiveis(token, shopId, agora, agora + dias * 86400), horariosOcupados(token, shopId)]);
      return NextResponse.json({ horarios: lista.map((h) => ({ ...h, ocupado: ocup.slots.has(h.timeslot_id) || ocup.inicios.has(h.start_time) })) });
    }
    const id = Number(u.searchParams.get("flash_sale_id"));
    if (!id) return erro("Informe a oferta");
    const itens = await itensDaOferta(token, shopId, id);
    return NextResponse.json({ itens: await margensDosItens(user.id, itens, 10, 5) });
  } catch (e) {
    return erro(e, 500);
  }
}

// POST { acao: "criar", shop_id, timeslot_id, itens }           → oferta nova com os produtos escolhidos
// POST { acao: "duplicar", shop_id, flash_sale_id, timeslot_ids } → copia a oferta para outros horários
// POST { acao: "status", shop_id, flash_sale_id, ativar }         → ativa ou desativa a oferta
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const b = await req.json().catch(() => ({}));
  const shopId = String(b.shop_id ?? "");
  const token = await tokenShopee(user.id, shopId);
  if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
  try {
    if (b.acao === "status") {
      await shopeePost(token, shopId, "/api/v2/shop_flash_sale/update_shop_flash_sale", { flash_sale_id: Number(b.flash_sale_id), status: b.ativar ? 1 : 2 });
      return NextResponse.json({ ok: true });
    }
    if (b.acao === "itens") {
      const mud = (b.mudancas ?? []) as MudancaRelampago[];
      if (!mud.length) return erro("Nada para salvar");
      return NextResponse.json(await editarItensOferta(token, shopId, Number(b.flash_sale_id), mud));
    }
    if (b.acao === "criar") {
      const itens = (b.itens ?? []) as ItemRelampago[];
      if (!itens.length) return erro("Escolha ao menos um produto");
      return NextResponse.json(await criarOfertaComItens(token, shopId, Number(b.timeslot_id), itens));
    }
    if (b.acao === "duplicar") {
      const itens = (await itensDaOferta(token, shopId, Number(b.flash_sale_id))).filter((i) => i.ativo);
      if (!itens.length) return erro("A oferta modelo não tem produtos ativos");
      const criadas: { timeslot_id: number; flash_sale_id?: number; recusados?: number; erro?: string }[] = [];
      for (const ts of (b.timeslot_ids ?? []) as number[]) {
        try {
          const c = await criarOfertaComItens(token, shopId, Number(ts), itens);
          criadas.push({ timeslot_id: ts, flash_sale_id: c.flash_sale_id, recusados: c.recusados.length });
        } catch (e) {
          criadas.push({ timeslot_id: ts, erro: e instanceof Error ? e.message : String(e) });
        }
      }
      return NextResponse.json({ criadas });
    }
    return erro("Ação desconhecida");
  } catch (e) {
    return erro(e, 500);
  }
}
