-- Nome que o usuário dá a cada loja/conta conectada (aparece na tela Integrações)
alter table public.ml_connections add column if not exists store_name text;
notify pgrst, 'reload schema';
