-- =============================================================================
-- Migracja: 20260803120000_events_vacation
--
-- Wydarzenia urlopowe: dyskryminator kind ('meeting' | 'urlop') i data konca
-- zakresu end_date na n2click.events (tabele przepiete ze schematu public
-- migracja 20260731081831_move_n2click_tables). Urlop jest przechowywany jako
-- wydarzenie pelnodniowe (start_minutes 0, duration_minutes 1440 — mieszcza sie
-- w istniejacych CHECK-ach), end_date niesie koniec zakresu (NULL = jeden dzien).
-- Zero zmian RLS (polityki events_* zostaja using(true)/with check(true)).
-- Konwencja: tylko-do-przodu, idempotentna. TYLKO plik — aplikacja to krok
-- operatora PRZED wdrozeniem klienta (select hydracji nazywa kolumny wprost).
-- =============================================================================

alter table n2click.events
  add column if not exists kind text not null default 'meeting';

alter table n2click.events
  add column if not exists end_date date;

do $$ begin
  alter table n2click.events
    add constraint events_kind_check check (kind in ('meeting', 'urlop'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table n2click.events
    add constraint events_end_date_check
    check (end_date is null or end_date >= event_date);
exception when duplicate_object then null; end $$;
