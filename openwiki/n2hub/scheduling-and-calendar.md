# Scheduling and calendar

## Boundaries

- `src/components/WeekView.tsx` owns timed-grid interaction and bin-card UI.
- `src/utils/time.ts` owns pure time calculations, collision checks, packing,
  free-slot search and quarter-hour math.
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
- Automatic placement uses a real free-slot search and rejects when no slot fits;
  it must not clamp into an overlap near midnight.
- Free-slot search rejects non-finite, non-positive, off-grid and over-day
  durations. Keyboard-activatable week blocks and bin cards respond to both
  Enter and Space without changing their pointer lifecycle.
- Recurring-task occurrences are PRESENTATIONAL ONLY (invariant 1): WeekView
  renders them as additive `.week-recur-block` overlays (dashed/striped, ⟳),
  positioned by time and painted BEHIND real blocks; they never enter
  `packDayBlocks`, collisions, totals or overload and carry NO pointer/drag
  handlers — only click/keyboard opens the task and right-click opens the
  `recurMenu`. Menu actions map only to the two reducer actions: „Pomiń ten
  dzień"/„Edytuj to wystąpienie" → `SET_RECURRENCE_OVERRIDE`, „Edytuj wszystkie"
  → TaskModal's „Cykliczność" section (`SET_TASK_RECURRENCE`). `openSlotMenu`
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

`src/utils/time.test.ts`, `src/store/blockActions.test.ts`,
`scripts/browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`, and
`browser-check-placement.mjs`.
