-- =============================================================================
-- Migracja: 20260811160000_events_absences
--
-- Nieobecność per (wystąpienie, osoba) wydarzenia CYKLICZNEGO: „nie biorę
-- udziału w TYM wystąpieniu" zwalnia slot osoby w kolizjach i objętości dnia
-- (frontend: TOGGLE_EVENT_ATTENDANCE, filtry w selektorach, kafel-duch).
--
-- Addytywna kolumna jsonb na n2click.events: lista obiektów
-- `{ "date": "yyyy-MM-dd", "personId": "<uuid profilu>" }`. Kanonizacja
-- (dedup, sort, tylko realne dni wystąpień żywej reguły) żyje po stronie
-- klienta (normalizeEventAbsences) — jak `recurrence`, którego kształtu baza
-- też nie waliduje. ZERO zmian RLS (polityki events bez zmian; kolumna jedzie
-- w istniejących grantach select/insert/update).
-- =============================================================================

alter table n2click.events
  add column if not exists absences jsonb not null default '[]'::jsonb;

comment on column n2click.events.absences is
  'Nieobecności per (wystąpienie, osoba) wydarzenia cyklicznego: [{date, personId(uuid profilu)}]. Kanonizacja po stronie klienta.';
