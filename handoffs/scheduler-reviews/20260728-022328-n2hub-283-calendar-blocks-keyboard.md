# Raport workflow: 20260728-022328-n2hub-283-calendar-blocks-keyboard

## Wykonane

Najpierw analiza, czy zadanie jest nadal aktualne w bieżącym buildzie: **było**.
Bloki `.week-block` obsługiwały wyłącznie Enter/Space (otwarcie zadania), w całym
kalendarzu nie istniał żaden region `aria-live`, `blockRowLabel` był domknięciem
prywatnym dla `TaskModal.tsx`, a `MonthView` renderował płaską listę
`<button className="month-cell">` bez `role="grid"`, roving tabindex i nawigacji
klawiaturą. Zadanie zostało więc wykonane w całości.

Praca przeszła przez workflow tierowy: `developer → reviewer` (ryzyko wysokie —
zmiana leży w `WeekView.tsx`, właścicielu cyklu życia wskaźnika kalendarza,
inwariant 7).

### Nowe moduły czyste (bez Reacta, bez store'u — wzorzec `kanbanMove.ts`)

- `src/components/calendarBlockKeyboard.ts` — automat etapowanej edycji
  klawiaturowej (`blockKeyboardReducer`, `blockKeyboardCommit`,
  `findBlockConflict`) plus 10 polskich budowniczych komunikatów. Projekcja
  przechodzi przez te same bramki co upuszczenie wskaźnikiem: `snapToStep`,
  `clampBlockStart`, granica doby, limit `maxHours`. Intencja commitu to
  dokładnie ładunek `SET_BLOCK_TIME`; kolizja lub brak zmiany zwraca `null`
  (brak dispatchu). Zdarzenie bez skutku zwraca TĘ SAMĄ referencję stanu.
- `src/components/monthGrid.ts` — czysta matematyka nawigacji siatki miesiąca
  (`monthGridCommand`, `monthFocusIndex`, `monthGridRows`, `monthCellName`).
- `src/utils/blockLabel.ts` — jedno zdanie opisujące blok; `blockRowLabel`
  wyniesiony z `TaskModal.tsx` bez zmiany brzmienia.

### Zmiany w istniejących plikach

- `src/components/WeekView.tsx` — wyłącznie **addytywnie**: sekcja klawiaturowa
  dopisana ZA `finish`, region `sr-only role="status" aria-live="polite"`,
  pełny `aria-label` kafelka z `blockLabel`, przycisk „Przenieś do zasobnika"
  jako **rodzeństwo** kafelka (potomkowie `role="button"` są prezentacyjni, więc
  zagnieżdżony przycisk nie zostałby ogłoszony); przycisk jest przycięty do
  1×1 px z `pointer-events: none` do czasu `:focus`, więc nie wchodzi w żadną
  ścieżkę wskaźnika. Keydown jest ignorowany, gdy `dragRef.current !== null`.
- `src/components/MonthView.tsx` — `role="grid"`, wiersz `columnheader`,
  `.month-grid` jako `rowgroup`, wiersze `.month-week-row` i komórki
  `.month-cell-slot` przez `display: contents` (układ CSS grid bez zmian),
  roving tabindex kluczowany **datą** (przeżywa zmianę miesiąca), nazwa komórki
  z `monthCellName`, znaczniki 🎂/⟳/📅 `aria-hidden` z treścią wtopioną w nazwę
  (bez podwójnego odczytu).
- `src/pages/CalendarPage.tsx` — wyniesione `onShiftMonth`/`onShiftYear`
  (rok = `shiftMonth(a, delta*12)`, bez nowej matematyki dat);
  `.cal-range-label` dostaje `id` + `role="status" aria-live="polite"`.
- `src/utils/dates.ts` — `dayMonthLabel` („30 lipca").
- `src/styles.css` — reguły addytywne (`.week-block.kb-editing`,
  `.week-block-bin-btn`, `.month-week-row`/`.month-cell-slot`).

### Rozstrzygnięcia projektowe

- **Kolizja Enter**: Enter/Space otwiera zadanie TYLKO gdy nic nie jest
  etapowane; po pierwszej strzałce Enter/Space **zatwierdza** edycję, Escape
  cofa ją w całości bez dispatchu. Utrata fokusu poza parę (kafelek + jego
  przycisk zasobnika) też zatwierdza, więc edycja nigdy nie ginie po cichu.
- **Ścieżki wskaźnika nietknięte**: `begin`, `startDrag`, `projectMove`,
  `finish`, `cancelDrag`, `releaseCapture`, nasłuchy okna zasobnika i bramka
  dotykowa są bajtowo bez zmian. Jedyne usunięte linie to cztery pochodne
  renderu (`start`/`hours`/`dayShift`/`tx`), dwa wpisy `className` i stary
  inline'owy `onKeyDown`.

## Zmiany

Nowe pliki: `src/components/calendarBlockKeyboard.ts` (+ `.test.ts`),
`src/components/monthGrid.ts` (+ `.test.ts`), `src/utils/blockLabel.ts`
(+ `.test.ts`) — 905 linii.
Zmodyfikowane: `src/components/WeekView.tsx`, `src/components/MonthView.tsx`,
`src/components/TaskModal.tsx`, `src/pages/CalendarPage.tsx`,
`src/utils/dates.ts`, `src/styles.css`, `openwiki/n2hub/scheduling-and-calendar.md`,
`handoffs/RUN-STATE.md` — 706 wstawień / 136 usunięć.

Bez zmian w `src/store/`. Brak nowej akcji reduktora, brak nowej zależności
runtime, tryb wygaszania nadal wyłączony.

## Weryfikacja

- Testy jednostkowe skupione: `blockLabel.test.ts` 6 ✓,
  `calendarBlockKeyboard.test.ts` 23 ✓, `monthGrid.test.ts` 13 ✓.
  Pokrycie automatu: kumulacja etapowania, ograniczenia doby/północy, brak
  zawijania na krawędziach, limit `maxHours` z `atCap`, **parzystość kolizji
  sprawdzana wprost względem `hasCollision`**, anulowanie, commit bez zmiany.
- `npm test`: **78 plików / 1789 testów — wszystkie zielone**
  (baza przed zmianą: 75 plików / 1747 testów; zero regresji, +42 nowe testy).
- `npm run build` (`tsc --noEmit && vite build`): zielony (tylko istniejące
  wcześniej ostrzeżenie o rozmiarze chunku).
- Checki przeglądarkowe: **nie uruchamiano** — żadna interakcja wskaźnika objęta
  tymi skryptami się nie zmieniła. Deweloper dodatkowo sprawdził, że nowe
  `aria-label`/`aria-describedby` na `.week-block` nie psują odczytu w
  `browser-check-onboarding.mjs` ani asercji Space w `browser-check-ui-keyboard.mjs`.
- **Review (tier `reviewer`)**: werdykt **approved-with-nits, zero blokerów**.
  Inwarianty 1/2/3/6/7 potwierdzone jako utrzymane, inwariant 7 przez diff
  `WeekView.tsx` linia po linii. Wszystkie 5 punktów zadania spełnione.
  Recenzent samodzielnie potwierdził wynik gate'u.
- Dwie uwagi recenzenta dotykające wprost kryteriów akceptacji zostały odesłane
  do dewelopera i **naprawione**: (1) `role="gridcell"` siedział na samym
  `<button>` i nadpisywał niejawną rolę przycisku — teraz komórka to osobny
  węzeł `.month-cell-slot` ZAWIERAJĄCY przycisk; (2) blur kafelka zatwierdzał
  zbędny `SET_BLOCK_TIME` przy przejściu fokusu na własny przycisk zasobnika —
  teraz kafelek i przycisk są jedną jednostką fokusu (`kbFocusStays`).
  Gate przebiegnięty ponownie po poprawkach: 78/1789 ✓, build ✓.

## Ryzyka / rzeczy do sprawdzenia

- **Świadome odstępstwa od dosłownego brzmienia promptu** (zaakceptowane przez
  recenzenta): nazwa komórki brzmi „30 lipca, 6 zaplanowanych godzin, 2 osoby"
  zamiast „6 h zaplanowane" — poprawna polska deklinacja przez
  `polishAmount`/`polishCount`. Komunikat kolizji nazywa kolidujący **blok
  zadania** („Koliduje z „Montaż filmu" 12:00–13:00"), nie „spotkaniem": kolizje
  tej samej osoby z definicji nie obejmują wydarzeń (są prezentacyjne i poza
  `hasCollision`), więc przykład z promptu opisywał stan niemożliwy.
- **Commit z klawiatury nie uzbraja animacji zlania** (`setFusedId`). Reduktor
  scala identycznie — różnica jest wyłącznie animacyjna. Odłożone świadomie.
- **Ciche no-opy na krawędziach**: na granicy siatki/doby reduktor zwraca tę samą
  referencję i nic nie jest ogłaszane. Zgodne z praktyką APG, ale krótki
  komunikat „krawędź" byłby przyjaźniejszy dla czytnika ekranu.
- **Strzałki w siatce miesiąca** mogą wejść na komórki sąsiedniego miesiąca bez
  zmiany wyświetlanego miesiąca (miesiąc zmieniają tylko PageUp/PageDown) —
  celowe i zgodne z APG, udokumentowane w module.
- `.week-block-bin-btn:focus` przywraca `pointer-events`, więc w tym oknie myszą
  da się w niego kliknąć — akcja jest ta sama, więc bez skutku.
- Brak przebiegu przeglądarkowego dla nowych ścieżek klawiaturowych: pokrycie
  jest jednostkowe (moduły czyste) plus review strukturalne. Warstwa React/DOM
  (routing fokusu, drzewo ARIA) nie ma testów automatycznych — świadomie, bo
  projekt nie ma infrastruktury do testów DOM.
- Codex review: **pominięty** — w tym worktree nie ma `scripts/codex-review.sh`
  ani `automation/claude-scheduler/`, więc maszyneria schedulera do niezależnego
  review jest nieobecna. Zastąpione pełnym przebiegiem tieru `reviewer`.

## Wiki

`wiki updated` — `openwiki/n2hub/scheduling-and-calendar.md` zaktualizowane.
Uzasadnienie (decyzja recenzenta): strona deklarowała „Keyboard-activatable week
blocks and bin cards respond to both Enter and Space", co po tej zmianie jest
nieprawdą, a sekcje „Boundaries" i „Relevant tests and checks" nie znały trzech
nowych modułów czystych ani ich testów. Wpis rejestruje też wejście klawiatury w
ten sam model dragu (w tym decyzje o commicie na blur i braku animacji zlania)
oraz semantykę siatki APG.

## Podpis schedulera

- Run: `20260728-022328-n2hub-283-calendar-blocks-keyboard`
- Prompt: `283-calendar-blocks-keyboard.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `dcf6004363e1ac003cb4f8b81985dd8e79084847`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `dcf6004363e1ac003cb4f8b81985dd8e79084847`
- Gałąź review: `review-integration`
- Run: `20260728-022328-n2hub-283-calendar-blocks-keyboard`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `src/components/MonthView.tsx`
- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/pages/CalendarPage.tsx`
- `src/styles.css`
- `src/utils/dates.ts`
- `handoffs/scheduler-reviews/20260728-022328-n2hub-283-calendar-blocks-keyboard.md`
- `src/components/calendarBlockKeyboard.test.ts`
- `src/components/calendarBlockKeyboard.ts`
- `src/components/monthGrid.test.ts`
- `src/components/monthGrid.ts`
- `src/utils/blockLabel.test.ts`
- `src/utils/blockLabel.ts`
