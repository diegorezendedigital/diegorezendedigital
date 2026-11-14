-- Assinaturas (Stripe) e trava de criação de conta.
-- 1) Tabela com o estado da assinatura por e-mail (só o servidor lê/escreve: RLS ligado, sem políticas).
create table if not exists public.assinaturas (
  email text primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  plano text,
  status text not null default 'incomplete',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.assinaturas enable row level security;

-- 2) Trava: só nasce conta nova (e-mail/senha ou Google) se o e-mail tiver assinatura ativa.
--    Quem já tem conta continua entrando normalmente. Para liberar alguém à mão, insira uma linha
--    em public.assinaturas com status 'active' para o e-mail dessa pessoa.
create or replace function public.exigir_assinatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.assinaturas
    where email = lower(new.email) and status in ('active', 'trialing')
  ) then
    return new;
  end if;
  raise exception 'ASSINATURA_OBRIGATORIA: nenhuma assinatura ativa para este e-mail';
end;
$$;

drop trigger if exists exigir_assinatura_no_cadastro on auth.users;
create trigger exigir_assinatura_no_cadastro
  before insert on auth.users
  for each row execute function public.exigir_assinatura();
