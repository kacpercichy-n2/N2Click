-- =============================================================================
-- Migracja: 20260804090000_restore_n2click_profiles_app_member_filter
--
-- Przywrócenie filtra członkostwa na widoku n2click.profiles. Tło: migracja
-- 20260803100000_profiles_notifications_read_ids (starszy timestamp) odtwarza
-- widok jako gołe `select *`, ale do żywej bazy trafiła PÓŹNIEJ niż
-- 20260803133730_n2click_profiles_only_app_members (aplikowana przez MCP,
-- bez pliku w repo), która zawęziła widok do członków appki przez
-- core.app_member(id, 'n2click'). Aplikacja 20260803100000 zdjęła więc filtr
-- z żywego widoku — ten plik przywraca go, zachowując nową kolumnę
-- notifications_read_ids (select * obejmuje ją automatycznie).
--
-- Plik istnieje też po to, żeby replay migracji z repo kończył się widokiem
-- FILTROWANYM: bez niego repo odtwarza stan sprzed
-- n2click_profiles_only_app_members. Konwencja: tylko-do-przodu, idempotentna
-- (create or replace). Zaaplikowana do żywej bazy 2026-08-04 przez MCP jako
-- restore_n2click_profiles_app_member_filter.
-- =============================================================================

create or replace view n2click.profiles with (security_invoker = on) as
  select * from core.profiles p
  where core.app_member(p.id, 'n2click');
