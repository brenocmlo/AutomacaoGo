-- GoAudit · B1 · Schema de saída
-- Todo o estado produzido pelo sistema. A entrada continua em CSV.

-- ---------------------------------------------------------------------------
-- Papéis (mínimo para o MVP)
--   aprovador        humanos que aprovam (alçada vem do JWT; PS01 e PS03 são aprovadores
--                    com pessoa_id, o que basta para a aprovação dupla)
--   consulta         demais humanos (tesouraria, controladoria, gestores, jurídico)
--   admin            conduz a simulação
--   agente_*         contas dos agentes, sujeitas à RLS como qualquer usuário
-- ---------------------------------------------------------------------------
create type public.papel as enum (
  'aprovador', 'consulta', 'admin', 'agente_operacao', 'agente_validacao', 'agente_leitor'
);

create table public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text not null,
  email         text not null,
  papel         public.papel not null,
  alcada        numeric(14, 2),            -- null = sem limite
  pessoa_id     text,                      -- PSxx de politicas.csv
  login_origem  text,                      -- login em usuarios_sistema.csv
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);
create unique index perfis_pessoa_id_uk on public.perfis (pessoa_id) where pessoa_id is not null;

create table public.simulacoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  cenario        text not null,             -- pasta da base usada (ex.: data/demo)
  inicio         timestamp not null,        -- hora simulada inicial
  fim            timestamp not null,
  hora_simulada  timestamp not null,
  situacao       text not null default 'ativa' check (situacao in ('ativa', 'pausada', 'encerrada')),
  criado_por     uuid default auth.uid() references auth.users (id),
  criado_em      timestamptz not null default now()
);

create table public.ciclos (
  id                 bigint generated always as identity primary key,
  simulacao_id       uuid not null references public.simulacoes (id) on delete cascade,
  hora_simulada      timestamp not null,
  iniciado_em        timestamptz not null default now(),
  duracao_ms         integer,
  titulos_avaliados  integer not null default 0,
  chamadas_ia        integer not null default 0,
  tokens_entrada     integer not null default 0,
  tokens_saida       integer not null default 0,
  custo_usd          numeric(12, 6) not null default 0,
  situacao           text not null default 'em_andamento' check (situacao in ('em_andamento', 'concluido', 'falhou')),
  unique (simulacao_id, hora_simulada)
);

create table public.decisoes (
  simulacao_id      uuid not null references public.simulacoes (id) on delete cascade,
  titulo_id         text not null,
  fornecedor_id     text not null,
  categoria         text,
  valor             numeric(14, 2) not null,
  lote              text not null,
  banco             text not null,
  fechamento        timestamp not null,
  destino           text not null check (destino in (
                      'LIBERADO_AUTOMATICO', 'CONFERIDO_AGUARDANDO_APROVADOR', 'AGUARDANDO_APROVACAO',
                      'RETIRADO', 'APROVADO', 'RECUSADO', 'DEVOLVIDO', 'ENVIADO')),
  regras            text[] not null default '{}',
  risco             integer not null default 0,
  urgencia          text,
  motivo            text,
  resumo_ia         text,
  agente            text,
  donos_pessoa_ids  text[] not null default '{}',
  hora_simulada     timestamp not null,
  atualizado_em     timestamptz not null default now(),
  primary key (simulacao_id, titulo_id)
);
create index decisoes_destino_idx on public.decisoes (simulacao_id, destino);

create table public.avaliacoes_regras (
  id             bigint generated always as identity primary key,
  simulacao_id   uuid not null references public.simulacoes (id) on delete cascade,
  hora_simulada  timestamp not null,
  titulo_id      text not null,
  regra          text not null,
  passou         boolean not null,
  severidade     text,
  evidencias     text[] not null default '{}',
  motivo         text,
  unique (simulacao_id, hora_simulada, titulo_id, regra)
);

create table public.movimentos_lote (
  id             bigint generated always as identity primary key,
  simulacao_id   uuid not null references public.simulacoes (id) on delete cascade,
  titulo_id      text not null,
  lote           text not null,
  tipo           text not null check (tipo in ('retirada', 'devolucao')),
  motivo         text not null,
  hora_simulada  timestamp not null,
  ator_id        uuid not null default auth.uid() references auth.users (id),
  criado_em      timestamptz not null default now(),
  unique (simulacao_id, titulo_id, hora_simulada, tipo)
);

create table public.solicitacoes_aprovacao (
  id                    uuid primary key default gen_random_uuid(),
  simulacao_id          uuid not null references public.simulacoes (id) on delete cascade,
  titulo_id             text not null,
  valor                 numeric(14, 2) not null,
  tipo                  text not null check (tipo in ('simples', 'dupla', 'alcada_superior')),
  nivel                 text not null,
  -- 'aprovador' (qualquer aprovador com alçada) e/ou pessoa_id exigido (PS01, PS03)
  aprovadores_exigidos  text[] not null,
  lancado_por           text,                       -- login ERP de quem lançou (segregação)
  motivo                text not null,
  solicitante_id        uuid not null default auth.uid() references auth.users (id),
  situacao              text not null default 'pendente' check (situacao in ('pendente', 'aprovada', 'recusada', 'expirada')),
  hora_simulada         timestamp not null,
  criada_em             timestamptz not null default now(),
  concluida_em          timestamptz
);
create unique index solicitacoes_pendente_uk on public.solicitacoes_aprovacao (simulacao_id, titulo_id) where situacao = 'pendente';

create table public.aprovacoes (
  id              bigint generated always as identity primary key,
  solicitacao_id  uuid not null references public.solicitacoes_aprovacao (id) on delete cascade,
  aprovador_id    uuid not null references auth.users (id),
  pessoa_id       text,
  decisao         text not null check (decisao in ('aprovado', 'recusado')),
  comentario      text,
  criado_em       timestamptz not null default now(),
  unique (solicitacao_id, aprovador_id)
);

create table public.alertas (
  id              bigint generated always as identity primary key,
  simulacao_id    uuid not null references public.simulacoes (id) on delete cascade,
  tipo            text not null,                    -- variacao_mensal, golpe, divergencia
  titulo_id       text,
  fornecedor_id   text,
  dono_pessoa_id  text,
  regras          text[] not null default '{}',
  mensagem        text not null,
  valor           numeric(14, 2),
  situacao        text not null default 'aberto' check (situacao in ('aberto', 'encerrado', 'descartado')),
  chave           text not null,                    -- idempotência
  hora_simulada   timestamp not null,
  criado_em       timestamptz not null default now(),
  encerrado_em    timestamptz,
  unique (simulacao_id, chave)
);

create table public.notificacoes (
  id             bigint generated always as identity primary key,
  simulacao_id   uuid not null references public.simulacoes (id) on delete cascade,
  pessoa_id      text not null,
  assunto        text not null,
  mensagem       text not null,
  titulos        text[] not null default '{}',
  urgencia       text,
  situacao       text not null default 'ativa' check (situacao in ('ativa', 'descartada', 'consolidada')),
  lida           boolean not null default false,
  chave          text not null,                     -- idempotência
  hora_simulada  timestamp not null,
  criado_em      timestamptz not null default now(),
  unique (simulacao_id, pessoa_id, chave)
);

create table public.mensagens_processadas (
  id                 bigint generated always as identity primary key,
  simulacao_id       uuid not null references public.simulacoes (id) on delete cascade,
  comunicacao_id     text not null,
  canal              text,
  tipo               text not null,
  dados              jsonb not null default '{}',
  remetente_confere  boolean,
  sinais             text[] not null default '{}',
  confianca          numeric(4, 3),
  revisao_humana     boolean not null default false,
  modelo_ia          text,
  hora_simulada      timestamp not null,
  criado_em          timestamptz not null default now(),
  unique (simulacao_id, comunicacao_id)
);

create table public.log_auditoria (
  log_id              bigint generated always as identity primary key,
  simulacao_id        uuid references public.simulacoes (id) on delete restrict,
  data_hora_real      timestamptz not null default now(),
  data_hora_simulada  timestamp,
  ator_tipo           text not null check (ator_tipo in (
                        'motor_regras', 'agente_operacao', 'agente_validacao', 'leitor_mensagens', 'humano', 'sistema')),
  ator_id             uuid,
  ator_papel          text,
  acao                text not null,
  entidade            text not null,
  entidade_id         text,
  regras              text[] not null default '{}',
  evidencias          text[] not null default '{}',
  motivo              text,
  valor_em_jogo       numeric(14, 2),
  modelo_ia           text,
  tokens_entrada      integer,
  tokens_saida        integer,
  custo_usd           numeric(12, 6),
  confianca           numeric(4, 3),
  log_relacionado     bigint references public.log_auditoria (log_id),
  situacao            text not null default 'concluida' check (situacao in ('pendente', 'concluida', 'revertida')),
  chave               text                           -- idempotência (simulação, título, hora, ação)
);
create unique index log_chave_uk on public.log_auditoria (simulacao_id, chave) where chave is not null;
create index log_entidade_idx on public.log_auditoria (simulacao_id, entidade, entidade_id);
