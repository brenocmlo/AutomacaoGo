-- GoAudit · B2 · Claims do JWT
-- Permissão nasce no servidor: papel, alçada e pessoa_id vêm da tabela perfis e são
-- gravados no token pelo Custom Access Token Hook do Supabase Auth.
-- Ativar em: Dashboard → Authentication → Hooks → Customize Access Token →
--            Postgres function → public.custom_access_token_hook

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  p       public.perfis%rowtype;
begin
  select * into p from public.perfis where id = (event ->> 'user_id')::uuid;

  if not found or not p.ativo then
    -- Sem perfil ativo: token sem papel. A RLS nega tudo.
    claims := claims - 'papel' - 'alcada' - 'pessoa_id';
  else
    claims := claims
      || jsonb_build_object('papel', p.papel::text)
      || jsonb_build_object('alcada', p.alcada)          -- null = sem limite
      || jsonb_build_object('pessoa_id', p.pessoa_id);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.perfis to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Leitura das claims (usadas pelas políticas e funções)
-- ---------------------------------------------------------------------------
create or replace function public.jwt_papel()
returns text language sql stable set search_path = ''
as $$ select nullif(auth.jwt() ->> 'papel', '') $$;

create or replace function public.jwt_pessoa()
returns text language sql stable set search_path = ''
as $$ select nullif(auth.jwt() ->> 'pessoa_id', '') $$;

-- Alçada do token; null no token = sem limite → devolve infinito.
create or replace function public.jwt_alcada()
returns numeric language sql stable set search_path = ''
as $$
  select case
    when auth.jwt() ->> 'papel' is null then 0
    when jsonb_typeof(auth.jwt() -> 'alcada') = 'number' then (auth.jwt() ->> 'alcada')::numeric
    else 'Infinity'::numeric
  end
$$;

create or replace function public.eh_humano()
returns boolean language sql stable set search_path = ''
as $$ select public.jwt_papel() in ('aprovador', 'consulta', 'admin') $$;
