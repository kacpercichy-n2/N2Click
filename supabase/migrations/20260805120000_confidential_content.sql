-- =============================================================================
-- Migracja: 20260805120000_confidential_content
--
-- Utajniona tresc (zarzad): addytywna flaga is_confidential na n2click.tasks /
-- n2click.projects / n2click.events. Tresc utajnionej encji (tytul, opis,
-- checklista, lokalizacja) maskuje WYLACZNIE klient — dla wszystkich poza
-- zarzadem (dzial "Zarzad" lub stanowisko CEO/COO/CTO) i osobami przypisanymi
-- (reguly wgladu: src/store/confidentiality.ts). To bramka UX po stronie
-- klienta, jak naglowek RLS wydarzen (20260721210000_events) — ZERO zmian RLS,
-- zadnych widokow; serwer nadal zwraca pelne wiersze kazdemu zalogowanemu.
-- Konwencja: tylko-do-przodu, idempotentna. TYLKO plik — aplikacja to krok
-- operatora PRZED wdrozeniem klienta (select hydracji nazywa kolumny wprost).
-- =============================================================================

alter table n2click.tasks
  add column if not exists is_confidential boolean not null default false;

alter table n2click.projects
  add column if not exists is_confidential boolean not null default false;

alter table n2click.events
  add column if not exists is_confidential boolean not null default false;
