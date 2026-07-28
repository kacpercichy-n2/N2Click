# Raport workflow: 20260728-090817-n2hub-297-workload-cell-popover

## Wykonane

Najpierw sprawdziłem bieżący kod: zadanie było nadal aktualne. Komórka dnia
otwierała wprawdzie panel, ale był to **wiersz rozwijany w tabeli**
(`tr.workload-detail-row` / `.wr-panel`) bez godzin bloków i bez skoku do
kalendarza, a jedno `danger` (`pct === null || pct > 100 || overloadedDays > 0`)
sterowało JEDNOCZEŚNIE kolorem paska, kolorem procentu i podpisem „⚠ N dni”.
Na przykładowych danych dawało to dokładnie sytuację z audytu: Ola 84% —
fioletowy pasek, Marek 75% — czerwony.

**1. Popover komórki (`WorkloadPage.tsx`)**

- Kliknięcie (albo Enter/spacja) na komórce otwiera `.wr-popover` na WSPÓLNEJ
  powłoce nakładek — `useOverlay` + `OverlayLayer`, ten sam prymityw co
  `OverflowMenu`/menu kontekstowe kalendarza. Kotwicą jest sama komórka
  (`triggerRef` = kotwica, więc drugie kliknięcie zamyka, a fokus wraca na
  komórkę), z `closeOnAnchorOutOfView`, bo tabela przewija się poziomo. Zero
  własnych reguł a11y — pozycja z flipem, stos Escape, zamykanie kliknięciem
  poza i powrót fokusa niesie przetestowany `overlayShell.ts`.
- Lista bloków niesie teraz zadanie, projekt · klienta, **zakres godzin**
  („8:00–14:00”) i długość. Dotychczasowe akcje zostały bez zmian (przypisanie
  do innej osoby z pre-walidacją „brak miejsca”, „Otwórz zadanie”, „Przesuń
  całe zadanie ±1 dzień”), doszła stopka **„Otwórz w kalendarzu”**: istniejący
  deep-link `calendarDayTarget(date)` + zapamiętany filtr osób kalendarza
  (`SET_LAST_FILTER` view `calendar`). Żadnego nowego parametru trasy, żadnej
  nowej zależności runtime.
- Wiersz rozwijany, `tr.workload-detail-row` i `Fragment` zniknęły; popover jest
  JEDNĄ instancją na stronę.

**2. Rozdzielone sygnały koloru**

- Nowy czysty `loadTone(pct)` (selectors.ts) → `low | mid | high | over`
  (progi 50 / 85 / >100; `null` = szczyt skali). Pasek dostaje klasę
  `.tone-*` i zależy WYŁĄCZNIE od procentu, więc skala jest monotoniczna.
  `aria-label` paska mówi już tylko o wykorzystaniu.
- „Dzień ponad dostępnością” to osobna ikona `.workload-over-flag`
  (`AlertTriangle`) przy nazwisku, z pełną listą dni w `aria-label`, poza
  linkiem do profilu (nie zaśmieca jego nazwy dostępnej).
- Podpis „⚠ N dni” i klasa `.workload-warn` usunięte — powtarzały czerwoną
  komórkę. Sama czerwona komórka i jej ukryty opis zostają bez zmian.

**3. Selektor + reużycie**

- `workloadCellBlocks` / `workloadCellDetail` (selectors.ts) — nadbudowa nad
  ISTNIEJĄCYMI `blocksForPersonDate` i `dayAvailabilityForPerson`. Sortuje po
  zegarze (potem `sortIndex`), pomija wpisy zasobnika (`date === ''`), rozwiązuje
  tytuł/projekt/klienta i formatuje zakres godzin. Bazowe `blocksForPersonDate`
  ZOSTAJE przy swojej kolejności `sortIndex` (używa jej reduktor i szukanie
  wolnego slotu) — jest na to osobny test.
- Tryb wygaszania niezmieniony, inwariant 6 nietknięty, brak nowych zależności.

**4. Sprzątanie wokół**

- `scripts/browser-check-placement.mjs`: `.wr-panel` → `.wr-popover`, a asercja
  (f2) `.load-pct.over` zastąpiona asercjami na NOWY kontrakt — flaga przy
  nazwisku istnieje i ma opis, pasek NIE jest `tone-over`, `.workload-warn`
  nie istnieje. Bez tego skrypt pilnowałby właśnie tego, co zadanie usuwa.
- `openwiki/n2hub/scheduling-and-calendar.md` — zaktualizowana granica
  (WorkloadPage nie liczy już treści komórki) i nowy punkt „dwa rozdzielone
  sygnały” w sekcji zachowań nienegocjowalnych.

## Zmiany

- `src/store/selectors.ts` — `loadTone` + `workloadCellBlocks` / `workloadCellDetail`.
- `src/store/selectors.test.ts` — 10 nowych testów jednostkowych.
- `src/pages/WorkloadPage.tsx` — popover na powłoce nakładek, rozdzielone sygnały.
- `src/styles.css` — `.wr-popover`, `.wr-foot`, `.wr-block-time`,
  `.workload-over-flag`, skala `.load-bar-fill.tone-*`; usunięte `.wr-panel`,
  `.workload-detail-row`, `.workload-warn`.
- `scripts/browser-check-placement.mjs` — selektory i asercje pod nowy kontrakt.
- `openwiki/n2hub/scheduling-and-calendar.md` — granica + zachowanie.

## Weryfikacja

- `npm test` — **97 plików / 2093 testy, wszystkie zielone**, zero regresji
  (liczby jako stan faktyczny po zmianie, nie oczekiwany).
- Nowe testy `workloadCellBlocks / workloadCellDetail`: kolejność zegarowa
  i zakres „9:00–11:00”, brak wpływu na kolejność `blocksForPersonDate`,
  pominięcie wpisów zasobnika, izolacja osoby i dnia, wartości zastępcze dla
  brakującego zadania/projektu/klienta, zgodność nagłówka z
  `dayAvailabilityForPerson` (w tym suma listy = `bookedHours`) oraz
  przeciążenie w dniu wolnym.
- Nowe testy `loadTone`: progi, `null` jako szczyt skali oraz **monotoniczność
  na całym zakresie 0–150%** (regresja OP-21: 75% nie może wyglądać groźniej
  niż 84%).
- `npm run build` (czyli `tsc --noEmit && vite build`) — zielony.
- `npm run check:openwiki` — 6 plików wiki zwalidowanych.
- Ręczny przebieg w prawdziwej przeglądarce (Playwright MCP, dev server na
  :5173, przykładowe dane): w tygodniu 27.07–02.08 Ola 84% i Marek 75% mają
  teraz TEN SAM stopień skali (`tone-mid`), flaga stoi tylko przy Marku
  („Przekroczona dostępność: śr. 29.07”), `.workload-warn` nie istnieje.
  Popover: otwarcie myszą i Enterem (zakotwiczony pod komórką), przełączenie
  na inną komórkę bez zamykania, Escape zamyka i oddaje fokus komórce,
  „Przenieś” działa i odświeża nagłówek oraz tabelę na żywo, opróżnienie dnia
  zamyka popover, „Otwórz w kalendarzu” przenosi na właściwy tydzień
  (sprawdzone na dniu z innego tygodnia) z filtrem osób ustawionym na tę osobę.
  W konsoli tylko 404 favicony — stan sprzed zmiany.

## Ryzyka / rzeczy do sprawdzenia

- `scripts/browser-check-placement.mjs` zaktualizowałem „na sucho” — w tym
  worktree nie ma pakietu `playwright` (nie jest zależnością projektu), więc
  samego skryptu nie dało się uruchomić. Interakcje, których dotyczy (otwarcie
  panelu komórki, przypisanie do innej osoby, sygnały przeciążenia), przeszły
  ręcznie przez Playwright MCP, ale skrypt warto puścić w macierzy wydania.
- Progi skali (50 / 85) to decyzja produktowa, nie wyliczenie — siedzą w jednym
  miejscu (`LOAD_TONE_MID_PCT` / `LOAD_TONE_HIGH_PCT`) i łatwo je przestawić.
- Wykrywanie przeciążonych dni w wierszu liczy się na godzinach PO filtrach
  (jak dotychczas i jak czerwone komórki), więc filtr klienta/typu usługi może
  ukryć flagę — świadomie zostawione bez zmian, żeby flaga i komórki mówiły to
  samo. Lista w popoverze jest za to zawsze pełna (jest o tym podpowiedź).
- `.workload-person-link` zmienił się z `flex` na `inline-flex`, żeby ikona
  zmieściła się obok linku — zmiana czysto układowa w jednej komórce tabeli.
- „Przesuń na…” zrealizowane ISTNIEJĄCĄ logiką (przypisanie do innej osoby
  z pre-walidacją wolnego slotu + przesunięcie zadania o dzień); nowego wyboru
  daty nie dokładałem — wymagane minimum (lista + nawigacja) jest spełnione,
  a OP-20 zostaje wyłączone zgodnie z poleceniem.

## Podpis schedulera

- Run: `20260728-090817-n2hub-297-workload-cell-popover`
- Prompt: `297-workload-cell-popover.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `733316269d5de5e09294ffc5a14cc5ab53b8f1f9`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `733316269d5de5e09294ffc5a14cc5ab53b8f1f9`
- Gałąź review: `review-integration`
- Run: `20260728-090817-n2hub-297-workload-cell-popover`

### Pliki zgłoszone do review

- `openwiki/n2hub/scheduling-and-calendar.md`
- `scripts/browser-check-placement.mjs`
- `src/pages/WorkloadPage.tsx`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260728-090817-n2hub-297-workload-cell-popover.md`
