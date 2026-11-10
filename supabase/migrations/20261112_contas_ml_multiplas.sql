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
