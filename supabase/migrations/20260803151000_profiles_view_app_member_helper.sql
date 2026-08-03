-- Poprawka 20260803150000: widok n2click.profiles jest security_invoker, więc
-- EXISTS na core.app_access wykonywał się jako WYWOŁUJĄCY — a `authenticated`
-- celowo NIE ma grantów do core (tożsamość płynie claimami JWT). Realny
-- użytkownik dostawał "permission denied for table app_access" na każdej
-- hydracji. Członkostwo w appce sprawdza więc SECURITY DEFINER (wzorzec
-- app.* / core.has_app), z przypiętym search_path.
create or replace function core.app_member(p_user uuid, p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from core.app_access a
    where a.user_id = p_user and a.app = p_app
  );
$$;

revoke all on function core.app_member(uuid, text) from public, anon;
grant execute on function core.app_member(uuid, text) to authenticated, service_role;

-- Ten sam widok, ten sam WHERE — tylko członkostwo przez definer.
create or replace view n2click.profiles
with (security_invoker = true) as
select
  id,
  first_name,
  last_name,
  email,
  role_title,
  access_role,
  department_id,
  avatar_path,
  created_at,
  updated_at,
  must_change_password,
  supervisor_id,
  phone,
  avatar,
  capacity,
  work_days,
  work_start_minutes,
  work_end_minutes,
  birth_date,
  company_id,
  email_notifications,
  notifications_seen_at,
  notifications_read_ids
from core.profiles p
where core.app_member(p.id, 'n2click')
  or auth.uid() is null;
