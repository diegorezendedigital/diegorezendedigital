-- Comissão de afiliado da Shopee (AMS) de cada venda, vinda do extrato do pedido
alter table public.sales add column if not exists fees_affiliate numeric not null default 0;
