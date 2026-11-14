// Taxas de referência dos 3 marketplaces da calculadora gratuita (página pública).
// São valores de partida: a pessoa pode ajustar a comissão e a taxa fixa na tela.
// Última conferência: 14/11/2026. Mercado Livre varia por categoria; Shopee e TikTok Shop por faixa de preço.

export type CanalId = "mercado_livre" | "shopee" | "tiktok_shop";

export type Faixa = { ate: number; comissao: number; fixa: number | "metade" };

export type Canal = {
  id: CanalId;
  nome: string;
  cor: string;
  faixas: Faixa[];
  nota: string;
};

export const CANAIS: Canal[] = [
  {
    id: "mercado_livre",
    nome: "Mercado Livre",
    cor: "#FFC800",
    // Clássico costuma ficar entre 10% e 14% conforme a categoria; a taxa fixa só existe abaixo de R$ 79.
    faixas: [
      { ate: 12.5, comissao: 14, fixa: "metade" },
      { ate: 29, comissao: 14, fixa: 6.25 },
      { ate: 50, comissao: 14, fixa: 6.5 },
      { ate: 79, comissao: 14, fixa: 6.75 },
      { ate: Infinity, comissao: 14, fixa: 0 },
    ],
    nota: "Anúncio Clássico, comissão de 14% (varia por categoria, de 10% a 14%) e taxa fixa só abaixo de R$ 79.",
  },
  {
    id: "shopee",
    nome: "Shopee",
    cor: "#EE4D2D",
    // Tabela em vigor desde 1º/10/2026 (já inclui transação e frete grátis).
    faixas: [
      { ate: 79.99, comissao: 20, fixa: 4.5 },
      { ate: 99.99, comissao: 14, fixa: 16 },
      { ate: 199.99, comissao: 14, fixa: 20 },
      { ate: Infinity, comissao: 14, fixa: 26 },
    ],
    nota: "Tabela por faixa de preço em vigor desde 1º/10/2026. Vendedor CPF paga R$ 3 a mais por item.",
  },
  {
    id: "tiktok_shop",
    nome: "TikTok Shop",
    cor: "#111111",
    // Em vigor desde 15/07/2026, sobre o preço depois do desconto do vendedor.
    faixas: [
      { ate: 49.99, comissao: 10, fixa: 4 },
      { ate: Infinity, comissao: 6, fixa: 6 },
    ],
    nota: "Tarifa por faixa de preço (desde 15/07/2026). Comissão de afiliado, se você oferecer, é custo à parte.",
  },
];

export type Ajustes = {
  /** Soma por item (ex.: Shopee CPF +3). */
  extraFixa: number;
  /** Se informado, troca a comissão da faixa. */
  comissao?: number;
  /** Se informado, troca a taxa fixa da faixa. */
  fixa?: number;
};

export function faixaDoPreco(canal: Canal, preco: number): Faixa {
  return canal.faixas.find((f) => preco <= f.ate) ?? canal.faixas[canal.faixas.length - 1];
}

export function taxasDoPreco(canal: Canal, preco: number, aj: Ajustes) {
  const f = faixaDoPreco(canal, preco);
  const comissaoPct = aj.comissao ?? f.comissao;
  const fixaBase = f.fixa === "metade" ? preco / 2 : f.fixa;
  const fixa = (aj.fixa ?? fixaBase) + aj.extraFixa;
  const comissao = (preco * comissaoPct) / 100;
  return { comissaoPct, comissao, fixa, total: comissao + fixa };
}

/** Menor preço que entrega a margem desejada (sobre o preço de venda), testando faixa por faixa. */
export function precoParaMargem(
  canal: Canal,
  custo: number,
  frete: number,
  impostoPct: number,
  margemPct: number,
  aj: Ajustes
): number | null {
  let inicio = 0;
  let melhor: number | null = null;
  for (const f of canal.faixas) {
    const comissaoPct = aj.comissao ?? f.comissao;
    const denom = 1 - (comissaoPct + impostoPct + margemPct) / 100;
    if (denom > 0) {
      const fixaFaixa = f.fixa === "metade" ? 0 : aj.fixa ?? f.fixa;
      const p = f.fixa === "metade" && aj.fixa === undefined
        ? (custo + frete + aj.extraFixa) / (denom - 0.5)
        : (custo + frete + fixaFaixa + aj.extraFixa) / denom;
      const valido = f.fixa === "metade" && aj.fixa === undefined ? denom - 0.5 > 0 : denom > 0;
      if (valido && p > inicio && p <= f.ate) {
        melhor = p;
        break;
      }
      // Na faixa o preço calculado ficou abaixo do início: vale o primeiro preço da faixa.
      if (valido && p <= inicio && inicio > 0) {
        const t = taxasDoPreco(canal, inicio + 0.01, aj);
        const lucro = inicio + 0.01 - custo - frete - t.total - ((inicio + 0.01) * impostoPct) / 100;
        if (lucro / (inicio + 0.01) >= margemPct / 100) {
          melhor = inicio + 0.01;
          break;
        }
      }
    }
    inicio = f.ate;
  }
  return melhor;
}
