# Raport workflow: 20260722-135851-n2hub-254-timeline-zoom-filters

## Wykonane

Routing tier: `developer → reviewer` (jedna granica zmian: `TimelinePage` +
czysty moduł logiki zoomu z testami). Analiza wstępna potwierdziła, że
wszystkie trzy punkty zadania były nadal aktualne w bieżącym buildzie
(zoom px-owy 14/26/40, zakładki 2/6/10/26 tyg., filtry inline w toolbarze).

- **Poziomy zoomu** — nowy czysty moduł `src/pages/timelineZoom.ts`: dokładnie
  trzy poziomy `week` (bazowy, pon–pt tygodnia kotwicy, 5 dni, 160 px/dzień —
  początek/koniec taska rozróżnialny co do dnia) → `twoWeeks` (14 dni od
  poniedziałku, 64 px/dzień) → `month` (pełny miesiąc kalendarzowy,
  30 px/dzień). Nic szerszego; przy poziomie bazowym przycisk „Powiększ" jest
  wyłączony, przy miesiącu — „Pomniejsz". Nawigacja ‹/› przesuwa kotwicę
  krokiem naturalnym dla poziomu (±1 tydzień / ±2 tygodnie / ±1 miesiąc),
  „Dzisiaj" wraca do bieżącego tygodnia. Cała matematyka dat przez
  `src/utils/dates.ts` (dodane pomocnicze `monthStart`/`monthEnd`). Etykiety
  nagłówka oznaczają poniedziałki + pierwszy dzień zakresu (miesiąc nie
  zaczyna się od poniedziałku).
- **Usunięto** input z zakładkami 2 / 6 / 10 / 26 tygodni (`WEEK_PRESETS`,
  grupa „Zakres widoku") oraz stan `weeks`/`dayW` w `TimelinePage`.
- **Filtry** — reużyty wspólny `FilterPanel` z promptu 248 (domyślnie
  zamknięty popover „Filtry" z licznikiem, chipsami i „Wyczyść wszystko");
  mały przycisk filtrów stoi w jednym wierszu/kolumnie z podpowiedzią
  „przeciągnij pasek…" (`.timeline-hint-row` w `src/styles.css`). Panel:
  grupy **Klient** i **Projekt** (nowe filtrowanie po `criteria.projectId` —
  pole istniało już w `SavedFilterCriteria`; opcje projektów zawężane do
  wybranego klienta) oraz **Osoby** — multi-wybór konkretnych osób przez
  istniejący `PersonFilter`, osadzony w popoverze przez nowy, czysto
  addytywny, opcjonalny prop `extra` w `FilterPanel` (pozostali konsumenci
  bez zmian). Zapamiętywanie filtrów bez zmian wzorca: pełny snapshot
  `SET_LAST_FILTER` dla widoku `timeline`. Przełącznik trybu Projekty/Osoby
  pozostał na miejscu.
- Bez zmian w danych tasków i logice przeciągania terminów: `Bar`,
  `MilestoneMark`, `commitTask`/`commitProject`, reduktory i storage
  nietknięte. Kotwice onboardingu `timeline.toolbar`/`timeline.chart`
  zachowane.

## Zmiany

- `src/pages/timelineZoom.ts` (nowy) — czysta logika poziomów zoomu.
- `src/pages/timelineZoom.test.ts` (nowy) — testy zakresów, stopniowania,
  klamrowania i kroku nawigacji.
- `src/pages/TimelinePage.tsx` — podpięcie poziomów zoomu, usunięcie
  presetów tygodni, przeniesienie filtrów do panelu.
- `src/components/FilterPanel.tsx` — opcjonalny, addytywny prop `extra`.
- `src/utils/dates.ts` + `src/utils/dates.test.ts` — `monthStart`/`monthEnd`
  z testami (w tym rok przestępny).
- `src/styles.css` — `.timeline-hint-row` (podpowiedź + przycisk filtrów).

## Weryfikacja

- Fokusowo: `npx vitest run src/pages/timelineZoom.test.ts
  src/utils/dates.test.ts` → 52/52 zielone.
- Pełny `npm test` → 53 pliki, 1383 testy, wszystkie zielone (bez regresji).
- `npm run build` → zielony (pozostaje jedynie wcześniejsze ostrzeżenie o
  chunku >500 kB, nie dotyczy tej zmiany).
- Reviewer (read-only): werdykt **approve**, zero blockerów; potwierdzono
  brak zmian w ścieżkach drag/commit, addytywność zmiany `FilterPanel`,
  zachowanie inwariantów (snapshot filtrów, daty tylko przez
  `utils/dates.ts`, wykluczenie szkiców `isDraft`).
- Wiki: **wiki unchanged** — żadna strona (w tym
  `ui-navigation-and-onboarding.md`) nie dokumentowała presetów zakresu,
  poziomów zoomu ani układu filtrów osi czasu; jedyna wzmianka o
  TimelinePage (lista wykluczenia szkiców w `state-and-persistence.md`)
  pozostaje aktualna.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Szerokości dnia (160/64/30 px) to strojenie wizualne — w razie potrzeby
  dopasowania do węższych viewportów zmienia się je w stałych
  `timelineZoom.ts`; widok przewija się poziomo jak dotychczas.
- Usunięcie chipa „Osoby" w panelu czyści cały zbiór zaznaczonych osób
  (semantyka chipa zagregowanego — spójna z licznikiem filtrów).
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260722-135851-n2hub-254-timeline-zoom-filters`
- Prompt: `254-timeline-zoom-filters.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `2a379114d04bb26da403c549266b714bacca323d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `2a379114d04bb26da403c549266b714bacca323d`
- Gałąź review: `review-integration`
- Run: `20260722-135851-n2hub-254-timeline-zoom-filters`

### Pliki zgłoszone do review

- `src/components/FilterPanel.tsx`
- `src/pages/TimelinePage.tsx`
- `src/styles.css`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `handoffs/scheduler-reviews/20260722-135851-n2hub-254-timeline-zoom-filters.md`
- `src/pages/timelineZoom.test.ts`
- `src/pages/timelineZoom.ts`
