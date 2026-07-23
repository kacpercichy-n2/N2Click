-- =============================================================================
-- Migracja: 20260723120000_notifications
--
-- Powiadomienia in-app: każdy użytkownik dostaje własny strumień powiadomień o
-- rzeczach, które go dotyczą (przypisanie zadania, komentarz w projekcie, w
-- którym uczestniczy, nowa praca w jego zasobniku). Tabela jest SAMODZIELNA —
-- nie zmienia żadnej istniejącej encji planera i jest rozszerzeniem WYŁĄCZNIE
-- addytywnym.
--
-- Model dostępu (per-użytkownik, wzorzec z tickets):
--   * SELECT wyłącznie własnych wierszy (`recipient_id` = własny profil).
--   * UPDATE wyłącznie własnych wierszy — służy TYLKO oznaczeniu jako
--     przeczytane (`read_at`); `with check` pilnuje, że odbiorca się nie zmienia.
--   * INSERT dla KAŻDEGO zalogowanego: zdarzenia generuje klient w imieniu
--     działającego użytkownika, więc wstawia wiersze DLA INNYCH osób (odbiorców).
--     Dlatego — inaczej niż w tickets — insert nie może być zawężony do
--     `recipient_id = auth.uid()`. Widoczność i tak chroni SELECT (własne wiersze).
--   * Brak polityki DELETE: powiadomień nie kasujemy z klienta (RLS deny-by-default
--     odrzuca DELETE bez polityki).
--
-- `recipient_id` → `public.profiles (id)` z `on delete cascade`: profil jest 1:1
-- z `auth.users` (to samo id), więc `recipient_id` = id konta odbiorcy.
--
-- Konwencja domu (patrz supabase/README.md): `enable row level security`,
-- `revoke all ... from anon`, brak `force row level security`, polityki wyłącznie
-- `to authenticated`, insert/update z `with check`. Reużywamy istniejącej funkcji
-- pomocniczej — BEZ nowych funkcji.
--
-- Idempotentnie (`if not exists` / `drop policy if exists`): plik bywa aplikowany
-- ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (char_length(type) between 1 and 100),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_id_idx
  on public.notifications (recipient_id);
-- Nieprzeczytane per odbiorca (Panel czyta max 3 nieprzeczytane).
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, read_at);

-- -----------------------------------------------------------------------------
-- RLS: deny-by-default + odebranie dostępu roli anon.
-- -----------------------------------------------------------------------------

alter table public.notifications enable row level security;

revoke all on public.notifications from anon;

-- Odbiorca widzi WYŁĄCZNIE własne powiadomienia.
drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

-- Wstawia dowolny zalogowany (zdarzenie generuje klient działającego użytkownika
-- W IMIENIU odbiorcy, więc wiersz zwykle dotyczy INNEJ osoby). Widoczność chroni
-- polityka SELECT — insert nie może być zawężony do własnego profilu.
drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert to authenticated
  with check (true);

-- Oznaczenie jako przeczytane: własne wiersze; odbiorca się nie zmienia.
drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Żywa synchronizacja: dodaj tabelę do publikacji realtime (idempotentnie), żeby
-- świeże powiadomienie odbiorcy pojawiało się bez ręcznego odświeżenia. RLS
-- (WALRUS) obowiązuje — odbiorca dostaje zdarzenia tylko dla własnych wierszy.
-- -----------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then
    null; -- tabela już w publikacji — idempotentnie pomiń
end $$;
