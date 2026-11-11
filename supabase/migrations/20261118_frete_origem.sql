-- De onde veio o frete do anúncio: 'ml' (puxado do Mercado Livre) ou 'manual' (digitado por você)
alter table public.listings add column if not exists shipping_source text;
notify pgrst, 'reload schema';
