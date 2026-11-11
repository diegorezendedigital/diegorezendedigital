-- Pacote do Mercado Livre: vários pedidos comprados juntos (mesmo envio) aparecem como uma venda só.
alter table public.sales add column if not exists pack_id text;
create index if not exists sales_pack_idx on public.sales (store_id, pack_id);
