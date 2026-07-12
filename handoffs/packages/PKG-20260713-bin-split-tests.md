# Handoff: Unit tests for SCHEDULE_BIN_PART and partial-scheduling selectors

- **Package ID:** PKG-20260713-bin-split-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713-bin-split-core (NOT on the UI package — may run in parallel with it)
- **Blast radius:** none — test files only, no production code.

## Goal

Deep reducer coverage for the new `SCHEDULE_BIN_PART` action (happy paths,
identity/ordering preservation, hour conservation, full rejection matrix) plus
selector-level proof that repeated partial scheduling moves a task's derived
planning status correctly. The 30-hour acceptance scenario must be an explicit
test.

## Context the worker needs

- Relevant files (the two you edit): `src/store/blockActions.test.ts`,
  `src/store/selectors.test.ts`.
- Read the REAL implementation first and assert what it does — never guess:
  `scheduleBinPart` + `setBlockTime` in `src/store/AppStore.tsx` (delegation
  pattern: rejection returns the ORIGINAL state reference; quarters math via
  `toQuarters`; activity suffix `; w zasobniku pozostało {X}` /
  `; zasobnik opróżniony`), `BIN_DATE`/`isBinEntry`/`HOURS_STEP` in
  `src/utils/time.ts`, `taskPlanningStatus` / `PLANNING_STATUSES` in
  `src/store/selectors.ts`, `MAX_TASK_PERIOD_DAYS` in `src/utils/dates.ts`.
- Test conventions: `blockActions.test.ts` builds fixtures by hand with its
  local `makeState` / `makeTask` / `makeEntry` / `makePerson` helpers (top of
  file) and asserts rejections with `expect(next).toBe(state)` (referential
  equality) — follow that style exactly. Existing describes for
  `MOVE_BLOCK_TO_BIN` / `SPLIT_BLOCK` / `DELETE_BLOCK` (~lines 372–540) are
  good templates.
- Environment: `npx tsc --noEmit`; `npm test` (vitest, node env). `git`
  denied. Run `npm test` BEFORE adding anything to capture the fresh baseline
  (11 test files currently; the 10/343 figure in RUN-STATE predates the
  onboarding run) and report baseline vs final counts.

### Prior decisions (final)

- New describe `SCHEDULE_BIN_PART` in `blockActions.test.ts`; a small describe
  in `selectors.test.ts` for the planning-status flow. No new test file.
- Target roughly 16–22 new tests total; every case below is real (no stubs).

## Scope

### In scope — blockActions.test.ts, describe `SCHEDULE_BIN_PART`

Happy paths:
1. **30h acceptance case:** bin row (id `bin1`, 30h) + `hours: 8` to a free
   valid day/start → source row SAME id, `date` still `''`, `plannedHours`
   22, sortIndex rank preserved; exactly one NEW dated row (8h, requested
   date/startMinutes); workload total for the (task, person) pair still 30h;
   task `estimatedHours` untouched; last activity row contains
   `w zasobniku pozostało 22h`.
2. **Repeated partials over several days to zero:** schedule 8h+8h+8h+6h on
   four different days from the same 30h row — after each step the remainder
   keeps the SAME id and exact hours (22 → 14 → 6); the final step deletes the
   bin row (no bin entry left for the pair) and its activity row contains
   `zasobnik opróżniony`; four dated rows exist; total still 30h.
3. Full-amount single call (`hours` = row hours) → bin row gone, one dated row,
   conservation holds.
4. Scheduling a part exactly touching an existing same-task same-person block
   → adjacency merge (inherited from `setBlockTime`): merged block's hours
   summed, earlier block's id survives, bin remainder still decremented.
5. Target date outside the task period → period extends (task
   `startDate`/`endDate` updated), within the 92-day cap.
6. Works when `estimatedHours === null` (no budget interaction — the action
   never consults headroom).
7. Bin `sortIndex` reindex: person has bin rows of TWO tasks; scheduling one
   task's row to zero leaves the other task's bin row with a contiguous
   sortIndex (read the reindexDays behavior first, assert reality).

Rejection matrix (each: `expect(next).toBe(state)` and no new activity row):
8. missing `entryId`; dated (non-bin) entry.
9. `hours`: 0, negative, NaN, off-grid (e.g. 1.1), > 24.
10. `hours` exceeding the row's remaining quarters (e.g. 3.25 from a 3h row).
11. invalid dates: `''` (BIN_DATE), `'not-a-date'`, `'2026-02-30'`.
12. `startMinutes` off the 15-min grid; block not fitting the day
    (e.g. start 23:00 + 2h).
13. same-person time collision on the target slot (touching edges must PASS —
    include the positive touching case in #4 or separately).
14. period extension that would exceed `MAX_TASK_PERIOD_DAYS` (93 days).
15. task referenced by the bin row does not exist.

Off-grid legacy row behavior (assert what the code does):
16. A 5.1h bin row: scheduling 5h (its rounded-quarters total) deletes the row
    (quarter-unit conservation — the 0.1h is snapped away by design).

### In scope — selectors.test.ts (small describe, e.g. `partial scheduling → planning status`)

17. Task with estimate 30h, one 30h bin row → `taskPlanningStatus` is
    `częściowo` (bin hours pending); after dispatching `SCHEDULE_BIN_PART` for
    all 30h across days → `rozplanowano`; assert the intermediate state after
    one 8h part is still `częściowo`. (Read `planningStatusForTotals`
    precedence in selectors.ts first and assert the real values.)
18. `binTaskRowsForPerson` / `binHoursForTaskPerson` reflect the remainder
    after a partial (e.g. 22h), and drop the task once the row hits zero.

### Out of scope

- Production code of any kind (if the implementation contradicts this package,
  STOP and report the mismatch instead of "fixing" either side).
- Browser tests, docs (PKG-20260713-bin-split-browser-docs).
- Restructuring existing tests; storage/migration tests (no schema change).

## Implementation notes

- Build workload fixtures with explicit quarters-friendly numbers; remember
  entries only exist with `plannedHours > 0`.
- For activity assertions use the last element of `next.activity` (house
  pattern in existing tests, e.g. lines ~566, ~875).
- `makeEntry` defaults to a dated entry — pass `date: ''` and
  `startMinutes: 0` for bin rows.

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: 0 tsc errors; ALL pre-existing tests still green (same counts as
  your captured baseline); 16–22 new tests, all green, no `.skip`/`.todo`.

## Report back

Baseline vs final file/test counts, the list of covered cases, any
implementation mismatch found (report, don't fix), pass/fail summary.
