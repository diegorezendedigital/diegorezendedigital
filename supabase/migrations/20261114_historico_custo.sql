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
