-- SKU do anúncio na hora da venda
alter table public.sales add column if not exists sku text;
notify pgrst, 'reload schema';
