import type { Company, Listing, Product } from "./types";
import { EntradaPreco, calcularLucro, precoParaMargem } from "./pricing";

// Junta o anúncio, o produto do armazém e o CNPJ na entrada do cálculo. null = sem custo para calcular.
export function entradaDoAnuncio(
  l: Listing,
  produto: Product | undefined,
  empresa: Company | null,
  feePct: number,
  feeFixo: number
): EntradaPreco | null {
  if (!produto || !(Number(produto.cost_price) > 0)) return null;
  const u = Number(l.units) || 1;
  return {
    custo: Number(produto.cost_price) * u,
    credito: (Number(produto.icms_credit) + Number(produto.pis_credit) + Number(produto.cofins_credit)) * u,
    feePct,
    feeFixo,
    frete: Number(l.shipping_cost) || 0,
    empresa,
  };
}

export type Analise = {
  custo: number;
  taxa: number;
  taxaPct: number;
  taxaFixo: number;
  taxaDoML: boolean;
  imposto: number;
  frete: number;
  lucro: number;
  margem: number;
  sugerido: number | null;
};

export function analisarAnuncio(
  l: Listing,
  produto: Product | undefined,
  empresa: Company | null,
  taxaPadrao: { pct: number; fixo: number }
): Analise | null {
  const pct = l.fee_percent != null ? Number(l.fee_percent) : taxaPadrao.pct;
  const fixo = l.fee_fixed != null ? Number(l.fee_fixed) : taxaPadrao.fixo;
  const e = entradaDoAnuncio(l, produto, empresa, pct, fixo);
  if (!e) return null;
  const r = calcularLucro(Number(l.price), e);
  return {
    custo: e.custo,
    taxa: r.taxaMarketplace,
    taxaPct: pct,
    taxaFixo: fixo,
    taxaDoML: l.fee_percent != null,
    imposto: r.impostos,
    frete: e.frete,
    lucro: r.lucro,
    margem: r.margem,
    sugerido: precoParaMargem(Number(l.target_margin), e),
  };
}
