-- Devoluções e reclamações salvas (para não buscar tudo de novo a cada visita)
create table if not exists public.devolucoes (
  store_id uuid not null,
  mp text not null,
  id text not null,
  conta text,
  pedido text,
  data timestamptz,
  aberta boolean not null default true,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (store_id, mp, id)
);
create index if not exists devolucoes_loja_data on public.devolucoes (store_id, data desc);
alter table public.devolucoes enable row level security;
drop policy if exists "Loja ve as devolucoes" on public.devolucoes;
create policy "Loja ve as devolucoes" on public.devolucoes for select to authenticated using (store_id = public.loja_do_usuario());
