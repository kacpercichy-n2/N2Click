# Handoff: Unit tests for status `isDone` migration, selectors, and reducer guards

- **Package ID:** PKG-20260712c-status-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712c-status-done-core (must be merged in the working tree first)
- **Blast radius:** low — test files only, plus zero production code.

## Goal

Lock in the new completion semantics with unit tests: the `normalizeStatusFlags`
migration defaults, the `doneStatusIds`/`isDoneStatus` selectors (including
"archived still counts as done" and "reordering never changes doneness"), and
the reducer guards on archive/delete/done-toggle.

## Context the worker needs

- Read FIRST (the implementation you are testing):
  `src/store/storage.ts` (`normalizeStatusFlags`, `DATA_VERSION = 7`,
  `buildDefaultStatuses`, `loadData`), `src/store/selectors.ts`
  (`doneStatusIds`, `isDoneStatus`, `todayAgendaForPerson`,
  `overdueTasksForPerson`, `unplannedTasksForPerson`),
  `src/store/AppStore.tsx` (reducer cases `SET_STATUS_DONE`,
  `SET_STATUS_ARCHIVED`, `DELETE_STATUS`, `SAVE_STATUS`, `REORDER_STATUS`).
  The package spec below states INTENDED behavior — if the code disagrees,
  STOP and report the mismatch instead of testing the bug in.
- Existing patterns to copy: `src/store/storage.test.ts` (persist a raw JSON
  payload into localStorage, call `loadData()`, assert; see the
  "loadData round-trip — multi-block day" describe), `src/store/selectors.test.ts`
  (fixture builders), `src/store/blockActions.test.ts` (dispatch actions
  through the exported `reducer`).
- Vitest, node env, files match `src/**/*.test.ts`. Run: `npm test`.
  Baseline before this package: 9 files / 320 tests green plus whatever the
  core package's mechanical updates changed — re-baseline by running first.

## Scope

### In scope

1. **Migration tests** (extend `src/store/storage.test.ts`, new describe
   `normalizeStatusFlags / v6→v7 done semantics`):
   - v6 payload, 4 statuses none archived, no `isDone` fields → after
     `loadData()` exactly the LAST status by `order` has `isDone: true`,
     all others `false`; loaded `version` is 7.
   - v6 payload where the last-by-order status is ARCHIVED → the last ACTIVE
     status becomes done (i.e. old `doneStatusId` value preserved).
   - v6 payload with ALL statuses archived → the last status by `order`
     becomes done.
   - Payload with zero statuses → loads without crash, no done status.
   - Payload that ALREADY has `isDone: true` on a non-last status → preserved
     untouched (no re-defaulting), including when that status is archived.
   - Idempotence: `normalizeStatusFlags(normalizeStatusFlags(x))` deep-equals
     one application; and a full save→load→load round-trip changes nothing.
   - Non-boolean `isDone` garbage (`'yes'`, `1`, `null`) coerces to `false`
     (and then the no-done default applies if none remain).
2. **Selector tests** (extend `src/store/selectors.test.ts`):
   - `doneStatusIds` returns ALL `isDone` statuses, archived included;
     `isDoneStatus` agrees.
   - Reordering statuses (dispatch `REORDER_STATUS` or permute `order`
     values) does NOT change `doneStatusIds`, and a task in a done status
     stays excluded from `overdueTasksForPerson` / `unplannedTasksForPerson`
     / `todayAgendaForPerson`'s `dateless` after the done status is moved to
     the FIRST pipeline position.
   - A task whose status is done-and-archived: not overdue, not unplanned,
     not in the dateless agenda.
   - A task in a non-done LAST-position status with a past `endDate` IS
     overdue (the old last-active rule is really gone).
3. **Reducer guard tests** (new file `src/store/statusActions.test.ts`):
   - `SET_STATUS_ARCHIVED archived=true` on the only active status → state
     unchanged (same reference or deep-equal).
   - `SET_STATUS_ARCHIVED archived=true` on the only done status → unchanged.
   - Archiving a used-but-not-only status → succeeds; referencing
     projects/tasks keep their `statusId`.
   - `DELETE_STATUS` on referenced / only-active / only-done → unchanged;
     on an unused, non-only archived non-done status → removed.
   - `SET_STATUS_DONE isDone=false` on the only done status → unchanged;
     `isDone=true` on a second status → both done; then un-toggling the first
     → allowed; then archiving the remaining done status → refused.
   - `SAVE_STATUS` create (statusId null) → new status has `isDone: false`;
     rename/recolor of a done status preserves `isDone: true`.

### Out of scope

- Any production code change (report mismatches instead).
- Browser/Playwright checks and CLAUDE.md (PKG-20260712c-status-browser-docs).
- Testing the admin UI components (unit suite is store-level only).

## Implementation notes

- Build minimal `AppData` fixtures the way `selectors.test.ts` does; every
  Status fixture now needs `isDone`.
- localStorage-based tests: follow `storage.test.ts`'s existing setup exactly
  (same storage key `n2hub.data.v1`, `version: 6` stamp for legacy payloads).
- Selectors are pure — pass explicit `today` strings, never `Date.now`.
- Environment: NO git, NO `npm run build`/`vite`/`curl`. Allowed:
  `npm test`, `npx tsc --noEmit`.
- Log your result to `handoffs/RUN-STATE.md` (worker log): files changed,
  counts before/after, any implementation mismatches found.

## Acceptance criteria

- [ ] All cases in the In-scope list exist as real assertions (no stubs/todos).
- [ ] `npm test` fully green; new tests fail if `isDone` defaulting, the
      archived-still-done rule, or any guard is reverted (spot-check by
      reading, not by mutating code).
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] No production file modified.

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: green; test count grows by roughly 18–25 over the post-core
  baseline.

## Report back

Synthesized summary only: files added/extended, number of new tests, pass/fail,
any behavior mismatches discovered (with file:line), deviations. No raw logs.
