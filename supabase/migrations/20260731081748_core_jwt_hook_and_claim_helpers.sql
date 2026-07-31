-- Custom Access Token Hook — claimy app_roles + app_company w JWT (handoff 4.3).
-- Hook trzeba włączyć w Dashboardzie: Authentication -> Hooks -> Custom Access
-- Token -> core.custom_access_token. Istniejące sesje dostają claimy dopiero po
-- odświeżeniu tokenu (re-login zespołu).
create or replace function core.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
declare
  claims jsonb;
  roles  jsonb;
  comp   jsonb;
begin
  select coalesce(jsonb_object_agg(app, role), '{}'::jsonb),
         coalesce(jsonb_object_agg(app, company_id), '{}'::jsonb)
    into roles, comp
    from core.app_access
   where user_id = (event->>'user_id')::uuid;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{app_roles}', roles);
  claims := jsonb_set(claims, '{app_company}', comp);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function core.custom_access_token to supabase_auth_admin;
revoke execute on function core.custom_access_token from anon, authenticated, public;
grant usage on schema core to supabase_auth_admin;
grant select on core.app_access to supabase_auth_admin;

-- Pomocnicze funkcje do polityk — czytają wyłącznie JWT, zero dostępu do tabel.
create or replace function core.has_app(p_app text)
returns boolean language sql stable
as $$ select (auth.jwt() -> 'app_roles' ->> p_app) is not null $$;

create or replace function core.company_for(p_app text)
returns uuid language sql stable
as $$ select nullif(auth.jwt() -> 'app_company' ->> p_app, '')::uuid $$;

create or replace function core.app_role(p_app text)
returns text language sql stable
as $$ select auth.jwt() -> 'app_roles' ->> p_app $$;

grant execute on function core.has_app(text), core.company_for(text), core.app_role(text)
  to authenticated, anon, service_role;
