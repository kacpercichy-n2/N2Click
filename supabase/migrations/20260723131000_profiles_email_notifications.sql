-- =============================================================================
-- Migracja: 20260723131000_profiles_email_notifications
--
-- Preferencja użytkownika „Powiadomienia mailowe" (opt-in) — odpowiednik pola
-- `Person.emailNotifications` z src/types.ts. Edge Function
-- `send-notification-emails` czyta tę kolumnę i POMIJA odbiorców, którzy jej nie
-- włączyli. Domyślnie FALSE — nie wysyłamy maili od pierwszego deployu, dopóki
-- użytkownik świadomie nie włączy powiadomień w profilu.
--
-- Uprawnienia: kolumnę edytuje właściciel i administrator (istniejące polityki
-- `profiles_*`); trigger app.protect_profile_privileges celowo jej NIE obejmuje
-- (to preferencja profilu, nie eskalacja uprawnień — jak phone/avatar/birth_date).
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- idempotentna, nazwa YYYYMMDDHHMMSS_opis.sql. Bez nowych polityk RLS.
-- =============================================================================

alter table public.profiles
  add column if not exists email_notifications boolean not null default false;
