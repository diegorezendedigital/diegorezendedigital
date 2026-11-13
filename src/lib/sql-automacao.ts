// Cópia do SQL de supabase/migrations/20261128_automacao_promocoes.sql, para a tela oferecer o "copiar" quando faltar no banco.
export const SQL_AUTOMACAO_PROMOCOES = `-- Promoção automática em segundo plano: rodadas com progresso, convites em tempo real (notificações do Mercado Livre)
-- e a origem de cada entrada no log. Pode rodar mais de uma vez sem problema.

-- Log das promoções automáticas (já existe se o SQL de 19/11 foi rodado)
create table if not exists public.promo_actions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ml_user_id text,
  item_id text not null,
  promotion_id text not null,
  promotion_type text,
  promotion_name text,
  price numeric,
  margin numeric,
  min_margin numeric,
  status text not null,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, item_id, promotion_id)
);
alter table public.promo_actions enable row level security;
drop policy if exists "Store owner can view own promo actions" on public.promo_actions;
create policy "Store owner can view own promo actions" on public.promo_actions
  for select to authenticated using (store_id = (select auth.uid()));
alter table public.promo_actions
  add column if not exists run_id uuid,
  add column if not exists origem text; -- manual | agendada | notificacao
create index if not exists promo_actions_rodada_idx on public.promo_actions (run_id);

-- Rodadas (uma ativa por loja), com o andamento que a tela mostra ao vivo
create table if not exists public.promo_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  origem text not null default 'manual',   -- manual | agendada
  status text not null default 'na_fila',  -- na_fila | rodando | concluida | erro | cancelada
  total integer not null default 0,        -- convites a verificar
  feitos integer not null default 0,
  promocoes_total integer not null default 0,
  promocoes_feitas integer not null default 0,
  avaliados integer not null default 0,
  entraram integer not null default 0,
  recusados integer not null default 0,
  erros integer not null default 0,
  cursor jsonb,
  mensagem text,
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  batida_em timestamptz,
  lease_ate timestamptz,
  terminado_em timestamptz
);
create index if not exists promo_runs_loja_idx on public.promo_runs (store_id, criado_em desc);
create unique index if not exists promo_runs_uma_ativa on public.promo_runs (store_id) where status in ('na_fila', 'rodando');
alter table public.promo_runs enable row level security;
drop policy if exists "Store owner can view own promo runs" on public.promo_runs;
create policy "Store owner can view own promo runs" on public.promo_runs
  for select to authenticated using (store_id = (select auth.uid()));

-- Notificações do Mercado Livre (convites para promoções chegam na hora)
create table if not exists public.ml_notificacoes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ml_user_id text,
  topic text not null,
  resource text not null,
  recebida_em timestamptz not null default now(),
  processada_em timestamptz,
  tentativas integer not null default 0,
  resultado text,
  unique (store_id, topic, resource)
);
create index if not exists ml_notificacoes_loja_idx on public.ml_notificacoes (store_id, recebida_em desc);
create index if not exists ml_notificacoes_pendentes_idx on public.ml_notificacoes (recebida_em) where processada_em is null;
alter table public.ml_notificacoes enable row level security;
drop policy if exists "Store owner can view own ml notifications" on public.ml_notificacoes;
create policy "Store owner can view own ml notifications" on public.ml_notificacoes
  for select to authenticated using (store_id = (select auth.uid()));

notify pgrst, 'reload schema';
`;
