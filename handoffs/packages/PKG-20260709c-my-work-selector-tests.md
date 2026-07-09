# Handoff: Unit tests for the "Moja praca" selectors

- **Package ID:** PKG-20260709c-my-work-selector-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260709c-my-work-page
- **Blast radius:** none — test file additions only.

## Goal

Add vitest unit coverage for the five selectors introduced by
PKG-20260709c-my-work-page: `doneStatusId`, `overdueTasksForPerson`,
`overloadedDatesForPersonInRange`, `unplannedTasksForPerson`,
`binTaskRowsForPerson`.

## Context the worker needs

- Relevant files:
  - `src/store/selectors.ts` — the selectors under test (read their JSDoc; they are pure and take explicit `today` / date-list params — never call `Date.now`).
  - `src/store/selectors.test.ts` — EXTEND this file; reuse its existing state-fixture helpers/builders and style. Do not create a new test file unless the existing one has none of the needed helpers (it does).
  - `src/utils/time.ts` — `BIN_DATE` (`''`) marks bin entries.
- Domain rules needed for the fixtures:
  - "Done" = the LAST active (non-archived) status by `order`.
  - A person's day total is the sum of their `WorkloadEntry.plannedHours` on that date; overload is STRICTLY greater than `personCapacity` (a person's `capacity`, default 8).
  - Bin entries have `date === ''`, `startMinutes: 0`; invariant: at most one bin row per (taskId, personId), but selectors must tolerate duplicates.
  - Tasks link to people via `assignments` rows, not via workload.

## Scope

### In scope — test cases (all in `src/store/selectors.test.ts`)

1. `doneStatusId`
   - Returns the id of the last active status in pipeline order.
   - An archived last status is skipped (the previous active one wins).
   - No statuses → `undefined`.
2. `overdueTasksForPerson`
   - Includes an assigned task with `endDate < today` and non-done status.
   - Excludes: done-status tasks, tasks ending today or later, tasks the person is NOT assigned to.
   - Sorted by `endDate` asc, ties by `title`.
3. `overloadedDatesForPersonInRange`
   - Returns only dates from the input list where booked > capacity; booked === capacity is NOT overloaded.
   - Respects per-person `capacity` (e.g. capacity 6, booked 7 → overloaded).
   - Entries of other people are ignored; hours from multiple tasks on one date are summed.
4. `unplannedTasksForPerson`
   - Includes an assigned, non-done task with zero workload rows for that person.
   - Excludes: a task where the person has only a BIN row (bin counts as planned work); a task with a dated row; done tasks; unassigned tasks. Another person's rows on the same task do NOT make it planned for this person.
   - Sorted by `endDate` asc, ties by `title`.
5. `binTaskRowsForPerson`
   - Maps each bin entry to `{ task, hours }` in bin `sortIndex` order.
   - Two bin rows of the same task are summed into one row (defensive path).
   - A bin entry whose `taskId` resolves to no task is skipped.
   - Other people's bin rows and dated rows are excluded.

### Out of scope

- Any change to `src/store/selectors.ts` or other source files. If a test reveals a real selector bug, STOP, do not "fix" the selector — report the failing case in your summary and in `handoffs/RUN-STATE.md`.
- Component/DOM tests, snapshot tests, new test infrastructure or dependencies.

## Implementation notes

- Copy the fixture-building approach already in `src/store/selectors.test.ts` (minimal `AppData` objects); keep dates as literal `'yyyy-MM-dd'` strings so tests are deterministic — never derive "today" from the clock.
- RTK hook rewrites read commands — use the Read/Grep/Glob tools to inspect files.

## Acceptance criteria

- [ ] All five selectors covered with the cases above (≥ 15 new tests total).
- [ ] `npm test` fully green; no existing test modified or broken.
- [ ] `npx tsc --noEmit` clean.
- [ ] No source (non-test) file changed.

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: previous baseline (195 pre-run; higher after PKG-20260709c-my-work-page if it added none this stays 195) + your new tests, all passing.

## Report back

Synthesized summary only: number of tests added per selector, final test count, any selector behavior that surprised you (report, don't fix). Log the block to `handoffs/RUN-STATE.md` → Worker log. No raw logs.
