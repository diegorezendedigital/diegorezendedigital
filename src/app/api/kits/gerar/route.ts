import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { montarPlano, type AnuncioBase, type ItemPlano, type ProdutoBase, type VendaBase } from "@/lib/kits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Admin = ReturnType<typeof supabaseAdmin>;

// Lê do banco tudo que o plano precisa. O banco devolve no máximo 1000 linhas por consulta, por isso a leitura é em blocos.
async function carregarBase(admin: Admin, storeId: string) {
  const produtos: ProdutoBase[] = [];
  for (let i = 0; i < 50000; i += 1000) {
    const { data, error } = await admin.from("products").select("id, sku, name, grupo, tipo, cost_price, company_id").eq("store_id", storeId).order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    produtos.push(...((data ?? []) as ProdutoBase[]));
    if ((data ?? []).length < 1000) break;
  }

  // Kits que já têm peças cadastradas
  const comComposicao = new Set<string>();
  for (let i = 0; i < 50000; i += 1000) {
    const { data, error } = await admin.from("product_components").select("kit_id").eq("store_id", storeId).order("id").range(i, i + 999);
    if (error) throw new Error(error.message.includes("product_components") ? "Falta rodar o SQL dos kits no Supabase (20261126_kits.sql)." : error.message);
    ((data ?? []) as { kit_id: string }[]).forEach((c) => comComposicao.add(String(c.kit_id)));
    if ((data ?? []).length < 1000) break;
  }

  // Só os anúncios cujo SKU começa com KIT (o resto não interessa)
  const anuncios: AnuncioBase[] = [];
  for (let i = 0; i < 50000; i += 1000) {
    const { data, error } = await admin.from("listings").select("id, sku, title, product_id, marketplace_id").eq("store_id", storeId).ilike("sku", "kit%").order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    anuncios.push(...((data ?? []) as AnuncioBase[]));
    if ((data ?? []).length < 1000) break;
  }

  // Vendas de SKU de kit que ficaram sem produto e sem custo (cobre venda sem anúncio, como a de outro marketplace)
  const vendas: VendaBase[] = [];
  for (let i = 0; i < 30000; i += 1000) {
    const { data, error } = await admin.from("sales").select("id, sku, title").eq("store_id", storeId).ilike("sku", "kit%").eq("cost_price", 0).is("product_id", null).order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    vendas.push(...((data ?? []) as VendaBase[]));
    if ((data ?? []).length < 1000) break;
  }
  return { produtos, comComposicao, anuncios, vendas };
}

// Liga os anúncios (que ainda estão sem produto) ao produto. Nunca troca um vínculo que já existe.
async function ligarAnuncios(admin: Admin, storeId: string, pares: { produtoId: string; anunciosIds: string[] }[]): Promise<number> {
  let ligados = 0;
  for (let i = 0; i < pares.length; i += 20) {
    const rs = await Promise.all(
      pares
        .slice(i, i + 20)
        .filter((p) => p.anunciosIds.length > 0)
        .map((p) => admin.from("listings").update({ product_id: p.produtoId }).eq("store_id", storeId).in("id", p.anunciosIds).is("product_id", null).select("id"))
    );
    rs.forEach((r) => {
      if (!r.error) ligados += (r.data ?? []).length;
    });
  }
  return ligados;
}

// Gerar kits dos anúncios.
// body: { acao: "previa" }  → o que seria criado, o que precisa de você e quantos anúncios seriam ligados
//       { acao: "criar", chaves: string[], ligar?: boolean } → cria os kits marcados (até 100 por chamada) e liga os anúncios
// O plano é sempre recalculado aqui: o que o navegador manda é só a lista de quais kits ele quer.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["armazem", "anuncios"]); if (semAcesso) return semAcesso; }
  const inicio = Date.now();
  try {
    const b = await req.json().catch(() => ({}));
    const admin = supabaseAdmin();
    const storeId = user.id;
    const plano = montarPlano(await carregarBase(admin, storeId));

    if (b.acao !== "criar") {
      return NextResponse.json({
        criar: plano.criar.map(({ anunciosIds, ...resto }) => ({ ...resto, anuncios: anunciosIds.length })),
        revisar: plano.revisar,
        ligarAnuncios: plano.ligar.reduce((s, l) => s + l.anunciosIds.length, 0),
        jaOk: plano.jaOk,
      });
    }

    const pedidas = new Set<string>(Array.isArray(b.chaves) ? b.chaves.map(String) : []);
    const itens = plano.criar.filter((i) => pedidas.has(i.chave)).slice(0, 100);
    const r = { criados: 0, completados: 0, ligados: 0, falhas: [] as { chave: string; sku: string; erro: string }[], ignorados: pedidas.size - itens.length, parcial: false, feitos: [] as string[] };

    // Anúncios que apontam para um kit/produto que já existe (só ligar)
    if (b.ligar === true && plano.ligar.length) r.ligados += await ligarAnuncios(admin, storeId, plano.ligar.map((l) => ({ produtoId: l.produtoId, anunciosIds: l.anunciosIds })));

    const agora = new Date().toISOString();
    for (let k = 0; k < itens.length; k += 50) {
      if (Date.now() - inicio > 45000) {
        r.parcial = true;
        break;
      }
      const lote = itens.slice(k, k + 50);
      const idDoKit = new Map<string, string>(); // chave do kit → id do produto (novo ou já existente)
      const novo = new Set<string>(); // chaves dos kits criados agora (para desfazer se a composição falhar)
      lote.filter((i) => i.existenteId).forEach((i) => idDoKit.set(i.chave, i.existenteId as string));

      // 1) kits novos. O custo já entra certo; o banco confirma pela soma das peças quando a composição é gravada.
      const linha = (i: ItemPlano) => ({
        store_id: storeId,
        tipo: "kit",
        grupo: i.grupo,
        sku: i.sku,
        name: i.nome,
        cost_price: i.custoKit,
        stock_qty: 0,
        company_id: i.companyId,
        cost_updated_at: agora,
      });
      const aCriar = lote.filter((i) => !i.existenteId);
      if (aCriar.length) {
        const { data, error } = await admin.from("products").insert(aCriar.map(linha)).select("id, sku");
        if (!error) {
          const porSku = new Map<string, string>(((data ?? []) as { id: string; sku: string }[]).map((d): [string, string] => [String(d.sku), String(d.id)]));
          aCriar.forEach((i) => {
            const id = porSku.get(i.sku);
            if (id) {
              idDoKit.set(i.chave, id);
              novo.add(i.chave);
            } else r.falhas.push({ chave: i.chave, sku: i.sku, erro: "O banco não devolveu o kit criado" });
          });
        } else {
          // Um por um, para saber qual falhou (por exemplo, SKU repetido) sem perder os outros
          for (const i of aCriar) {
            const um = await admin.from("products").insert(linha(i)).select("id").single();
            if (um.error || !um.data) r.falhas.push({ chave: i.chave, sku: i.sku, erro: um.error?.message ?? "Não foi possível criar o kit" });
            else {
              idDoKit.set(i.chave, String(um.data.id));
              novo.add(i.chave);
            }
          }
        }
      }

      // 2) composição: uma peça de referência × quantidade do kit
      const comPeca = lote.filter((i) => idDoKit.has(i.chave));
      const composicao = (i: ItemPlano) => ({ store_id: storeId, kit_id: idDoKit.get(i.chave) as string, component_id: i.pecaId, quantity: i.n });
      if (comPeca.length) {
        const { error } = await admin.from("product_components").insert(comPeca.map(composicao));
        if (error) {
          for (const i of comPeca) {
            const um = await admin.from("product_components").insert(composicao(i));
            if (um.error) {
              r.falhas.push({ chave: i.chave, sku: i.sku, erro: um.error.message });
              // kit recém-criado sem peça não serve: desfaz para não deixar um kit com custo solto
              if (novo.has(i.chave)) await admin.from("products").delete().eq("id", idDoKit.get(i.chave) as string).eq("store_id", storeId);
              idDoKit.delete(i.chave);
            }
          }
        }
      }

      // 3) liga os anúncios (sem produto) ao kit
      const prontos = lote.filter((i) => idDoKit.has(i.chave));
      r.ligados += await ligarAnuncios(admin, storeId, prontos.map((i) => ({ produtoId: idDoKit.get(i.chave) as string, anunciosIds: i.anunciosIds })));
      prontos.forEach((i) => {
        if (novo.has(i.chave)) r.criados++;
        else r.completados++;
        r.feitos.push(i.chave);
      });
    }
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao gerar os kits" }, { status: 500 });
  }
}
