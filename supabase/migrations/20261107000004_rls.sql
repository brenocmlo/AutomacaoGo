-- GoAudit · B3 · Row Level Security
-- Negação por padrão: RLS ligada em todas as tabelas; só passa o que
-- tem política explícita. anon não acessa nada. Mudanças sensíveis (aprovar, recusar,
-- devolver ao lote) só por função do banco (migração 0005).
--
-- Matriz resumida (L lê, I insere, A atualiza, F só por função):
--                         aprovador  consulta  admin  ag_operacao  ag_validacao  ag_leitor
--  perfis                   L(todos)  L(todos)  L      L(próprio)   L(próprio)    L(próprio)
--  simulacoes               L         L         L I A  L            L             L
--  ciclos                   L         L         L I A  L I A        L             —
--  decisoes                 L F       L         L      L I A*       L A           —
--  avaliacoes_regras        L         L         L      L I          L             —
--  movimentos_lote          L F       L         L      L I          L I           —
--  solicitacoes_aprovacao   L F       L         L      L I A        L             —
--  aprovacoes               L F       L         L      —            —             —
--  alertas                  L A       L A(seus) L      L I A        L A           —
--  notificacoes             L A(suas) L A(suas) L A(s) I            I A           —
--  mensagens_processadas    L         L         L      L            L             I
--  log_auditoria            L I       L I       L I    L I          L I           I
--  * agente_operacao não grava LIBERADO_AUTOMATICO acima da alçada do próprio JWT.
--  Ninguém atualiza ou apaga log_auditoria.

do $$
declare t text;
begin
  foreach t in array array[
    'perfis', 'simulacoes', 'ciclos', 'decisoes', 'avaliacoes_regras', 'movimentos_lote',
    'solicitacoes_aprovacao', 'aprovacoes', 'alertas', 'notificacoes', 'mensagens_processadas', 'log_auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- Ninguém (fora do dono da tabela) atualiza ou apaga o log, nem com política errada.
revoke update, delete, truncate on table public.log_auditoria from authenticated, anon;

-- Leitura geral para humanos e agentes de operação/validação
create or replace function public.le_painel()
returns boolean language sql stable set search_path = ''
as $$ select public.jwt_papel() in ('aprovador', 'consulta', 'admin', 'agente_operacao', 'agente_validacao') $$;

-- perfis --------------------------------------------------------------------
create policy perfis_humanos_leem on public.perfis for select to authenticated
  using (public.eh_humano() or id = auth.uid());
-- o hook de claims (roda como supabase_auth_admin) precisa ler o perfil
create policy perfis_auth_hook on public.perfis for select to supabase_auth_admin using (true);

-- simulacoes / ciclos -------------------------------------------------------
create policy simulacoes_le on public.simulacoes for select to authenticated
  using (public.jwt_papel() is not null);
create policy simulacoes_admin_ins on public.simulacoes for insert to authenticated
  with check (public.jwt_papel() = 'admin');
create policy simulacoes_admin_upd on public.simulacoes for update to authenticated
  using (public.jwt_papel() = 'admin') with check (public.jwt_papel() = 'admin');

create policy ciclos_le on public.ciclos for select to authenticated using (public.le_painel());
create policy ciclos_ins on public.ciclos for insert to authenticated
  with check (public.jwt_papel() in ('admin', 'agente_operacao'));
create policy ciclos_upd on public.ciclos for update to authenticated
  using (public.jwt_papel() in ('admin', 'agente_operacao'))
  with check (public.jwt_papel() in ('admin', 'agente_operacao'));

-- decisoes ------------------------------------------------------------------
create policy decisoes_le on public.decisoes for select to authenticated using (public.le_painel());
create policy decisoes_operacao_ins on public.decisoes for insert to authenticated
  with check (
    public.jwt_papel() = 'agente_operacao'
    and destino in ('LIBERADO_AUTOMATICO', 'CONFERIDO_AGUARDANDO_APROVADOR', 'AGUARDANDO_APROVACAO', 'RETIRADO', 'ENVIADO')
    and (destino <> 'LIBERADO_AUTOMATICO' or valor <= public.jwt_alcada())
  );
create policy decisoes_operacao_upd on public.decisoes for update to authenticated
  using (public.jwt_papel() = 'agente_operacao')
  with check (
    public.jwt_papel() = 'agente_operacao'
    and destino in ('LIBERADO_AUTOMATICO', 'CONFERIDO_AGUARDANDO_APROVADOR', 'AGUARDANDO_APROVACAO', 'RETIRADO', 'ENVIADO')
    and (destino <> 'LIBERADO_AUTOMATICO' or valor <= public.jwt_alcada())
  );
-- validação só desfaz exageros: devolve ao lote ou retira. Nunca libera nem aprova.
create policy decisoes_validacao_upd on public.decisoes for update to authenticated
  using (public.jwt_papel() = 'agente_validacao')
  with check (public.jwt_papel() = 'agente_validacao' and destino in ('DEVOLVIDO', 'RETIRADO'));

-- avaliacoes_regras ---------------------------------------------------------
create policy avaliacoes_le on public.avaliacoes_regras for select to authenticated using (public.le_painel());
create policy avaliacoes_ins on public.avaliacoes_regras for insert to authenticated
  with check (public.jwt_papel() = 'agente_operacao');

-- movimentos_lote -----------------------------------------------------------
create policy movimentos_le on public.movimentos_lote for select to authenticated using (public.le_painel());
create policy movimentos_agentes_ins on public.movimentos_lote for insert to authenticated
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao') and ator_id = auth.uid());

-- solicitacoes_aprovacao ----------------------------------------------------
create policy solicitacoes_le on public.solicitacoes_aprovacao for select to authenticated using (public.le_painel());
create policy solicitacoes_operacao_ins on public.solicitacoes_aprovacao for insert to authenticated
  with check (public.jwt_papel() = 'agente_operacao' and solicitante_id = auth.uid() and situacao = 'pendente');
-- o agente só pode expirar (margem antes do fechamento); aprovar/recusar é função.
create policy solicitacoes_operacao_expira on public.solicitacoes_aprovacao for update to authenticated
  using (public.jwt_papel() = 'agente_operacao' and situacao = 'pendente')
  with check (public.jwt_papel() = 'agente_operacao' and situacao = 'expirada');

-- aprovacoes (só leitura; gravação só pela função aprovar/recusar) -----------
create policy aprovacoes_humanos_leem on public.aprovacoes for select to authenticated using (public.eh_humano());

-- alertas -------------------------------------------------------------------
create policy alertas_le on public.alertas for select to authenticated using (public.le_painel());
create policy alertas_operacao_ins on public.alertas for insert to authenticated
  with check (public.jwt_papel() = 'agente_operacao');
create policy alertas_agentes_upd on public.alertas for update to authenticated
  using (public.jwt_papel() in ('agente_operacao', 'agente_validacao'))
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));
create policy alertas_aprovador_upd on public.alertas for update to authenticated
  using (public.jwt_papel() = 'aprovador') with check (public.jwt_papel() = 'aprovador');
create policy alertas_dono_upd on public.alertas for update to authenticated
  using (public.jwt_papel() = 'consulta' and dono_pessoa_id = public.jwt_pessoa())
  with check (public.jwt_papel() = 'consulta' and dono_pessoa_id = public.jwt_pessoa());

-- notificacoes --------------------------------------------------------------
create policy notificacoes_proprias_le on public.notificacoes for select to authenticated
  using (public.eh_humano() and pessoa_id = public.jwt_pessoa());
create policy notificacoes_proprias_upd on public.notificacoes for update to authenticated
  using (public.eh_humano() and pessoa_id = public.jwt_pessoa())
  with check (public.eh_humano() and pessoa_id = public.jwt_pessoa());
create policy notificacoes_agentes_ins on public.notificacoes for insert to authenticated
  with check (public.jwt_papel() in ('agente_operacao', 'agente_validacao'));
-- validação consolida/descarta acionamentos fracos (cada um custa R$ 60)
create policy notificacoes_validacao_upd on public.notificacoes for update to authenticated
  using (public.jwt_papel() = 'agente_validacao')
  with check (public.jwt_papel() = 'agente_validacao' and situacao in ('descartada', 'consolidada'));

-- mensagens_processadas -----------------------------------------------------
create policy mensagens_le on public.mensagens_processadas for select to authenticated using (public.le_painel());
create policy mensagens_leitor_ins on public.mensagens_processadas for insert to authenticated
  with check (public.jwt_papel() = 'agente_leitor');

-- log_auditoria -------------------------------------------------------------
create policy log_le on public.log_auditoria for select to authenticated using (public.le_painel());
create policy log_ins on public.log_auditoria for insert to authenticated
  with check (public.jwt_papel() is not null);

-- Realtime: o painel assina estas tabelas (respeitando a RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.decisoes, public.alertas, public.notificacoes, public.ciclos;
  end if;
end $$;
