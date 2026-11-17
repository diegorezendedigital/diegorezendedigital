import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { tokenShopee } from "@/lib/server/shopee";
import { executarRegra, itensDaOferta, type Regra } from "@/lib/server/shopee-relampago";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const erro = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
const falta = (m: string) => /shopee_flash_rules|schema cache|does not exist/i.test(m);

// Regras do robô de relâmpago da loja
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const shopId = new URL(req.url).searchParams.get("shop_id") ?? "";
  const { data, error } = await supabaseAdmin().from("shopee_flash_rules").select("*").eq("store_id", user.id).eq("shop_id", shopId).order("created_at");
  if (error) return NextResponse.json({ regras: [], precisaSQL: falta(error.message), error: falta(error.message) ? undefined : error.message });
  return NextResponse.json({ regras: data ?? [] });
}

// POST { acao: "salvar", regra } → cria ou altera (ao trocar a oferta modelo, copia os produtos e preços dela)
// POST { acao: "rodar", id }     → roda a regra agora
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const b = await req.json().catch(() => ({}));
  const admin = supabaseAdmin();
  try {
    if (b.acao === "rodar") {
      const { data } = await admin.from("shopee_flash_rules").select("*").eq("id", b.id).eq("store_id", user.id).maybeSingle();
      if (!data) return erro("Regra não encontrada");
      return NextResponse.json({ resultado: await executarRegra(data as Regra) });
    }
    const r = b.regra ?? {};
    const shopId = String(r.shop_id ?? "");
    const campos: Record<string, unknown> = {
      store_id: user.id,
      shop_id: shopId,
      nome: String(r.nome || "Robô de relâmpago").slice(0, 80),
      modo: ["todos", "diario", "agenda"].includes(r.modo) ? r.modo : "todos",
      dias_semana: Array.isArray(r.dias_semana) ? r.dias_semana.map(Number).filter((d: number) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6],
      hora_inicio: Math.min(Math.max(Number(r.hora_inicio) || 0, 0), 23),
      hora_fim: Math.min(Math.max(Number(r.hora_fim) || 24, 1), 24),
      dias_a_frente: Math.min(Math.max(Number(r.dias_a_frente) || 3, 1), 7),
      margem_minima: Number(r.margem_minima) || 0,
      imposto_pct: Number(r.imposto_pct ?? 10),
      taxa_extra_pct: Number(r.taxa_extra_pct ?? 5),
      ativo: r.ativo !== false,
    };
    if (r.modelo_flash_sale_id && Number(r.modelo_flash_sale_id) !== Number(r.modelo_atual ?? 0)) {
      const token = await tokenShopee(user.id, shopId);
      if (!token) return erro("Conecte sua loja da Shopee primeiro (Integrações)");
      const itens = (await itensDaOferta(token, shopId, Number(r.modelo_flash_sale_id))).filter((i) => i.ativo);
      if (!itens.length) return erro("A oferta modelo não tem produtos ativos");
      campos.modelo_flash_sale_id = Number(r.modelo_flash_sale_id);
      campos.modelo_itens = itens;
    }
    const q = r.id
      ? admin.from("shopee_flash_rules").update(campos).eq("id", r.id).eq("store_id", user.id).select().single()
      : admin.from("shopee_flash_rules").insert(campos).select().single();
    const { data, error } = await q;
    if (error) return erro(falta(error.message) ? "Rode o SQL do robô de relâmpago no Supabase antes de criar a regra." : error.message);
    return NextResponse.json({ regra: data });
  } catch (e) {
    return erro(e, 500);
  }
}

export async function DELETE(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["promo_shopee"]); if (semAcesso) return semAcesso; }
  const id = new URL(req.url).searchParams.get("id");
  const { error } = await supabaseAdmin().from("shopee_flash_rules").delete().eq("id", id).eq("store_id", user.id);
  if (error) return erro(error.message);
  return NextResponse.json({ ok: true });
}
