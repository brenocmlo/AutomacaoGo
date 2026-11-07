-- GoAudit · migração 8 · a administração pode fazer tudo no painel (aprovar, recusar, devolver, tratar alertas).
-- Os agentes continuam com as próprias contas e permissões: a administração não se passa por eles.
-- Segregação mantida: quem solicitou ou lançou o título não aprova, e a aprovação dupla exige duas pessoas diferentes.
-- A administração pode ser a "segunda pessoa" (coordenação/diretoria) exigida na aprovação dupla.

-- 1) Aprovar, recusar, devolver ao lote etc.: aprovador OU administração
create or replace function public._exigir_aprovador()
returns void language plpgsql stable set search_path = ''
as $$
begin
  if public.jwt_papel() not in ('aprovador', 'admin') then
    raise exception 'Só aprovadores ou a administração podem executar esta ação (papel atual: %).', coalesce(public.jwt_papel(), 'nenhum')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- 2) Administração sem limite de alçada (null = sem limite)
update public.perfis set alcada = null where papel = 'admin';

-- 3) Aprovação dupla: a administração vale como a segunda pessoa exigida
create or replace function public.aprovar_solicitacao(p_solicitacao uuid, p_comentario text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s           public.solicitacoes_aprovacao%rowtype;
  d           public.decisoes%rowtype;
  v_pessoa    text := public.jwt_pessoa();
  v_alcada    numeric := public.jwt_alcada();
  v_login     text;
  v_segunda   text;
  v_hora      timestamp;
  v_n         integer;
  v_tem_seg   boolean;
  v_concluiu  boolean;
  v_log       bigint;
begin
  perform public._exigir_aprovador();

  select * into s from public.solicitacoes_aprovacao where id = p_solicitacao for update;
  if not found then raise exception 'Solicitação % não encontrada.', p_solicitacao; end if;
  if s.situacao <> 'pendente' then raise exception 'Solicitação já está %.', s.situacao; end if;

  -- Segregação: quem solicitou ou lançou não aprova.
  if s.solicitante_id = auth.uid() then
    raise exception 'Segregação: quem solicitou não pode aprovar a própria solicitação.' using errcode = 'insufficient_privilege';
  end if;
  select login_origem into v_login from public.perfis where id = auth.uid();
  if s.lancado_por is not null and v_login = s.lancado_por then
    raise exception 'Segregação: quem lançou o título não pode aprová-lo.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.aprovacoes where solicitacao_id = s.id and aprovador_id = auth.uid()) then
    raise exception 'Esta pessoa já se manifestou nesta solicitação; a aprovação dupla exige duas pessoas diferentes.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Segunda pessoa exigida (coordenação ou diretoria), quando houver.
  select x into v_segunda from unnest(s.aprovadores_exigidos) as x where x <> 'aprovador' limit 1;

  if s.tipo = 'dupla' then
    -- Se já há uma aprovação que não é da segunda pessoa, esta tem de ser dela.
    if v_segunda is not null
       and exists (select 1 from public.aprovacoes a
                   where a.solicitacao_id = s.id and a.decisao = 'aprovado' and a.pessoa_id is distinct from v_segunda and not exists (select 1 from public.perfis pf where pf.id = a.aprovador_id and pf.papel = 'admin'))
       and v_pessoa is distinct from v_segunda and public.jwt_papel() <> 'admin' then
      raise exception 'Aprovação dupla: falta a aprovação de %.', v_segunda using errcode = 'insufficient_privilege';
    end if;
  else
    -- Alçada: a soma (fracionamento) já vem em s.valor.
    if s.valor > v_alcada then
      raise exception 'Valor de % acima da sua alçada (%).', s.valor, v_alcada using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.aprovacoes (solicitacao_id, aprovador_id, pessoa_id, decisao, comentario)
  values (s.id, auth.uid(), v_pessoa, 'aprovado', p_comentario);

  v_hora := public._hora_simulada(s.simulacao_id);
  insert into public.log_auditoria (simulacao_id, data_hora_simulada, ator_tipo, acao, entidade, entidade_id, motivo, valor_em_jogo, log_relacionado)
  values (s.simulacao_id, v_hora, 'humano', 'aprovou', 'titulo', s.titulo_id,
          coalesce(p_comentario, 'Aprovado (' || s.tipo || ')'), s.valor, public._ultimo_log(s.simulacao_id, s.titulo_id))
  returning log_id into v_log;

  if s.tipo = 'dupla' then
    select count(distinct a.aprovador_id),
           coalesce(bool_or(a.pessoa_id = v_segunda or exists (select 1 from public.perfis pf where pf.id = a.aprovador_id and pf.papel = 'admin')), v_segunda is null)
      into v_n, v_tem_seg
      from public.aprovacoes a where a.solicitacao_id = s.id and a.decisao = 'aprovado';
    v_concluiu := v_n >= 2 and v_tem_seg;
  else
    v_concluiu := true;
  end if;

  if not v_concluiu then
    return 'pendente';
  end if;

  update public.solicitacoes_aprovacao set situacao = 'aprovada', concluida_em = now() where id = s.id;
  update public.decisoes set destino = 'APROVADO', atualizado_em = now(), hora_simulada = v_hora
   where simulacao_id = s.simulacao_id and titulo_id = s.titulo_id
   returning * into d;

  -- Se o título tinha sido retirado (margem vencida), volta ao lote enquanto ele estiver aberto.
  if found and public._esta_retirado(s.simulacao_id, s.titulo_id) and d.fechamento > v_hora then
    insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada, ator_id)
    values (s.simulacao_id, s.titulo_id, d.lote, 'devolucao', 'aprovado por humano', v_hora, auth.uid())
    on conflict do nothing;
    insert into public.log_auditoria (simulacao_id, data_hora_simulada, ator_tipo, acao, entidade, entidade_id, motivo, valor_em_jogo, log_relacionado)
    values (s.simulacao_id, v_hora, 'humano', 'devolveu ao lote', 'titulo', s.titulo_id, 'Devolvido após aprovação', s.valor, v_log);
  end if;

  return 'aprovada';
end;
$$;

-- 4) Alertas: a administração trata qualquer alerta
drop policy if exists alertas_admin_upd on public.alertas;
create policy alertas_admin_upd on public.alertas for update to authenticated
  using (public.jwt_papel() = 'admin') with check (public.jwt_papel() = 'admin');
