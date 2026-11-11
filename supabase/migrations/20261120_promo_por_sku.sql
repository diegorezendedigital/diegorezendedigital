-- Margem mínima e participação automática em promoções por SKU (produto do armazém). A margem pode ser negativa.
alter table public.products
  add column if not exists promo_auto boolean not null default false,
  add column if not exists promo_min_margin numeric;

notify pgrst, 'reload schema';
