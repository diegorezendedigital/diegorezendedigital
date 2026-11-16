-- Regras do robô de ofertas relâmpago da Shopee: copia os produtos e preços de uma oferta modelo para os horários livres.
create table if not exists public.shopee_flash_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  shop_id text not null,
  nome text not null default 'Robô de relâmpago',
  modelo_flash_sale_id bigint,
  modelo_itens jsonb not null default '[]'::jsonb,      -- produtos e preços copiados da oferta modelo
  modo text not null default 'todos',                    -- todos | diario | agenda
  dias_semana int[] not null default '{0,1,2,3,4,5,6}',  -- 0 = domingo (usado no modo agenda)
  hora_inicio int not null default 0,                    -- faixa de horário (hora de Brasília) em que pode começar
  hora_fim int not null default 24,
  dias_a_frente int not null default 3,                  -- até quantos dias à frente o robô agenda
  margem_minima numeric not null default 0,              -- produto abaixo dessa margem fica de fora
  imposto_pct numeric not null default 10,
  taxa_extra_pct numeric not null default 5,             -- taxas da Shopee além da comissão padrão (serviço adicional, transação)
  ativo boolean not null default true,
  ultima_execucao timestamptz,
  ultimo_resultado jsonb,
  total_criadas int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shopee_flash_rules_store on public.shopee_flash_rules (store_id);
alter table public.shopee_flash_rules enable row level security;
