# Run state — 20260803-105323-n2hub-309 wydarzenia urlopowe

## Goal

Rodzaj wydarzenia „urlop" na istniejącym `CalendarEvent`: zakres od–do (klucz
`endDate`, kanonicznie tylko dla urlopu), tylko własny urlop, pełnodniowa
zajętość (czasy kanoniczne 0/1440) twardo blokująca przypisania przez ISTNIEJĄCY
mechanizm kolizji z commita ca0a9b6 (2026-07-30), czerwony blok `TreePalm` w
oknie godzin pracy z profilu (fallback 9:00–17:00), palma zamiast wykrzyknika
przeciążenia w dni urlopowe.

## Packages

1. `handoffs/scheduler-reviews/n2hub-309-architect-package.md`
   (PKG-20260803-wydarzenia-urlopowe) — tier developer, ready, risk medium,
   Codex required. Jeden pakiet (testy nierozdzielne).

## Changed boundaries (planned)

`types.ts` (`kind?`/`endDate?`), `commandValidation.normalizeEventDraft`,
`storage.repairEvents`, `selectors.ts` (rozwinięcie wielodniowe w
`calendarEventsForDate`, `ScheduleConflictKind:'urlop'`, nowy
`personVacationOnDate`, `eventDraftConflicts` z progiem warning dla urlopu),
`AppStore` (straż urlopu w `insertBlock`/`reassignEntry`; `setBlockTime`
dziedziczy), `weekViewModel` (`BusyInterval:'urlop'`, `vacationNames`),
`weekViewLayout.vacationRenderWindow`, WeekView/MonthView/EventsPage/
EventModal/WorkloadPage/PersonProfilePage, `permissions` (`events.vacationSelf`),
cloudMirror/plannerData/cloudMerge + JEDNA nieaplikowana migracja
`20260803120000_events_vacation.sql` (n2click.events: kind, end_date).

## Verification

Focused vitest z pakietu, potem pełne `npm test` + `npm run build`
(scheduler-owned). Browser: none — zero zmian ścieżek pointer/drag.

## Open questions

Brak blokujących. Świadome decyzje D1–D12 w pakiecie (m.in. zapis urlopu nad
istniejącym planem = warning, nie blocking; TaskModal/SAVE_TASK nieblokowane —
inwariant 3). Wiki: `scheduling-and-calendar.md` i `state-and-persistence.md`
będą wymagały wpisu o urlopie po zielonym runie — decyzja finalnego recenzenta.

## Developer log (n2hub-309)

Wykonano pakiet w całości. Granice zmienione zgodnie z listą wyżej; dodatkowo
`commandValidation.canonicalVacationEndDate` (jedno źródło reguły zakresu dla
trzech granic) i `selectors.splitOverloadedDaysByVacation` (czysty podział
wskaźnika, D8). Wynik: `npm test` 107 plików / 2337 testów zielone,
`npm run build` zielony. Migracja NIE zaaplikowana. Wiki zaktualizowane
(scheduling-and-calendar, state-and-persistence, cloud-database). Brak blokerów.

## Developer log (n2hub-310)

Granice: `styles.css` (skala szerokości modali `clamp()`, nowy blok pól
tekstowych `field-sizing: content` od 761 px) i jedna klasa w `EventModal.tsx`
(`event-modal-card`). Dolne granice `clamp()` = poprzednie stałe, więc mobile i
ekrany < ~1300 px bez zmian. `npm test` 107/2337 zielone, `npm run build`
zielony. Playwright niezainstalowany, browser check nie uruchamiany.

## Developer log (n2hub-312)

Granice: nowy `src/contentplan/domain.ts` (czysta domena + drafty), typy i dwa
slice'y w `types.ts`, `emptyData`/`coerceArray`/`repairContentPlan` w
`storage.ts`, 7 akcji `*_CP_*` w `AppStore.tsx`, 2 selektory, `seed.ts`,
`persistGate` (kolekcje NON_MIRRORED — brak domu w chmurze do R8). `npm test`
111 plików / 2476 testów zielone (+139), `npm run build` zielony. Wiki:
`state-and-persistence.md` zaktualizowane. Bez blokerów.

## Developer log (n2hub-313)

Granice: `navItems.ts` + `icons.ts` (CalendarRange), `routeChunks.ts`,
`App.tsx` (filtr navPaths + trasa), nowe `pages/contentPlanScope.ts`,
`pages/contentPlanRoute.ts`, `pages/ContentPlanPage.tsx`,
`contentplan/useContentPlanAccess.ts`. Rozszerzenie kontekstu: `GlobalSearch`
i `NavOrderEditor` musiały dostać tę samą bramkę, bo obie czytają `NAV`.
`npm test` 113/2494 zielone, `npm run build` zielony. Wiki: patrz raport.
