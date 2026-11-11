-- Tipo do produto do armazém: único, multi-variantes ou kit / produto aleatório.
alter table public.products add column if not exists tipo text not null default 'unico';
do $$ begin
  alter table public.products add constraint products_tipo_check check (tipo in ('unico', 'multi', 'kit'));
exception when duplicate_object then null; end $$;
