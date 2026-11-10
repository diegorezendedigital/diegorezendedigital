-- Detalhes do pedido nas vendas importadas (número, produto, estado do comprador, conta). Segura para repetir.
alter table public.sales
  add column if not exists order_number text,
  add column if not exists title text,
  add column if not exists buyer_state text,
  add column if not exists ml_user_id text;

notify pgrst, 'reload schema';
