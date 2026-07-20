# Raport workflow: 20260720-191842-225-weekday-next-to-dates

## Wykonane

Analiza wstępna potwierdziła, że funkcja nie istniała w bieżącym buildzie
(brak formattera z dniem tygodnia w `src/utils/dates.ts`), więc zadanie
zrealizowano w trybie tier `developer → reviewer`.

- **Formatter kanoniczny**: dodano jeden eksport `formatShortWithWeekday(d)`
  w `src/utils/dates.ts` — wynik `formatShort` + sufiks `(EEEEEE)` z locale
  `pl` (date-fns), np. `26 paź (pon)`, `1 lis (nie)`. Żadna logika dat nie
  została zduplikowana poza `dates.ts`.
- **Powierzchnie planowania** przełączone na nowy formatter:
  `rangeLabel` w `ProjectsPage.tsx` i `TasksPage.tsx` (karty zadań/projektów;
  usunięto martwe importy date-fns), wiersze zadań w `ProjectDetailPage.tsx`,
  wiersze projektów/zadań w `PersonProfilePage.tsx`, wyniki `GlobalSearch.tsx`,
  `TodayAgenda.tsx` („do …”), `MyWorkPage.tsx` (zaległe „do …”),
  karty w `KanbanPage.tsx`.
- **TaskModal**: natywne `input[type=date]` nie renderują własnego tekstu,
  więc pod polami okresu (start/koniec) dodano wyciszoną podpowiedź
  `field-hint` z pełną datą z dniem tygodnia, renderowaną tylko dla poprawnej
  daty (`isValidDateStr`).
- **Pozostawione celowo**: nagłówki tygodnia w `WeekView` (już mają dni
  tygodnia; plik stability-sensitive — inwariant 7), nagłówki dni w
  `AllocationGrid` (już pokazują dzień przez `formatRowLabel`), chipy filtrów
  `Od:`/`Do:` (to filtry, nie daty planowania), osie/etykiety `TimelinePage`
  oraz jego tooltipy.
- **Testy**: nowy blok w `src/utils/dates.test.ts` — dokładne polskie wyjścia
  dla znanego poniedziałku (`2026-10-26` → `26 paź (pon)`) i niedzieli
  (`2026-11-01` → `1 lis (nie)`).

Recenzent (read-only) zweryfikował diff względem kryteriów: **approve**, zero
blockerów; potwierdził brak zmian w WeekView/store/storage/reducerach oraz
jedno kanoniczne źródło formatu. Decyzja wiki: **wiki unchanged** —
`ui-navigation-and-onboarding.md` nie opisuje formatowania etykiet dat, więc
nic nie stało się nieaktualne.

## Zmiany

- `src/utils/dates.ts` — nowy `formatShortWithWeekday`
- `src/utils/dates.test.ts` — testy formattera
- `src/pages/ProjectsPage.tsx`, `src/pages/TasksPage.tsx` — `rangeLabel`
- `src/pages/ProjectDetailPage.tsx`, `src/pages/PersonProfilePage.tsx`,
  `src/pages/MyWorkPage.tsx`, `src/pages/KanbanPage.tsx` — daty zadań/projektów
- `src/components/GlobalSearch.tsx`, `src/components/TodayAgenda.tsx` — meta dat
- `src/components/TaskModal.tsx` — podpowiedzi dnia tygodnia przy polach okresu

## Weryfikacja

- `npx vitest run src/utils/dates.test.ts`: PASS (28 testów, 0 błędów)
- `npm run build` (`tsc --noEmit && vite build`): PASS, bez błędów typów
- `npm test` / `npm run build` (gate): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- `rangeLabel` w ProjectsPage/TasksPage nie pokazuje już roku (wcześniej
  pokazywał) — ujednolicone z resztą aplikacji, która roku nie pokazywała;
  okres zadania ≤ 92 dni, więc niejednoznaczność między latami jest ograniczona.
- Podpowiedź przy polach dat w TaskModal pokazuje pełną datę `26 paź (pon)`,
  a nie sam `(pon)` — świadome odstępstwo, by nie dodawać drugiego formattera
  ani nie duplikować logiki dat poza `dates.ts`.
- Tooltipy w `TimelinePage` nadal używają `formatShort` bez dnia tygodnia —
  poza wyliczonymi powierzchniami akceptacji; do ewentualnego osobnego promptu.

## Podpis schedulera

- Run: `20260720-191842-225-weekday-next-to-dates`
- Prompt: `225-weekday-next-to-dates.md`
- Gałąź review: `review-integration`
- Baza: `63818ee890ad6d3d54878807aa7c2682c963e6c7`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `63818ee890ad6d3d54878807aa7c2682c963e6c7`
- Gałąź review: `review-integration`
- Run: `20260720-191842-225-weekday-next-to-dates`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/GlobalSearch.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TodayAgenda.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/MyWorkPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `handoffs/scheduler-reviews/20260720-191842-225-weekday-next-to-dates.md`
