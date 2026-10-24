-- 057 — Conversão automática a partir das vendas do Sistema ADM
-- A função vendas-adm lê as OS do ADM (só leitura) e liga a venda à receita:
--   mesma loja + mesmo telefone + nome confere + venda até 30 dias depois do exame → conversão automática (origem ADM)
--   telefone confere mas nome não (ou o contrário) → vai para "Para conferir" (vendas_sugestoes)
--   30 dias sem venda → "Não convertido" (origem PRAZO)
-- Conversão registrada à mão (origem MANUAL ou vazia) nunca é alterada pela integração.

create unique index if not exists conversoes_receita_unica on public.conversoes (receita_id);

create table if not exists public.vendas_sugestoes (
  id            bigint generated always as identity primary key,
  receita_id    text not null,
  unidade       text not null,
  paciente_nome text,
  os_id         text not null,
  os_numero     text,
  os_tipo       text,
  cliente       text,
  telefone_fim  text,
  dt_venda      date,
  valor         numeric,
  motivo        text not null,        -- TELEFONE_IGUAL_NOME_DIFERENTE | NOME_IGUAL_TELEFONE_DIFERENTE
  status        text not null default 'PENDENTE', -- PENDENTE | CONFIRMADA | DESCARTADA | CANCELADA
  decidido_por  text,
  decidido_em   timestamptz,
  created_at    timestamptz not null default now(),
  unique (receita_id, os_id)
);

create table if not exists public.integracao_adm (
  id               int primary key default 1 check (id = 1),
  ultima_execucao  timestamptz,
  resumo           jsonb
);
insert into public.integracao_adm (id) values (1) on conflict do nothing;

alter table public.vendas_sugestoes enable row level security;
alter table public.integracao_adm   enable row level security;

-- leitura: quem pode ver a loja; gravação só pela função (service role)
create policy vendas_sugestoes_ler on public.vendas_sugestoes for select to authenticated
  using ((select public.agenda_eh_usuario()) and ((select public.agenda_escopo_unidade()) = '*' or unidade = (select public.agenda_escopo_unidade())));
create policy integracao_adm_ler on public.integracao_adm for select to authenticated
  using ((select public.agenda_eh_usuario()));

revoke all on public.vendas_sugestoes, public.integracao_adm from anon;
revoke insert, update, delete, truncate on public.vendas_sugestoes, public.integracao_adm from authenticated;
grant select on public.vendas_sugestoes, public.integracao_adm to authenticated;

alter publication supabase_realtime add table public.vendas_sugestoes;

-- Agendador: busca as vendas do ADM a cada 15 minutos (função vendas-adm)
-- select cron.schedule('vendas-adm-15min', '*/15 * * * *', $$ select net.http_post(
--   url := 'https://gnqokiwxbamiegjrfacv.supabase.co/functions/v1/vendas-adm',
--   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <anon key>'),
--   body := '{"acao":"sincronizar"}'::jsonb, timeout_milliseconds := 60000); $$);
