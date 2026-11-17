-- Abas que cada colaborador pode acessar (vazio/null = todas)
alter table public.store_members add column if not exists permissoes text[];
