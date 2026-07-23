-- =============================================================================
-- Migracja: 20260723120000_profiles_notifications_seen
--
-- Znacznik „przeczytane" feedu powiadomień Panelu — odpowiednik pola
-- `Person.notificationsSeenAt` z src/types.ts. Powiadomienie (pochodne:
-- @-wzmianki + przypisania zadań) z `created_at <= notifications_seen_at` jest
-- przeczytane; nowsze — nieprzeczytane. Pole jest per użytkownik i wyłącznie
-- UX-owe: NIE wpływa na żadną encję planera ani na RLS.
--
-- Synchronizacja między urządzeniami: mirror (cloudMirror) pisze wartość przy
-- edycji profilu, hydracja (referenceData) czyta ją z powrotem, a scalenie
-- osób (applyCloudPeople) bierze PÓŹNIEJSZY z lokalnego/chmurowego znacznika
-- (watermark jest monotoniczny — przeczytane nie cofa się przy wyścigu dwóch
-- urządzeń). NULL/brak => '' po stronie klienta (wszystko nieprzeczytane).
--
-- Uprawnienia: kolumnę edytuje właściciel i administrator (istniejące polityki
-- `profiles_*`); trigger app.protect_profile_privileges celowo jej NIE obejmuje
-- (dane profilowe, nie eskalacja uprawnień — jak phone/avatar/birth_date
-- w 20260717130000_profiles_planner_fields i 20260721030000_profiles_birth_date).
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- idempotentna, nazwa YYYYMMDDHHMMSS_opis.sql. Bez nowych polityk RLS.
-- =============================================================================

alter table public.profiles
  add column if not exists notifications_seen_at timestamptz;
