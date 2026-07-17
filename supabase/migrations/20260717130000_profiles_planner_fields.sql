-- =============================================================================
-- Migracja: 20260717130000_profiles_planner_fields
--
-- Pola planera na profilach — profil chmury staje się źródłem prawdy dla
-- lokalnej listy osób (pełna synchronizacja zespołu między przeglądarkami;
-- hydracja przez MERGE_CLOUD_PEOPLE w reduktorze). Odpowiedniki pól `Person`
-- z src/types.ts: telefon, awatar (emoji), dzienna dostępność (capacity,
-- próg przeciążenia) i informacyjne godziny pracy. Wartości domyślne są równe
-- lokalnym domyślnym, więc istniejące profile pozostają poprawne bez backfillu.
--
-- Uprawnienia: kolumny edytuje właściciel i administrator (istniejące polityki
-- `profiles_*`); trigger app.protect_profile_privileges celowo ich NIE obejmuje
-- (to dane profilowe, nie eskalacja uprawnień).
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql. Bez nowych polityk RLS.
-- =============================================================================

alter table public.profiles
  add column phone text not null default '',
  add column avatar text not null default '',
  add column capacity numeric(5,2) not null default 8
    check (capacity >= 0 and capacity <= 24),
  add column work_days smallint[] not null default array[1,2,3,4,5]::smallint[]
    check (work_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  add column work_start_minutes integer not null default 480
    check (work_start_minutes between 0 and 1440),
  add column work_end_minutes integer not null default 960
    check (work_end_minutes between 0 and 1440),
  add constraint profiles_work_hours_order
    check (work_end_minutes >= work_start_minutes);
