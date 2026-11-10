-- Margem Certa: armazém, anúncios, CNPJs (regime tributário), NF-e e preço automático.
-- Segura para rodar mais de uma vez.

-- 1) Marketplaces de referência (a tabela estava vazia, o que quebrava a importação do Mercado Livre)
insert into public.marketplaces (id, name, commission_percent, fixed_fee, extra_percent) values
  ('mercado_livre', 'Mercado Livre', 12, 6, 0),
  ('shopee', 'Shopee', 14, 4, 0),
  ('amazon', 'Amazon', 15, 0, 0),
  ('magalu', 'Magazine Luiza', 16, 5, 0),
  ('americanas', 'Americanas', 15, 5, 0)
on conflict (id) do nothing;

-- 2) CNPJs da loja, cada um com seu regime
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  cnpj text,
  regime text not null default 'simples' check (regime in ('simples', 'lucro_real')),
  simples_aliquota numeric not null default 0,   -- % efetiva sobre a receita (Simples Nacional)
  icms_pct numeric not null default 0,           -- Lucro Real: % sobre a venda
  pis_pct numeric not null default 1.65,
  cofins_pct numeric not null default 7.6,
  irpj_csll_pct numeric not null default 34,     -- Lucro Real: % sobre o lucro antes do IR
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists companies_one_default_uidx on public.companies (store_id) where is_default;

-- 3) Produtos do armazém (cadastro mestre: custo, estoque, créditos fiscais)
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

-- 4) Anúncios nos marketplaces
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
  units integer not null default 1 check (units > 0),     -- unidades do armazém por venda (kits)
  shipping_cost numeric not null default 0,               -- frete médio pago pelo vendedor
  fee_percent numeric,                                    -- taxa % do marketplace (lida do ML)
  fee_fixed numeric,                                      -- taxa fixa em R$ (lida do ML)
  target_margin numeric not null default 15,              -- margem líquida desejada (%)
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

-- 5) Histórico de reajustes de preço
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

-- 6) Notas fiscais já importadas (evita lançar o mesmo XML duas vezes)
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

-- 7) Segurança: cada loja só enxerga o que é seu
alter table public.companies enable row level security;
alter table public.listings enable row level security;
alter table public.price_changes enable row level security;
alter table public.nfe_imports enable row level security;

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

-- 8) Custo das vendas passa a considerar as unidades do anúncio (kits)
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
