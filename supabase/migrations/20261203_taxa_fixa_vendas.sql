-- Parte fixa (R$ por item) da tarifa de venda, separada da comissão percentual (Shopee: comissão + taxa fixa)
alter table public.sales add column if not exists fees_fixed numeric not null default 0;
