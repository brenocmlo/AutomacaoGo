-- GoAudit · vínculo com contratos e alerta de desvio
-- Cada título recorrente é ligado ao contrato que o autoriza; cada competência (mês) do contrato
-- guarda o valor esperado, a faixa e o cobrado. Os desvios D01–D10 viram alertas (tipo 'contrato').
--
-- Quem vê o quê (RLS):
--   aprovador (financeiro/diretoria), admin, agentes de operação e validação → todos os contratos
--   consulta (gestor de área)                                                 → só os contratos em que é gestor_pessoa_id
--   agente_leitor                                                             → nada
--   gravam: agente_operacao e agente_validacao. Ninguém apaga.

-- 1) Vínculo título × contrato --------------------------------------------------------------
create table public.vinculos_contrato (
  simulacao_id      uuid not null references public.simulacoes (id) on delete cascade,
  titulo_id         text not null,
  contrato_id       text not null,
  competencia       text check (competencia ~ '^\d{4}-\d{2}$'),      -- mês de referência; nulo quando não há vínculo
  metodo            text not null check (metodo in ('oc_contrato', 'fornecedor_sem_oc', 'frete_integracao', 'sem_vinculo')),
  confianca         text not null check (confianca in ('alta', 'media', 'nenhuma')),
  fornecedor_id     text,
  gestor_pessoa_id  text not null default '',                         -- quem enxerga (RLS)
  motivo            text,
  hora_simulada     timestamp not null,
  atualizado_em     timestamptz not null default now(),
  primary key (simulacao_id, titulo_id)
);
create index vinculos_contrato_idx on public.vinculos_contrato (simulacao_id, contrato_id, competencia);

-- 2) Competências do contrato (esperado × cobrado) ------------------------------------------
create table public.competencias_contrato (
  simulacao_id         uuid not null references public.simulacoes (id) on delete cascade,
  contrato_id          text not null,
  competencia          text not null check (competencia ~ '^\d{4}-\d{2}$'),
  classe               text not null check (classe in ('fixo', 'utilidade', 'frete')),
  fornecedor_id        text,
  gestor_pessoa_id     text not null default '',
  valor_esperado       numeric(14, 2),
  faixa_min            numeric(14, 2),
  faixa_max            numeric(14, 2),
  valor_cobrado        numeric(14, 2) not null default 0,
  qtd_titulos          integer not null default 0,
  titulos              text[] not null default '{}',
  situacao             text not null check (situacao in ('conforme', 'desvio', 'aguardando', 'sem_titulo', 'sem_referencia')),
  desvios              text[] not null default '{}',                  -- códigos D01..D10 desta competência
  vencimento_previsto  date,
  hora_simulada        timestamp not null,
  atualizado_em        timestamptz not null default now(),
  primary key (simulacao_id, contrato_id, competencia)
);

-- 3) Alertas de contrato usam a tabela existente (tipo = 'contrato', código em `regras`) -----
alter table public.alertas
  add column contrato_id       text,
  add column competencia       text,
  add column gestor_pessoa_id  text;
comment on column public.alertas.tipo is 'divergencia, golpe ou contrato (desvio contratual D01–D10, código em regras)';
create index alertas_contrato_idx on public.alertas (simulacao_id, contrato_id) where contrato_id is not null;

-- 4) RLS ----------------------------------------------------------------------------------
alter table public.vinculos_contrato enable row level security;
alter table public.competencias_contrato enable row level security;
revoke all on table public.vinculos_contrato, public.competencias_contrato from anon;
grant select, insert, update on table public.vinculos_contrato, public.competencias_contrato to authenticated;
revoke delete, truncate on table public.vinculos_contrato, public.competencias_contrato from authenticated;

-- Quem enxerga um contrato: financeiro/auditoria/diretoria e agentes veem todos; gestor de área, só o seu.
create or replace function public.ve_contrato(gestor text)
returns boolean language sql stable set search_path = ''
as $$
  select public.jwt_papel() in ('aprovador', 'admin', 'agente_operacao', 'agente_validacao')
      or (public.jwt_papel() = 'consulta' and coalesce(gestor, '') <> '' and gestor = public.jwt_pessoa())
$$;

create policy vinculos_le on public.vinculos_contrato for select to authenticated
  using (public.ve_contrato(gestor_pessoa_id));
create policy vinculos_agentes_ins on public.vinculos_contrato for insert to authenticated
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));
create policy vinculos_agentes_upd on public.vinculos_contrato for update to authenticated
  using (public.jwt_papel() in ('agente_operacao', 'agente_validacao'))
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));

create policy competencias_le on public.competencias_contrato for select to authenticated
  using (public.ve_contrato(gestor_pessoa_id));
create policy competencias_agentes_ins on public.competencias_contrato for insert to authenticated
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));
create policy competencias_agentes_upd on public.competencias_contrato for update to authenticated
  using (public.jwt_papel() in ('agente_operacao', 'agente_validacao'))
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));

-- Alertas: os de contrato só aparecem para o gestor do contrato, para quem foi avisado e para quem vê tudo.
drop policy alertas_le on public.alertas;
create policy alertas_le on public.alertas for select to authenticated
  using (
    public.le_painel()
    and (tipo <> 'contrato' or public.ve_contrato(gestor_pessoa_id) or dono_pessoa_id = public.jwt_pessoa())
  );
