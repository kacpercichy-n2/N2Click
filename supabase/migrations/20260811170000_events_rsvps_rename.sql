-- =============================================================================
-- Migracja: 20260811170000_events_rsvps_rename
--
-- RSVP per (wystąpienie, osoba) wydarzenia cyklicznego (jak w Google Meet):
-- mechanika nieobecności z 20260811160000 rozszerzona o statusy —
-- `yes` = potwierdzam, `no` = nie biorę udziału, BRAK wpisu = „oczekuje".
-- Kolumna `absences` zmienia nazwę na `rsvps`; istniejące wpisy
-- `{date, personId}` (bez `status`) są czytane przez klienta jako `no`
-- (normalizeEventRsvps), więc dane nie wymagają transformacji.
-- ZERO zmian RLS.
-- =============================================================================

alter table n2click.events rename column absences to rsvps;

comment on column n2click.events.rsvps is
  'Odpowiedzi RSVP per (wystąpienie, osoba) wydarzenia cyklicznego: [{date, personId(uuid profilu), status yes|no}]; brak wpisu = oczekuje. Wpis legacy bez status = no. Kanonizacja po stronie klienta.';
