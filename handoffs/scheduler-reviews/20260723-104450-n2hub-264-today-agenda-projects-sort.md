# Raport workflow: 20260723-104450-n2hub-264-today-agenda-projects-sort

## Wykonane

### Item A — „Zadania na dziś" pokazuje zadania nie zaplanowane na dzisiaj → JUŻ NAPRAWIONE (bez zmian produkcyjnych)

Zweryfikowałem wszystkie ścieżki renderujące „zadania na dziś":
- Jedyną ścieżką jest `TodayAgendaList` (`src/components/TodayAgenda.tsx`),
  używana przez scalony Panel (`src/pages/DashboardPage.tsx`, RZĄD 3,
  `data-tour="home.today"`). Czyta wyłącznie selektor `todayAgendaForPerson`.
- `todayAgendaForPerson` (`src/store/selectors.ts` ~467–486) filtruje `timed`
  po wpisach workload (`w.date === date`), a `dateless` po deadline
  (`t.endDate === date`). Zadania jedynie „obejmujące" datę są celowo wykluczone.
- Przeszukałem cały `src/` pod kątem filtrowania po okresie zadania
  (period start–end zawiera dziś) w kontekście „na dziś" — brak takiej ścieżki.
  Widok mobilny nie ma osobnej listy „na dziś" (trafienia `mobile` w App.tsx /
  styles.css nie dotyczą tej listy). Pozostałe listy na Panelu to Zasobnik,
  „Po terminie", „Przeciążone dni", „Bez planu" — inna semantyka, nie „na dziś".

Wniosek: logika jest już poprawna. Aby zablokować regresję dokładnie
zgłoszonego scenariusza, dodałem test regresyjny (nie zmieniałem kodu
produkcyjnego).

### Item B — alfabetyczne sortowanie projektów wg nazwy klienta → NAPRAWIONE

- Nowy czysty helper `sortProjectGroups` w `src/pages/projectSort.ts`
  (zgodnie ze wzorcem `dashboardPanels.ts`/`kanbanBoard.ts`/`timelineZoom.ts`):
  grupy sortowane alfabetycznie po nazwie klienta, projekty w grupie wtórnie po
  nazwie projektu, `localeCompare(..., 'pl')` (poprawne polskie znaki),
  grupa „Bez klienta" (pusty `clientId`) zawsze na końcu.
- `src/pages/ProjectsPage.tsx`: `groups` (useMemo) owinięte przez
  `sortProjectGroups(out)` — sortowanie wyłącznie w warstwie prezentacji
  (posortowana kopia). Bez zmian kolejności w stanie ani persystencji, bez zmian
  modelu danych i reducerów.

## Zmiany

- `src/pages/projectSort.ts` — NOWY czysty helper sortujący grupy projektów (Item B).
- `src/pages/projectSort.test.ts` — NOWE testy jednostkowe helpera (5 przypadków:
  sort grup, sort projektów w grupie, „Bez klienta" na końcu, kolacja polskich
  znaków, brak mutacji wejścia).
- `src/pages/ProjectsPage.tsx` — użycie `sortProjectGroups` w memo `groups` +
  import (Item B).
- `src/store/selectors.test.ts` — NOWY test regresyjny (Item A): zadanie pon–pt
  z wpisem workload tylko w czwartek nie pokazuje się w środę, tylko w czwartek.

## Weryfikacja

- `npm test`: zielone — 58 plików, 1419 testów przechodzi (w tym nowe testy Item A i B).
- `npm run build` (`tsc --noEmit && vite build`): zielone.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Item A: brak zmian produkcyjnych — jeśli w przyszłości powstanie inna ścieżka
  „na dziś", musi również korzystać z `todayAgendaForPerson`, nie z filtrowania
  po okresie zadania. Test regresyjny pilnuje selektora, nie ewentualnej nowej
  ścieżki UI.
- Item B: sortowanie zależy od `Intl`/`localeCompare('pl')` w środowisku
  przeglądarki (standardowe, wspierane). Sortowanie jest czysto prezentacyjne —
  nie wpływa na stan, persystencję ani deep-link `?client=`.

## Podpis schedulera

- Run: `20260723-104450-n2hub-264-today-agenda-projects-sort`
- Prompt: `264-today-agenda-projects-sort.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `04b4c8a65fb30dc0f989220d9c887e7862b8712b`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `04b4c8a65fb30dc0f989220d9c887e7862b8712b`
- Gałąź review: `review-integration`
- Run: `20260723-104450-n2hub-264-today-agenda-projects-sort`

### Pliki zgłoszone do review

- `src/pages/ProjectsPage.tsx`
- `src/store/selectors.test.ts`
- `handoffs/scheduler-reviews/20260723-104450-n2hub-264-today-agenda-projects-sort.md`
- `src/pages/projectSort.test.ts`
- `src/pages/projectSort.ts`
