-- Nota Fiscal: configuração do emissor fiscal (Focus NFe) por CNPJ e caixa de entrada das notas de compra.
-- Segura para rodar mais de uma vez: só cria o que falta e não apaga dados.

-- 1) Configuração fiscal por CNPJ. Guarda os tokens da Focus NFe, então só o servidor lê (sem policy de leitura de propósito).
create table if not exists public.fiscal_config (
  store_id uuid not null references public.stores(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  provedor text not null default 'focus',
  token_homologacao text,
  token_producao text,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  entrada_ativa boolean not null default true,
  ciencia_automatica boolean not null default true,
  entrada_versao bigint not null default 0,
  entrada_ultima_busca timestamptz,
  entrada_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (store_id, company_id)
);
alter table public.fiscal_config enable row level security;
-- Sem policy de leitura de propósito: a tabela guarda tokens. A tela lê pela API do servidor.

-- 2) Notas de entrada (compras): as que chegam pela SEFAZ via Focus NFe e as enviadas em XML.
create table if not exists public.nfe_entradas (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  chave text not null,
  numero text,
  serie text,
  emitente_nome text,
  emitente_cnpj text,
  destinatario_cnpj text,
  emitida_em timestamptz,
  total numeric,
  itens integer,
  situacao text not null default 'autorizada',  -- autorizada | cancelada | denegada
  manifestacao text,                             -- null | ciencia | confirmacao | desconhecimento | nao_realizada
  completa boolean not null default false,       -- true = o XML completo está guardado aqui
  xml text,
  versao bigint,                                 -- versão da nota na Focus NFe (busca só o que mudou)
  origem text not null default 'focus',          -- focus | xml
  lancada_em timestamptz,                        -- quando os custos da nota foram lançados nos produtos
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (store_id, chave)
);
create index if not exists nfe_entradas_loja_data on public.nfe_entradas (store_id, emitida_em desc);
create index if not exists nfe_entradas_sem_xml on public.nfe_entradas (store_id, atualizado_em) where completa = false;
alter table public.nfe_entradas enable row level security;
drop policy if exists "Loja gerencia as notas de entrada" on public.nfe_entradas;
create policy "Loja gerencia as notas de entrada" on public.nfe_entradas for all to authenticated
  using (store_id = (select public.loja_do_usuario())) with check (store_id = (select public.loja_do_usuario()));

notify pgrst, 'reload schema';
