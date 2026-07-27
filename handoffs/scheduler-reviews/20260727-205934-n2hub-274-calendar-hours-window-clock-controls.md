# Raport workflow: 20260727-205934-n2hub-274-calendar-hours-window-clock-controls

## Wykonane

Analiza stanu wyjściowego: wszystkie trzy zgłoszenia były nadal aktualne w
bieżącym worktree — siatka otwierała się na 08:00 (`SCROLL_TO_MIN`), plakietka
daty/zegara wisiała jako absolutny narożnik NAD siatką (`.week-now-badge`,
`z-index: 40`), a nad kalendarzem stały trzy osobne wiersze (`page-head` z H1,
`cal-toolbar`, `filter-toolbar`). Żadnego z punktów nie pominąłem.

1. **Domyślne okno 9–17.** Nowy czysty moduł `src/components/weekViewLayout.ts`
   z nazwanymi stałymi `WORK_START_HOUR = 9` / `WORK_END_HOUR = 17` (plus
   `AXIS_LABEL_LEAD_PX`, żeby wyśrodkowana etykieta „9:00” nie była przycięta
   górną krawędzią). WeekView otwiera siatkę na `workWindowScrollTop(HOUR_PX)`
   (748 px), a granice okna jadą do CSS jako zmienne `--week-work-top` /
   `--week-work-bottom` ustawiane inline na `.week-days-grid`. Przygaszenie
   slotów poza 9–17 to dodatkowa warstwa `linear-gradient` w tle
   `.week-day-col` (`--week-offhours-tint`) — **bez nowych węzłów DOM**, bez
   `pointer-events`, bez z-index — plus wyblakłe etykiety godzin na osi
   (`.week-axis-label.off-hours`). Sloty poza oknem działają normalnie:
   snapowanie, kolizje, drag/resize, dane i reducer są nietknięte. Zmiana
   wartości stałych przesuwa jednocześnie przewinięcie, przygaszenie i oś.
2. **Zegar poza siatką.** Plakietka „data + HH:mm” wyprowadzona z WeekView do
   nowego `src/components/NowClockBadge.tsx`, renderowanego w pasku sterowania
   kalendarza (`.cal-now-badge`) — czyli poza `.week-cal`, więc niczego już nie
   zasłania. Takt 30 s żyje we wspólnym haku `src/utils/useNowTick.ts`
   (`NOW_TICK_MS = 30_000`), z którego korzysta też WeekView do linii „teraz”;
   sama `.week-now-line` i jej pozycjonowanie są bez zmian. Na ekranach ≤760 px
   plakietka pokazuje sam zegar (pełna polska data zabierałaby cały wiersz).
3. **Kontrolki wyżej → wyższy kalendarz.** `CalendarPage` scala trzy wiersze w
   JEDEN `.cal-toolbar` (kotwica onboardingu `calendar.toolbar` zostaje):
   tytuł „Kalendarz” + przełącznik Tydzień/Miesiąc + nawigacja z zakresem dat +
   `FilterBar` („Filtry” z sekcją Osoby oraz aktywne chipy) + zegar na końcu.
   Zmiana jest wyłącznie układowa — żaden props ani handler filtrowania się nie
   zmienił. Odzyskaną przestrzeń zabiera siatka: `.week-main` ma teraz
   `max-height: max(70dvh, calc(100dvh - 168px))`, więc przy oknie 900 px rośnie
   z 630 px do 732 px, a na niskich oknach nigdy nie jest niższa niż wcześniej.

Usunięty martwy CSS `.week-now-badge*`; stała `SCROLL_TO_MIN` zastąpiona
funkcją z modułu układu.

## Zmiany

- `src/components/weekViewLayout.ts` (nowy) — czysta geometria okna roboczego.
- `src/components/weekViewLayout.test.ts` (nowy) — 9 testów jednostkowych.
- `src/components/NowClockBadge.tsx` (nowy) — plakietka daty/zegara w pasku.
- `src/utils/useNowTick.ts` (nowy) — wspólny takt zegara 30 s.
- `src/components/WeekView.tsx` — przewinięcie na 9:00, zmienne CSS okna,
  przygaszone etykiety osi, usunięta narożna plakietka, hak `useNowTick`.
- `src/pages/CalendarPage.tsx` — jeden wiersz sterowania + `NowClockBadge`.
- `src/styles.css` — tint okna roboczego, `.cal-title`/`.cal-now-badge`,
  scalony `.cal-toolbar`, wyższy `.week-main`, mobilne dostrojenie.
- `openwiki/n2hub/scheduling-and-calendar.md` — nowa granica (moduł układu),
  zapis, że okno robocze jest wyłącznie prezentacyjne, nowa ścieżka testowa.

## Weryfikacja

- `npm test`: **68 plików / 1549 testów zielonych** (w tym 9 nowych w
  `weekViewLayout.test.ts`: domyślne przewinięcie, skalowanie z `hourPx`,
  odporność na NaN/0/ujemne/Infinity, granice tintu w dobie, klasyfikacja
  godzin osi, zmienne CSS). Zero regresji względem stanu wejściowego.
- `npm run build` (`tsc --noEmit && vite build`): zielony.
- `npm run check:openwiki`: „Validated 6 wiki files.”
- Ręczna weryfikacja w przeglądarce (Playwright, dev server, dane przykładowe,
  1440×900): `scrollTop` siatki i osi = 748 (9:00 na górze, etykieta czytelna);
  `.week-day-col` ma 3 warstwy tła, tint z twardymi stopami 756 px / 1428 px;
  `.week-now-badge` nie istnieje, `.cal-now-badge` renderuje „poniedziałek, 27
  lipca 21:09” i **nie zachodzi** na `.week-cal`; nad siatką jest dokładnie
  jeden wiersz kontrolek; wysokość `.week-main` 732 px (było 630 px); linia
  „teraz” nadal obecna; 16 przygaszonych etykiet osi (0–8 i 17–23).
- Smoke dragu (nie zmieniałem ścieżek wskaźnika, ale obszar jest wrażliwy):
  przeciągnięcie bloku o +84 px zmieniło „Pakiet kreacji do premiery”
  z 14:00–16:00 na 15:00–17:00 — snapowanie i zapis działają jak dotąd.
  Popover „Filtry” otwiera się z sekcją Osoby; widok mobilny 390×760 zawija
  pasek poprawnie (zegar bez daty).
- Skryptów `scripts/browser-check-*.mjs` NIE uruchomiłem — `playwright` nie
  jest zależnością repo i nie ma go w `node_modules` tego worktree; pełną
  matrycę przeglądarkową i tak posiada weryfikacja wydania.

## Ryzyka / rzeczy do sprawdzenia

- Przygaszenie jest warstwą `background-image` na `.week-day-col` korzystającą
  ze zmiennych CSS. Zmienne mają wartości domyślne (`var(--week-work-top, 0px)`),
  więc nawet ich brak nie unieważnia właściwości i linie godzin/kwadransów
  pozostają. Sprawdzone w Chromium; WebKit warto obejrzeć przy weryfikacji
  wydania (składnia gradientu jest w pełni standardowa).
- `max-height: max(70dvh, calc(100dvh - 168px))` zakłada JEDEN wiersz kontrolek
  nad siatką. Gdy pasek zawinie się na wąskim ekranie, kalendarz może wystawać
  nieco poniżej krawędzi okna i strona się przewinie — tak jak przed zmianą;
  dolna granica 70dvh gwarantuje, że nigdy nie jest niżej niż dotychczas.
- Zegar tyka teraz w dwóch miejscach (linia „teraz” w WeekView i plakietka),
  czyli dwa interwały 30 s zamiast jednego. Koszt pomijalny, semantyka ta sama.
- Nie zmieniałem pointer-dragu, snapowania, kolizji, reducera ani danych;
  inwariant 6 (ta sama referencja stanu dla niepoprawnego ładunku) nie był
  dotykany — cała zmiana jest prezentacyjno-układowa. Tryb wygaszania
  (retirement) pozostaje wyłączony, brak nowych zależności runtime.

## Podpis schedulera

- Run: `20260727-205934-n2hub-274-calendar-hours-window-clock-controls`
- Prompt: `274-calendar-hours-window-clock-controls.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `813c37b9831c73528719d59c20967788ba5c46a5`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `813c37b9831c73528719d59c20967788ba5c46a5`
- Gałąź review: `review-integration`
- Run: `20260727-205934-n2hub-274-calendar-hours-window-clock-controls`

### Pliki zgłoszone do review

- `openwiki/n2hub/scheduling-and-calendar.md`
- `src/components/WeekView.tsx`
- `src/pages/CalendarPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260727-205934-n2hub-274-calendar-hours-window-clock-controls.md`
- `src/components/NowClockBadge.tsx`
- `src/components/weekViewLayout.test.ts`
- `src/components/weekViewLayout.ts`
- `src/utils/useNowTick.ts`
