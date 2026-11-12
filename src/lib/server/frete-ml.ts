import { mlGet } from "./ml";

type Resp = { coverage?: { all_country?: { list_cost?: number } } };

async function consulta(token: string, mlUserId: string, query: string): Promise<number | null> {
  try {
    const f = await mlGet<Resp>(token, `/users/${mlUserId}/shipping_options/free?${query}`);
    const custo = f.coverage?.all_country?.list_cost;
    return typeof custo === "number" && custo >= 0 ? custo : null;
  } catch {
    return null;
  }
}

// Frete que o vendedor paga por um anúncio, direto do Mercado Livre (já com o desconto de reputação).
// Tenta no preço informado (o custo muda por faixa de preço); se o Mercado Livre não aceitar o preço, usa o frete do anúncio como está.
export async function freteML(token: string, mlUserId: string, itemId: string, preco?: number | null): Promise<number | null> {
  const base = `item_id=${encodeURIComponent(itemId)}`;
  if (preco && preco > 0) {
    const noPreco = await consulta(token, mlUserId, `${base}&item_price=${preco.toFixed(2)}`);
    if (noPreco != null) return noPreco;
  }
  return consulta(token, mlUserId, base);
}
