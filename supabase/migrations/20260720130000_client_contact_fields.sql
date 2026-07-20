-- Kartoteka klientów: opcjonalne dane kontaktowe (Client z src/types.ts).
-- Kolumny tylko-dodawane; istniejące polityki row-level `clients_*` obejmują
-- nowe kolumny, publikacja `supabase_realtime` już zawiera `clients` — brak
-- zmian polityk i publikacji.
alter table public.clients
  add column contact_person text
    check (contact_person is null or char_length(contact_person) between 1 and 200),
  add column email text
    check (email is null or char_length(email) between 1 and 200),
  add column phone text
    check (phone is null or char_length(phone) between 1 and 50);
