-- GoAudit · B3 · Funções de negócio (rpc)
-- Única porta para aprovar, recusar, devolver ao lote, manter retido e retirar por humano.
-- Cada uma valida a regra de negócio e grava o log na MESMA transação.
-- Nenhum valor de alçada está aqui: vem do JWT (claim alcada) e da própria solicitação
-- (aprovadores_exigidos, calculados pelo agente a partir de politicas.csv).

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function public._hora_simulada(p_simulacao uuid)
returns timestamp language sql stable security definer set search_path = ''
as $$ select hora_simulada from public.simulacoes where id = p_simulacao $$;

create or replace function public._esta_retirado(p_simulacao uuid, p_titulo text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select tipo = 'retirada' from public.movimentos_lote
    where simulacao_id = p_simulacao and titulo_id = p_titulo
    order by id desc limit 1
  ), false)
$$;

create or replace function public._exigir_aprovador()
returns void language plpgsql stable set search_path = ''
as $$
begin
  if public.jwt_papel() is distinct from 'aprovador' then
    raise exception 'Só aprovadores podem executar esta ação (papel atual: %).', coalesce(public.jwt_papel(), 'nenhum')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public._ultimo_log(p_simulacao uuid, p_titulo text)
returns bigint language sql stable security definer set search_path = ''
as $$
  select max(log_id) from public.log_auditoria
  where simulacao_id = p_simulacao and entidade = 'titulo' and entidade_id = p_titulo
$$;

-- ---------------------------------------------------------------------------
-- aprovar_solicitacao
-- ---------------------------------------------------------------------------
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
                   where a.solicitacao_id = s.id and a.decisao = 'aprovado' and a.pessoa_id is distinct from v_segunda)
       and v_pessoa is distinct from v_segunda then
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
    select count(distinct aprovador_id), coalesce(bool_or(pessoa_id = v_segunda), v_segunda is null)
      into v_n, v_tem_seg
      from public.aprovacoes where solicitacao_id = s.id and decisao = 'aprovado';
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

-- ---------------------------------------------------------------------------
-- recusar_solicitacao
-- ---------------------------------------------------------------------------
create or replace function public.recusar_solicitacao(p_solicitacao uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.solicitacoes_aprovacao%rowtype;
  d        public.decisoes%rowtype;
  v_login  text;
  v_hora   timestamp;
begin
  perform public._exigir_aprovador();
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Motivo da recusa é obrigatório.'; end if;

  select * into s from public.solicitacoes_aprovacao where id = p_solicitacao for update;
  if not found then raise exception 'Solicitação % não encontrada.', p_solicitacao; end if;
  if s.situacao <> 'pendente' then raise exception 'Solicitação já está %.', s.situacao; end if;
  if s.solicitante_id = auth.uid() then
    raise exception 'Segregação: quem solicitou não pode decidir a própria solicitação.' using errcode = 'insufficient_privilege';
  end if;
  select login_origem into v_login from public.perfis where id = auth.uid();
  if s.lancado_por is not null and v_login = s.lancado_por then
    raise exception 'Segregação: quem lançou o título não pode decidir sobre ele.' using errcode = 'insufficient_privilege';
  end if;

  v_hora := public._hora_simulada(s.simulacao_id);
  insert into public.aprovacoes (solicitacao_id, aprovador_id, pessoa_id, decisao, comentario)
  values (s.id, auth.uid(), public.jwt_pessoa(), 'recusado', p_motivo);
  update public.solicitacoes_aprovacao set situacao = 'recusada', concluida_em = now() where id = s.id;
  update public.decisoes set destino = 'RECUSADO', atualizado_em = now(), hora_simulada = v_hora
   where simulacao_id = s.simulacao_id and titulo_id = s.titulo_id
   returning * into d;

  if found and not public._esta_retirado(s.simulacao_id, s.titulo_id) and d.fechamento > v_hora then
    insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada, ator_id)
    values (s.simulacao_id, s.titulo_id, d.lote, 'retirada', 'recusado: ' || p_motivo, v_hora, auth.uid())
    on conflict do nothing;
  end if;

  insert into public.log_auditoria (simulacao_id, data_hora_simulada, ator_tipo, acao, entidade, entidade_id, motivo, valor_em_jogo, log_relacionado)
  values (s.simulacao_id, v_hora, 'humano', 'recusou', 'titulo', s.titulo_id, p_motivo, s.valor, public._ultimo_log(s.simulacao_id, s.titulo_id));
  return 'recusada';
end;
$$;

-- ---------------------------------------------------------------------------
-- decisao_humana: devolver ao lote, manter retido, retirar do lote
-- ---------------------------------------------------------------------------
create or replace function public.decisao_humana(p_simulacao uuid, p_titulo text, p_acao text, p_justificativa text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d       public.decisoes%rowtype;
  v_hora  timestamp;
  v_acao  text;
begin
  perform public._exigir_aprovador();
  if coalesce(btrim(p_justificativa), '') = '' then raise exception 'Justificativa é obrigatória.'; end if;
  if p_acao not in ('devolver_ao_lote', 'manter_retido', 'retirar_do_lote') then
    raise exception 'Ação inválida: %.', p_acao;
  end if;

  select * into d from public.decisoes where simulacao_id = p_simulacao and titulo_id = p_titulo for update;
  if not found then raise exception 'Título % sem decisão nesta simulação.', p_titulo; end if;
  v_hora := public._hora_simulada(p_simulacao);

  if p_acao in ('devolver_ao_lote', 'retirar_do_lote') and d.fechamento <= v_hora then
    raise exception 'O lote % já fechou.', d.lote;
  end if;

  if p_acao = 'devolver_ao_lote' then
    if not public._esta_retirado(p_simulacao, p_titulo) then raise exception 'O título não está retirado.'; end if;
    -- Devolver = autorizar o pagamento: precisa de alçada.
    if d.valor > public.jwt_alcada() then
      raise exception 'Valor de % acima da sua alçada.', d.valor using errcode = 'insufficient_privilege';
    end if;
    insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada, ator_id)
    values (p_simulacao, p_titulo, d.lote, 'devolucao', p_justificativa, v_hora, auth.uid());
    update public.decisoes set destino = 'DEVOLVIDO', atualizado_em = now(), hora_simulada = v_hora
     where simulacao_id = p_simulacao and titulo_id = p_titulo;
    v_acao := 'devolveu ao lote';
  elsif p_acao = 'retirar_do_lote' then
    if public._esta_retirado(p_simulacao, p_titulo) then raise exception 'O título já está retirado.'; end if;
    insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada, ator_id)
    values (p_simulacao, p_titulo, d.lote, 'retirada', p_justificativa, v_hora, auth.uid());
    update public.decisoes set destino = 'RETIRADO', atualizado_em = now(), hora_simulada = v_hora
     where simulacao_id = p_simulacao and titulo_id = p_titulo;
    v_acao := 'retirou do lote';
  else
    v_acao := 'manteve retido';
  end if;

  insert into public.log_auditoria (simulacao_id, data_hora_simulada, ator_tipo, acao, entidade, entidade_id, motivo, valor_em_jogo, log_relacionado)
  values (p_simulacao, v_hora, 'humano', v_acao, 'titulo', p_titulo, p_justificativa, d.valor, public._ultimo_log(p_simulacao, p_titulo));
  return v_acao;
end;
$$;

-- Permissões de execução: só usuários autenticados (o papel é checado dentro).
do $$
declare f text;
begin
  foreach f in array array[
    'public.aprovar_solicitacao(uuid, text)',
    'public.recusar_solicitacao(uuid, text)',
    'public.decisao_humana(uuid, text, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public._hora_simulada(uuid)', 'public._esta_retirado(uuid, text)', 'public._ultimo_log(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
