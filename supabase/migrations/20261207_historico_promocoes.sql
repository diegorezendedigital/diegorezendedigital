-- Histórico completo das promoções automáticas: cada ação vira uma linha nova (nunca é substituída).
create table if not exists public.promo_action_events (
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
  status text not null,
  message text,
  run_id uuid,
  origem text,
  created_at timestamptz not null default now()
);
create index if not exists promo_action_events_store_data on public.promo_action_events (store_id, created_at desc);
alter table public.promo_action_events enable row level security;
drop policy if exists "Loja ve o historico de promocoes" on public.promo_action_events;
create policy "Loja ve o historico de promocoes" on public.promo_action_events for select to authenticated
  using (store_id = (select public.loja_do_usuario()));
