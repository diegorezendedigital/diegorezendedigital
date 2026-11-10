-- Integração com o Mercado Livre + ajustes de segurança.
-- Pode ser rodada mais de uma vez sem problemas (idempotente).

-- 1) Identificadores do Mercado Livre, para não duplicar vendas/produtos a cada sincronização.
alter table public.products add column if not exists external_id text;
alter table public.sales    add column if not exists external_id text;

create unique index if not exists products_store_external_uidx on public.products (store_id, external_id);
create unique index if not exists sales_store_external_uidx    on public.sales    (store_id, external_id);

-- 2) Tokens do Mercado Livre só podem ser lidos/gravados pelo servidor (service_role).
--    Antes, o dono da loja conseguia ler o próprio access_token pelo navegador.
--    Com o RLS ligado e nenhuma policy, anon e authenticated ficam sem acesso à tabela.
drop policy if exists "Store owner can manage own ML connection" on public.ml_connections;
drop policy if exists "Admin full access ml_connections" on public.ml_connections;
alter table public.ml_connections enable row level security;

-- 3) Quando o custo de um produto muda, recalcula o custo das vendas desse produto.
create or replace function public.recalc_sales_cost(p_product uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.sales s
     set cost_price = p.cost_price * s.quantity
    from public.products p
   where p.id = s.product_id
     and s.product_id = p_product;
$$;

revoke execute on function public.recalc_sales_cost(uuid) from public, anon;
grant execute on function public.recalc_sales_cost(uuid) to authenticated;

-- 4) Usuários criados antes do gatilho on_auth_user_created ficaram sem loja.
insert into public.stores (id, name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', 'Minha Loja')
  from auth.users u
on conflict (id) do nothing;
