import { supabaseAdmin } from "./supabase-admin";
import { shopeeGet, shopeePost, tokenShopee } from "./shopee";
import { CANAIS, faixaDoPreco } from "@/lib/taxas-publicas";

// Um produto (ou uma variação) dentro de uma oferta relâmpago.
export type ItemRelampago = {
  item_id: number;
  model_id: number | null;
  nome: string;
  variacao: string | null;
  preco_original: number;
  preco_promo: number;
  estoque: number;
  limite_compra: number;
  ativo: boolean;
};

export type Horario = { timeslot_id: number; start_time: number; end_time: number };

type Info = {
  item_id: number; item_name?: string; status?: number; purchase_limit?: number;
  input_promotion_price?: number; promotion_price_with_tax?: number; campaign_stock?: number; original_price?: number;
};
type Modelo = {
  item_id: number; model_id: number; model_name?: string; status?: number; original_price?: number;
  input_promotion_price?: number; promotion_price_with_tax?: number; campaign_stock?: number;
};

// Produtos de uma oferta relâmpago, já no formato que dá para copiar.
export async function itensDaOferta(token: string, shopId: string, flashSaleId: number): Promise<ItemRelampago[]> {
  const infos: Info[] = [];
  const modelos: Modelo[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await shopeeGet<{ response?: { item_info?: Info[]; models?: Modelo[]; total_count?: number } }>(
      token, shopId, "/api/v2/shop_flash_sale/get_shop_flash_sale_items", { flash_sale_id: flashSaleId, offset, limit: 50 }
    );
    const i = r.response?.item_info ?? [];
    infos.push(...i);
    modelos.push(...(r.response?.models ?? []));
    if (i.length < 50) break;
  }
  const out: ItemRelampago[] = [];
  for (const it of infos) {
    const mods = modelos.filter((m) => m.item_id === it.item_id);
    if (mods.length) {
      for (const m of mods)
        out.push({
          item_id: it.item_id, model_id: m.model_id, nome: it.item_name ?? String(it.item_id), variacao: m.model_name ?? null,
          preco_original: Number(m.original_price) || 0, preco_promo: Number(m.input_promotion_price ?? m.promotion_price_with_tax) || 0,
          estoque: Number(m.campaign_stock) || 0, limite_compra: Number(it.purchase_limit) || 0, ativo: m.status === undefined || m.status === 1,
        });
    } else
      out.push({
        item_id: it.item_id, model_id: null, nome: it.item_name ?? String(it.item_id), variacao: null,
        preco_original: Number(it.original_price) || 0, preco_promo: Number(it.input_promotion_price ?? it.promotion_price_with_tax) || 0,
        estoque: Number(it.campaign_stock) || 0, limite_compra: Number(it.purchase_limit) || 0, ativo: it.status === undefined || it.status === 1,
      });
  }
  return out;
}

// Horários de relâmpago que a Shopee oferece entre duas datas (segundos).
export async function horariosDisponiveis(token: string, shopId: string, de: number, ate: number): Promise<Horario[]> {
  const r = await shopeeGet<{ response?: Horario[] | { time_slot_list?: Horario[] } }>(token, shopId, "/api/v2/shop_flash_sale/get_time_slot_id", {
    start_time: Math.max(de, Math.floor(Date.now() / 1000) + 60), end_time: ate,
  });
  const lista = Array.isArray(r.response) ? r.response : r.response?.time_slot_list ?? [];
  return lista.sort((a, b) => a.start_time - b.start_time);
}

// Horários (início) que já têm oferta relâmpago da loja, acontecendo ou programada.
export async function horariosOcupados(token: string, shopId: string): Promise<{ inicios: Set<number>; slots: Set<number> }> {
  const inicios = new Set<number>();
  const slots = new Set<number>();
  for (const type of [1, 2]) {
    for (let offset = 0; offset < 500; offset += 100) {
      const r = await shopeeGet<{ response?: { flash_sale_list?: { timeslot_id?: number; start_time: number; status?: number }[] } }>(
        token, shopId, "/api/v2/shop_flash_sale/get_shop_flash_sale_list", { type, offset, limit: 100 }
      );
      const l = r.response?.flash_sale_list ?? [];
      for (const f of l) {
        if (f.status === 0) continue; // excluída
        inicios.add(f.start_time);
        if (f.timeslot_id) slots.add(f.timeslot_id);
      }
      if (l.length < 100) break;
    }
  }
  return { inicios, slots };
}

// Cria a oferta no horário e coloca os produtos. Devolve o id e os produtos que a Shopee recusou.
export async function criarOfertaComItens(token: string, shopId: string, timeslotId: number, itens: ItemRelampago[]) {
  const c = await shopeePost<{ response?: { flash_sale_id?: number } }>(token, shopId, "/api/v2/shop_flash_sale/create_shop_flash_sale", { timeslot_id: timeslotId });
  const flashSaleId = c.response?.flash_sale_id;
  if (!flashSaleId) throw new Error("A Shopee não devolveu o número da oferta criada");
  const porItem = new Map<number, ItemRelampago[]>();
  for (const i of itens) porItem.set(i.item_id, [...(porItem.get(i.item_id) ?? []), i]);
  const corpo = Array.from(porItem.values()).map((grupo) => {
    const p = grupo[0];
    if (p.model_id == null) return { item_id: p.item_id, purchase_limit: p.limite_compra, item_input_promo_price: p.preco_promo, item_stock: p.estoque };
    return { item_id: p.item_id, purchase_limit: p.limite_compra, models: grupo.map((g) => ({ model_id: g.model_id, input_promo_price: g.preco_promo, stock: g.estoque })) };
  });
  const recusados: { item_id: number; model_id?: number; motivo: string }[] = [];
  for (let i = 0; i < corpo.length; i += 50) {
    const r = await shopeePost<{ response?: { failed_items?: { item_id: number; model_id?: number; err_msg?: string; unqualified_reason?: string }[] } }>(
      token, shopId, "/api/v2/shop_flash_sale/add_shop_flash_sale_items", { flash_sale_id: flashSaleId, items: corpo.slice(i, i + 50) }
    );
    for (const f of r.response?.failed_items ?? []) recusados.push({ item_id: f.item_id, model_id: f.model_id, motivo: f.err_msg || f.unqualified_reason || "recusado" });
  }
  return { flash_sale_id: flashSaleId, recusados };
}

// Margem de cada produto no preço da oferta, com o custo do armazém e as taxas da Shopee.
export async function margensDosItens(storeId: string, itens: ItemRelampago[], impostoPct: number, taxaExtraPct: number) {
  const admin = supabaseAdmin();
  const ids = Array.from(new Set(itens.map((i) => (i.model_id == null ? String(i.item_id) : `${i.item_id}:${i.model_id}`))));
  const { data: lst } = await admin.from("listings").select("external_id, product_id").eq("store_id", storeId).eq("marketplace_id", "shopee").in("external_id", ids);
  const prodIds = Array.from(new Set((lst ?? []).map((l) => l.product_id).filter(Boolean))) as string[];
  const { data: prods } = prodIds.length ? await admin.from("products").select("id, cost_price").in("id", prodIds) : { data: [] };
  const custoProd = new Map((prods ?? []).map((p) => [p.id as string, Number(p.cost_price) || 0]));
  const custoPorExt = new Map((lst ?? []).map((l) => [l.external_id as string, custoProd.get(l.product_id as string) ?? 0]));
  const canal = CANAIS.find((c) => c.id === "shopee")!;
  return itens.map((i) => {
    const custo: number = Number(custoPorExt.get(i.model_id == null ? String(i.item_id) : `${i.item_id}:${i.model_id}`) ?? 0);
    const p = i.preco_promo;
    if (!custo || p <= 0) return { ...i, custo, margem: null as number | null };
    const f = faixaDoPreco(canal, p);
    const fixa: number = f.fixa === "metade" ? p / 2 : Number(f.fixa);
    const lucro = p - custo - fixa - (p * (f.comissao + taxaExtraPct + impostoPct)) / 100;
    return { ...i, custo, margem: (lucro / p) * 100 };
  });
}

export type Regra = {
  id: string; store_id: string; shop_id: string; nome: string; modelo_itens: ItemRelampago[];
  modo: "todos" | "diario" | "agenda"; dias_semana: number[]; hora_inicio: number; hora_fim: number; dias_a_frente: number;
  margem_minima: number; imposto_pct: number; taxa_extra_pct: number; total_criadas: number;
};

// Hora e dia da semana em Brasília.
function emBrasilia(seg: number) {
  const d = new Date((seg - 3 * 3600) * 1000);
  return { hora: d.getUTCHours(), diaSemana: d.getUTCDay(), dia: d.toISOString().slice(0, 10) };
}

const MAX_POR_RODADA = 12;

// Roda uma regra: escolhe os horários livres conforme o modo e cria uma oferta em cada um, copiando o modelo.
export async function executarRegra(regra: Regra, limiteMs = 45_000) {
  const inicio = Date.now();
  const admin = supabaseAdmin();
  const resultado = { em: new Date().toISOString(), criadas: [] as { inicio: number; flash_sale_id: number; itens: number; recusados: number }[], pulados: [] as { nome: string; motivo: string }[], erros: [] as string[], aviso: "" };
  try {
    const token = await tokenShopee(regra.store_id, regra.shop_id);
    if (!token) throw new Error("Loja da Shopee desconectada");
    if (!regra.modelo_itens?.length) throw new Error("A regra não tem produtos do modelo");

    // Trava de margem: só entram os produtos com margem acima da mínima (sem custo cadastrado também fica de fora).
    const comMargem = await margensDosItens(regra.store_id, regra.modelo_itens, Number(regra.imposto_pct), Number(regra.taxa_extra_pct));
    const aprovados: ItemRelampago[] = [];
    for (const i of comMargem) {
      const rotulo = i.variacao ? `${i.nome} (${i.variacao})` : i.nome;
      if (i.margem == null) resultado.pulados.push({ nome: rotulo, motivo: "sem custo no armazém" });
      else if (i.margem < Number(regra.margem_minima)) resultado.pulados.push({ nome: rotulo, motivo: `margem ${i.margem.toFixed(1)}% abaixo da mínima` });
      else aprovados.push(i);
    }
    if (!aprovados.length) throw new Error("Nenhum produto do modelo passou na margem mínima");

    const agora = Math.floor(Date.now() / 1000);
    const horarios = await horariosDisponiveis(token, regra.shop_id, agora, agora + Math.min(Math.max(regra.dias_a_frente, 1), 7) * 86400);
    const ocupados = await horariosOcupados(token, regra.shop_id);
    const diasComOferta = new Set(Array.from(ocupados.inicios).map((s) => emBrasilia(s).dia));

    const escolhidos: Horario[] = [];
    for (const h of horarios) {
      if (ocupados.slots.has(h.timeslot_id) || ocupados.inicios.has(h.start_time)) continue;
      const b = emBrasilia(h.start_time);
      if (b.hora < regra.hora_inicio || b.hora >= regra.hora_fim) continue;
      if (regra.modo === "agenda" && !regra.dias_semana.includes(b.diaSemana)) continue;
      if (regra.modo === "diario") {
        if (diasComOferta.has(b.dia)) continue;
        diasComOferta.add(b.dia);
      }
      escolhidos.push(h);
    }

    for (const h of escolhidos) {
      if (resultado.criadas.length >= MAX_POR_RODADA || Date.now() - inicio > limiteMs) {
        resultado.aviso = "Parou antes de preencher todos os horários; o restante entra na próxima rodada.";
        break;
      }
      try {
        const c = await criarOfertaComItens(token, regra.shop_id, h.timeslot_id, aprovados);
        resultado.criadas.push({ inicio: h.start_time, flash_sale_id: c.flash_sale_id, itens: aprovados.length - c.recusados.length, recusados: c.recusados.length });
      } catch (e) {
        resultado.erros.push(`${new Date(h.start_time * 1000).toISOString()}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!escolhidos.length) resultado.aviso = "Nenhum horário livre que combine com a regra.";
  } catch (e) {
    resultado.erros.push(e instanceof Error ? e.message : String(e));
  }
  await admin
    .from("shopee_flash_rules")
    .update({ ultima_execucao: resultado.em, ultimo_resultado: resultado, total_criadas: (regra.total_criadas ?? 0) + resultado.criadas.length })
    .eq("id", regra.id);
  return resultado;
}
