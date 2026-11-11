import type { Regime } from "./pricing";

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
  company_id: string | null;
  ean: string | null;
  ncm: string | null;
  stock_qty: number;
  icms_credit: number;
  pis_credit: number;
  cofins_credit: number;
  cost_updated_at: string | null;
  promo_auto?: boolean;
  promo_min_margin?: number | null;
};

export type Company = {
  id: string;
  store_id: string;
  name: string;
  cnpj: string | null;
  regime: Regime;
  simples_aliquota: number;
  icms_pct: number;
  pis_pct: number;
  cofins_pct: number;
  irpj_csll_pct: number;
  is_default: boolean;
};

export type Listing = {
  id: string;
  store_id: string;
  marketplace_id: string;
  external_id: string;
  ml_user_id: string | null;
  title: string;
  permalink: string | null;
  thumbnail: string | null;
  status: string | null;
  category_id: string | null;
  listing_type_id: string | null;
  price: number;
  product_id: string | null;
  company_id: string | null;
  units: number;
  shipping_cost: number;
  shipping_source?: string | null;
  fee_percent: number | null;
  fee_fixed: number | null;
  target_margin: number;
  min_price: number | null;
  max_price: number | null;
  auto_price: boolean;
  promo_auto?: boolean;
  promo_min_margin?: number | null;
  last_repriced_at: string | null;
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
  listing_id?: string | null;
  order_number?: string | null;
  title?: string | null;
  buyer_state?: string | null;
  ml_user_id?: string | null;
  cost_manual?: boolean;
  sku?: string | null;
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

// Mantém só os dígitos de um CNPJ/CPF e aplica a máscara quando tem 14 dígitos.
export function formatarCnpj(v: string | null | undefined): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d;
}

export type ContaML = {
  ml_user_id: string;
  nickname: string | null;
  company_id: string | null;
  last_synced_at: string | null;
  connected_at: string;
  store_name?: string | null;
  expires_at?: string;
  status?: "ativo" | "reconectar";
};

export type CustoProduto = {
  id: string;
  product_id: string;
  cost_price: number;
  icms_credit: number;
  pis_credit: number;
  cofins_credit: number;
  valid_from: string;
};

export type AcaoPromo = {
  id: string;
  item_id: string;
  promotion_id: string;
  promotion_name: string | null;
  price: number | null;
  margin: number | null;
  min_margin: number | null;
  status: "entrou" | "recusada" | "erro";
  message: string | null;
  updated_at: string;
};
