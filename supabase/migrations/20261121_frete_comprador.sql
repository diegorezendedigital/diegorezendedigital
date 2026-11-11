-- Frete que o comprador pagou no pedido (aparece no resumo de Pedidos)
alter table public.sales add column if not exists buyer_shipping numeric not null default 0;
notify pgrst, 'reload schema';
