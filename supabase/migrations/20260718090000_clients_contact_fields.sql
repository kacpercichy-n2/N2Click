-- =============================================================================
-- Migracja: 20260718090000_clients_contact_fields
--
-- Dane kontaktowe klienta — zakładka „Klienci” edytuje osobę kontaktową,
-- e-mail, telefon i notatki. Odpowiedniki pól `Client` z src/types.ts.
-- Wartości domyślne '' odpowiadają lokalnym domyślnym, więc istniejące wiersze
-- pozostają poprawne bez backfillu. Uprawnienia: istniejące polityki
-- `clients_*` (RLS) obejmują nowe kolumny automatycznie.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- idempotentna dzięki IF NOT EXISTS.
-- =============================================================================

alter table public.clients
  add column if not exists contact_name text not null default ''
    check (char_length(contact_name) <= 200),
  add column if not exists contact_email text not null default ''
    check (char_length(contact_email) <= 320),
  add column if not exists contact_phone text not null default ''
    check (char_length(contact_phone) <= 40),
  add column if not exists notes text not null default ''
    check (char_length(notes) <= 4000);
