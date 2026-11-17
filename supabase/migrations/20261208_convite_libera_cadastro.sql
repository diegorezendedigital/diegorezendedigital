-- A trava de assinatura passa a liberar e-mails convidados por um usuário master (convite registrado antes do login nascer).
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
  -- Convite pendente feito pelo master da loja
  if exists (
    select 1 from public.store_members
    where lower(email) = lower(new.email) and user_id is null
  ) then
    return new;
  end if;
  raise exception 'ASSINATURA_OBRIGATORIA: nenhuma assinatura ativa para este e-mail';
end;
$$;
