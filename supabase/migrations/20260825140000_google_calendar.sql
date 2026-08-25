-- =============================================================================
-- Migracja: 20260825140000_google_calendar
--
-- IMPORT KALENDARZA GOOGLE (tylko odczyt): każdy pracownik podpina WŁASNE konto
-- Google w ustawieniach konta, a jego spotkania trafiają do N2Hub jako osobna,
-- CIENIOWA warstwa wydarzeń (nigdy do `n2click.events`, które ludzie edytują
-- ręcznie). Trzy tabele w `n2click`, widok maskujący i dwie funkcje Vault:
--
--   * `google_accounts` — jedno konto Google na profil. Refresh token NIE leży
--     w tabeli: jest sekretem Vault (`vault_secret_id`), zapisywanym i czytanym
--     WYŁĄCZNIE przez funkcje definer poniżej, wykonywalne tylko dla
--     `service_role` (Edge Functions). `share_level` = co widzi RESZTA zespołu:
--     `details` (pełne szczegóły), `busy` (domyślnie: tylko „Zajęty"),
--     `hidden` (nic).
--   * `google_calendars` — subskrybowane kalendarze konta; `selected` włącza
--     import, `sync_token` niesie stan przyrostowy (`events.list`).
--   * `google_calendar_events` — instancje wydarzeń (`singleEvents=true`,
--     okno −30/+90 dni, przesuwane przy pełnym syncu). Klucz deduplikacji
--     `(calendar_id, google_event_id)`. Czasy surowe w `start_at`/`end_at`
--     (timestamptz) i już ZAOKRĄGLONE do siatki 15 min N2Hub (`start_minutes`,
--     `duration_minutes`, `event_date`) — start w dół, koniec w górę.
--
-- KTO CO WIDZI (decyzja z researchu 2026-08-25): RLS tabeli bazowej = tylko
-- właściciel. Reszta zespołu czyta WIDOK `google_calendar_events_visible`
-- (właściciela widoku, czyli bez RLS bazy), który maskuje kolumny w trzech
-- progach: właściciel — wszystko; uczestnik dopasowany po e-mailu — wszystko,
-- chyba że poufne; pozostali — „Zajęty" bez tytułu/opisu/linku, a przy
-- `share_level = 'hidden'`, `is_confidential` albo widoczności prywatnej —
-- nic. Wiersze `is_busy = false` (Google „Wolny") są tylko dla właściciela.
--
-- ZAPIS: wyłącznie Edge Functions z kluczem service_role (`google-calendar-
-- connect`, `google-calendar-sync`). Klient (authenticated) może: czytać swoje
-- konto i kalendarze, przełączać `selected` i `share_level`, ROZŁĄCZYĆ konto
-- (DELETE własnego wiersza — kaskada sprząta kalendarze i wydarzenia; sekret
-- Vault sprząta trigger).
--
-- SYNC W TLE: `pg_cron` co 5 minut woła przez `pg_net` Edge Function
-- `google-calendar-sync` z nagłówkiem `x-n2-cron-secret`. Adres i sekret leżą
-- w Vault (`n2click_google_sync_url`, `n2click_google_sync_secret`) — bez nich
-- zadanie kończy się cicho (nic nie woła). Krok operatora: patrz
-- supabase/functions/README.md.
--
-- Konwencja domu jak w 20260813180000_chat: pełna kwalifikacja nazw,
-- `enable row level security` przy tabeli, `revoke all … from anon,
-- authenticated` przed grantami, polityki wyłącznie `to authenticated` z
-- `with check`, funkcje z `set search_path = ''`, idempotentnie.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Tabele
-- -----------------------------------------------------------------------------

create table if not exists n2click.google_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references core.profiles(id) on delete cascade,
  google_email text not null check (char_length(google_email) between 3 and 320),
  vault_secret_id uuid,
  scopes text not null default '',
  share_level text not null default 'busy'
    check (share_level in ('details', 'busy', 'hidden')),
  status text not null default 'active'
    check (status in ('active', 'revoked', 'error')),
  last_error text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table n2click.google_accounts is
  'Podpięte konto Google profilu (jedno na osobę). Refresh token w Vault (vault_secret_id), nigdy w tabeli.';

create table if not exists n2click.google_calendars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references n2click.google_accounts(id) on delete cascade,
  google_calendar_id text not null,
  summary text not null default '',
  is_primary boolean not null default false,
  selected boolean not null default false,
  color text,
  sync_token text,
  last_full_sync_at timestamptz,
  last_sync_at timestamptz,
  unique (account_id, google_calendar_id)
);

comment on table n2click.google_calendars is
  'Kalendarze konta Google; selected = importowany; sync_token = stan przyrostowy events.list.';

create table if not exists n2click.google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references n2click.google_calendars(id) on delete cascade,
  account_id uuid not null references n2click.google_accounts(id) on delete cascade,
  google_event_id text not null,
  ical_uid text,
  recurring_event_id text,
  etag text,
  status text not null default 'confirmed',
  title text not null default '',
  description text not null default '',
  location text not null default '',
  meeting_url text not null default '',
  html_link text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_all_day boolean not null default false,
  event_date date not null,
  start_minutes integer not null check (start_minutes between 0 and 1425 and start_minutes % 15 = 0),
  duration_minutes integer not null check (duration_minutes between 15 and 1440 and duration_minutes % 15 = 0),
  end_date date,
  event_type text not null default 'default',
  visibility text not null default 'default',
  is_busy boolean not null default true,
  is_confidential boolean not null default false,
  attendees jsonb not null default '[]'::jsonb,
  attendee_profile_ids uuid[] not null default '{}',
  self_response text,
  google_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (calendar_id, google_event_id)
);

create index if not exists google_calendar_events_date
  on n2click.google_calendar_events (event_date, account_id);

comment on table n2click.google_calendar_events is
  'Instancje wydarzeń z Google (singleEvents), okno -30/+90 dni, siatka 15 min N2Hub. Zapis tylko przez Edge Function google-calendar-sync.';

-- -----------------------------------------------------------------------------
-- 2. Granty i RLS
-- -----------------------------------------------------------------------------

alter table n2click.google_accounts enable row level security;
alter table n2click.google_calendars enable row level security;
alter table n2click.google_calendar_events enable row level security;

revoke all on n2click.google_accounts from anon, authenticated, service_role;
revoke all on n2click.google_calendars from anon, authenticated, service_role;
revoke all on n2click.google_calendar_events from anon, authenticated, service_role;

-- Klient: własne konto (odczyt, poziom udostępniania, rozłączenie) i własne
-- kalendarze (odczyt, przełącznik importu). Wydarzenia bazowe czyta tylko
-- właściciel; reszta zespołu idzie przez widok maskujący (sekcja 4).
grant select, delete on n2click.google_accounts to authenticated;
grant update (share_level) on n2click.google_accounts to authenticated;
grant select on n2click.google_calendars to authenticated;
grant update (selected) on n2click.google_calendars to authenticated;
grant select on n2click.google_calendar_events to authenticated;

-- Edge Functions (service_role) piszą wszystko; TRUNCATE nigdy.
grant select, insert, update, delete on n2click.google_accounts to service_role;
grant select, insert, update, delete on n2click.google_calendars to service_role;
grant select, insert, update, delete on n2click.google_calendar_events to service_role;

drop policy if exists "google_accounts_select" on n2click.google_accounts;
create policy "google_accounts_select" on n2click.google_accounts
  for select to authenticated
  using ((select core.has_app('n2click')) and profile_id = (select auth.uid()));

drop policy if exists "google_accounts_update" on n2click.google_accounts;
create policy "google_accounts_update" on n2click.google_accounts
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "google_accounts_delete" on n2click.google_accounts;
create policy "google_accounts_delete" on n2click.google_accounts
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Właściciel konta = właściciel kalendarza (definer omija RLS `google_accounts`,
-- ale predykat i tak zawęża do `auth.uid()`).
create or replace function app.google_account_owner(acc uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id from n2click.google_accounts a where a.id = acc;
$$;

revoke all on function app.google_account_owner(uuid) from public;
grant execute on function app.google_account_owner(uuid) to authenticated;

drop policy if exists "google_calendars_select" on n2click.google_calendars;
create policy "google_calendars_select" on n2click.google_calendars
  for select to authenticated
  using (app.google_account_owner(account_id) = (select auth.uid()));

drop policy if exists "google_calendars_update" on n2click.google_calendars;
create policy "google_calendars_update" on n2click.google_calendars
  for update to authenticated
  using (app.google_account_owner(account_id) = (select auth.uid()))
  with check (app.google_account_owner(account_id) = (select auth.uid()));

drop policy if exists "google_calendar_events_select" on n2click.google_calendar_events;
create policy "google_calendar_events_select" on n2click.google_calendar_events
  for select to authenticated
  using (app.google_account_owner(account_id) = (select auth.uid()));

-- `updated_at` konta z zegara serwera przy każdej zmianie.
create or replace function n2click.google_accounts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists google_accounts_touch on n2click.google_accounts;
create trigger google_accounts_touch
  before update on n2click.google_accounts
  for each row execute function n2click.google_accounts_touch();

-- -----------------------------------------------------------------------------
-- 3. Vault: refresh token zapisuje i czyta WYŁĄCZNIE service_role
--
-- `vault.create_secret` / `vault.decrypted_secrets` są poza grantami appki;
-- opakowujemy je w definerów z jawnym `revoke … from public, anon,
-- authenticated`. Nazwa sekretu = `google-refresh:<profile uuid>`, więc ponowne
-- podpięcie NADPISUJE stary sekret (limit 100 refresh tokenów na klienta
-- Google — stary token i tak traci ważność).
-- -----------------------------------------------------------------------------

create or replace function n2click.google_store_refresh_token(p_profile_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'google-refresh:' || p_profile_id::text;
  v_id uuid;
begin
  if p_profile_id is null or p_token is null or p_token = '' then
    raise exception 'bad input' using errcode = '22023';
  end if;
  select s.id into v_id from vault.secrets s where s.name = v_name;
  if v_id is null then
    v_id := vault.create_secret(p_token, v_name, 'Refresh token Google Calendar (N2Hub)');
  else
    perform vault.update_secret(v_id, p_token, v_name, 'Refresh token Google Calendar (N2Hub)');
  end if;
  return v_id;
end;
$$;

create or replace function n2click.google_read_refresh_token(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from n2click.google_accounts a
  join vault.decrypted_secrets s on s.id = a.vault_secret_id
  where a.id = p_account_id;
$$;

-- Rozłączenie (DELETE konta) sprząta sekret Vault, żeby po tabeli nie został
-- osierocony refresh token.
create or replace function n2click.google_accounts_cleanup_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets s where s.id = old.vault_secret_id;
  end if;
  return old;
end;
$$;

drop trigger if exists google_accounts_cleanup_secret on n2click.google_accounts;
create trigger google_accounts_cleanup_secret
  after delete on n2click.google_accounts
  for each row execute function n2click.google_accounts_cleanup_secret();

revoke all on function n2click.google_store_refresh_token(uuid, text) from public, anon, authenticated;
revoke all on function n2click.google_read_refresh_token(uuid) from public, anon, authenticated;
grant execute on function n2click.google_store_refresh_token(uuid, text) to service_role;
grant execute on function n2click.google_read_refresh_token(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Widok maskujący dla zespołu
--
-- Widok działa z uprawnieniami WŁAŚCICIELA (domyślne `security_invoker = false`),
-- więc omija RLS tabeli bazowej i sam decyduje, co komu pokazać. Kolumna
-- `access` mówi UI, w którym progu jest wiersz (`owner` | `attendee` | `busy`).
-- -----------------------------------------------------------------------------

create or replace view n2click.google_calendar_events_visible
with (security_barrier = true)
as
  select
    e.id,
    e.account_id,
    a.profile_id as owner_profile_id,
    e.event_date,
    e.end_date,
    e.start_minutes,
    e.duration_minutes,
    e.is_all_day,
    e.is_busy,
    e.attendee_profile_ids,
    e.self_response,
    case
      when a.profile_id = (select auth.uid()) then 'owner'
      when (select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential then 'attendee'
      else 'busy'
    end as access,
    case
      when a.profile_id = (select auth.uid())
        or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
        or (a.share_level = 'details' and not e.is_confidential)
      then e.title else 'Zajęty'
    end as title,
    case
      when a.profile_id = (select auth.uid())
        or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
        or (a.share_level = 'details' and not e.is_confidential)
      then e.description else ''
    end as description,
    case
      when a.profile_id = (select auth.uid())
        or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
        or (a.share_level = 'details' and not e.is_confidential)
      then e.location else ''
    end as location,
    case
      when a.profile_id = (select auth.uid())
        or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
        or (a.share_level = 'details' and not e.is_confidential)
      then e.meeting_url else ''
    end as meeting_url,
    case when a.profile_id = (select auth.uid()) then e.html_link else '' end as html_link,
    e.is_confidential
  from n2click.google_calendar_events e
  join n2click.google_accounts a on a.id = e.account_id
  where coalesce((select core.has_app('n2click')), false)
    and a.status <> 'revoked'
    and e.status <> 'cancelled'
    and (
      a.profile_id = (select auth.uid())
      or (
        e.is_busy
        and a.share_level <> 'hidden'
        and not e.is_confidential
        and e.visibility not in ('private', 'confidential')
      )
      or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
    );

comment on view n2click.google_calendar_events_visible is
  'Wydarzenia Google dla zespołu z maską: właściciel/uczestnik widzą szczegóły, reszta „Zajęty" (wg share_level konta); prywatne/poufne tylko właściciel.';

revoke all on n2click.google_calendar_events_visible from anon;
grant select on n2click.google_calendar_events_visible to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Harmonogram: pg_cron co 5 minut -> Edge Function google-calendar-sync
--
-- Adres funkcji i sekret nagłówka leżą w Vault. Bez nich (świeży projekt) job
-- jest cichym no-opem. `net.http_post` jest asynchroniczne — job nie czeka na
-- odpowiedź. Funkcja sama dba o backoff i status kont.
-- -----------------------------------------------------------------------------

create or replace function n2click.google_calendar_sync_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s where s.name = 'n2click_google_sync_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s where s.name = 'n2click_google_sync_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from n2click.google_accounts a where a.status = 'active') then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-n2-cron-secret', v_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function n2click.google_calendar_sync_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'n2click-google-calendar-sync') then
    perform cron.unschedule('n2click-google-calendar-sync');
  end if;
  perform cron.schedule(
    'n2click-google-calendar-sync',
    '*/5 * * * *',
    'select n2click.google_calendar_sync_tick()'
  );
end;
$$;
