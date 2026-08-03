-- =============================================================================
-- Migracja: 20260803100000_profiles_notifications_read_ids
--
-- Przeczytane per wpis dla pochodnego feedu powiadomien Panelu — odpowiednik
-- pola Person.notificationsReadIds z src/types.ts. Wpis feedu (id postaci
-- 'mention:<commentId>' / 'assignment:<assignmentId>') jest przeczytany, gdy
-- created_at <= notifications_seen_at (watermark, zostaje) LUB jego id jest w
-- tej tablicy. Scalenie klienta robi UNIE lokalnego i chmurowego zbioru
-- (monotonicznie, parytet z max-merge watermarka); "Oznacz jako przeczytane"
-- (zbiorcze) bije watermark i czysci tablice (pruning).
--
-- Kolumna siedzi na core.profiles (jak notifications_seen_at po przepieciu
-- schema-per-app); n2click.profiles to widok "select *" zamrozony w chwili
-- utworzenia, wiec trzeba go odtworzyc, by wystawil nowa kolumne (CREATE OR
-- REPLACE VIEW zachowuje granty; nowa kolumna doklada sie na koncu).
-- Trigger app.protect_profile_privileges celowo jej NIE obejmuje (dane
-- profilowe, nie eskalacja — jak notifications_seen_at). Bez zmian RLS.
-- Konwencja: tylko-do-przodu, idempotentna. TYLKO plik — aplikacja to krok
-- operatora PRZED wdrozeniem klienta (select nazywa kolumne wprost).
-- =============================================================================

alter table core.profiles
  add column if not exists notifications_read_ids text[] not null default '{}';

create or replace view n2click.profiles with (security_invoker = on) as
  select * from core.profiles;
