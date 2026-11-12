-- User Products do Mercado Livre: identificador do produto do usuário e família (mesmo modelo, cores/tamanhos diferentes).
alter table public.listings add column if not exists user_product_id text;
alter table public.listings add column if not exists family_id text;
alter table public.listings add column if not exists family_name text;
create index if not exists listings_family_idx on public.listings (store_id, family_id);
notify pgrst, 'reload schema';
