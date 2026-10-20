-- 040 — Gerou receita = Compareceu; a regra de 1 hora só marca "Não Compareceu" quem não tem receita.
-- Rodar no SQL Editor do Supabase (projeto gnqokiwxbamiegjrfacv).

-- 1) Regra de 1 hora: ignora quem já tem receita
create or replace function public.agenda_marcar_nao_compareceu()
returns integer language sql security definer set search_path to 'public' as $$
  with alvo as (
    update public.agenda a set status = 'Não Compareceu'
    where a.status = 'Agendado'
      and a.data ~ '^\d{4}-\d{2}-\d{2}$' and a.hora ~ '^\d{2}:\d{2}'
      and (a.data || ' ' || left(a.hora, 5))::timestamp < (now() at time zone 'America/Sao_Paulo') - interval '1 hour'
      and not exists (select 1 from public.receitas r where r.agenda_id = a.id)
    returning 1
  ) select count(*)::int from alvo;
$$;
revoke execute on function public.agenda_marcar_nao_compareceu() from public, anon, authenticated;

-- 2) Ao gerar a receita, o agendamento vira "Compareceu" na hora
create or replace function public.fn_receita_marca_compareceu()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.agenda_id is not null then
    update public.agenda set status = 'Compareceu'
     where id = new.agenda_id and status is distinct from 'Compareceu';
  end if;
  return null;
end $$;
revoke execute on function public.fn_receita_marca_compareceu() from public, anon, authenticated;
drop trigger if exists trg_receita_compareceu on public.receitas;
create trigger trg_receita_compareceu after insert on public.receitas
  for each row execute function public.fn_receita_marca_compareceu();

-- 3) Corrige quem já tem receita e ficou com outro status (hoje: 2 pacientes)
update public.agenda a set status = 'Compareceu'
 where a.status <> 'Compareceu'
   and exists (select 1 from public.receitas r where r.agenda_id = a.id);
