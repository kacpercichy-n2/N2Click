# Raport workflow: 20260720-235620-229-task-status-on-calendar-blocks

## Wykonane

Najpierw sprawdziłem bieżący build: bloki `WeekView` nie miały żadnego
oznaczenia statusu zadania (klasy to wyłącznie stany dragu/kolizji/scalania),
a jedyny „overdue” w aplikacji żył w `TimelinePage` i selektorach „Mojej
pracy”. Zadanie było więc nadal aktualne i zostało zaimplementowane.

- `src/store/selectors.ts`: nowy, czysty selektor `taskDisplayStatus(state,
  task, today)` zwracający `'done' | 'overdue' | 'open'`. `done` pochodzi
  wyłącznie z `isDoneStatus` (niezmiennik 5 — kolejność w pipeline i
  archiwizacja statusu niczego nie zmieniają), `overdue` to `endDate < today`
  przy statusie nie-zrobionym. Bez `Date.now()` w środku — `today` jest
  parametrem, tak jak w `overdueTasksForPerson`.
- `src/components/WeekView.tsx`: `TimedBlock` i `BinCard` (wraz z portalowym
  duchem karty zasobnika) dokładają modyfikatory `done` / `overdue` do
  istniejącej listy klas. Tooltipy dostały polski dopisek — „Zadanie
  zakończone.” albo „Zadanie po terminie (termin: 1 lip 2026).” — doklejony do
  każdego wariantu tytułu; przy limicie zasobnika (`at-cap`) tooltip pozostał
  bez zmian.
- `src/styles.css`: `.week-block.done` / `.week-bin-block.done` dostają
  ciemnozielone, nieprzezroczyste tło i zielonkawą ramkę, `.overdue` —
  ciemnoczerwone tło i ramkę `--n2-danger`. Kolor osoby zostaje na lewej
  krawędzi, bo pochodzi ze stylu inline (nie nadpisuję `border-left-color`).
  Warianty `:hover` mają `:not(.colliding):not(.to-bin)`, żeby nie przebić
  specyficznością stanów dragu; reguły `dragging` / `colliding` / `to-bin` /
  `will-merge` stoją w pliku niżej i nadal wygrywają.
- Kod wskaźników/dragu (pointer, capture, listenery okna, hit-testing) nie
  został tknięty — zmiana jest wyłącznie prezentacyjna (niezmiennik 7).

## Zmiany

- `src/store/selectors.ts` — selektor `taskDisplayStatus`.
- `src/components/WeekView.tsx` — klasy statusu na blokach i kartach zasobnika,
  polskie dopiski w tooltipach, helper `statusNoteFor`.
- `src/styles.css` — modyfikatory `.done` / `.overdue` dla bloków i kart.
- `src/store/selectors.test.ts` — 7 nowych testów `taskDisplayStatus`.
- `reviews/screenshots-20260709-codex/*.png` — nadpisane przez uruchomienie
  `browser-check-bin-drag.mjs` (to samo zachowanie co w runie 228).
- Zrzut ekranu z nowymi statusami zapisałem w
  `reviews/screenshots-20260721-229/kalendarz-statusy-blokow.png`, ale katalog
  `reviews/` jest w `.gitignore`, więc plik NIE trafi do commita — istnieje
  tylko lokalnie w worktree runu.

## Weryfikacja

- `npm test`: PASS — 37 plików, 1005 testów (w tym 7 nowych dla
  `taskDisplayStatus`: status done mimo przeszłego terminu, archiwalny status
  done, `endDate < dziś`, `endDate == dziś` jako „open”, przyszły termin,
  nieznany `statusId`, niezależność od kolejności w pipeline). Uwaga: liczba
  933 z promptu była nieaktualna — baza `5ed5a42` miała już 998 testów.
- `npm run build`: PASS (2631 modułów, brak błędów TS).
- `node scripts/browser-check-bin-drag.mjs chromium`: **PASS** na dev serverze
  w trybie lokalnym (`heartbeatAlive`, `evalResponsive`, `modalOpensAfterDrop`
  = true, `consoleErrors` i `pageErrors` puste, `maxUpdateDepth` = false).
  Playwright nie jest zależnością tego repo — na czas checku podlinkowałem go
  symlinkiem z głównego klona i po uruchomieniu symlinki usunąłem; drzewo Git
  jest czyste.
- Wizualnie (zrzut ekranu): w zasianych danych przykładowych bloki zadania w
  statusie done renderują się na zielono, zadanie z przeszłym `endDate` w
  statusie aktywnym — na czerwono, etykiety (tytuł, godziny, osoba) pozostają
  czytelne w obu wariantach, a kropka i lewa krawędź nadal niosą kolor osoby.

## Ryzyka / rzeczy do sprawdzenia

- Blok „po terminie” i blok w kolizji podczas dragu używają tej samej barwy
  ramki (`--n2-danger`); różni je tło (kolizja ma jaśniejszy `danger-soft` i
  kursor `not-allowed`), więc stany są rozróżnialne, ale to najbliższa sobie
  para kolorów w widoku.
- Status liczony jest z `todayStr()` przy renderze — otwarty przez dobę widok
  nie przemaluje bloku o północy bez ponownego renderu. Ta sama charakterystyka
  co istniejące oznaczenia terminów w aplikacji.
- Wiki bez zmian: `openwiki/n2hub/scheduling-and-calendar.md` opisuje granice,
  model godzin i cykl dragu — zmiana jest czysto prezentacyjna, nie rusza
  żadnej z opisanych granic ani tras testowych.

## Podpis schedulera

- Run: `20260720-235620-229-task-status-on-calendar-blocks`
- Prompt: `229-task-status-on-calendar-blocks.md`
- Gałąź review: `review-integration`
- Baza: `5ed5a428bc02b6ec55cc6d78fb5bcf4596803479`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `5ed5a428bc02b6ec55cc6d78fb5bcf4596803479`
- Gałąź review: `review-integration`
- Run: `20260720-235620-229-task-status-on-calendar-blocks`

### Pliki zgłoszone do review

- `reviews/screenshots-20260709-codex/chromium-01-before-drag.png`
- `reviews/screenshots-20260709-codex/chromium-02-during-drag.png`
- `reviews/screenshots-20260709-codex/chromium-03-after-drop.png`
- `src/components/WeekView.tsx`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260720-235620-229-task-status-on-calendar-blocks.md`
