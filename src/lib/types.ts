export type Marketplace = {
  id: string;
  name: string;
  commission_percent: number;
  fixed_fee: number;
  extra_percent: number;
  notes: string | null;
};

export type Product = {
  id: string;
  store_id: string;
  name: string;
  sku: string | null;
  cost_price: number;
  sale_price: number;
  marketplace_id: string | null;
  external_id: string | null;
  created_at: string;
};

export type Sale = {
  id: string;
  store_id: string;
  product_id: string | null;
  marketplace_id: string | null;
  quantity: number;
  sale_price: number;
  cost_price: number;
  fees_total: number;
  shipping_cost: number;
  tax_amount: number;
  profit: number;
  sold_at: string;
  external_id: string | null;
};

export type Expense = {
  id: string;
  store_id: string;
  category: string;
  description: string;
  amount: number;
  month_ref: string;
  created_at: string;
};

export const CATEGORIAS_DESPESA = [
  { id: "despesa_fixa", label: "Despesa fixa" },
  { id: "frete", label: "Frete" },
  { id: "imposto", label: "Imposto" },
  { id: "outro", label: "Outro" },
];

export function calcularTaxas(
  precoVenda: number,
  mp: Marketplace
): { taxaComissao: number; taxaFixa: number; taxaExtra: number; totalTaxas: number } {
  const taxaComissao = (precoVenda * Number(mp.commission_percent)) / 100;
  const taxaExtra = (precoVenda * Number(mp.extra_percent)) / 100;
  const taxaFixa = Number(mp.fixed_fee);
  return { taxaComissao, taxaFixa, taxaExtra, totalTaxas: taxaComissao + taxaFixa + taxaExtra };
}

export const brl = (v: number | string | null | undefined): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

export const pct = (v: number): string =>
  `${(Number.isFinite(v) ? v : 0).toFixed(1).replace(".", ",")}%`;

// Converte texto digitado ("12,50") em número.
export const num = (v: string): number => {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// Converte número em texto para os campos de formulário ("12.5" -> "12,5").
export const campo = (v: number): string => String(v).replace(".", ",");

export function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-11" -> { inicio: "2026-11-01", fim: "2026-12-01" } (fim exclusivo)
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const prox = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
  const p = (n: number) => String(n).padStart(2, "0");
  return { inicio: `${a}-${p(m)}-01`, fim: `${prox.a}-${p(prox.m)}-01` };
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : "Erro inesperado";
}
