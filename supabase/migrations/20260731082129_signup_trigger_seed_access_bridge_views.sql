-- Globalne konto (handoff 5.3 pkt 2): każdy nowy user auth dostaje profil w
-- core, ale ZERO wpisów w app_access — dostęp do appek nadaje admin lub flow
-- provisioningu. Plus seed app_access i widoki-mostki dla PostgREST.
create or replace function core.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into core.profiles (id, first_name, last_name, email)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Użytkownik'
    ),
    coalesce(trim(new.raw_user_meta_data->>'last_name'), ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_user();

-- Seed z obecnego modelu spółek (audyt Fazy 0 pkt 5: company_id zawsze wypełnione).
insert into core.app_access (user_id, app, role, company_id)
select p.id,
       'n2click',
       case p.access_role
         when 'administrator' then 'admin'
         when 'manager' then 'manager'
         else 'member'
       end,
       p.company_id
from core.profiles p
where p.company_id is not null
on conflict do nothing;

-- Widoki-mostki: PostgREST nie robi embeddingu między schematami, a core nie
-- jest wystawiony; security_invoker => RLS tabel bazowych obowiązuje.
create view n2click.profiles with (security_invoker = on) as
  select * from core.profiles;
create view n2click.companies with (security_invoker = on) as
  select * from core.companies;
