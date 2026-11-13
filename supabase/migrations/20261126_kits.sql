-- Kits: um produto "kit" é composto por outros produtos do armazém (com quantidade). O custo do kit é a soma dos custos
-- das peças e se atualiza sozinho sempre que o custo unitário de uma peça mudar (cada mudança fica no histórico de custo).
create table if not exists public.product_components (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  kit_id uuid not null references public.products(id) on delete cascade,
  component_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (kit_id, component_id),
  check (kit_id <> component_id)
);
create index if not exists product_components_component_idx on public.product_components (component_id);

alter table public.product_components enable row level security;
drop policy if exists "Store owner can manage own product components" on public.product_components;
create policy "Store owner can manage own product components" on public.product_components
  for all to authenticated using (store_id = (select auth.uid())) with check (store_id = (select auth.uid()));

-- Recalcula custo e créditos do kit pela soma das peças (kit sem peças mantém o custo digitado)
create or replace function public.recalcular_kit(p_kit uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int; c numeric; i numeric; p numeric; f numeric;
begin
  select count(*),
         coalesce(sum(pc.quantity * pr.cost_price), 0),
         coalesce(sum(pc.quantity * coalesce(pr.icms_credit, 0)), 0),
         coalesce(sum(pc.quantity * coalesce(pr.pis_credit, 0)), 0),
         coalesce(sum(pc.quantity * coalesce(pr.cofins_credit, 0)), 0)
    into n, c, i, p, f
    from public.product_components pc
    join public.products pr on pr.id = pc.component_id
   where pc.kit_id = p_kit;
  if n = 0 then return; end if;
  update public.products
     set cost_price = round(c, 2),
         icms_credit = round(i, 2),
         pis_credit = round(p, 2),
         cofins_credit = round(f, 2),
         cost_updated_at = now()
   where id = p_kit
     and (cost_price is distinct from round(c, 2)
          or coalesce(icms_credit, 0) is distinct from round(i, 2)
          or coalesce(pis_credit, 0) is distinct from round(p, 2)
          or coalesce(cofins_credit, 0) is distinct from round(f, 2));
end $$;

-- Mudou a composição: recalcula o kit
create or replace function public.kit_composicao_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.recalcular_kit(old.kit_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.recalcular_kit(new.kit_id); end if;
  return null;
end $$;

drop trigger if exists kit_recalcula_composicao on public.product_components;
create trigger kit_recalcula_composicao
  after insert or update or delete on public.product_components
  for each row execute function public.kit_composicao_mudou();

-- Mudou o custo de uma peça: recalcula todos os kits que usam essa peça
create or replace function public.peca_custo_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare k uuid;
begin
  if pg_trigger_depth() > 3 then return null; end if;
  for k in select distinct kit_id from public.product_components where component_id = new.id loop
    perform public.recalcular_kit(k);
  end loop;
  return null;
end $$;

drop trigger if exists produto_recalcula_kits on public.products;
create trigger produto_recalcula_kits
  after update of cost_price, icms_credit, pis_credit, cofins_credit on public.products
  for each row execute function public.peca_custo_mudou();

notify pgrst, 'reload schema';
