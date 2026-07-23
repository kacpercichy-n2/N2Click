# Raport workflow: 20260723-113754-n2hub-268-person-pills-into-filter-panel

## Wykonane

Analiza wstępna potwierdziła, że problem nadal występuje w bieżącym buildzie:
Kanban przekazywał inline pillsy osób do slotu `personFilter` FilterBara, a
Kalendarz renderował `PersonFilter` zawsze inline pod toolbarem (Timeline miał
już sekcję w popoverze po prompcie 254; Projects/Tasks mają single-select
„Osoba" w panelu — nietknięte). Routing tier: `developer → reviewer`.

Zrealizowano przeniesienie wyboru osób do popovera „Filtry" i pokazywanie w
belce wyłącznie aktywnych wyborów:

- `src/components/PersonFilter.tsx` — nowe współdzielone eksporty:
  `PersonFilterSection` (fieldset „Osoby" z `PersonFilter` do popovera) oraz
  `ActivePersonChips` (kompaktowe chipy tylko wybranych osób: kropka koloru +
  nazwa, klik usuwa z filtra, nadmiar zwijany do „+N" przy `maxVisible=4`,
  `null` gdy pusto == „Wszyscy"). Semantyka bazowego `PersonFilter` bez zmian
  (pusty Set == wszyscy).
- `src/components/FilterBar.tsx` — slot `personFilter?: ReactNode` zastąpiony
  pierwszoklasowym propem `person?: { people, selected, onToggle, onAll }`:
  FilterBar sam wstrzykuje sekcję „Osoby" do `filterPanel.extra` (komponując z
  extra strony) i renderuje aktywne chipy w belce. Bar i panel pozostają
  bezstanowe — strony dalej trzymają własny stan i podają dane w dół.
- `src/pages/KanbanPage.tsx` — przełączony na prop `person`; usunięty zbiorczy
  chip „Osoby: X, Y" i inline slot. Licznik „Filtry" już wcześniej liczył filtr
  osób.
- `src/pages/TimelinePage.tsx` — lokalny fieldset zastąpiony współdzielonym
  `PersonFilterSection`, zbiorczy chip „Osoby: N" zastąpiony `ActivePersonChips`
  (nadal `FilterPanel` bezpośrednio — mniejszy diff, układ `timeline-hint-row`
  zachowany).
- `src/pages/CalendarPage.tsx` — zawsze-inline pillsy zastąpione FilterBarem z
  popoverem „Filtry" (jedyna grupa = sekcja „Osoby") + aktywne chipy;
  `activeCount` obejmuje filtr osób. `data-tour="calendar.toolbar"` i strażnik
  `state.people.length > 0` nietknięte.
- `src/styles.css` — style `.person-active-chips` / `.person-active-chip(.more)`
  spójne z istniejącymi chipami.
- Testy: `src/components/FilterBar.test.ts` zaktualizowany (nie usunięty),
  nowy `src/components/PersonFilter.test.ts` (sekcja „Osoby", semantyka
  „Wszyscy", chipy aktywnych, usuwanie, „+N", pusto → nic).

Zero zmian w modelu danych, kształcie stanu filtrów per strona, payloadach
`SET_LAST_FILTER` i persystencji presetów (`criteria.personId` dla
Projects/Tasks round-tripuje jak dotąd; multi-select `personIds` nadal w
`lastFilters`). Kotwice onboardingu (`projects.filters`, `tasks.filters`,
`calendar.toolbar`) bez zmian.

Werdykt reviewera (osobny agent, read-only): **approve**, zero blockerów;
potwierdził zgodność diffa z raportem developera (0 zmian w `src/store/`,
`src/onboarding/`, `src/types.ts`), bezpieczne zachowanie przy nieaktualnych
id osób (filtrowane po `people`) i poprawną granicę „+N" przy dokładnie 4
wybranych. Decyzja wiki: **wiki unchanged** — strona
`ui-navigation-and-onboarding.md` dokumentuje tylko stabilne kotwice
`data-tour` (niezmienione), a `testing-and-automation.md` nie enumeruje plików
testów jednostkowych.

## Zmiany

- `src/components/PersonFilter.tsx`, `src/components/FilterBar.tsx`,
  `src/pages/KanbanPage.tsx`, `src/pages/TimelinePage.tsx`,
  `src/pages/CalendarPage.tsx`, `src/styles.css`,
  `src/components/FilterBar.test.ts`, `src/components/PersonFilter.test.ts`
  (nowy).

## Weryfikacja

- `npx vitest run src/components/FilterBar.test.ts src/components/PersonFilter.test.ts`
  → 12 passed, 0 failed (developer i reviewer niezależnie).
- `npm test` → 64 pliki, 1483 passed, 0 failed (developer i reviewer
  niezależnie).
- `npm run build` → zielony (`tsc --noEmit` + vite; jedynie wcześniejsze,
  niepowiązane ostrzeżenie o rozmiarze chunku).
- Gate (`npm test && npm run build`): oczekuje na scheduler
- Codex review: brak artefaktu w worktree (uruchamiany przez scheduler po
  wyjściu procesu); reviewer nie zgłosił `codex-requested` — brak ekspansji
  granic i nierozstrzygniętych wątpliwości.

## Ryzyka / rzeczy do sprawdzenia

- Sekcja „Osoby" w popoverze renderuje się dopiero po otwarciu (stan `open`
  FilterPanelu), więc testy SSR pokrywają wstrzyknięcie przez bezpośredni
  render `PersonFilterSection`, a callbacki toggle/onAll strukturalnie (bez
  symulacji kliknięć — brak DOM w środowisku `node`).
- Nowy `activeCount` Kalendarza (`filter.size > 0 ? 1 : 0`) zweryfikowany
  inspekcją reviewera — strony nie mają harnessu unit-testowego; Kanban/Timeline
  liczyły filtr osób już wcześniej (bez zmian).
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260723-113754-n2hub-268-person-pills-into-filter-panel`
- Prompt: `268-person-pills-into-filter-panel.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `9af559b3f5b92fcc1b89593d6922843b1f089434`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `9af559b3f5b92fcc1b89593d6922843b1f089434`
- Gałąź review: `review-integration`
- Run: `20260723-113754-n2hub-268-person-pills-into-filter-panel`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/FilterBar.test.ts`
- `src/components/FilterBar.tsx`
- `src/components/PersonFilter.tsx`
- `src/pages/CalendarPage.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/TimelinePage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260723-113754-n2hub-268-person-pills-into-filter-panel.md`
- `src/components/PersonFilter.test.ts`
