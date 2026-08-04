-- =============================================================================
-- Migracja: 20260804090000_restore_n2click_profiles_app_member_filter
--
-- Przywrócenie filtra członkostwa na widoku n2click.profiles. Tło: migracja
-- 20260803100000_profiles_notifications_read_ids (starszy timestamp) odtwarza
-- widok jako gołe `select *`, ale do żywej bazy trafiła PÓŹNIEJ niż
-- 20260803150000_n2click_profiles_only_app_members (w żywym rejestrze pod
-- wersją 20260803133730 — MCP stempluje własne wersje), która zawęziła widok
-- do członków appki przez core.app_member(id, 'n2click'). Aplikacja
-- 20260803100000 zdjęła więc filtr z żywego widoku — ten plik przywraca go,
-- zachowując nową kolumnę notifications_read_ids (select * obejmuje ją
-- automatycznie).
--
-- Przy replay z repo plik jest nieszkodliwie redundantny wobec 150000
-- (ta sama definicja, idempotentne create or replace); dokumentuje kolejność
-- aplikacji do żywej bazy. Zaaplikowany do żywej bazy 2026-08-04 przez MCP
-- jako restore_n2click_profiles_app_member_filter.
-- =============================================================================

create or replace view n2click.profiles with (security_invoker = on) as
  select * from core.profiles p
  where core.app_member(p.id, 'n2click');
