-- SKU do anúncio (vem do Mercado Livre), usado para ligar o anúncio ao produto do armazém de mesmo SKU.
alter table public.listings add column if not exists sku text;
create index if not exists listings_sku_idx on public.listings (store_id, sku);
