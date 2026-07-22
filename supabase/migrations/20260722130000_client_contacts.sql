-- =============================================================================
-- Migracja: 20260722130000_client_contacts
--
-- DODATKOWE osoby kontaktowe klienta jako osadzona lista (jsonb). Główna osoba
-- kontaktowa zostaje w istniejących kolumnach `clients.contact_name` /
-- `contact_email` / `contact_phone` (20260718090000) — ta kolumna trzyma
-- WYŁĄCZNIE dodatkowe osoby, więc żadnej migracji danych.
--
-- Model: osadzona tablica `clients.contacts` (jsonb), dokładnie jak
-- `projects.documents` (20260721010000). Świadomie BEZ osobnej tabeli:
-- widoczność osób kontaktowych ma być IDENTYCZNA z widocznością klienta, więc
-- RLS dziedziczy się z wiersza `public.clients` — ZERO nowych polityk. Tabela
-- `clients` jest już w publikacji `supabase_realtime` (20260718091000), więc bez
-- zmian w realtime.
--
-- Kształt jednego wpisu (walidacja kształtu żyje po stronie klienta,
-- src/store/commandValidation.ts → sanitizeClientContacts):
--   { "id": uuid, "firstName": text, "lastName": text, "phone": text, "email": text }
--
-- Idempotentnie (`add column if not exists` + `drop constraint if exists`):
-- plik bywa aplikowany ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.clients
  add column if not exists contacts jsonb not null default '[]'::jsonb;

-- Twardy kształt kolumny: zawsze tablica JSON (nigdy obiekt, liczba czy null).
alter table public.clients
  drop constraint if exists clients_contacts_is_array;

alter table public.clients
  add constraint clients_contacts_is_array
  check (jsonb_typeof(contacts) = 'array');
