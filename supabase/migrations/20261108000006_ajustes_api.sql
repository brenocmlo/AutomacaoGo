-- GoAudit · ajustes para a Data API e o ciclo idempotente

-- 1) Tabelas criadas por SQL podem não ficar expostas à API automaticamente.
--    Concede o acesso de tabela a authenticated; quem filtra as linhas é a RLS (ligada em todas).
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- O log continua só de inclusão, mesmo com o grant acima.
revoke update, delete, truncate on table public.log_auditoria from authenticated;
revoke delete, truncate on all tables in schema public from authenticated;
-- aprovacoes só pela função do banco
revoke insert, update on table public.aprovacoes from authenticated;

-- 2) UPDATE exige SELECT: a validação consolida/descarta notificações, então precisa enxergá-las.
create policy notificacoes_validacao_le on public.notificacoes for select to authenticated
  using (public.jwt_papel() = 'agente_validacao');

-- 3) Idempotência do log via upsert (ON CONFLICT): índice parcial não serve ao PostgREST.
--    Constraint única comum: chave nula não conflita (NULLs são distintos).
drop index if exists public.log_chave_uk;
alter table public.log_auditoria add constraint log_auditoria_chave_uk unique (simulacao_id, chave);
