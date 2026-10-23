-- 050 — Só supervisor e diretor veem todas as lojas; pré-venda passa a ver só a própria loja (aplicada via MCP em 23/10/2026)
create or replace function public.agenda_escopo_unidade()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case when perfil in ('diretor','supervisor') then '*' else coalesce(unidade, '') end
      from public.usuarios where auth_id = auth.uid() and ativo limit 1), '');
$$;
