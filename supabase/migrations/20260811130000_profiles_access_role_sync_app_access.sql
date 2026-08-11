-- =============================================================================
-- Migracja: 20260811130000_profiles_access_role_sync_app_access
--
-- AUTH-03 (audyt 2026-08-10): edycja roli w UI zapisuje WYŁĄCZNIE
-- core.profiles.access_role (mirror profilu), a JWT i polityki RLS czytają
-- core.app_access (hook 20260731081748). Bez synchronizacji degradacja
-- administratora w UI zostawia claim `admin` bezterminowo, a awans nie działa
-- do ręcznego wpisu operatora.
--
-- DWA triggery (łańcuch, żeby nowo zakładani administratorzy też byli objęci —
-- provisioning najpierw upsertuje profil, a wiersz n2click app_access powstaje
-- DOPIERO w kroku 9b, więc trigger wyłącznie na profiles by go nie widział):
--   1. core.profiles (AFTER UPDATE OF access_role, tylko realna zmiana):
--      aktualizuje rolę ISTNIEJĄCEGO wiersza n2click w app_access (mapowanie
--      jak seed 20260731082129: administrator→admin, manager→manager,
--      reszta→member). NIE tworzy członkostwa — nadanie dostępu do appki
--      pozostaje świadomą decyzją (provisioning / operator).
--   2. core.app_access (AFTER INSERT OR UPDATE wierszy app='n2click'):
--      utrzymuje decyzję operatora 20260803160300 („moduł Content Plan widzą
--      WYŁĄCZNIE administratorzy”): rola n2click 'admin' nadaje wiersz
--      contentplan role='admin' (spółka z wiersza n2click), każda inna usuwa
--      WYŁĄCZNIE wiersz role='admin' — konta portalowe klientów
--      (role='client', 20260804120000) pozostają nietknięte. Zmiana roli w
--      profilu przechodzi przez trigger 1 → update n2click → trigger 2, a
--      świeży provisioning przez INSERT n2click → trigger 2.
--
-- Backfill na końcu uzgadnia istniejący dryf w obu kierunkach (żywa baza mogła
-- rozjechać się od seedu — profiles jest źródłem prawdy roli).
--
-- ŚWIADOME OGRANICZENIE: claimy JWT odświeżają się przy odnowieniu tokenu /
-- ponownym logowaniu — zmiana roli działa od NASTĘPNEGO tokenu, nie
-- natychmiast. Sesja zdegradowanego admina wygasa najpóźniej z tokenem.
--
-- Definer (wzorzec jak core.handle_new_user): wywołujący (authenticated przez
-- widok-mostek n2click.profiles) nie ma grantów do core.app_access — trigger
-- musi pisać z uprawnieniami właściciela. search_path pusty, odwołania w pełni
-- kwalifikowane.
-- =============================================================================

create or replace function core.sync_app_access_role()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  mapped text := case new.access_role
    when 'administrator' then 'admin'
    when 'manager' then 'manager'
    else 'member'
  end;
begin
  -- Sam update n2click; contentplan domyka trigger na app_access (łańcuch).
  update core.app_access
     set role = mapped
   where user_id = new.id
     and app = 'n2click'
     and role is distinct from mapped;
  return new;
end;
$$;

drop trigger if exists profiles_access_role_sync on core.profiles;
create trigger profiles_access_role_sync
  after update of access_role on core.profiles
  for each row
  when (old.access_role is distinct from new.access_role)
  execute function core.sync_app_access_role();

-- Rekursja jest bezpieczna: INSERT wiersza contentplan odpala ten trigger
-- ponownie, ale klauzula WHEN (app='n2click') go nie przepuszcza.
create or replace function core.sync_contentplan_from_n2click()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.role = 'admin' then
    insert into core.app_access (user_id, app, role, company_id)
    values (new.user_id, 'contentplan', 'admin', new.company_id)
    on conflict (user_id, app) do update set role = 'admin';
  else
    delete from core.app_access
     where user_id = new.user_id
       and app = 'contentplan'
       and role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists app_access_n2click_sync_contentplan on core.app_access;
create trigger app_access_n2click_sync_contentplan
  after insert or update of role on core.app_access
  for each row
  when (new.app = 'n2click')
  execute function core.sync_contentplan_from_n2click();

-- ---- Backfill istniejącego dryfu (idempotentny) -----------------------------

update core.app_access a
   set role = case p.access_role
     when 'administrator' then 'admin'
     when 'manager' then 'manager'
     else 'member'
   end
  from core.profiles p
 where p.id = a.user_id
   and a.app = 'n2click'
   and a.role is distinct from case p.access_role
     when 'administrator' then 'admin'
     when 'manager' then 'manager'
     else 'member'
   end;

insert into core.app_access (user_id, app, role, company_id)
select p.id, 'contentplan', 'admin', a.company_id
  from core.profiles p
  join core.app_access a on a.user_id = p.id and a.app = 'n2click'
 where p.access_role = 'administrator'
on conflict (user_id, app) do update set role = 'admin';

delete from core.app_access a
 using core.profiles p
 where p.id = a.user_id
   and a.app = 'contentplan'
   and a.role = 'admin'
   and p.access_role <> 'administrator';
