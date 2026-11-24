// Kits gerados a partir dos anúncios.
//
// O SKU de um anúncio de kit segue o padrão do armazém:  KIT<quantidade>-<TIPO>-<MODELO>-<COR(ES)>-<TAMANHO>
// (ex.: KIT2-BERM-SP-CINZACAZUL-G = 2 bermudas do modelo BERM-SP, tamanho G, nas cores Cinza e Azul).
//
// O custo do kit é  <quantidade> × o custo de UMA peça do mesmo modelo e tamanho.  Como o custo não muda de uma cor
// para outra, a cor não precisa ser decifrada (e nem dá, porque as cores vêm coladas): basta achar a "família"
// modelo + tamanho no armazém e conferir que todas as cores dela têm o mesmo custo. Se tiverem custos diferentes,
// o kit não é criado: vai para a lista "precisa de você", com os custos encontrados.

import { IndiceSku, chaveSku } from "@/lib/sku";

export type ProdutoBase = {
  id: string;
  sku: string | null;
  name: string | null;
  grupo: string | null;
  tipo: string | null;
  cost_price: number | string | null;
  company_id: string | null;
};
export type AnuncioBase = { id: string; sku: string | null; title: string | null; product_id: string | null; marketplace_id: string | null };
export type VendaBase = { sku: string | null; title: string | null };

// Custos que diferem em até 1 centavo contam como iguais (a nota fiscal arredonda cada cor de um jeito)
export const CUSTO_IGUAL_ATE = 0.01;

// "KIT2-BERM-SP-CINZACAZUL-G" → { n: 2, resto: ["berm", "sp", "cinzacazul", "g"] }
export function lerSkuKit(sku: string | null | undefined): { n: number; resto: string[] } | null {
  const m = /^kit-?(\d{1,3})-(.+)$/.exec(chaveSku(sku));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!(n >= 1)) return null;
  return { n, resto: m[2].split("-").filter(Boolean) };
}

// O SKU "tem cara" de kit: começa com KIT seguido de número ("KIT2-…", "KIT 2 …") ou de hífen ("KIT-…")
export function pareceSkuDeKit(sku: string | null | undefined): boolean {
  return /^kit(-|\d)/.test(chaveSku(sku));
}

export type Peca = { id: string; sku: string; name: string; grupo: string | null; custo: number; companyId: string | null; chave: string; tokens: string[] };

// Peças do armazém (tudo que não é kit) com o SKU quebrado em partes
export function indexarPecas(produtos: ProdutoBase[]): Peca[] {
  const pecas: Peca[] = [];
  for (const p of produtos) {
    if (p.tipo === "kit") continue;
    const sku = String(p.sku ?? "").trim();
    const chave = chaveSku(sku);
    if (!chave) continue;
    pecas.push({ id: p.id, sku, name: p.name ?? "", grupo: p.grupo ?? null, custo: Number(p.cost_price) || 0, companyId: p.company_id ?? null, chave, tokens: chave.split("-").filter(Boolean) });
  }
  return pecas;
}

export type CustoDaFamilia = { custo: number; skus: string[] };

export type Familia =
  | { ok: true; modelo: string[]; tamanho: string; cores: number; coresSemCusto: number; rep: Peca; custo: number }
  | { ok: false; motivo: "padrao" | "nao_achou" | "sem_custo" | "custo_diferente"; modelo: string[]; tamanho: string; custos?: CustoDaFamilia[] };

function agruparCustos(pecas: Peca[]): CustoDaFamilia[] {
  const por = new Map<number, string[]>();
  for (const p of pecas) {
    const c = Math.round(p.custo * 100) / 100;
    por.set(c, [...(por.get(c) ?? []), p.sku]);
  }
  return Array.from(por.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([custo, skus]) => ({ custo, skus: skus.sort() }));
}

// Acha a família (modelo + tamanho) de um kit no armazém.
// resto = partes do SKU depois de "KITn" (["berm","sp","cinzacazul","g"]): o último é o tamanho, as primeiras são o modelo
// (pelo menos 2 partes: TIPO-MODELO) e o que sobra no meio é a cor, que é ignorada.
// Tenta o modelo mais curto primeiro (BERM-SP); só se o custo não for igual entre as cores dele tenta um modelo mais específico.
export function resolverFamilia(resto: string[], pecas: Peca[]): Familia {
  if (resto.length < 3) return { ok: false, motivo: "padrao", modelo: resto.slice(0, -1), tamanho: resto[resto.length - 1] ?? "" };
  const tamanho = resto[resto.length - 1];
  const meio = resto.slice(0, -1);
  let achou = false;
  let conflito: { modelo: string[]; custos: CustoDaFamilia[] } | null = null;
  for (let k = 2; k <= meio.length; k++) {
    const prefixo = meio.slice(0, k);
    const membros = pecas.filter((p) => p.tokens.length >= k + 1 && p.tokens[p.tokens.length - 1] === tamanho && prefixo.every((t, i) => p.tokens[i] === t));
    if (membros.length === 0) continue;
    achou = true;
    const comCusto = membros.filter((p) => p.custo > 0);
    if (comCusto.length === 0) continue;
    const min = Math.min(...comCusto.map((p) => p.custo));
    const max = Math.max(...comCusto.map((p) => p.custo));
    if (max - min <= CUSTO_IGUAL_ATE + 1e-9) {
      // Peça de referência: sempre a mesma para a mesma família (a primeira em ordem de SKU)
      const rep = [...comCusto].sort((a, b) => a.chave.localeCompare(b.chave))[0];
      return { ok: true, modelo: prefixo, tamanho, cores: membros.length, coresSemCusto: membros.length - comCusto.length, rep, custo: rep.custo };
    }
    conflito ??= { modelo: prefixo, custos: agruparCustos(comCusto) };
  }
  const modelo = meio.slice(0, 2);
  if (conflito) return { ok: false, motivo: "custo_diferente", modelo: conflito.modelo, tamanho, custos: conflito.custos };
  if (achou) return { ok: false, motivo: "sem_custo", modelo, tamanho };
  return { ok: false, motivo: "nao_achou", modelo, tamanho };
}

export type ItemPlano = {
  chave: string;
  sku: string;
  n: number;
  nome: string;
  grupo: string;
  modelo: string;
  tamanho: string;
  cores: number;
  coresSemCusto: number;
  pecaId: string;
  pecaSku: string;
  custoPeca: number;
  custoKit: number;
  companyId: string | null;
  // kit que já existe sem peças e sem custo: ele é completado em vez de criado de novo
  existenteId: string | null;
  anunciosIds: string[]; // anúncios sem produto que serão ligados ao kit
  vendas: number; // vendas sem custo com esse SKU (só informativo)
  marketplaces: string[];
};

export type MotivoRevisar = "sem_numero" | "padrao" | "nao_achou" | "sem_custo" | "custo_diferente" | "produto_sem_custo";

export type ItemRevisar = {
  chave: string;
  sku: string;
  nome: string | null;
  anuncios: number;
  vendas: number;
  motivo: MotivoRevisar;
  modelo?: string;
  tamanho?: string;
  custos?: CustoDaFamilia[];
  existente?: { sku: string; tipo: string };
};

// Kit (ou produto) que já existe com o SKU do anúncio, mas o anúncio ainda não está ligado a ele
export type ItemLigar = { chave: string; sku: string; produtoId: string; anunciosIds: string[] };

export type Plano = { criar: ItemPlano[]; revisar: ItemRevisar[]; ligar: ItemLigar[]; jaOk: number };

type Grupo = { chave: string; sku: string; titulo: string | null; anuncios: AnuncioBase[]; vendas: number; mps: Set<string> };

const arred = (x: number) => Math.round(x * 100) / 100;

// Monta o que fazer com cada SKU de kit encontrado nos anúncios (e nas vendas sem custo).
// comComposicao = ids dos kits que já têm peças cadastradas.
export function montarPlano(entrada: { produtos: ProdutoBase[]; comComposicao: Set<string>; anuncios: AnuncioBase[]; vendas: VendaBase[] }): Plano {
  const { produtos, comComposicao, anuncios, vendas } = entrada;

  // 1) um grupo por SKU de kit (escrito de qualquer jeito: maiúsculas, espaço ou hífen)
  const grupos = new Map<string, Grupo>();
  const grupoDe = (sku: string, titulo: string | null) => {
    const chave = chaveSku(sku);
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, sku: sku.trim(), titulo: null, anuncios: [], vendas: 0, mps: new Set() };
      grupos.set(chave, g);
    }
    if (!g.titulo && titulo && titulo.trim()) g.titulo = titulo.trim();
    return g;
  };
  for (const a of anuncios) {
    const sku = String(a.sku ?? "").trim();
    if (!sku || !pareceSkuDeKit(sku)) continue;
    const g = grupoDe(sku, a.title);
    g.anuncios.push(a);
    if (a.marketplace_id) g.mps.add(a.marketplace_id);
  }
  for (const v of vendas) {
    const sku = String(v.sku ?? "").trim();
    if (!sku || !pareceSkuDeKit(sku)) continue;
    grupoDe(sku, v.title).vendas++;
  }

  // 2) produtos que já existem no armazém (qualquer tipo), achados pelo SKU sem diferenciar maiúsculas/acento/espaço/hífen
  const porSku = new IndiceSku<ProdutoBase>();
  for (const p of produtos) porSku.add(p.sku, p, comComposicao.has(p.id) ? 2 : Number(p.cost_price) > 0 ? 1 : 0);
  const pecas = indexarPecas(produtos);

  const plano: Plano = { criar: [], revisar: [], ligar: [], jaOk: 0 };
  const lista = Array.from(grupos.values()).sort((a, b) => a.chave.localeCompare(b.chave));
  for (const g of lista) {
    const semProduto = g.anuncios.filter((a) => !a.product_id);
    const base = { chave: g.chave, sku: g.sku, nome: g.titulo, anuncios: semProduto.length, vendas: g.vendas };
    const existente = porSku.get(g.sku);

    let existenteId: string | null = null;
    if (existente) {
      const temCusto = Number(existente.cost_price) > 0 || comComposicao.has(existente.id);
      if (existente.tipo === "kit" && !temCusto) {
        existenteId = existente.id; // kit vazio e sem custo: completa com a peça
      } else {
        // kit montado (ou com custo digitado à mão) ou produto com custo: não mexe no custo; só liga os anúncios soltos
        if (temCusto) {
          plano.jaOk++;
          if (semProduto.length > 0) plano.ligar.push({ chave: g.chave, sku: g.sku, produtoId: existente.id, anunciosIds: semProduto.map((a) => a.id) });
        } else {
          plano.revisar.push({ ...base, motivo: "produto_sem_custo", existente: { sku: String(existente.sku ?? ""), tipo: existente.tipo ?? "unico" } });
        }
        continue;
      }
    } else if (semProduto.length === 0 && g.vendas === 0) {
      // todos os anúncios desse SKU já estão ligados a algum produto: nada a fazer
      plano.jaOk++;
      continue;
    }

    const kit = lerSkuKit(g.sku);
    if (!kit) {
      plano.revisar.push({ ...base, motivo: /^kit-?\d/.test(g.chave) ? "padrao" : "sem_numero" });
      continue;
    }
    const f = resolverFamilia(kit.resto, pecas);
    if (!f.ok) {
      plano.revisar.push({ ...base, motivo: f.motivo, modelo: f.modelo.join("-").toUpperCase(), tamanho: f.tamanho.toUpperCase(), custos: f.custos });
      continue;
    }
    const modelo = f.modelo.join("-").toUpperCase();
    plano.criar.push({
      chave: g.chave,
      sku: g.sku,
      n: kit.n,
      nome: g.titulo ?? `Kit ${kit.n} - ${f.rep.name}`,
      grupo: `Kit ${kit.n} - ${f.rep.grupo || modelo}`,
      modelo,
      tamanho: f.tamanho.toUpperCase(),
      cores: f.cores,
      coresSemCusto: f.coresSemCusto,
      pecaId: f.rep.id,
      pecaSku: f.rep.sku,
      custoPeca: f.custo,
      custoKit: arred(f.custo * kit.n),
      companyId: f.rep.companyId,
      existenteId,
      anunciosIds: semProduto.map((a) => a.id),
      vendas: g.vendas,
      marketplaces: Array.from(g.mps),
    });
  }
  return plano;
}
