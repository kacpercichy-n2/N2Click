-- =============================================================================
-- Migracja: 20260915120000_events_personal_times_and_absence_kind
--
-- 1. OSOBISTE CZASY WYSTĄPIEŃ (zgłoszenie „Brak możliwości edycji czasu
--    pojedynczego spotkania", 2.09): kolumna `personal_times` jsonb na
--    n2click.events — lista [{date, personId(uuid profilu), startMinutes,
--    durationMinutes}] per (dzień wystąpienia, osoba). Obowiązuje wyłącznie
--    w kalendarzu tej osoby (plan dnia, kolizje, godziny); pozostali widzą
--    czas wydarzenia. Kanonizacja po stronie klienta
--    (`normalizeEventPersonalTimes`), jak przy `rsvps`.
-- 2. NIEOBECNOŚĆ jako drugi rodzaj nieobecności obok urlopu (zgłoszenie
--    „nieobecności", 3.09): `kind` przyjmuje też 'nieobecnosc' (nie schodzi
--    z limitu dni urlopu; blokuje czas jak urlop).
--
-- Addytywne, bez zmian RLS (polityki n2click.events bez zmian). Idempotentne.
-- =============================================================================

alter table n2click.events
  add column if not exists personal_times jsonb not null default '[]'::jsonb;

comment on column n2click.events.personal_times is
  'Osobiste czasy wystąpień per (dzień, osoba): [{date, personId(uuid profilu), startMinutes, durationMinutes}]; obowiązują tylko w kalendarzu tej osoby. Kanonizacja po stronie klienta.';

alter table n2click.events drop constraint if exists events_kind_check;
alter table n2click.events
  add constraint events_kind_check check (kind in ('meeting', 'urlop', 'nieobecnosc'));

comment on column n2click.events.kind is
  'Rodzaj: meeting (spotkanie), urlop (schodzi z limitu dni), nieobecnosc (nie schodzi; choroba, odbiór godzin, wyjazd).';
