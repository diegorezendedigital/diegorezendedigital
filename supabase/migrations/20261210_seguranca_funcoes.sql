-- Corrige os avisos do Security Advisor sobre funções SECURITY DEFINER.

-- 1) Funções de gatilho e internas: só o próprio banco usa (gatilhos rodam sem precisar de permissão de execução)
revoke execute on function public.exigir_assinatura()        from public, anon, authenticated;
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.kit_composicao_mudou()     from public, anon, authenticated;
revoke execute on function public.peca_custo_mudou()         from public, anon, authenticated;
revoke execute on function public.registrar_custo_produto()  from public, anon, authenticated;
revoke execute on function public.recalcular_kit(uuid)       from public, anon, authenticated;

-- 2) Usadas pelas regras de acesso (RLS) e pelo sistema: só usuário logado, nunca visitante anônimo
revoke execute on function public.loja_do_usuario() from public, anon;
grant  execute on function public.loja_do_usuario() to authenticated;
revoke execute on function public.is_admin()        from public, anon;
grant  execute on function public.is_admin()        to authenticated;
