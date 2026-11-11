-- Participação automática em promoções do Mercado Livre
alter table public.listings
  add column if not exists promo_auto boolean not null default false,
  add column if not exists promo_min_margin numeric;

create table if not exists public.promo_actions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ml_user_id text,
  item_id text not null,
  promotion_id text not null,
  promotion_type text,
  promotion_name text,
  price numeric,
  margin numeric,
  min_margin numeric,
  status text not null,       -- entrou | recusada | erro
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, item_id, promotion_id)
);
alter table public.promo_actions enable row level security;
drop policy if exists "Store owner can view own promo actions" on public.promo_actions;
create policy "Store owner can view own promo actions" on public.promo_actions
  for select to authenticated using (store_id = (select auth.uid()));

notify pgrst, 'reload schema';
