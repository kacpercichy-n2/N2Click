# Raport workflow: 20260728-103722-n2hub-299-calendar-toolbar-and-done-tick

## Wykonane

Obie pozycje z kolejki były nadal aktualne w bieżącym kodzie `review-integration`
(plakietka daty/zegara odjeżdżała na prawo przez `margin-left: auto`, ✓ stało w
prawym GÓRNYM rogu kafelka). Obie naprawione. Zmiany czysto prezentacyjne —
bez dotykania reduktorów, modelu przeciągania, snapowania i kolizji.

**1. Układ paska sterowania kalendarza (`CalendarPage.tsx`, `styles.css`)**

- Pasek desktopowy ma teraz DWIE grupy i nic pomiędzy nimi:
  - `.cal-toolbar-lead` przy lewej krawędzi — zwarta trójka (gap 8 px):
    tytuł „Kalendarz” · przełącznik Tydzień/Miesiąc · plakietka daty/zegara
    (`NowClockBadge`) zaraz obok nich;
  - `.cal-toolbar-trail` przy prawej — „Filtry”, a skrajnie po prawej nawigacja
    okresu.
  - Wolna przestrzeń zostaje w ŚRODKU paska (`margin-right: auto` na lewej
    grupie — nie ruszałem `justify-content` na współdzielonej `.cal-toolbar`,
    bo tej klasy używają też Obciążenie i Oś czasu).
- `.cal-now-badge` straciła `margin-left: auto` (to był źródłowy powód widocznej
  przerwy między tytułem a plakietką).
- `.cal-toolbar .filter-toolbar` przestał rozpychać się na całą wolną szerokość
  (`flex: 1 1 auto` → `flex: 0 1 auto`), więc „Filtry” stoją bezpośrednio na
  lewo od nawigacji.
- Etykieta okresu (`.cal-range-label`, jednocześnie `role="status"` i
  `aria-labelledby` siatki miesiąca) przeniesiona na POCZĄTEK `.cal-nav`, żeby
  same strzałki + „Dzisiaj” kończyły się na skrajnie prawej krawędzi
  interfejsu. `id`/`role`/`aria-live` bez zmian, kolejność DOM = kolejność
  wizualna.
- Zachowane z runu 274: jeden wiersz, wyższa siatka, kotwica onboardingu
  `calendar.toolbar` na tym samym elemencie, wariant telefonowy (≤760 px:
  ‹ · zakres · › · Filtry) — gałąź `cal-toolbar-phone` nietknięta.

**2. Znacznik ✓ w prawym DOLNYM rogu kafelka (`WeekView.tsx`,
`weekViewLayout.ts`, `styles.css`)**

- Interaktywny przycisk z runu 286 (`.week-block-done-btn`, rodzeństwo kafelka)
  liczy `top` nową czystą funkcją `doneTickTopPx(top, height)` z
  `weekViewLayout.ts`: dół kafelka − 20 px wysokości ✓ − 8 px prześwitu
  (6 px uchwytu `.week-block-handle.bottom` + 2 px luzu). Poziom bez zmian
  (prawa krawędź kolumny, a w widoku dnia krawędź kaskady). Zachowanie bez
  zmian: hover/fokus/dotyk, `aria-pressed`, `stopPropagation` na `pointerdown`,
  domykanie wystawionej edycji klawiaturowej przez `onBlur`.
- Bierne znaczniki przeniesione z wiersza tytułu do narożnika jako
  `.block-done-mark.corner` (absolut, `right: 6px`, `bottom: 8px`,
  `pointer-events: none`): kafelek bez prawa edycji oraz wystąpienie cykliczne.
- Kafelki o minimalnej wysokości (50 px) rezerwują 22 px w ostatnim wierszu
  treści (`.week-block.has-done-tick .week-block-meta`,
  `.week-recur-block.done .week-recur-time`), więc godziny nie chowają się pod
  ✓. Nowa klasa `has-done-tick` wchodzi wyłącznie przy `entry.done === true`
  (nie przy szerszym statusie „zrobione” zadania), więc rezerwa nie pojawia się
  tam, gdzie znacznika nie ma.
- Karta zasobnika (`.week-bin-block`) zostaje przy dotychczasowym znaczniku w
  wierszu tytułu — nie jest kaflem kalendarza i nie ma pustego dołu.

## Zmiany

- `src/pages/CalendarPage.tsx` — dwie grupy paska, przeniesienie plakietki i
  etykiety okresu.
- `src/components/WeekView.tsx` — ✓ w dolnym rogu (przycisk + oba bierne
  znaczniki), klasa `has-done-tick`.
- `src/components/weekViewLayout.ts` — `doneTickTopPx`, `DONE_TICK_SIZE_PX`,
  `DONE_TICK_BOTTOM_PX`.
- `src/components/weekViewLayout.test.ts` — 4 nowe testy geometrii ✓.
- `src/styles.css` — `.cal-toolbar-lead/-trail`, `.cal-now-badge`,
  `.cal-toolbar .filter-toolbar`, `.week-block-done-btn`,
  `.block-done-mark.corner`, rezerwy miejsca w ostatnim wierszu treści.
- `openwiki/n2hub/scheduling-and-calendar.md` — nowy punkt o rogu ✓ i o lustrze
  stałej `DONE_TICK_BOTTOM_PX` w CSS (nowa zależność TS↔CSS w obszarze
  wrażliwym na stabilność).

## Weryfikacja

- `npm test` — 101 plików, 2119 testów, wszystko zielone (w tym 4 nowe testy
  `doneTickTopPx`: róg dolny zamiast górnego, pełna odsłona dolnego uchwytu,
  utrzymanie ✓ wewnątrz najniższego kafelka, brak NaN przy złej geometrii).
- `npm run build` (`tsc --noEmit` + `vite build`) — zielony.
- `npm run check:openwiki` — 6 plików wiki zwalidowanych.
- Przegląd w przeglądarce (Playwright, dev server, dane przykładowe):
  - 1440 px: pasek czyta się „Kalendarz · Tydzień/Miesiąc · wtorek, 28 lipca
    10:46 …… Filtry · 27 lip–2 sie 2026 ‹ Dzisiaj ›” — lewa grupa zwarta, wolne
    miejsce w środku, nawigacja przy prawej krawędzi;
  - 1100 px i 390 px (telefon): brak regresji układu, rząd telefonowy bez zmian;
  - pomiar DOM na kaflu 4 h: ✓ przy prawej krawędzi (delta 0 px), 8 px nad dołem
    kafelka, dolna krawędź ✓ ponad górną krawędzią uchwytu zmiany rozmiaru
    (brak nachodzenia), `elementFromPoint` w środku ✓ trafia w przycisk;
  - kliknięcie ✓ przestawiło blok na „wykonane” (`aria-pressed=true`, nazwa
    dostępna „…, wykonane”), znacznik został widoczny w dolnym rogu i nie
    zasłania treści kafelka;
  - sonda CSS dla wariantu cyklicznego: `.block-done-mark.corner` renderuje się
    w prawym dolnym rogu wewnątrz kafelka, `pointer-events: none`, rezerwa
    22 px w wierszu czasu.

## Ryzyka / rzeczy do sprawdzenia

- Wysokość ✓ (20 px) i prześwit 8 px żyją w DWÓCH miejscach: `weekViewLayout.ts`
  (stałe + `doneTickTopPx`) oraz `styles.css` (`.week-block-done-btn`,
  `.block-done-mark.corner`). Rozjazd tych wartości przesunąłby znacznik na
  uchwyt zmiany rozmiaru; zależność opisana w komentarzach po obu stronach i w
  wiki.
- Na kaflu, który NIE jest odhaczony, ✓ pojawiające się na hover może przez
  moment przykryć prawy koniec wiersza „osoba · godziny” na najniższych
  kafelkach (50 px). Rezerwa miejsca wchodzi dopiero dla kafelków faktycznie
  odhaczonych — świadomy kompromis, żeby najazd myszą nie przesuwał treści.
- Wariant kafelka bez prawa edycji (`readonly`) i wystąpienie cykliczne z ✓ nie
  wystąpiły w danych przykładowych, więc sprawdziłem je sondą CSS w żywym DOM,
  a nie pełnym scenariuszem aplikacji. Logika renderu tych znaczników jest
  niezmieniona — zmienił się wyłącznie rodzic i klasa pozycjonująca.
- Przeglądarkowa macierz regresyjna (`npm run check:browser-release`) nie była
  uruchamiana — należy do weryfikacji wydania; zmiany nie dotykają ścieżek
  wskaźnika ani reduktorów objętych tymi scenariuszami.
- Nie dopisywałem wpisu do changeloga — prompt tego nie obejmował, a istniejący
  wpis o pasku sterowania z runu 274 pozostaje prawdziwy.

## Podpis schedulera

- Run: `20260728-103722-n2hub-299-calendar-toolbar-and-done-tick`
- Prompt: `299-calendar-toolbar-and-done-tick.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `74cfb752226caa959deba322d67817bfcab71b7d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `74cfb752226caa959deba322d67817bfcab71b7d`
- Gałąź review: `review-integration`
- Run: `20260728-103722-n2hub-299-calendar-toolbar-and-done-tick`

### Pliki zgłoszone do review

- `openwiki/n2hub/scheduling-and-calendar.md`
- `src/components/WeekView.tsx`
- `src/components/weekViewLayout.test.ts`
- `src/components/weekViewLayout.ts`
- `src/pages/CalendarPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-103722-n2hub-299-calendar-toolbar-and-done-tick.md`
