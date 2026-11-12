import { mlGet } from "./ml";

// Frete que o vendedor paga por um anúncio, direto do Mercado Livre (já com o desconto de reputação).
// Passando o preço, o Mercado Livre devolve o custo da faixa de preço correspondente (o frete muda conforme o preço do anúncio).
export async function freteML(token: string, mlUserId: string, itemId: string, preco?: number | null): Promise<number | null> {
  try {
    const q = `item_id=${encodeURIComponent(itemId)}` + (preco && preco > 0 ? `&item_price=${preco.toFixed(2)}` : "");
    const f = await mlGet<{ coverage?: { all_country?: { list_cost?: number } } }>(token, `/users/${mlUserId}/shipping_options/free?${q}`);
    const custo = f.coverage?.all_country?.list_cost;
    return typeof custo === "number" && custo >= 0 ? custo : null;
  } catch {
    return null;
  }
}
