-- Grupo de variantes: produtos que são variações do mesmo modelo (cor, tamanho) compartilham o nome do grupo.
alter table public.products add column if not exists grupo text;
create index if not exists products_grupo_idx on public.products (store_id, grupo);
notify pgrst, 'reload schema';
