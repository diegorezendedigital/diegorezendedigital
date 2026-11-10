-- Margem Certa: esquema completo do banco. Cole no SQL Editor do Supabase e clique em Run.
-- Seguro para rodar mais de uma vez: só cria o que falta e não apaga dados.

-- 1) Tabelas base -----------------------------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Minha Loja',
  created_at timestamptz not null default now()
);

create table if not exists public.marketplaces (
  id text primary key,
  name text not null,
  commission_percent numeric not null default 0,
  fixed_fee numeric not null default 0,
  extra_percent numeric not null default 0,
  notes text
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  sku text,
  cost_price numeric not null default 0,
  sale_price numeric not null default 0,
  marketplace_id text references public.marketplaces(id),
  created_at timestamptz not null default now(),
  external_id text
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id),
  marketplace_id text references public.marketplaces(id),
  quantity integer not null default 1,
  sale_price numeric not null,
  cost_price numeric not null,
  fees_total numeric not null default 0,
  sold_at timestamptz not null default now(),
  shipping_cost numeric not null default 0,
  tax_amount numeric not null default 0,
  profit numeric generated always as (sale_price - cost_price - fees_total - shipping_cost - tax_amount) stored,
  external_id text
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null default 'despesa_fixa',
  description text not null,
  amount numeric not null default 0,
  month_ref date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Tokens do Mercado Livre: só o servidor lê (sem nenhuma regra de acesso para o navegador)
create table if not exists public.ml_connections (
  store_id uuid primary key references public.stores(id) on delete cascade,
  ml_user_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  connected_at timestamptz not null default now()
);

-- Colunas que podem faltar se as tabelas já existiam em versões antigas
alter table public.products add column if not exists external_id text;
alter table public.sales add column if not exists external_id text;
alter table public.sales add column if not exists shipping_cost numeric not null default 0;
alter table public.sales add column if not exists tax_amount numeric not null default 0;
create unique index if not exists products_store_external_uidx on public.products (store_id, external_id);
create unique index if not exists sales_store_external_uidx on public.sales (store_id, external_id);

-- 2) Funções e criação automática da loja ao cadastrar um usuário -----------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.stores (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Minha Loja'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Usuários que já existiam e ainda não têm loja
insert into public.stores (id, name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Minha Loja')
from auth.users u
on conflict (id) do nothing;

-- 3) Marketplaces de referência -----------------------------------------------------------------
insert into public.marketplaces (id, name, commission_percent, fixed_fee, extra_percent) values
  ('mercado_livre', 'Mercado Livre', 12, 6, 0),
  ('shopee', 'Shopee', 14, 4, 0),
  ('amazon', 'Amazon', 15, 0, 0),
  ('magalu', 'Magazine Luiza', 16, 5, 0),
  ('americanas', 'Americanas', 15, 5, 0)
on conflict (id) do nothing;

-- 4) CNPJs da loja, cada um com seu regime ------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  cnpj text,
  regime text not null default 'simples' check (regime in ('simples', 'lucro_real')),
  simples_aliquota numeric not null default 0,
  icms_pct numeric not null default 0,
  pis_pct numeric not null default 1.65,
  cofins_pct numeric not null default 7.6,
  irpj_csll_pct numeric not null default 34,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists companies_one_default_uidx on public.companies (store_id) where is_default;

-- 5) Produtos do armazém ------------------------------------------------------------------------
alter table public.products
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists ean text,
  add column if not exists ncm text,
  add column if not exists stock_qty numeric not null default 0,
  add column if not exists icms_credit numeric not null default 0,
  add column if not exists pis_credit numeric not null default 0,
  add column if not exists cofins_credit numeric not null default 0,
  add column if not exists cost_updated_at timestamptz;
create unique index if not exists products_store_sku_uidx on public.products (store_id, sku);

-- 6) Anúncios nos marketplaces ------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  marketplace_id text not null default 'mercado_livre' references public.marketplaces(id),
  external_id text not null,
  title text not null,
  permalink text,
  thumbnail text,
  status text,
  category_id text,
  listing_type_id text,
  price numeric not null default 0,
  product_id uuid references public.products(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  units integer not null default 1 check (units > 0),
  shipping_cost numeric not null default 0,
  fee_percent numeric,
  fee_fixed numeric,
  target_margin numeric not null default 15,
  min_price numeric,
  max_price numeric,
  auto_price boolean not null default false,
  last_repriced_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, external_id)
);
create index if not exists listings_store_idx on public.listings (store_id);
create index if not exists listings_product_idx on public.listings (product_id);

create table if not exists public.price_changes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  old_price numeric not null,
  new_price numeric not null,
  ok boolean not null default true,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists price_changes_store_idx on public.price_changes (store_id, created_at desc);

create table if not exists public.nfe_imports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  chave text not null,
  numero text,
  serie text,
  emitente_nome text,
  emitente_cnpj text,
  emitida_em timestamptz,
  total numeric,
  itens integer,
  created_at timestamptz not null default now(),
  unique (store_id, chave)
);

alter table public.sales add column if not exists listing_id uuid references public.listings(id) on delete set null;

-- 7) Segurança: cada loja só enxerga o que é seu ----------------------------------------------------
alter table public.stores enable row level security;
alter table public.marketplaces enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.admins enable row level security;
alter table public.ml_connections enable row level security;
alter table public.companies enable row level security;
alter table public.listings enable row level security;
alter table public.price_changes enable row level security;
alter table public.nfe_imports enable row level security;

-- ml_connections: nenhuma regra de acesso de propósito (os tokens só são lidos pelo servidor)
drop policy if exists "Store owner can manage own ML connection" on public.ml_connections;
drop policy if exists "Admin full access ml_connections" on public.ml_connections;

drop policy if exists "Store owner can view own store" on public.stores;
create policy "Store owner can view own store" on public.stores for select using (auth.uid() = id);
drop policy if exists "Store owner can insert own store" on public.stores;
create policy "Store owner can insert own store" on public.stores for insert with check (auth.uid() = id);
drop policy if exists "Store owner can update own store" on public.stores;
create policy "Store owner can update own store" on public.stores for update using (auth.uid() = id);
drop policy if exists "Admin full access stores" on public.stores;
create policy "Admin full access stores" on public.stores for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Anyone authenticated can read marketplaces" on public.marketplaces;
create policy "Anyone authenticated can read marketplaces" on public.marketplaces for select to authenticated using (true);

drop policy if exists "Store owner can manage own products" on public.products;
create policy "Store owner can manage own products" on public.products for all using (auth.uid() = store_id) with check (auth.uid() = store_id);
drop policy if exists "Admin full access products" on public.products;
create policy "Admin full access products" on public.products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Store owner can manage own sales" on public.sales;
create policy "Store owner can manage own sales" on public.sales for all using (auth.uid() = store_id) with check (auth.uid() = store_id);
drop policy if exists "Admin full access sales" on public.sales;
create policy "Admin full access sales" on public.sales for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Store owner can manage own expenses" on public.expenses;
create policy "Store owner can manage own expenses" on public.expenses for all using (auth.uid() = store_id) with check (auth.uid() = store_id);
drop policy if exists "Admin full access expenses" on public.expenses;
create policy "Admin full access expenses" on public.expenses for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "User can check own admin status" on public.admins;
create policy "User can check own admin status" on public.admins for select using (auth.uid() = user_id);

drop policy if exists "Store owner can manage own companies" on public.companies;
create policy "Store owner can manage own companies" on public.companies
  for all to authenticated using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));

drop policy if exists "Store owner can manage own listings" on public.listings;
create policy "Store owner can manage own listings" on public.listings
  for all to authenticated using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));

drop policy if exists "Store owner can view own price changes" on public.price_changes;
create policy "Store owner can view own price changes" on public.price_changes
  for select to authenticated using (store_id = (select auth.uid()));

drop policy if exists "Store owner can manage own nfe imports" on public.nfe_imports;
create policy "Store owner can manage own nfe imports" on public.nfe_imports
  for all to authenticated using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));

-- 8) Recalcula o custo das vendas quando o custo do produto muda (considera as unidades do anúncio)
create or replace function public.recalc_sales_cost(p_product uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.sales s
     set cost_price = p.cost_price
                      * coalesce((select l.units from public.listings l where l.id = s.listing_id), 1)
                      * s.quantity
    from public.products p
   where p.id = p_product and s.product_id = p.id;
$$;
revoke all on function public.recalc_sales_cost(uuid) from public, anon;
grant execute on function public.recalc_sales_cost(uuid) to authenticated;

-- Pede ao Supabase para reconhecer as tabelas novas
notify pgrst, 'reload schema';
-- Várias contas do Mercado Livre por loja (ex.: uma por CNPJ). Segura para rodar mais de uma vez.

alter table public.ml_connections
  add column if not exists nickname text,
  add column if not exists company_id uuid references public.companies(id) on delete set null;

update public.ml_connections set ml_user_id = 'desconhecido' where ml_user_id is null;
alter table public.ml_connections alter column ml_user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ml_connections'::regclass and contype = 'p' and array_length(conkey, 1) = 2
  ) then
    alter table public.ml_connections drop constraint if exists ml_connections_pkey;
    alter table public.ml_connections add primary key (store_id, ml_user_id);
  end if;
end $$;

-- De qual conta do Mercado Livre é cada anúncio
alter table public.listings add column if not exists ml_user_id text;
update public.listings l
   set ml_user_id = c.ml_user_id
  from public.ml_connections c
 where c.store_id = l.store_id
   and l.ml_user_id is null
   and (select count(*) from public.ml_connections x where x.store_id = l.store_id) = 1;

notify pgrst, 'reload schema';

alter table public.sales
  add column if not exists order_number text,
  add column if not exists title text,
  add column if not exists buyer_state text,
  add column if not exists ml_user_id text;

notify pgrst, 'reload schema';

-- Histórico de custo por produto: cada venda guarda o custo da época e não muda quando o custo do produto mudar.
create table if not exists public.product_costs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  cost_price numeric not null default 0,
  icms_credit numeric not null default 0,
  pis_credit numeric not null default 0,
  cofins_credit numeric not null default 0,
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists product_costs_product_idx on public.product_costs (product_id, valid_from);

alter table public.product_costs enable row level security;
drop policy if exists "Store owner can manage own product costs" on public.product_costs;
create policy "Store owner can manage own product costs" on public.product_costs
  for all to authenticated using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));

-- Produtos que já existem: o custo atual vira a primeira linha do histórico
insert into public.product_costs (store_id, product_id, cost_price, icms_credit, pis_credit, cofins_credit, valid_from)
select p.store_id, p.id, p.cost_price, coalesce(p.icms_credit,0), coalesce(p.pis_credit,0), coalesce(p.cofins_credit,0),
       coalesce(p.cost_updated_at, p.created_at, now())
  from public.products p
 where not exists (select 1 from public.product_costs c where c.product_id = p.id);

-- Toda mudança de custo/créditos no produto (tela, planilha ou XML) grava uma linha nova no histórico
create or replace function public.registrar_custo_produto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.cost_price is distinct from old.cost_price
     or new.icms_credit is distinct from old.icms_credit
     or new.pis_credit is distinct from old.pis_credit
     or new.cofins_credit is distinct from old.cofins_credit then
    insert into public.product_costs (store_id, product_id, cost_price, icms_credit, pis_credit, cofins_credit, valid_from)
    values (new.store_id, new.id, coalesce(new.cost_price,0), coalesce(new.icms_credit,0), coalesce(new.pis_credit,0), coalesce(new.cofins_credit,0), now());
  end if;
  return new;
end $$;

drop trigger if exists produto_registra_custo on public.products;
create trigger produto_registra_custo
  after insert or update of cost_price, icms_credit, pis_credit, cofins_credit on public.products
  for each row execute function public.registrar_custo_produto();

-- Antes, mudar o custo reescrevia TODAS as vendas do produto. Agora só preenche vendas que ainda estão sem custo,
-- usando o custo vigente na data da venda. Vendas com custo já gravado nunca são alteradas.
create or replace function public.recalc_sales_cost(p_product uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.sales s
     set cost_price = coalesce((
           select c.cost_price from public.product_costs c
            where c.product_id = s.product_id
            order by (c.valid_from <= s.sold_at) desc,
                     case when c.valid_from <= s.sold_at then c.valid_from end desc nulls last,
                     c.valid_from asc
            limit 1), 0)
         * coalesce((select l.units from public.listings l where l.id = s.listing_id), 1)
         * s.quantity
   where s.product_id = p_product and s.cost_price = 0;
$$;

notify pgrst, 'reload schema';
