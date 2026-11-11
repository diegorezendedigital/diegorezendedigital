-- Senha master (guardada só como hash, acessível apenas pelo servidor) e marca de custo informado à mão.
create table if not exists public.store_secrets (
  store_id uuid primary key references public.stores(id) on delete cascade,
  master_salt text not null,
  master_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.store_secrets enable row level security; -- sem políticas: o navegador não enxerga nada

alter table public.sales add column if not exists cost_manual boolean not null default false;

notify pgrst, 'reload schema';
