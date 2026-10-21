-- 045 — Separação por loja no banco: opto, comercial e gerente só leem/gravam a própria loja;
-- diretor, supervisor e pré-venda veem todas. (Aplicada via MCP em 21/10/2026.)
create or replace function public.agenda_escopo_unidade()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case when perfil in ('diretor','supervisor','prevenda') then '*' else coalesce(unidade, '') end
      from public.usuarios where auth_id = auth.uid() and ativo limit 1), '');
$$;
revoke execute on function public.agenda_escopo_unidade() from public, anon;
grant execute on function public.agenda_escopo_unidade() to authenticated;
-- policies agenda_usuarios, receitas_leitura, receitas_usuarios, conversoes_usuarios:
--   ... and ((select agenda_escopo_unidade()) = '*' or unidade = (select agenda_escopo_unidade()))
