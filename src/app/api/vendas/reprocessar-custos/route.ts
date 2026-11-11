import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { calcularLucro } from "@/lib/pricing";
import type { Company } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Custo = { product_id: string; cost_price: number; icms_credit: number; pis_credit: number; cofins_credit: number; valid_from: string };

// Recalcula o custo (e o imposto) das vendas de um período usando o custo que estava cadastrado NA DATA DA VENDA.
// - Existe um custo vigente na data da venda → usa esse (mesmo que a venda já tivesse outro custo).
// - Não existe, mas a venda está sem custo → usa o custo mais antigo cadastrado (melhor informação disponível).
// - Não existe e a venda já tem custo → não mexe. Vendas com custo informado à mão nunca mudam.
// body: { de: "AAAA-MM-DD", ate: "AAAA-MM-DD" }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const inicioMs = Date.now();
  try {
    const b = await req.json().catch(() => ({}));
    const de = new Date(`${String(b.de)}T00:00:00-03:00`);
    const ate = new Date(`${String(b.ate)}T23:59:59.999-03:00`);
    if (isNaN(de.getTime()) || isNaN(ate.getTime())) return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });

    const admin = supabaseAdmin();
    const storeId = user.id;

    const vendas: { id: string; product_id: string | null; listing_id: string | null; quantity: number; sale_price: number; fees_total: number; shipping_cost: number; cost_price: number; cost_manual: boolean; sold_at: string }[] = [];
    for (let i = 0; i < 20000; i += 1000) {
      const { data, error } = await admin
        .from("sales")
        .select("id, product_id, listing_id, quantity, sale_price, fees_total, shipping_cost, cost_price, cost_manual, sold_at")
        .eq("store_id", storeId)
        .gte("sold_at", de.toISOString())
        .lte("sold_at", ate.toISOString())
        .order("sold_at")
        .range(i, i + 999);
      if (error) throw new Error(error.message);
      vendas.push(...((data ?? []) as typeof vendas));
      if ((data ?? []).length < 1000) break;
    }

    const { data: anuncios } = await admin.from("listings").select("id, product_id, company_id, units").eq("store_id", storeId);
    type Anuncio = { id: string; product_id: string | null; company_id: string | null; units: number | null };
    const anuncio = new Map<string, Anuncio>(((anuncios ?? []) as Anuncio[]).map((a) => [a.id, a]));
    const { data: emps } = await admin.from("companies").select("*").eq("store_id", storeId);
    const empresas = new Map(((emps ?? []) as Company[]).map((c) => [c.id, c]));
    const padrao = ((emps ?? []) as Company[]).find((c) => c.is_default) ?? null;

    const produtoDe = (v: (typeof vendas)[number]) => v.product_id ?? (v.listing_id ? anuncio.get(v.listing_id)?.product_id : null) ?? null;
    const prodIds = Array.from(new Set(vendas.map(produtoDe).filter(Boolean) as string[]));
    const historico = new Map<string, Custo[]>();
    for (let i = 0; i < prodIds.length; i += 200) {
      const { data } = await admin.from("product_costs").select("*").in("product_id", prodIds.slice(i, i + 200)).gt("cost_price", 0).order("valid_from");
      ((data ?? []) as Custo[]).forEach((h) => historico.set(h.product_id, [...(historico.get(h.product_id) ?? []), h]));
    }

    const r = { analisadas: vendas.length, reprocessadas: 0, mantidas: 0, manuais: 0, semCusto: 0 };
    const mudancas: { id: string; dados: Record<string, unknown> }[] = [];

    for (const v of vendas) {
      if (v.cost_manual) {
        r.manuais++;
        continue;
      }
      const pid = produtoDe(v);
      const lista = pid ? historico.get(pid) ?? [] : [];
      const t = new Date(v.sold_at).getTime();
      const vigente = [...lista].reverse().find((h) => new Date(h.valid_from).getTime() <= t);
      const escolhido = vigente ?? (Number(v.cost_price) === 0 ? lista[0] : undefined);
      if (!escolhido || !pid) {
        if (Number(v.cost_price) === 0) r.semCusto++;
        else r.mantidas++;
        continue;
      }
      const a = v.listing_id ? anuncio.get(v.listing_id) : undefined;
      const unidades = (Number(a?.units) || 1) * (Number(v.quantity) || 1);
      const custo = Math.round(Number(escolhido.cost_price) * unidades * 100) / 100;
      const credito = (Number(escolhido.icms_credit) + Number(escolhido.pis_credit) + Number(escolhido.cofins_credit)) * unidades;
      const empresa = (a?.company_id && empresas.get(a.company_id)) || padrao;
      const imposto = empresa
        ? Math.max(0, calcularLucro(Number(v.sale_price), { custo, credito, feePct: 0, feeFixo: Number(v.fees_total), frete: Number(v.shipping_cost), empresa }).impostos)
        : 0;
      if (Number(v.cost_price) === custo) {
        r.mantidas++;
        continue;
      }
      mudancas.push({ id: v.id, dados: { cost_price: custo, tax_amount: Math.round(imposto * 100) / 100, product_id: pid } });
    }

    for (let i = 0; i < mudancas.length; i += 25) {
      if (Date.now() - inicioMs > 50000) return NextResponse.json({ ...r, parcial: true });
      await Promise.all(mudancas.slice(i, i + 25).map((m) => admin.from("sales").update(m.dados).eq("id", m.id)));
      r.reprocessadas += Math.min(25, mudancas.length - i);
    }
    return NextResponse.json({ ...r, parcial: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao reprocessar os custos" }, { status: 500 });
  }
}
