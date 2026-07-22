# Raport workflow: 20260722-163416-n2hub-260-perf-weekview-memo

## Wykonane

Workflow tier `developer → reviewer` (problem potwierdzony w bieżącym buildzie:
zero `React.memo` w całym `src/`, skany kolekcji w JSX WeekView per render).

1. **Indeksowany model tygodnia** — nowy czysty moduł
   `src/components/weekViewModel.ts` (bez Reacta): `buildWeekModel(state, days,
   filter)` liczy raz per (stan, tydzień, filtry) wpisy per data, sumy dnia,
   przeciążenia, urodziny, eventy/recurrencje, packing bloków, grupy i sumy
   zasobnika oraz indeks kolizyjny `blocksByPersonDate` (klucz
   `personId + '\u0000' + data`). Model komponuje wyłącznie istniejące selektory, więc
   wynik jest identyczny z dotychczasowymi skanami w JSX. W `WeekView.tsx`
   spięty przez `useMemo(..., [state, days, filter])`; `days` memoizowane po
   `anchor`, `filter` to memoizowany Set z CalendarPage.
2. **Granice `React.memo`** — `TimedBlock`, `BinCard`, `RecurBlock`,
   `EventBlock` owinięte `memo` ze stabilizowanymi propami: callbacki przez
   `useCallback`, a `mergeTargetId`/`fusedId` zamienione na per-blokowe
   booleany `isMergeTarget`/`isFused` — zmiana merge-targetu podczas dragu
   re-renderuje tylko blok ciągnięty + stary/nowy target.
3. **Drag po klatkach** — projekcja pointera zapisywana synchronicznie w
   `dragRef` (bez setState per pointermove); jeden `requestAnimationFrame`
   koalescuje `setDrag` + `setMergeTargetId`; kolizje liczone z indeksu
   tygodniowego zamiast pełnego skanu workloadu. Semantyka commit/cancel
   nietknięta: `finish()` projektuje synchronicznie z pointerup i robi
   `cancelRaf()` przed dispatch; komentarze kontraktowe wokół pointer-capture,
   bramki `buttons===0` i finish() zachowane dosłownie. `cancelRaf()` także w
   `cancelDrag` (Escape/blur/visibility/pointercancel) i w cleanupie unmount.
4. Drag `BinCard` celowo NIE jest throttlowany rAF (window-owned, wrażliwy na
   rendered-column hit-test — invariant 7); dostał jednak kolizje z indeksu
   i granicę memo.

Bez zmian modelu danych, reducerów i architektury store'a. Zmienione pliki:
`src/components/WeekView.tsx` (+252/−172), nowe `src/components/weekViewModel.ts`
i `src/components/weekViewModel.test.ts`.

## Zmiany

- `M src/components/WeekView.tsx` — konsumpcja modelu tygodnia, granice memo,
  rAF w dragu.
- `A src/components/weekViewModel.ts` — czysty indeksowany model tygodnia.
- `A src/components/weekViewModel.test.ts` — 10 testów jednostkowych modelu.

## Weryfikacja

- `npm test`: **1403 passed / 0 failed** (57 plików), w tym 10 nowych testów
  modelu (packing, pomijanie osieroconych wpisów, semantyka filtrów,
  urodziny niezależne od filtra, przeciążenia, grupowanie zasobnika,
  wykluczenie wierszy bin i dat spoza tygodnia z indeksu kolizyjnego) —
  uruchomione niezależnie przez developera i reviewera.
- `npm run build`: zielony (ostrzeżenie o chunku >500 kB — istniejące
  wcześniej, niezwiązane).
- Reviewer (read-only): werdykt **approve**, 0 blokerów. Zweryfikował m.in.
  ekwiwalencję kolizji indeks vs stary skan `blockCollides` (identyczne
  filtrowanie, wykluczenie `entry.id`, indeks budowany ze WSZYSTKICH wierszy
  workloadu — invariant 3 nienaruszony), brak stale-closure w flushu rAF,
  stabilność każdego propa komponentów memo, zachowane komentarze kontraktowe.
- Gate (`npm test && npm run build`): oczekuje na scheduler.
- Wiki: **wiki unchanged** — `scheduling-and-calendar.md` pozostaje aktualne;
  `weekViewModel.ts` to wewnętrzny helper za WeekView, granice i invarianty
  bez zmian (potwierdzone przez reviewera).

## Ryzyka / rzeczy do sprawdzenia

- `openSchedule` to `useCallback([state])` z wyłączonym exhaustive-deps —
  bezpieczne, bo `initScheduleForm` czyta tylko `state`, `todayStr()` i stabilne
  settery; gdyby kiedyś czytał `days`/`filter`, trzeba poszerzyć deps.
- Indeks kolizyjny obejmuje tylko 7 renderowanych dni; obecnie bezpieczne
  (projekcje clampowane do 0..6), ale ewentualny przyszły drag między
  tygodniami wymagałby poszerzenia indeksu.
- Podgląd dragu może opóźniać się o max 1 klatkę względem pointera (zamierzone);
  commit czyta synchroniczny ref, więc semantyka dropu jest niezależna od klatek.

## Podpis schedulera

- Run: `20260722-163416-n2hub-260-perf-weekview-memo`
- Prompt: `260-perf-weekview-memo.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `0633d9c93d29c55c4e506498799692c4f307422d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `0633d9c93d29c55c4e506498799692c4f307422d`
- Gałąź review: `review-integration`
- Run: `20260722-163416-n2hub-260-perf-weekview-memo`

### Pliki zgłoszone do review

- `src/components/WeekView.tsx`
- `handoffs/scheduler-reviews/20260722-163416-n2hub-260-perf-weekview-memo.md`
- `src/components/weekViewModel.test.ts`
- `src/components/weekViewModel.ts`
