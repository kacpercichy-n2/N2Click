# Handoff: Mobile allocation day list replacing the grid table (<760 px)

- Package ID: PKG-20260728-alloc-day-list
- Status: ready
- Tier: developer
- Depends on: none (run FIRST — PKG-20260728-keyboard-inset edits the same
  `@media (max-width: 760px)` modal block in `src/styles.css`; serialize to
  avoid a text conflict)
- Risk: medium
- Codex review: required — TaskModal is the highest-traffic editor and the
  allocation state machine (auto-save, undo, reconciliation) must not regress.

## Goal

On phones (`max-width: 760px`) TaskModal's „Dzienny przydział godzin" renders a
vertical day LIST instead of the 480 px `<table class="alloc-grid">` — one row
per day showing the day's sum; tapping a row expands per-person hour steppers.
Zero horizontal scrolling. Desktop table is untouched; both forms commit
through the exact same editor callbacks.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/scheduling-and-calendar.md`

## Expected touchpoints

- `new: src/components/allocationDayList.ts` — pure model (node env)
- `new: src/components/allocationDayList.test.ts`
- `new: src/components/AllocationDayList.tsx` — thin DOM layer
- `src/components/TaskModal.tsx` — allocation section only (~line 2062–2104):
  render `<AllocationDayList …>` instead of `<AllocationGrid …>` when
  `useMediaQuery(MOBILE_NAV_QUERY)` matches (import from
  `src/utils/useMediaQuery.ts`; TaskModal does not import it yet)
- `src/styles.css` — NEW `.alloc-daylist*` classes only (place near the
  existing task-modal mobile block at ~line 5204)

## Invariants

- Invariant 1: planned hours live only in `WorkloadEntry`; the day list NEVER
  dispatches — it writes exclusively through the existing `setCell`
  (`onChange(personId, date, hours)`) and `setCellStart` props, so the values
  flow into the same `allocations`/`startTimes` maps → `plannedCells` →
  `SAVE_TASK` path the desktop table uses. No reducer or AppStore change.
- Invariant 2: 0,25 h step, clamp 0–24; time inputs 15-minute step (`step={900}`).
- Invariant 3: overload stays warn-only; deliberate overlap allowed.
- Invariant 6: no reducer changes at all.
- Desktop bit-identical: `src/components/AllocationGrid.tsx` and every existing
  `.alloc-*` CSS rule (`.alloc-wrap`, `.alloc-grid`, `.alloc-cell`,
  `.alloc-input`, `.alloc-time-input`, `.alloc-collapsed*`, `.alloc-person-*`,
  `.alloc-total-col`, `.alloc-day-*`, `.task-modal-body .alloc-wrap`) must not
  change by one byte. The switch is a conditional render in TaskModal only.
- TaskModal memoization contract: pass the SAME already-stable props
  (memoized `allocations`, `useCallback` handlers). Do not add new state to
  TaskModal beyond the `useMediaQuery` call.

## Scope

1. **Pure model `allocationDayList.ts`** (mirrors `allocationGridView.ts`
   style, Polish comments):
   - `allocationDayRows(days: readonly string[], personIds: readonly string[], allocations: Readonly<Record<string, number>>): { date: string; total: number; byPerson: Record<string, number> }[]`
     — reads via the shared `allocKey` from `./allocationGridView` (single key
     format source).
   - `stepAllocationHours(value: number, direction: 1 | -1): number` — ±0,25,
     clamp `[0, 24]`, snap result to the 0,25 grid.
   - `parseAllocationInput(raw: string): number | null` — accepts comma AND dot
     decimals (`inputMode="decimal"` on Polish keyboards yields a comma), trims,
     `''` → `0`, invalid → `null` (caller ignores), clamp 0–24, snap to
     nearest 0,25.
2. **Tests `allocationDayList.test.ts`** (node env, like
   `allocationGridView`'s siblings). REQUIRED cases:
   - round-trip with the grid model: build an `AllocMap` by writing
     `allocKey(person, date)` entries, assert `allocationDayRows` day totals ==
     the table's `dayTotalAcross` semantics and per-person sums across days ==
     the table's `personTotal` semantics (recompute both from the same map);
   - stepping from 0 → 0,25; at 24 stays 24; at 0 minus stays 0; snap of an
     off-grid value (e.g. 1,3 + step → 1,5 or nearest snap — assert your
     documented rule);
   - `parseAllocationInput('1,75') === 1.75`, `'1.3'` snaps to `1.25`,
     `'abc'` → null, `''` → 0, `'25'` → 24.
3. **Component `AllocationDayList.tsx`** — same Props shape as
   `AllocationGrid` (reuse the interface or a subset; it already receives
   `state`, `currentTaskId`, `startDate`, `endDate`, `people`, `allocations`,
   `startTimes`, `blockCounts`, `onChange`, `onChangeStart`, `onFillWeekdays`,
   `onClearPerson`, `undoPersonId`, `onUndoClear`, `readOnly`, `startHintId`):
   - **Person switcher** (settled): rendered ONLY when `people.length > 1` —
     a row of buttons (person dot + first name, `aria-pressed`) selecting the
     ACTIVE person; with a single assignee no switcher renders and that person
     is active. Active person defaults to `people[0]`; if the active id leaves
     `people`, fall back to `people[0]`.
   - Per-person actions for the ACTIVE person above the list (reuse the exact
     existing handlers): „Wypełnij dni robocze" link, „Cofnij" link when
     `undoPersonId === active.id`, `OverflowMenu` with „Wyczyść kolumnę".
   - **Day rows**: one `<button aria-expanded>` per period day (from
     `eachDayInclusive`), label = `formatRowLabel(date)` + day total across ALL
     people (`formatDuration`), weekend rows get a modifier class. Tapping
     toggles expansion (local state, multiple days may stay open).
   - **Expanded panel** (for the ACTIVE person): stepper cluster
     `− / value / +`: buttons call `onChange(active.id, date, stepAllocationHours(current, ±1))`;
     the value is `<input type="text" inputMode="decimal">` committed via
     `parseAllocationInput` on change/blur (null = ignore). Below it, when
     `value > 0 && !multi && !readOnly`, the SAME optional start-time input as
     the desktop cell (`<input type="time" step={900}>`, `aria-describedby`
     `startHintId`, `onChangeStart(active.id, date, minutes|null)`); when
     `blockCounts` says ≥2 blocks show the `×N` badge + the same explanatory
     note instead. Overload: same warn-only computation as the table (base =
     `hoursForPersonOnDate` minus this task's saved entries for that
     person/date, vs `availableHoursOnDate`) — an `.overload` class + a visible
     Polish note sentence; it never blocks input or save (invariant 3).
   - `readOnly`: inputs disabled + the shared hidden „Brak uprawnień…" note
     pattern; no switcher-less crash with 0 people (TaskModal already guards —
     list renders only when `assignedPeople.length > 0`).
   - No `title` attributes (repo-wide ban); tooltips only via `Tooltip` if
     needed.
4. **TaskModal**: `const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);` at top
   level (before any early return — hook order), and in the `allocation`
   section render the day list vs grid conditionally. Nothing else changes.
5. **CSS**: new `.alloc-daylist*` rules. They may live outside a media query
   (component only mounts on mobile) but must not restyle any existing
   selector. Min tap targets ~44 px; no horizontal overflow at 390 px.

## Out of scope

- Any reducer/AppStore/selectors change; `SAVE_TASK` reconciliation; auto-save
  timing; `taskSaveBlockers`.
- AllocationGrid.tsx, WorkloadPage, WeekView, drag/pointer code (invariant 7).
- The visualViewport keyboard work (separate package
  PKG-20260728-keyboard-inset).
- Retirement mode stays disabled — do not touch anything related.
- No new runtime dependencies.

## Acceptance

- [ ] At ≤760 px the allocation section shows the day list: one row per day
      with the day sum; no horizontal scrolling anywhere in the modal at 390 px.
- [ ] Expanding a day and using −/+ or typing `1,75` updates the SAME
      `allocations` map (visible in the day sum and in „Suma osoby" semantics)
      and survives save exactly like a desktop table edit (same `SAVE_TASK`
      payload path).
- [ ] Multiple assignees → person switcher on top; single assignee → no
      switcher.
- [ ] Start-time input appears under the same rule as desktop
      (`value>0 && !multi && !readOnly`), 15-min steps; ×N badge for
      multi-block days.
- [ ] „Wypełnij dni robocze" / „Wyczyść kolumnę" / „Cofnij" work for the active
      person through the existing handlers.
- [ ] Desktop (>760 px) DOM and CSS for the table are byte-identical.
- [ ] `allocationDayList.test.ts` covers the round-trip + parsing/stepping
      cases above and is green.

## Verification

- Worker: `npx vitest run src/components/allocationDayList.test.ts` then
  `npm run build`; spot-run `npx vitest run src/components/allocationGridView.test.ts`
  to prove the shared key module regressed nothing.
- Browser: none — release verification owns the browser matrix; no covered
  pointer interaction changes here.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Steppers commit through `setCell`/`setCellStart` ONLY; the day list is a
  presentation twin of the table, never a second mutation path.
- Single assignee ⇒ no switcher (settled above).
- Expanded panel edits the ACTIVE person only; the row label always shows the
  all-people day sum.
- Comma decimals must parse; values snap to 0,25 (invariant 2).
