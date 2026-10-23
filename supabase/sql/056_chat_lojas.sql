-- 056 — Chat interno por loja
-- Um grupo por loja (sala = nome da loja). Colaborador da loja só vê o grupo dela;
-- diretor, supervisor e pré-venda veem todos (mesma regra de agenda_escopo_unidade).
-- Mensagens não podem ser apagadas. O autor pode editar a própria mensagem; o texto
-- anterior fica guardado em chat_edicoes.

create table if not exists public.chat_mensagens (
  id           bigint generated always as identity primary key,
  sala         text not null,
  autor_id     text not null,
  autor_nome   text not null,
  autor_perfil text not null,
  texto        text not null check (length(btrim(texto)) between 1 and 4000),
  criado_em    timestamptz not null default now(),
  editado_em   timestamptz
);
create index if not exists chat_mensagens_sala_idx on public.chat_mensagens (sala, criado_em desc);

create table if not exists public.chat_edicoes (
  id             bigint generated always as identity primary key,
  mensagem_id    bigint not null references public.chat_mensagens(id),
  texto_anterior text not null,
  editado_em     timestamptz not null default now()
);

create table if not exists public.chat_leitura (
  usuario_id text not null,
  sala       text not null,
  lido_ate   timestamptz not null default now(),
  primary key (usuario_id, sala)
);

-- Usuário logado (id da tabela usuarios)
create or replace function public.chat_meu_id() returns text
language sql stable security definer set search_path to 'public' as $$
  select id from public.usuarios where auth_id = auth.uid() and ativo limit 1;
$$;

create or replace function public.chat_pode_sala(p_sala text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.agenda_eh_usuario() and p_sala is not null and p_sala <> ''
     and (public.agenda_escopo_unidade() = '*' or public.agenda_escopo_unidade() = p_sala);
$$;

-- Autor sempre vem da sessão (ninguém escreve em nome de outro)
create or replace function public.fn_chat_autor() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare u record;
begin
  select id, nome, perfil into u from public.usuarios where auth_id = auth.uid() and ativo limit 1;
  if u.id is null then raise exception 'sem usuário'; end if;
  new.autor_id := u.id; new.autor_nome := u.nome; new.autor_perfil := u.perfil;
  new.criado_em := now(); new.editado_em := null;
  new.texto := btrim(new.texto);
  return new;
end $$;
create trigger trg_chat_autor before insert on public.chat_mensagens
  for each row execute function public.fn_chat_autor();

-- Edição: só o texto muda; o anterior vai para o histórico
create or replace function public.fn_chat_edicao() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.sala is distinct from old.sala or new.autor_id is distinct from old.autor_id
     or new.criado_em is distinct from old.criado_em then
    raise exception 'só o texto pode ser editado';
  end if;
  new.autor_nome := old.autor_nome; new.autor_perfil := old.autor_perfil;
  new.texto := btrim(new.texto);
  if new.texto is distinct from old.texto then
    insert into public.chat_edicoes (mensagem_id, texto_anterior) values (old.id, old.texto);
    new.editado_em := now();
  else
    new.editado_em := old.editado_em;
  end if;
  return new;
end $$;
create trigger trg_chat_edicao before update on public.chat_mensagens
  for each row execute function public.fn_chat_edicao();

alter table public.chat_mensagens enable row level security;
alter table public.chat_edicoes   enable row level security;
alter table public.chat_leitura   enable row level security;

create policy chat_ler on public.chat_mensagens for select to authenticated
  using (public.chat_pode_sala(sala));
create policy chat_enviar on public.chat_mensagens for insert to authenticated
  with check (public.chat_pode_sala(sala));
create policy chat_editar on public.chat_mensagens for update to authenticated
  using (autor_id = public.chat_meu_id() and public.chat_pode_sala(sala))
  with check (autor_id = public.chat_meu_id());
-- sem política de delete: ninguém apaga

create policy chat_edicoes_ler on public.chat_edicoes for select to authenticated
  using (exists (select 1 from public.chat_mensagens m where m.id = mensagem_id and public.chat_pode_sala(m.sala)));

create policy chat_leitura_minha on public.chat_leitura for all to authenticated
  using (usuario_id = public.chat_meu_id())
  with check (usuario_id = public.chat_meu_id() and public.chat_pode_sala(sala));

revoke all on public.chat_mensagens, public.chat_edicoes, public.chat_leitura from anon;
revoke delete, truncate on public.chat_mensagens, public.chat_edicoes from authenticated;
revoke insert, update on public.chat_edicoes from authenticated;
grant select, insert, update on public.chat_mensagens to authenticated;
grant select on public.chat_edicoes to authenticated;
grant select, insert, update on public.chat_leitura to authenticated;

alter publication supabase_realtime add table public.chat_mensagens;

-- Não lidas por sala (RLS do próprio usuário se aplica)
create or replace function public.chat_nao_lidas()
returns table (sala text, n bigint)
language sql stable security invoker set search_path to 'public' as $$
  select m.sala, count(*)
    from public.chat_mensagens m
    left join public.chat_leitura l on l.sala = m.sala and l.usuario_id = public.chat_meu_id()
   where m.autor_id <> coalesce(public.chat_meu_id(), '')
     and m.criado_em > coalesce(l.lido_ate, '-infinity'::timestamptz)
   group by m.sala;
$$;
revoke all on function public.chat_nao_lidas() from anon, public;
grant execute on function public.chat_nao_lidas() to authenticated;

-- Marca a sala como lida com o relógio do servidor
create or replace function public.chat_marcar_lida(p_sala text)
returns void language sql volatile security invoker set search_path to 'public' as $$
  insert into public.chat_leitura (usuario_id, sala, lido_ate)
  values (public.chat_meu_id(), p_sala, now())
  on conflict (usuario_id, sala) do update set lido_ate = excluded.lido_ate;
$$;
revoke all on function public.chat_marcar_lida(text) from anon, public;
grant execute on function public.chat_marcar_lida(text) to authenticated;
