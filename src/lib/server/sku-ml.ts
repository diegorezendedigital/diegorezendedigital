// SKU de um anúncio do Mercado Livre. Com "User Products" o SKU pode vir em seller_custom_field,
// no atributo SELLER_SKU do anúncio ou, em anúncios antigos com variações, em cada variação.
type Attr = { id?: string; value_name?: string | null };
type ItemSku = {
  seller_custom_field?: string | null;
  attributes?: Attr[];
  variations?: { seller_custom_field?: string | null; attributes?: Attr[] }[];
};

export function skuDoItem(it: ItemSku): string {
  const direto = (it.seller_custom_field || "").trim() || (it.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name || "").trim();
  if (direto) return direto;
  const vars = (it.variations ?? [])
    .map((v) => (v.seller_custom_field || "").trim() || (v.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name || "").trim())
    .filter(Boolean);
  // Vários SKUs no mesmo anúncio: guarda todos (a busca acha por qualquer um); a ligação automática exige SKU único.
  return Array.from(new Set(vars)).join(", ");
}
