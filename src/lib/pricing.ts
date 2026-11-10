// Cálculo de lucro e de preço por margem, por regime tributário. Funções puras (sem React, sem banco).

export type Regime = "simples" | "lucro_real";

export type Empresa = {
  regime: Regime;
  simples_aliquota: number; // % efetiva sobre a receita
  icms_pct: number; // Lucro Real: % sobre a venda
  pis_pct: number;
  cofins_pct: number;
  irpj_csll_pct: number; // Lucro Real: % sobre o lucro antes do IR
};

export type EntradaPreco = {
  custo: number; // custo total das unidades vendidas (R$)
  credito: number; // créditos de ICMS/PIS/COFINS da compra (R$) — só contam no Lucro Real
  feePct: number; // taxa % do marketplace
  feeFixo: number; // taxa fixa do marketplace (R$)
  frete: number; // frete pago pelo vendedor (R$)
  empresa: Empresa | null;
};

export type Resultado = {
  taxaMarketplace: number;
  impostos: number;
  lucro: number;
  margem: number; // % sobre o preço
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// Parcelas que dependem do regime: t = % de imposto sobre a venda, ir = % sobre o lucro, cred = crédito (R$)
function parametros(e: EntradaPreco): { t: number; ir: number; cred: number } {
  const emp = e.empresa;
  if (!emp) return { t: 0, ir: 0, cred: 0 };
  if (emp.regime === "simples") return { t: n(emp.simples_aliquota) / 100, ir: 0, cred: 0 };
  return {
    t: (n(emp.icms_pct) + n(emp.pis_pct) + n(emp.cofins_pct)) / 100,
    ir: n(emp.irpj_csll_pct) / 100,
    cred: n(e.credito),
  };
}

export function calcularLucro(preco: number, e: EntradaPreco): Resultado {
  const p = n(preco);
  const { t, ir, cred } = parametros(e);
  const taxaMarketplace = (p * n(e.feePct)) / 100 + n(e.feeFixo);
  const indiretos = p * t - cred;
  const antesIR = p - n(e.custo) - taxaMarketplace - n(e.frete) - indiretos;
  const irValor = Math.max(0, antesIR) * ir;
  const lucro = antesIR - irValor;
  return {
    taxaMarketplace,
    impostos: indiretos + irValor,
    lucro,
    margem: p > 0 ? (lucro / p) * 100 : 0,
  };
}

// Preço de venda que entrega a margem líquida desejada (% sobre o preço). null = impossível com essas taxas.
export function precoParaMargem(margemAlvo: number, e: EntradaPreco): number | null {
  const { t, ir, cred } = parametros(e);
  const f = n(e.feePct) / 100;
  const m = n(margemAlvo) / 100;
  const k = n(e.custo) + n(e.feeFixo) + n(e.frete) - cred;
  const den = (1 - t - f) * (1 - ir) - m;
  if (den <= 0 || k <= 0) return null;
  return Math.ceil(((k * (1 - ir)) / den) * 100) / 100;
}

export function rotuloRegime(r: Regime): string {
  return r === "simples" ? "Simples Nacional" : "Lucro Real";
}
