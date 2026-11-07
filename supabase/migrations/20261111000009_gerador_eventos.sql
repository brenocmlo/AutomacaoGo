-- GoAudit · migração 9 · gerador de eventos ao vivo (agente_gerador).
-- A cada hora simulada um agente faz chegar títulos e mensagens NOVOS de fornecedores (rotina, duplicidade, golpe
-- por mensagem), no formato dos CSVs da base. Ele só INSERE em `eventos_gerados` e no log: não lê decisões,
-- não aprova, não age em título. Humanos e agentes de operação/validação leem a tabela (le_painel).
-- Idempotente: pode ser colada de novo sem efeito colateral.

-- 1) Novo papel -------------------------------------------------------------------------------
-- (o valor novo só pode ser usado depois que esta transação terminar; por isso nada abaixo o compara como enum:
--  jwt_papel() devolve texto)
alter type public.papel add value if not exists 'agente_gerador';

-- 2) Ator do log: o gerador aparece como 'gerador_eventos' ------------------------------------
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.log_auditoria'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%ator_tipo%'
  loop
    execute format('alter table public.log_auditoria drop constraint %I', c);
  end loop;
  alter table public.log_auditoria add constraint log_auditoria_ator_tipo_check check (ator_tipo in (
    'motor_regras', 'agente_operacao', 'agente_validacao', 'leitor_mensagens', 'gerador_eventos', 'humano', 'sistema'));
end $$;

create or replace function public.log_preencher_ator()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_papel text := public.jwt_papel();
begin
  new.ator_id := auth.uid();
  new.ator_papel := v_papel;
  new.data_hora_real := now();

  new.ator_tipo := case
    when v_papel = 'agente_operacao' then
      -- o motor de regras roda dentro da conta do agente de operação
      case when new.ator_tipo = 'motor_regras' then 'motor_regras' else 'agente_operacao' end
    when v_papel = 'agente_validacao' then 'agente_validacao'
    when v_papel = 'agente_leitor' then 'leitor_mensagens'
    when v_papel = 'agente_gerador' then 'gerador_eventos'
    when v_papel in ('aprovador', 'consulta', 'admin') then 'humano'
    when auth.role() = 'service_role' then 'sistema'
    else null  -- viola o NOT NULL: sem papel, sem log
  end;
  return new;
end;
$$;

-- 3) Tabela dos eventos gerados -----------------------------------------------------------------
create table if not exists public.eventos_gerados (
  id             bigint generated always as identity primary key,
  simulacao_id   uuid not null references public.simulacoes (id) on delete cascade,
  hora_simulada  timestamp not null,                 -- hora em que o evento chega (o ciclo desta hora é o primeiro a vê-lo)
  evento         text not null,                      -- agrupa as linhas do mesmo acontecimento (EVG...)
  trilha         text not null check (trilha in ('rotina', 'duplicidade', 'golpe', 'ruido')),
  arquivo        text not null check (arquivo in (
                   'contas_a_pagar', 'agenda_remessa', 'notas_fiscais', 'nf_duplicatas', 'pedidos_compra',
                   'dda_boletos', 'recebimentos_mercadoria', 'comunicacoes_fornecedores', 'alteracoes_cadastro')),
  linha          jsonb not null,                     -- uma linha do CSV correspondente
  fornecedor_id  text,
  origem         text not null default 'regra' check (origem in ('regra', 'template', 'ia')),  -- quem escreveu o texto
  modelo_ia      text,
  chave          text not null,                      -- idempotência: hora|evento|arquivo|linha
  criado_em      timestamptz not null default now(),
  constraint eventos_gerados_chave_uk unique (simulacao_id, chave)
);
create index if not exists eventos_gerados_hora_idx on public.eventos_gerados (simulacao_id, hora_simulada);

-- 4) RLS ----------------------------------------------------------------------------------------
--                       aprovador  consulta  admin  ag_operacao  ag_validacao  ag_leitor  ag_gerador
--  eventos_gerados        L          L         L       L            L            —          I
alter table public.eventos_gerados enable row level security;
revoke all on table public.eventos_gerados from anon;
grant select, insert on table public.eventos_gerados to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop policy if exists eventos_le on public.eventos_gerados;
create policy eventos_le on public.eventos_gerados for select to authenticated using (public.le_painel());
drop policy if exists eventos_gerador_ins on public.eventos_gerados;
create policy eventos_gerador_ins on public.eventos_gerados for insert to authenticated
  with check (public.jwt_papel() = 'agente_gerador');
-- Ninguém altera nem apaga um evento já gerado (sem update/delete: o histórico da simulação é imutável).

-- 5) Realtime (opcional): o painel pode assinar a chegada de eventos --------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eventos_gerados') then
    alter publication supabase_realtime add table public.eventos_gerados;
  end if;
end $$;
