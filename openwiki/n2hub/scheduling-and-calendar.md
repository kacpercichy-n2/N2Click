# Scheduling and calendar

## Boundaries

- `src/components/WeekView.tsx` owns timed-grid interaction and bin-card UI, w
  DWÓCH trybach renderowania za jednym propem `mode` (`'week'` domyślnie,
  `'day'` na telefonie ≤760 px). Różnicę niesie WYŁĄCZNIE długość tablicy
  `days` — stała `DAY_COLS` zniknęła na rzecz `days.length`. Tryb dnia dokłada
  tylko warstwę prezentacji: pasek 7 dat i pigułkę „Dzisiaj” (czysty
  `dayStrip.ts`), kaskadę nakładających się kart zamiast wąskich kolumn (czysty
  `dayStack.ts`, prop `stack`; `undefined` = dotychczasowa arytmetyka kolumn co
  do bajta) oraz zasobnik jako arkusz od dołu (`binRef` ZOSTAJE na
  `.week-bin-pane`; stany `closed`/`peek`/`open` różnią się WYSOKOŚCIĄ, nigdy
  `translateY`). Sygnał „trwa przeciąganie” dla auto-peeku płynie z ISTNIEJĄCEGO
  efektu `[dragging]` (`onDragActiveChange` obok `setLiveSyncHold`) i wychodzi
  natychmiast poza trybem dnia — żaden handler wskaźnika się nie zmienia
  (inwariant 7).
- `src/components/weekViewLayout.ts` (pure) owns the PRESENTATIONAL working
  window: `WORK_START_HOUR`/`WORK_END_HOUR` (9–17), the default scroll offset and
  the px bounds fed to CSS as `--week-work-top`/`--week-work-bottom`.
- `src/utils/time.ts` owns pure time calculations, collision checks, packing,
  free-slot search and quarter-hour math.
- `src/utils/touchDrag.ts` (pure state machine) + `src/utils/useTouchDragGate.ts`
  (React wrapper) own the touch long-press gate in FRONT of every drag entry.
- `src/components/calendarBlockKeyboard.ts` (pure state machine + polskie
  komunikaty) owns the KEYBOARD entry into the block-edit model.
- `src/components/monthGrid.ts` (pure) owns MonthView grid navigation math and
  the Polish accessible name of a day cell.
- `src/utils/blockLabel.ts` (pure) owns the ONE sentence describing a work block
  (TaskModal rows + WeekView tile `aria-label`).
- `src/store/AppStore.tsx` applies scheduling mutations atomically.
- `src/pages/WorkloadPage.tsx` owns workload reassignment UI.

## Non-negotiable behavior

- Time uses 15-minute steps; hours use 0.25-hour steps; a block must fit in one
  day. A task period is at most 92 days.
- Same-person collisions block calendar drag/resize and automatic placement.
  Intentional TaskModal allocation edits may overlap and render side-by-side.
- Bin work uses exactly one row per `(taskId, personId)`. `SCHEDULE_BIN_PART`
  keeps that row identity, decrements it atomically and removes it only at zero.
- Sold-hours model (2026-07-17): TaskModal edits per-person TOTAL hours
  (`binTotals` in SAVE_TASK — absolute bin target per person, row identity
  kept, 0 removes the row); `task.estimatedHours` is the SUM of per-person
  hours, and the bin is derived (sold − calendar). Zeroing/shrinking a grid
  cell RETURNS hours to the person's bin (the sold total is the contract);
  growing a cell consumes the bin. TaskModal auto-saves valid edited drafts
  (debounced ~0.9 s; paused during an explicit tab conflict; creation stays
  manual).
- Bin drag is window-owned: preserve its pointer-up/cancel/blur/Escape/visibility
  cleanup, synchronous refs and rendered-column hit-testing.
- Touch drag gate (2026-07-27, invariant 7): on `pointerType` touch/pen the four
  drag entries (WeekView `TimedBlock.begin`, `BinCard.begin`, TimelinePage
  `Bar.begin`, `MilestoneMark`) do NOT start a drag on `pointerdown` — they call
  `useTouchDragGate().arm(...)`, which starts a drag only after `TOUCH_HOLD_MS`
  (350 ms) of near-stillness (`TOUCH_HOLD_SLOP_PX` = 10 px); drift past the slop,
  `pointerup` or `pointercancel` aborts and the page scrolls. A late timer must
  never engage after an abort. Mouse is untouched: `arm` returns false without
  registering a timer or listener, so the drag layer runs byte-identically. Each
  `begin` captures its `init` (element/pointerId/client coords) SYNCHRONOUSLY —
  the deferred `startDrag` may not read the React event — and resets
  `moved.current` before the gate so a tap that never engages still opens the
  entity. On engage the gate holds a non-passive `touchmove` preventDefault lock
  for the life of the gesture, because `@media (pointer: coarse)` relaxes
  `.week-block`/`.week-bin-block`/`.timeline-bar`/`.timeline-milestone` to
  `touch-action: pan-x pan-y` (both axes: `.week-days-viewport` scrolls both) and
  `touch-action` cannot be tightened mid-gesture. The SAME engaged-only lock also
  suppresses the browser's own long-press: a capture-phase `contextmenu` listener
  on `document` (`preventDefault` + `stopPropagation`, so React's delegated
  `onContextMenu` never fires on a live drag), plus `user-select`/
  `-webkit-touch-callout: none` on the coarse-pointer selectors. A short press
  that never engages keeps today's context menu. Coarse pointers also hide
  `.week-block-handle` (6 px, untargetable), so touch gets move-only; `.bar-handle`
  is unchanged.
- Working window (2026-07-27) is PRESENTATION ONLY (invariant 1 + 7): the week
  grid opens scrolled to `WORK_START_HOUR` and slots outside 9:00–17:00 get a
  dimming `linear-gradient` LAYER on `.week-day-col` plus faded axis labels.
  No DOM node, no `pointer-events`, no z-index — snapping, collisions, drag and
  data are untouched, and off-window slots stay fully usable. The date+clock
  badge lives OUTSIDE the grid (`NowClockBadge` in the calendar toolbar row,
  `useNowTick` 30 s); the `.week-now-line` in today's column is unchanged.
- Podpowiedzi na powierzchniach przeciągania (2026-07-28, inwariant 7): bloki
  siatki, karty zasobnika, nakładki cykliczne/wydarzeń, plakietki nagłówka oraz
  paski i kamienie milowe osi czasu nie mają już natywnego `title` — otacza je
  `Tooltip` (`tooltipShell.ts`), który KLONUJE ten sam element (zero opakowań,
  zero zmian układu), dokłada WYŁĄCZNIE obserwatorów (nigdy `preventDefault`,
  `stopPropagation` ani przejęcia wskaźnika, zawsze woła istniejący handler) i
  chowa dymek na `pointerdown`, więc podczas przeciągania/rozciągania nic nie
  wisi nad siatką. Karta jest `pointer-events: none` w portalu, więc nie wpływa
  na `elementFromPoint` ani na trafianie w wyrenderowaną kolumnę. Znaczniki
  MonthView i plakietka „Wykonane” niosą informację `aria-label` (dymek komórki
  miesiąca jest czysto wizualny), a powody blokady pozycji menu kontekstowego
  („Podziel…”) są WIDOCZNĄ linijką `.context-menu-hint` + `aria-describedby`,
  nie dymkiem. `browser-check-bin-drag.mjs` czyta podpowiedź karty zasobnika
  przez `aria-describedby`, a nie przez atrybut `title`.
- Automatic placement uses a real free-slot search and rejects when no slot fits;
  it must not clamp into an overlap near midnight.
- Free-slot search rejects non-finite, non-positive, off-grid and over-day
  durations. Keyboard-activatable week blocks and bin cards respond to both
  Enter and Space without changing their pointer lifecycle.
- Klawiatura na bloku siatki (2026-07-28, inwariant 7) jest DODATKOWYM WEJŚCIEM
  do modelu przeciągania, nigdy równoległym uproszczeniem: ↑/↓ przesuwa start
  o 15 min, Shift+↑/↓ zmienia długość, ←/→ przenosi o dzień, Escape cofa CAŁĄ
  wystawioną edycję bez wysyłki, a Enter/spacja ZATWIERDZA ją (bez rozpoczętej
  edycji Enter/spacja nadal otwierają zadanie). Projekcja jest wystawiona jak
  `dragRef` i idzie przez te same granice (`snapToStep`, `clampBlockStart`,
  doba, `hasCollision`, sufit `baseHours + growAllowanceHours`) do TEJ SAMEJ
  akcji `SET_BLOCK_TIME`; kolizja blokuje zapis (inwariant 3). Wyjście fokusa
  zatwierdza (edycja nie ginie po cichu). Decyzyjność siedzi w czystym
  `calendarBlockKeyboard.ts`, a `.week-block` nosi wtedy `kb-editing` obok
  istniejących `colliding`/`at-cap`. Akcja „Przenieś do zasobnika”
  (`MOVE_BLOCK_TO_BIN`) jest RODZEŃSTWEM kafelka (dzieci `role="button"` są
  prezentacyjne), widoczna dopiero przy fokusie i `pointer-events: none` poza
  nim, więc `elementFromPoint`, bramka dotyku i cały cykl życia wskaźnika
  (`begin`/`startDrag`/`projectMove`/`finish`/`cancelDrag`) zostają bez zmian.
  Kafelek niesie pełne zdanie `aria-label` z `blockLabel`, a WeekView ma jeden
  region `sr-only role="status" aria-live="polite"` — kolizja jest ZDANIEM
  („Koliduje z „Montaż filmu” 12:00–13:00”), nie samą czerwoną obwódką.
  Klawiaturowy zapis NIE odpala animacji scalenia (`setFusedId`) — reduktor
  scala tak samo, animacja zostaje przy przeciąganiu.
- MonthView (2026-07-28) jest siatką APG: `role="grid"` na `.month-grid-wrap`,
  wiersz `columnheader` z dniami tygodnia, `.month-grid` jako `rowgroup` i
  wiersze `.month-week-row` (`display: contents` — układ CSS bez zmian).
  Wędrujący `tabindex` trzyma DATĘ (jedna komórka fokusowalna), strzałki chodzą
  po dniach/tygodniach bez zawijania, Home/End po wierszu (z Ctrl po siatce),
  PageUp/PageDown = ±1 miesiąc, z Shiftem ±1 rok — i te dwa ostatnie przestawiają
  kotwicę `CalendarPage` (`onShiftMonth`/`onShiftYear`), która nie dubluje
  matematyki dat. Widoczna etykieta okresu (`.cal-range-label`) jest naraz
  `aria-live` i nazwą siatki. Nazwa komórki („30 lipca, 6 zaplanowanych godzin,
  2 osoby”) pochodzi z `monthCellName`, więc znaczniki 🎂/⟳/📅 są `aria-hidden` —
  ich treść wchodzi do nazwy i nie czyta się dwa razy.
- Recurring-task occurrences are PRESENTATIONAL ONLY (invariant 1): WeekView
  renders them as additive `.week-recur-block` overlays (dashed/striped, ⟳),
  positioned by time and painted BEHIND real blocks; they never enter
  `packDayBlocks`, collisions, totals or overload and carry NO pointer/drag
  handlers — only click/keyboard opens the task and right-click opens the
  `recurMenu`. Menu actions map only to reducer actions: „Pomiń ten
  dzień"/„Edytuj to wystąpienie" → `SET_RECURRENCE_OVERRIDE`, „Oznacz to
  wystąpienie jako zrobione"/„Cofnij wykonanie tego wystąpienia" →
  `SET_OCCURRENCE_DONE`, „Oznacz całą serię jako zrobioną (status zadania)" →
  `SET_TASK_STATUS` (PIERWSZY `isDone` w kolejności `state.statuses`; przy już
  zrobionej serii menu pokazuje samą podpowiedź zamiast przełącznika),
  „Edytuj wszystkie" → TaskModal's „Cykliczność" section (`SET_TASK_RECURRENCE`).
  A done occurrence (`occurrenceIsDone`) only adds the additive `.done` class +
  the shared `.block-done-mark` tick — no handler or pointer path changes. `openSlotMenu`
  guards `.week-recur-block` alongside `.week-block`. MonthView shows only a
  `.month-cell-recur` ⟳ marker (no blocks/menu). The rule is edited in TaskModal
  via explicit dispatch, never through the SAVE_TASK draft/auto-save. All bin
  drag, pointer lifecycle and rendered-column hit-testing paths are untouched.
- Calendar events / meetings (2026-07-21) are PRESENTATIONAL ONLY (invariant 1):
  WeekView renders each `calendarEventsForDate` occurrence as an additive
  `.week-event-block` overlay (solid cyan border + left bar, `--event-accent`,
  📅), positioned by `startMinutes`, height ∝ `durationMinutes`, painted BEHIND
  real task blocks (tree order, `z-index: 0`); events never enter `packDayBlocks`,
  collisions, totals, `dayTotal` or overload and carry NO pointer/drag handlers —
  only click/keyboard opens `EventModal` (`?wydarzenie=<id>`). `openSlotMenu`
  guards `.week-event-block` alongside `.week-recur-block`/`.week-block`, and its
  gate widens to `canManageTasks || canManageEvents`: the slot menu shows „+ Dodaj
  zadanie" at `tasks.manage` and „+ Dodaj spotkanie" at `events.manage`.
  MonthView shows only a `.month-cell-event` 📅 marker (no blocks/menu; inline
  `right` offset avoids collision with 🎂/⟳). All bin drag, pointer lifecycle and
  rendered-column hit-testing paths remain untouched (invariant 7).

## Start here for

Calendar blocks, bin recovery, collisions, ripple insertion, reassignment,
availability/overload calculations, drag lifecycle and time utilities.

## Relevant tests and checks

`src/utils/time.test.ts`, `src/utils/touchDrag.test.ts`,
`src/utils/blockLabel.test.ts`,
`src/components/calendarBlockKeyboard.test.ts`,
`src/components/monthGrid.test.ts`,
`src/components/weekViewLayout.test.ts`,
`src/components/overlayShell.test.ts`,
`src/store/blockActions.test.ts`,
`scripts/browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`, and
`browser-check-placement.mjs`.
