-- =============================================================================
-- Migracja: 20260803160200_contentplan_my_access_view
--
-- Widok-mostek `contentplan.my_access(user_id, role)` — jedyne źródło, z którego
-- frontend czyta SWÓJ grant do modułu (`canViewContentPlan` w fazie R3).
-- PostgREST nie wystawia `core`, a frontend nie parsuje JWT (patrz plan §1.2),
-- więc grant musi być widoczny jako zwykły wiersz w schemacie appki.
--
-- RÓŻNICA WOBEC `n2click.app_access` (20260731082805): tamten widok jest
-- `security_invoker = on` i służy WYŁĄCZNIE roli `service_role` (Edge Function
-- provisioningu). Tutaj czytelnikiem jest zalogowany użytkownik, a
-- `core.app_access` ma RLS bez ani jednej polityki i zero grantów dla
-- `authenticated` — widok invokera zwracałby błąd uprawnień. Dlatego widok jest
-- ŚWIADOMIE `security_invoker = off` (prawa właściciela), a ograniczenie
-- widoczności siedzi W SAMEJ DEFINICJI: `user_id = auth.uid()` i
-- `app = 'contentplan'`. Użytkownik nie może zobaczyć cudzego wiersza ani
-- grantu do innej aplikacji, bo predykat jest wpisany w widok, nie w zapytanie.
-- Widok jest tylko-do-odczytu (grant wyłącznie SELECT) — grantów NIE nadaje
-- się przez niego, robi to service_role na tabeli bazowej.
-- =============================================================================

create or replace view contentplan.my_access with (security_invoker = off) as
  select a.user_id,
         a.role
  from core.app_access a
  where a.app = 'contentplan'
    and a.user_id = (select auth.uid());

revoke all on contentplan.my_access from anon, authenticated, service_role;
grant select on contentplan.my_access to authenticated, service_role;
