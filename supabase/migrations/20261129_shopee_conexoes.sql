-- Conexões com a Shopee (uma linha por loja autorizada). Os tokens só são lidos pelo servidor.
create table if not exists public.shopee_connections (
  store_id uuid not null references public.stores(id) on delete cascade,
  shop_id text not null,
  shop_name text,
  region text,
  host text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  store_name text,
  company_id uuid references public.companies(id) on delete set null,
  primary key (store_id, shop_id)
);

alter table public.shopee_connections enable row level security;
-- Sem policy de leitura de propósito: a tabela guarda tokens. A tela lê pela API do servidor.

notify pgrst, 'reload schema';
