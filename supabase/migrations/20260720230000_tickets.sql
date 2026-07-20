-- =============================================================================
-- Migracja: 20260720230000_tickets
--
-- Zgłoszenia zespołu („Zgłoszenia”): błędy, usprawnienia i prośby o nowe
-- funkcje w jednym, ustrukturyzowanym miejscu. Tabela jest SAMODZIELNA —
-- nie wiąże się z projektami/zadaniami i nie zmienia żadnej istniejącej encji.
--
-- Model dostępu:
--   * KAŻDY zalogowany może złożyć zgłoszenie, ale wyłącznie „na siebie”
--     (`reporter_id` = własny profil) — polityka insert to wymusza w with check.
--   * Zgłaszający widzi WYŁĄCZNIE własne wiersze i może je poprawiać, dopóki
--     zgłoszenie ma status 'nowe' (po podjęciu triage'u edycja należy do
--     administratora).
--   * Administrator widzi wszystko, zmienia status i usuwa.
--
-- Konwencja domu (patrz supabase/README.md): `enable row level security`,
-- `revoke all ... from anon`, brak `force row level security`, polityki
-- wyłącznie `to authenticated`, insert/update z `with check`. Reużywamy
-- istniejących funkcji `app.is_administrator()` i triggera `app.set_updated_at()`
-- — BEZ nowych funkcji.
--
-- Idempotentnie (`if not exists` / `drop policy if exists`): plik bywa aplikowany
-- ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  area text not null default '' check (char_length(area) <= 300),
  description text not null default '',
  kind text not null default 'inne'
    check (kind in ('blad', 'usprawnienie', 'nowa-funkcja', 'inne')),
  priority text not null default 'sredni'
    check (priority in ('niski', 'sredni', 'wysoki')),
  status text not null default 'nowe'
    check (status in ('nowe', 'w-trakcie', 'zrobione', 'odrzucone')),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function app.set_updated_at();

create index if not exists tickets_reporter_id_idx on public.tickets (reporter_id);
create index if not exists tickets_status_idx on public.tickets (status);

-- -----------------------------------------------------------------------------
-- RLS: deny-by-default + odebranie dostępu roli anon.
-- -----------------------------------------------------------------------------

alter table public.tickets enable row level security;

revoke all on public.tickets from anon;

drop policy if exists "tickets_select" on public.tickets;
create policy "tickets_select" on public.tickets
  for select to authenticated
  using (
    app.is_administrator()
    or reporter_id = (select auth.uid())
  );

-- Wstawienie WYŁĄCZNIE na własny profil — także administrator zgłasza „na siebie”.
drop policy if exists "tickets_insert" on public.tickets;
create policy "tickets_insert" on public.tickets
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));

-- Administrator edytuje zawsze; zgłaszający — własne zgłoszenie, dopóki jest
-- 'nowe', i bez podmiany zgłaszającego (with check pilnuje stanu PO zmianie).
drop policy if exists "tickets_update" on public.tickets;
create policy "tickets_update" on public.tickets
  for update to authenticated
  using (
    app.is_administrator()
    or (reporter_id = (select auth.uid()) and status = 'nowe')
  )
  with check (
    app.is_administrator()
    or (reporter_id = (select auth.uid()) and status = 'nowe')
  );

drop policy if exists "tickets_delete" on public.tickets;
create policy "tickets_delete" on public.tickets
  for delete to authenticated
  using (app.is_administrator());
