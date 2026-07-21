-- =============================================================================
-- Migracja: 20260721030000_profiles_birth_date
--
-- Data urodzenia na profilach — odpowiednik pola `Person.birthDate` z
-- src/types.ts. Pole jest OPCJONALNE i wyłącznie prezentacyjne: kalendarz
-- pokazuje znacznik urodzin (🎂) na dniu zgodnym z miesiącem i dniem tej daty.
-- Domyślnie NULL (brak), więc istniejące profile pozostają poprawne bez
-- backfillu.
--
-- Uprawnienia: kolumnę edytuje właściciel i administrator (istniejące polityki
-- `profiles_*`); trigger app.protect_profile_privileges celowo jej NIE obejmuje
-- (to dane profilowe, nie eskalacja uprawnień — jak phone/avatar w migracji
-- 20260717130000_profiles_planner_fields).
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- idempotentna, nazwa YYYYMMDDHHMMSS_opis.sql. Bez nowych polityk RLS.
-- =============================================================================

alter table public.profiles
  add column if not exists birth_date date;
