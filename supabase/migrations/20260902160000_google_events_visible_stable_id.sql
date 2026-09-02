-- =============================================================================
-- Migracja: 20260902160000_google_events_visible_stable_id
--
-- Widok `google_calendar_events_visible` dostaje dwie kolumny NA KOŃCU:
-- `calendar_id` i `google_event_id`. Powód: tracker w widoku „Dzień" pozwala
-- odhaczyć spotkanie z Google (wpis czasu z `eventId`), a `id` wiersza zmienia
-- się przy pełnym syncu (funkcja syncu kasuje wiersze kalendarza i wstawia od
-- nowa), więc zaliczone spotkanie „odznaczało się" samo po syncu (przegląd
-- Codex 2026-09-02). Para `(calendar_id, google_event_id)` jest kluczem
-- unikalnym tabeli i przeżywa sync.
--
-- `create or replace view` dopisuje kolumny na końcu bez zmiany istniejących;
-- treść widoku poza tym identyczna z 20260825140000 (maski, progi `access`,
-- `security_barrier`). Grants i komentarz widoku zostają.
-- =============================================================================

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
    e.last_day_end_minutes,
    e.is_all_day,
    e.is_busy,
    -- Uczestnicy i własna odpowiedź TYLKO przy pełnych szczegółach: wiersz
    -- „Zajęty" nie może zdradzać, kto siedzi na spotkaniu (przegląd Codex).
    case
      when a.profile_id = (select auth.uid())
        or ((select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential)
        or (a.share_level = 'details' and not e.is_confidential)
      then e.attendee_profile_ids else '{}'::uuid[]
    end as attendee_profile_ids,
    case when a.profile_id = (select auth.uid()) then e.self_response else null end as self_response,
    case
      when a.profile_id = (select auth.uid()) then 'owner'
      when (select auth.uid()) = any (e.attendee_profile_ids) and not e.is_confidential then 'attendee'
      when a.share_level = 'details' and not e.is_confidential then 'attendee'
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
    e.is_confidential,
    -- Stabilny klucz wystąpienia (2026-09-02): `id` wiersza zmienia się przy
    -- pełnym syncu (kasowanie + wstawienie), a klucz `(calendar_id,
    -- google_event_id)` przeżywa sync — tracker w widoku „Dzień" wiąże nim wpis
    -- czasu ze spotkaniem. Oba pola są nieosobowe (id kalendarza i id instancji
    -- wydarzenia Google), więc wchodzą także do wierszy „Zajęty".
    e.calendar_id,
    e.google_event_id
  from n2click.google_calendar_events e
  join n2click.google_accounts a on a.id = e.account_id
  -- Odznaczony kalendarz znika z widoku od razu (wiersze sprząta następny sync).
  join n2click.google_calendars c on c.id = e.calendar_id and c.selected
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
