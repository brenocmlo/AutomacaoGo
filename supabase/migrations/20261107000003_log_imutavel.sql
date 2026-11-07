-- GoAudit · B1 · Log de auditoria só de inclusão
-- Imposto pelo banco: trigger bloqueia UPDATE/DELETE/TRUNCATE para qualquer papel
-- (inclusive service_role) e preenche o ator a partir do JWT. A aplicação não escolhe
-- quem aparece como autor.

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
    when v_papel in ('aprovador', 'consulta', 'admin') then 'humano'
    when auth.role() = 'service_role' then 'sistema'
    else null  -- viola o NOT NULL: sem papel, sem log
  end;
  return new;
end;
$$;

create trigger log_auditoria_ator
  before insert on public.log_auditoria
  for each row execute function public.log_preencher_ator();

create or replace function public.log_bloquear_alteracao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'log_auditoria é só de inclusão: % não é permitido. Registre uma correção como nova linha com log_relacionado.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger log_auditoria_sem_update
  before update or delete on public.log_auditoria
  for each row execute function public.log_bloquear_alteracao();

create trigger log_auditoria_sem_truncate
  before truncate on public.log_auditoria
  for each statement execute function public.log_bloquear_alteracao();
