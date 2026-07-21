-- =============================================================================
-- Migracja: 20260721210000_events
--
-- Wydarzenia / spotkania kalendarza („Wydarzenia”): jedna SAMODZIELNA encja
-- renderowana w kalendarzu innym kolorem niż zadania i zarządzana w panelu
-- „Wydarzenia”. Tabela nie wiąże się z projektami/zadaniami i nie zmienia żadnej
-- istniejącej encji planera. Wystąpienia są CZYSTO PREZENTACYJNE — nie tworzą
-- zaplanowanych godzin (odpowiednik inwariantu 1 po stronie klienta).
--
-- Model dostępu (UZASADNIENIE ZAMKNIĘTE): kalendarz spotkań jest OGÓLNOFIRMOWY,
-- a lokalna rola `handlowiec` mapuje się w chmurze na `worker` (patrz
-- referenceData.ts), więc bramka po `app.is_manager()` odcięłaby handlowca,
-- który umawia spotkania z klientami. Dlatego wszystkie polityki są
-- `to authenticated` z `using (true)` / `with check (true)` — bramka
-- `events.manage` pozostaje UX-em po stronie klienta (jak cały system uprawnień).
-- ŚWIADOMIE bez tabeli `event_attendees`: `attendee_ids uuid[]` NIE steruje RLS-em
-- i nie ma FK (czyszczenie danglingów po stronie klienta przy hydracji).
--
-- Konwencja domu (patrz supabase/README.md): `enable row level security`,
-- `revoke all ... from anon`, brak `force row level security`, polityki wyłącznie
-- `to authenticated`, insert/update z `with check`. Reużywamy triggera
-- `app.set_updated_at()` — BEZ nowych funkcji.
--
-- Idempotentnie (`if not exists` / `drop policy if exists`): plik bywa aplikowany
-- ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  location text not null default '' check (char_length(location) <= 300),
  meeting_url text not null default '' check (char_length(meeting_url) <= 2048),
  event_date date not null,
  start_minutes integer not null
    check (start_minutes between 0 and 1425 and start_minutes % 15 = 0),
  duration_minutes integer not null
    check (duration_minutes between 15 and 1440 and duration_minutes % 15 = 0),
  attendee_ids uuid[] not null default '{}',
  recurrence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_minutes + duration_minutes <= 1440)
);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function app.set_updated_at();

create index if not exists events_event_date_idx on public.events (event_date);

-- -----------------------------------------------------------------------------
-- RLS: deny-by-default + odebranie dostępu roli anon. Kalendarz ogólnofirmowy —
-- pełne CRUD dla każdego zalogowanego (patrz uzasadnienie w nagłówku).
-- -----------------------------------------------------------------------------

alter table public.events enable row level security;

revoke all on public.events from anon;

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select to authenticated
  using (true);

drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events
  for insert to authenticated
  with check (true);

drop policy if exists "events_update" on public.events;
create policy "events_update" on public.events
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists "events_delete" on public.events;
create policy "events_delete" on public.events
  for delete to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Żywa synchronizacja: dodaj tabelę do publikacji realtime (idempotentnie).
-- -----------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.events;
exception
  when duplicate_object then
    null; -- tabela już w publikacji — idempotentnie pomiń
end $$;
