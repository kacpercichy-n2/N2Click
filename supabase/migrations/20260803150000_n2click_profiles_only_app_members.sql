-- Placeholderowe profile blogoapp (Ala Adminowa, Olek Logistyk, Jan Kierowca,
-- Karol Szofer) wyciekały do N2Huba: widok-mostek n2click.profiles lustrował
-- CAŁY core.profiles, a MERGE_CLOUD_PEOPLE scala każdy widoczny profil w
-- lokalną listę osób. Decyzja usera (2026-08-03): osoby spoza appki n2click
-- mają nie istnieć w interfejsie N2Huba, a placeholdery blogoapp należą do
-- spółki „Błogość Catering".
--
-- 1) DANE: profile z dostępem wyłącznie do blogoapp dostają spółkę
--    „Błogość Catering" (bez twardych id — dopasowanie po app_access i nazwie).
update core.profiles p
set company_id = (select id from core.companies where name = 'Błogość Catering')
where p.company_id is null
  and exists (
    select 1 from core.app_access a
    where a.user_id = p.id and a.app = 'blogoapp'
  )
  and not exists (
    select 1 from core.app_access a
    where a.user_id = p.id and a.app = 'n2click'
  );

-- 2) WIDOK: n2click.profiles pokazuje zalogowanym WYŁĄCZNIE członków appki
--    n2click (wpis w core.app_access). Gałąź `auth.uid() is null` przepuszcza
--    ścieżki serwisowe: Edge Function provision-account upsertuje profil PRZEZ
--    TEN WIDOK zanim nada app_access (krok 9 przed 9b), a service_role nie ma
--    auth.uid(); anon nie ma grantów na widok, więc nic tędy nie zyskuje.
--    CREATE OR REPLACE zachowuje granty; lista kolumn identyczna jak dotąd,
--    WHERE z podzapytaniem nie odbiera widokowi auto-updatability.
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
where exists (
    select 1 from core.app_access a
    where a.user_id = p.id and a.app = 'n2click'
  )
  or auth.uid() is null;
