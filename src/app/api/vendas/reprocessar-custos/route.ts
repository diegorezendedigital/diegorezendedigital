import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { calcularLucro } from "@/lib/pricing";
import { IndiceSku } from "@/lib/sku";
import type { Company } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Custo = { product_id: string; cost_price: number; icms_credit: number; pis_credit: number; cofins_credit: number; valid_from: string };

// Recalcula o custo (e o imposto) das vendas de um período usando o custo que estava cadastrado NA DATA DA VENDA.
// - Existe um custo vigente na data da venda → usa esse (mesmo que a venda já tivesse outro custo).
// - Não existe, mas a venda está sem custo → usa o custo mais antigo cadastrado (melhor informação disponível).
// - Não existe e a venda já tem custo → não mexe. Vendas com custo informado à mão nunca mudam.
// O produto vem do anúncio ligado; sem ele, do SKU da venda ou do anúncio (sem diferenciar maiúsculas, acentos nem espaço/hífen).
// Anúncio sem produto que casa pelo SKU é ligado ao produto, para as próximas vendas já entrarem com custo.
// body: { de: "AAAA-MM-DD", ate: "AAAA-MM-DD", modo?: "sem_custo_atual" }
// modo "sem_custo_atual": só vendas SEM custo, usando o custo ATUAL do produto (o de hoje), não o da data da venda.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["pedidos"]); if (semAcesso) return semAcesso; }
  const inicioMs = Date.now();
  try {
    const b = await req.json().catch(() => ({}));
    const de = new Date(`${String(b.de)}T00:00:00-03:00`);
    const ate = new Date(`${String(b.ate)}T23:59:59.999-03:00`);
    if (isNaN(de.getTime()) || isNaN(ate.getTime())) return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });

    const admin = supabaseAdmin();
    const storeId = user.id;

    const vendas: { id: string; order_number: string | null; title: string | null; product_id: string | null; listing_id: string | null; sku: string | null; quantity: number; sale_price: number; fees_total: number; shipping_cost: number; cost_price: number; cost_manual: boolean; sold_at: string }[] = [];
    for (let i = 0; i < 20000; i += 1000) {
      let q = admin
        .from("sales")
        .select("id, order_number, title, product_id, listing_id, sku, quantity, sale_price, fees_total, shipping_cost, cost_price, cost_manual, sold_at")
        .eq("store_id", storeId)
        .gte("sold_at", de.toISOString())
        .lte("sold_at", ate.toISOString());
      if (Array.isArray(b.lojas) && b.lojas.length) q = q.in("ml_user_id", b.lojas.map(String)); // só as lojas escolhidas (Mercado Livre ou Shopee)
      const { data, error } = await q.order("sold_at").range(i, i + 999);
      if (error) throw new Error(error.message);
      vendas.push(...((data ?? []) as typeof vendas));
      if ((data ?? []).length < 1000) break;
    }

    // Anúncios: o banco devolve no máximo 1000 linhas por consulta, então busca em blocos (antes os anúncios
    // depois do 1000º não eram vistos e a venda ficava sem produto).
    type Anuncio = { id: string; product_id: string | null; company_id: string | null; units: number | null; sku: string | null };
    const anuncio = new Map<string, Anuncio>();
    const idsAnuncio = Array.from(new Set(vendas.map((v) => v.listing_id).filter(Boolean) as string[]));
    for (let i = 0; i < idsAnuncio.length; i += 100) {
      const { data, error } = await admin.from("listings").select("id, product_id, company_id, units, sku").eq("store_id", storeId).in("id", idsAnuncio.slice(i, i + 100));
      if (error) throw new Error(error.message);
      ((data ?? []) as Anuncio[]).forEach((a) => anuncio.set(a.id, a));
    }
    const { data: emps } = await admin.from("companies").select("*").eq("store_id", storeId);
    const empresas = new Map(((emps ?? []) as Company[]).map((c) => [c.id, c]));
    const padrao = ((emps ?? []) as Company[]).find((c) => c.is_default) ?? null;

    // Produtos do armazém (para o custo atual e para achar o produto pelo SKU da venda)
    type Prod = { id: string; sku: string | null; cost_price: number | null; icms_credit: number | null; pis_credit: number | null; cofins_credit: number | null };
    const produtos = new Map<string, Prod>();
    const porSku = new IndiceSku<string>();
    for (let i = 0; ; i += 1000) {
      const { data, error } = await admin.from("products").select("id, sku, cost_price, icms_credit, pis_credit, cofins_credit").eq("store_id", storeId).order("id").range(i, i + 999);
      if (error) throw new Error(error.message);
      ((data ?? []) as Prod[]).forEach((p) => {
        produtos.set(p.id, p);
        porSku.add(p.sku, p.id, Number(p.cost_price) > 0 ? 1 : 0); // entre dois produtos com o mesmo SKU, vale o que tem custo
      });
      if (!data || data.length < 1000) break;
    }

    type V = (typeof vendas)[number];
    const produtoLigado = (v: V) => v.product_id ?? (v.listing_id ? anuncio.get(v.listing_id)?.product_id : null) ?? null;
    // SKU da venda; sem ele, o SKU gravado no anúncio
    const skuDaVenda = (v: V) => (v.sku ?? "").trim() || (v.listing_id ? (anuncio.get(v.listing_id)?.sku ?? "").trim() : "");
    const produtoSku = (v: V) => {
      const a = v.listing_id ? anuncio.get(v.listing_id) : undefined;
      return porSku.get(v.sku) ?? porSku.get(a?.sku) ?? null;
    };
    const prodIds = Array.from(new Set(vendas.flatMap((v) => [produtoLigado(v), produtoSku(v)]).filter(Boolean) as string[]));
    const historico = new Map<string, Custo[]>();
    for (let i = 0; i < prodIds.length; i += 200) {
      const { data } = await admin.from("product_costs").select("*").in("product_id", prodIds.slice(i, i + 200)).gt("cost_price", 0).order("valid_from");
      ((data ?? []) as Custo[]).forEach((h) => historico.set(h.product_id, [...(historico.get(h.product_id) ?? []), h]));
    }
    // Custo do produto na data da venda: histórico; sem histórico, o custo cadastrado no produto
    const custoNaData = (pid: string | null, v: V): Custo | undefined => {
      if (!pid) return undefined;
      const lista = historico.get(pid) ?? [];
      const t = new Date(v.sold_at).getTime();
      const vigente = [...lista].reverse().find((h) => new Date(h.valid_from).getTime() <= t);
      if (vigente) return vigente;
      if (Number(v.cost_price) !== 0) return undefined; // venda com custo: só muda se houver histórico vigente
      if (lista[0]) return lista[0];
      const p = produtos.get(pid);
      return p && Number(p.cost_price) > 0
        ? { product_id: pid, cost_price: Number(p.cost_price), icms_credit: Number(p.icms_credit) || 0, pis_credit: Number(p.pis_credit) || 0, cofins_credit: Number(p.cofins_credit) || 0, valid_from: v.sold_at }
        : undefined;
    };

    // Custo de hoje: o cadastrado no produto; sem ele, o último do histórico
    const custoAtual = (pid: string | null, v: V): Custo | undefined => {
      if (!pid) return undefined;
      const p = produtos.get(pid);
      if (p && Number(p.cost_price) > 0)
        return { product_id: pid, cost_price: Number(p.cost_price), icms_credit: Number(p.icms_credit) || 0, pis_credit: Number(p.pis_credit) || 0, cofins_credit: Number(p.cofins_credit) || 0, valid_from: v.sold_at };
      const lista = historico.get(pid) ?? [];
      return lista[lista.length - 1];
    };
    const soSemCusto = b.modo === "sem_custo_atual";
    const escolher = soSemCusto ? custoAtual : custoNaData;

    const r = { analisadas: vendas.length, reprocessadas: 0, mantidas: 0, manuais: 0, semCusto: 0, anunciosLigados: 0, falhas: 0 };
    type Det = { pedido: string; produto: string; sku: string | null; qtd: number; custo?: number; motivo?: string; parecidos?: string[] };
    const mudancas: { id: string; dados: Record<string, unknown>; det?: Det }[] = [];
    const ligar = new Map<string, string>(); // anúncio sem produto → produto achado pelo SKU
    // Detalhe por venda (só no modo "sem custo"), para a tela mostrar o que mudou e o que ficou sem custo
    const atualizadas: Det[] = [];
    const continuam: Det[] = [];
    const det = (v: V): Det => ({ pedido: v.order_number ?? "", produto: v.title ?? "—", sku: skuDaVenda(v) || null, qtd: Number(v.quantity) || 1 });

    // Por que a venda continua sem custo (para o vendedor saber o que acertar)
    const porque = (v: V, ligado: string | null, outro: string | null): Pick<Det, "motivo" | "parecidos"> => {
      const p = produtos.get(ligado ?? outro ?? "");
      if (p) return { motivo: `O produto do armazém (${p.sku ?? "sem SKU"}) está sem custo cadastrado` };
      const sku = skuDaVenda(v);
      if (!sku) return { motivo: "A venda não tem SKU e o anúncio não está ligado a um produto" };
      const parecidos = porSku.parecidos(sku);
      return { motivo: parecidos.length ? `O SKU "${sku}" não existe no armazém. Parecido: ${parecidos.join(", ")}` : `O SKU "${sku}" não existe no armazém`, parecidos };
    };

    for (const v of vendas) {
      if (v.cost_manual) {
        r.manuais++;
        continue;
      }
      if (soSemCusto && Number(v.cost_price) !== 0) {
        r.mantidas++;
        continue;
      }
      const ligado = produtoLigado(v);
      let pid = ligado;
      let escolhido = escolher(ligado, v);
      let viaSku = false;
      const outro = produtoSku(v);
      if (!escolhido) {
        if (outro && outro !== ligado) {
          escolhido = escolher(outro, v);
          if (escolhido) { pid = outro; viaSku = true; }
        }
      }
      if (!escolhido || !pid) {
        if (Number(v.cost_price) === 0) {
          r.semCusto++;
          if (soSemCusto) continuam.push({ ...det(v), ...porque(v, ligado, outro) });
        } else r.mantidas++;
        continue;
      }
      const a = v.listing_id ? anuncio.get(v.listing_id) : undefined;
      // Anúncio sem produto ligado, que casou pelo SKU: liga (nunca troca um vínculo que já existe)
      if (viaSku && a && !a.product_id && v.listing_id && !ligar.has(v.listing_id)) ligar.set(v.listing_id, pid);
      const unidades = (viaSku ? 1 : Number(a?.units) || 1) * (Number(v.quantity) || 1);
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
      mudancas.push({ id: v.id, dados: { cost_price: custo, tax_amount: Math.round(imposto * 100) / 100, product_id: pid }, ...(soSemCusto ? { det: { ...det(v), custo } } : {}) });
    }

    // Liga os anúncios ao produto (para as próximas sincronizações já virem com custo)
    const paraLigar = Array.from(ligar.entries());
    for (let i = 0; i < paraLigar.length; i += 25) {
      const rs = await Promise.all(paraLigar.slice(i, i + 25).map(([id, product_id]) => admin.from("listings").update({ product_id }).eq("id", id).is("product_id", null)));
      rs.forEach((x) => { if (!x.error) r.anunciosLigados++; });
    }

    let erroGravar: string | null = null;
    for (let i = 0; i < mudancas.length; i += 25) {
      if (Date.now() - inicioMs > 50000) return NextResponse.json({ ...r, parcial: true, atualizadas, continuam, erroGravar });
      const lote = mudancas.slice(i, i + 25);
      const rs = await Promise.all(lote.map((m) => admin.from("sales").update(m.dados).eq("id", m.id)));
      rs.forEach((x, k) => {
        if (x.error) {
          r.falhas++;
          erroGravar ??= x.error.message;
        } else {
          r.reprocessadas++;
          const d = lote[k].det;
          if (d) atualizadas.push(d);
        }
      });
    }
    return NextResponse.json({ ...r, parcial: false, erroGravar, ...(soSemCusto ? { atualizadas, continuam } : {}) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao reprocessar os custos" }, { status: 500 });
  }
}
