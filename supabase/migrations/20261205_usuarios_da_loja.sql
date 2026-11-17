-- Usuários da loja: o dono (master) convida outras pessoas, que entram na mesma loja com e-mail e senha próprios.

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade, -- loja (= id do usuário master)
  user_id uuid unique references auth.users(id) on delete cascade,      -- login do convidado (um login entra em uma loja só)
  email text not null,
  nome text,
  invited_by uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (store_id, email)
);
create index if not exists store_members_store on public.store_members (store_id);
alter table public.store_members enable row level security;
drop policy if exists "Master e o proprio convidado veem o vinculo" on public.store_members;
create policy "Master e o proprio convidado veem o vinculo" on public.store_members
  for select to authenticated using (store_id = (select auth.uid()) or user_id = (select auth.uid()));

-- Loja de quem está logado: a loja que o convidou, ou a própria (master).
create or replace function public.loja_do_usuario()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.store_id from public.store_members m where m.user_id = auth.uid() limit 1), auth.uid())
$$;
revoke all on function public.loja_do_usuario() from public;
grant execute on function public.loja_do_usuario() to authenticated;

-- Regras de acesso: em vez de "o dono", passa a valer "quem é da loja".
drop policy if exists "Store owner can view own store" on public.stores;
create policy "Store owner can view own store" on public.stores for select using (id = (select public.loja_do_usuario()));
-- criar e alterar a loja continua só com o master (auth.uid() = id), regras existentes mantidas

drop policy if exists "Store owner can manage own products" on public.products;
create policy "Store owner can manage own products" on public.products for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own sales" on public.sales;
create policy "Store owner can manage own sales" on public.sales for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own expenses" on public.expenses;
create policy "Store owner can manage own expenses" on public.expenses for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own listings" on public.listings;
create policy "Store owner can manage own listings" on public.listings for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own nfe imports" on public.nfe_imports;
create policy "Store owner can manage own nfe imports" on public.nfe_imports for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own product costs" on public.product_costs;
create policy "Store owner can manage own product costs" on public.product_costs for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can manage own product components" on public.product_components;
create policy "Store owner can manage own product components" on public.product_components for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can view own price changes" on public.price_changes;
create policy "Store owner can view own price changes" on public.price_changes for select to authenticated
  using (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can view own promo actions" on public.promo_actions;
create policy "Store owner can view own promo actions" on public.promo_actions for select to authenticated
  using (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can view own promo runs" on public.promo_runs;
create policy "Store owner can view own promo runs" on public.promo_runs for select to authenticated
  using (store_id = (select public.loja_do_usuario()));

drop policy if exists "Store owner can view own ml notifications" on public.ml_notificacoes;
create policy "Store owner can view own ml notifications" on public.ml_notificacoes for select to authenticated
  using (store_id = (select public.loja_do_usuario()));

-- CNPJs: todos da loja veem; só o master cria, altera ou apaga.
drop policy if exists "Store owner can manage own companies" on public.companies;
drop policy if exists "Loja ve os CNPJs" on public.companies;
drop policy if exists "Master gerencia os CNPJs" on public.companies;
create policy "Loja ve os CNPJs" on public.companies for select to authenticated
  using (store_id = (select public.loja_do_usuario()));
create policy "Master gerencia os CNPJs" on public.companies for all to authenticated
  using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));
