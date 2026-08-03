# Raport workflow: 20260803-105323-n2hub-309-wydarzenia-urlopowe

## Wykonane

Analiza wstępna potwierdziła, że w buildzie nie było żadnej obsługi urlopów
(grep "urlop" w `src/` pusty), więc zadanie wykonano w całości. Workflow tier:
architect → developer → reviewer (pakiet `n2hub-309-architect-package.md`,
decyzje D1–D12).

1. **Typ wydarzenia "urlop"** w istniejącym modelu: `CalendarEvent.kind?: 'urlop'`
   + `endDate?` (zakres od–do, wielodniowy, limit 92 dni przez
   `canonicalVacationEndDate` w `commandValidation.ts` — jedno źródło reguły dla
   reduktora, `repairEvents` i hydracji chmury). Forma kanoniczna: wydarzenie
   całodniowe 0/1440, dokładnie jeden uczestnik (w UI wymuszony bieżący
   użytkownik — urlop dodaje się tylko sobie), bez cykliczności, bez lokalizacji.
   EventModal ma tryb urlopu (Od/Do/Opis), EventsPage przycisk "Dodaj urlop" za
   nowym uprawnieniem `events.vacationSelf` (obie role).
2. **Reprezentacja w kalendarzu**: czerwony blok z ikoną `TreePalm` rysowany
   w oknie godzin pracy osoby z profilu (`vacationRenderWindow`), fallback
   9:00–17:00 gdy profil godzin nie definiuje. Wizualnie NIE 0–24; styl
   `--vacation-accent` odróżnia urlop od zwykłych wydarzeń. Znaczniki także
   w MonthView i podsumowaniu dnia.
3. **Twarda blokada przydziału** oparta o mechanizm kolizji z `ca0a9b6`, bez
   równoległego mechanizmu: urlop rozwija się wielodniowo w
   `calendarEventsForDate`, więc `blockCollidesWithEvent` /
   `eventDraftConflicts` / `eventBusyByPersonDate` traktują każdy dzień urlopu
   jako zajęty — drag/resize, "Zaplanuj część", ścieżka klawiaturowa i
   automatyczne rozmieszczanie dziedziczą blokadę bez zmian logiki interwałów.
   Dodatkowo jawne straże `personVacationOnDate` w `insertBlock` i datowanym
   `reassignEntry`. Polskie komunikaty ("Ta osoba ma w tym dniu urlop.").
   Inwariant 6 zachowany (odrzut = ta sama referencja stanu). Zapis urlopu nad
   już zaplanowanym okresem ostrzega, nie blokuje (jak wydarzenia
   ogólnofirmowe) — inaczej dwutygodniowy urlop byłby niewstawialny.
4. **Palemka zamiast wykrzyknika** dla dni urlopu danej osoby
   (`splitOverloadedDaysByVacation`): WorkloadPage (komórka + flaga przy
   nazwisku), PersonProfilePage (pasek tygodnia), nagłówek dnia WeekView.
   Wykrzyknik przeciążenia w pozostałych miejscach i dniach bez zmian
   (potwierdzone testami).
5. **Chmura**: `cloudMirror` zapisuje `kind`/`end_date`, hydracja
   (`plannerData`) łagodna per-pole (nieznany `kind` → spotkanie). Dodany
   TYLKO addytywny plik migracji
   `supabase/migrations/20260803120000_events_vacation.sql` (`add column if
   not exists kind, end_date` + CHECK) — **nie zaaplikowany do żadnej bazy**.
6. Wiki zaktualizowane: `scheduling-and-calendar.md`,
   `state-and-persistence.md`, `cloud-database.md` (werdykt reviewera:
   `wiki updated`).

## Zmiany

- 34 zmodyfikowane pliki w `src/` i `openwiki/n2hub/` (model, walidacja,
  selektory, reduktor, render, chmura, style, testy) + nowy plik migracji
  `supabase/migrations/20260803120000_events_vacation.sql`.

## Weryfikacja

- Testy fokusowe pakietu: 909 passed, 0 failed.
- Pełne `npm test`: 107 plików / 2337 testów — zielone.
- `npm run build` oraz `tsc --noEmit`: zielone, 0 błędów.
- Nowe testy zgodnie z wymaganiami: blokada przydziału w terminie urlopu
  (drag, "Zaplanuj część", klawiatura, insert, reassign; inwariant 6 przez
  `.toBe(state)`), urlop wielodniowy (rozwinięcie + dzień środkowy), okno
  godzin bloku wg profilu i fallback 9–17 (w tym okna zdegenerowane), palemka
  vs wykrzyknik (rozdział per osoba/dzień), migracje/mirror/hydracja.
- Reviewer (read-only): wszystkie kryteria PASS, 5 odstępstw developera
  zaakceptowanych, zero defektów blokujących. Werdykt `codex-requested`
  wyłącznie proceduralnie: pakiet deklaruje "Codex review: required", a
  artefakt Codex jest własnością schedulera (uruchamiany po wyjściu tego
  procesu) — zgodnie z kontraktem tier.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- **Kolejność wdrożenia chmury**: select hydracji nazywa `kind, end_date`
  wprost, więc klient z tą zmianą przeciw bazie BEZ migracji dostanie `42703`.
  Migrację trzeba zaaplikować PRZED wdrożeniem klienta (opisane w nagłówku
  pliku migracji i w `cloud-database.md`). Migracja nie została zaaplikowana.
- Urlop z pustym `attendeeIds` (osiągalny tylko przez wiersz z chmury po
  odfiltrowaniu danglingowego uczestnika) działa jak ogólnofirmowy i blokuje
  wszystkich — świadomie spójne z istniejącą semantyką spotkań w
  `blockCollidesWithEvent`; ewentualne utwardzenie hydracji to osobne zadanie.
- Blok urlopu rysuje się w oknie godzin pracy, ale kolizyjnie blokuje całą
  dobę (decyzja D7): wizualnie pokazuje mniej, niż zajmuje — udokumentowane
  w kodzie i wiki.
- Edycje alokacji w TaskModal (`SAVE_TASK`) celowo pozostają nieblokowane
  (inwariant 3 CLAUDE.md ma pierwszeństwo); `MOVE_TASK` poza zakresem pakietu.

## Podpis schedulera

- Run: `20260803-105323-n2hub-309-wydarzenia-urlopowe`
- Prompt: `309-wydarzenia-urlopowe.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `bacec7ddfeb5b8729e2a1589eed074d2751ed732`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `bacec7ddfeb5b8729e2a1589eed074d2751ed732`
- Gałąź review: `review-integration`
- Run: `20260803-105323-n2hub-309-wydarzenia-urlopowe`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/EventModal.tsx`
- `src/components/MonthView.tsx`
- `src/components/WeekView.tsx`
- `src/components/icons.ts`
- `src/components/weekViewLayout.test.ts`
- `src/components/weekViewLayout.ts`
- `src/components/weekViewModel.test.ts`
- `src/components/weekViewModel.ts`
- `src/pages/EventsPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/WorkloadPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/blockActions.test.ts`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.ts`
- `src/store/eventActions.test.ts`
- `src/store/permissions.test.ts`
- `src/store/permissions.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `src/utils/eventConflictMessage.test.ts`
- `src/utils/eventConflictMessage.ts`
- `handoffs/scheduler-reviews/20260803-105323-n2hub-309-wydarzenia-urlopowe.md`
- `handoffs/scheduler-reviews/n2hub-309-architect-package.md`
- `supabase/migrations/20260803120000_events_vacation.sql`
