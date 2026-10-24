-- 058 — Nome do paciente sem emoji/símbolos (a IA às vezes grava o nome do perfil do WhatsApp)
-- Mantém letras (com acento), números, espaço, ponto, hífen e apóstrofo; junta espaços.
-- Se sobrar vazio (nome só com emoji), grava 'SEM NOME - VERIFICAR'. Vale para agenda, pacientes,
-- receitas e conversões, venha de onde vier. O evento no Google Agenda não é alterado.

create or replace function public.limpa_nome(p text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when p is null then null
    when btrim(p) = '' then p
    else coalesce(nullif(btrim(regexp_replace(regexp_replace(p, '[^A-Za-zÀ-ÖØ-öø-ÿ0-9 .''-]', ' ', 'g'), '\s+', ' ', 'g')), ''), 'SEM NOME - VERIFICAR')
  end;
$$;

create or replace function public.fn_nome_limpo() returns trigger
language plpgsql set search_path to 'public' as $$
declare c text; j jsonb := to_jsonb(new);
begin
  foreach c in array TG_ARGV loop
    if jsonb_typeof(j->c) = 'string' then
      j := jsonb_set(j, array[c], to_jsonb(upper(public.limpa_nome(j->>c))));
    end if;
  end loop;
  new := jsonb_populate_record(new, j);
  return new;
end $$;

create trigger trg_nome_limpo before insert or update on public.agenda     for each row execute function public.fn_nome_limpo('paciente_nome');
create trigger trg_nome_limpo before insert or update on public.pacientes  for each row execute function public.fn_nome_limpo('nome');
create trigger trg_nome_limpo before insert or update on public.receitas   for each row execute function public.fn_nome_limpo('paciente_nome');
create trigger trg_nome_limpo before insert or update on public.conversoes for each row execute function public.fn_nome_limpo('paciente_nome');

-- corrige o que já foi gravado
update public.agenda     set paciente_nome = paciente_nome where paciente_nome ~ '[^A-Za-zÀ-ÖØ-öø-ÿ0-9 .''-]';
update public.pacientes  set nome = nome                   where nome ~ '[^A-Za-zÀ-ÖØ-öø-ÿ0-9 .''-]';
update public.receitas   set paciente_nome = paciente_nome where paciente_nome ~ '[^A-Za-zÀ-ÖØ-öø-ÿ0-9 .''-]';
update public.conversoes set paciente_nome = paciente_nome where paciente_nome ~ '[^A-Za-zÀ-ÖØ-öø-ÿ0-9 .''-]';
