# Raport workflow: 20260722-122208-n2hub-248-filter-bar-pattern

## Wykonane

Workflow tier: orchestrator → developer → reviewer (werdykt: approve, bez blokerów).

Analiza stanu zastałego wykazała, że część zadania była już zrealizowana przez
wcześniejsze etapy: wspólny `FilterPanel` (popover „Filtry”) działał na
Projektach, Zadaniach i Kanbanie, filtr po osobach istniał we wszystkich trzech
widokach, a autozapis filtrów (`commit` → `lastFilters`) był pokryty testami.
Domknięto pozostałe luki — chirurgicznie, bez przebudowy logiki filtrów:

1. Nowy reużywalny `src/components/FilterBar.tsx` — jedna pozioma belka
   komponująca istniejące elementy: `FilterPanel` (pass-through propsów),
   opcjonalne sloty `personFilter` / `presets` / `trailing` oraz pass-through
   `data-tour`. Bez stanu i bez zależności od store — gotowy pod przyszły
   TimelinePage (TimelinePage w tym runie nietknięty).
2. `ProjectsPage` i `TasksPage`: `FilterPresets` („Zapisz filtr”) przeniesione
   spod belki DO belki; licznik wyników jako slot `trailing`; kotwice
   onboardingu `data-tour="projects.filters"` / `"tasks.filters"` zachowane.
3. `KanbanPage`: `PersonFilter` przeniesiony spod nagłówka „Kanban”
   (`.page-head`) do belki `FilterBar` pod nagłówkiem, razem z `FilterPanel`
   i `FilterPresets`. Sekcje: płatność / klient / projekt / osoba przypisana.
4. `src/styles.css`: nowa klasa `.filter-toolbar` (+ warianty), rozłączna
   z istniejącą `.filter-bar` (root `FilterPanel`, nietknięta).

## Zmiany

- `src/components/FilterBar.tsx` (nowy) — reużywalna belka filtrów.
- `src/components/FilterBar.test.ts` (nowy) — 4 testy SSR
  (`renderToStaticMarkup`): jeden kontener belki, presety wewnątrz belki,
  pass-through `data-tour`, pomijanie pustych slotów.
- `src/store/personFilterSelectors.test.ts` (nowy) — 9 testów brzegowych
  `projectsOfPerson` / `assigneeIdsOfTask` (deduplikacja, wykluczenie draftów,
  wiszący `projectId`, kolejność, izolacja między zadaniami).
- `src/pages/ProjectsPage.tsx`, `src/pages/TasksPage.tsx`,
  `src/pages/KanbanPage.tsx` — kompozycja przez `FilterBar` (tylko JSX;
  logika stanu/commit/applyPreset bez zmian).
- `src/styles.css` — style `.filter-toolbar*`.
- Zero zmian w `src/store/*` (poza nowym plikiem testów), reducerach,
  storage, `package.json`; brak nowych zależności.

## Weryfikacja

- `npm test`: PASS — 50 plików testowych, 1321 testów (w tym 13 nowych).
- `npm run build` (`tsc --noEmit` + `vite build`): PASS; ostrzeżenie o rozmiarze
  chunku istniało wcześniej i nie jest związane z tą zmianą.
- Reviewer (read-only) zweryfikował diff względem bazy `9ae14807`: presety
  faktycznie wewnątrz belki na 3 stronach, Kanban bez `PersonFilter`
  w `.page-head`, kotwice `data-tour` zgodne z `src/onboarding/catalog.ts`,
  brak zmian w store/reducerach (invariant 6 i autozapis nienaruszone),
  klasy CSS rozłączne. Werdykt: **approve**, blokerów brak.
- Wiki: `wiki unchanged` — kotwice `data-tour` i granice opisane
  w `ui-navigation-and-onboarding.md` pozostają aktualne; `FilterBar` to
  szczegół kompozycji wewnątrz strony, poniżej granulacji wiki.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- W Kanbanie kolejność w belce to teraz `FilterPanel` → `PersonFilter`
  (wcześniej odwrotnie w nagłówku); zadanie nie narzucało kolejności,
  sekcje i logika bez zmian.
- Test presetów w belce dowodzi obecności „Zapisz filtr” wewnątrz kontenera
  belki przez kolejność znaczników w SSR, nie przez pełną asercję zagnieżdżenia
  — drobne, nieblokujące.
- Przycisk nosi istniejącą etykietę „Zapisz filtr” (komponent `FilterPresets`
  sprzed tego zadania); zakres chirurgiczny obejmował umiejscowienie, nie
  zmianę etykiety.

## Podpis schedulera

- Run: `20260722-122208-n2hub-248-filter-bar-pattern`
- Prompt: `248-filter-bar-pattern.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `9ae14807c421e8655012e2b6187958ecdc5b3559`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `9ae14807c421e8655012e2b6187958ecdc5b3559`
- Gałąź review: `review-integration`
- Run: `20260722-122208-n2hub-248-filter-bar-pattern`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/KanbanPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-122208-n2hub-248-filter-bar-pattern.md`
- `src/components/FilterBar.test.ts`
- `src/components/FilterBar.tsx`
- `src/store/personFilterSelectors.test.ts`
