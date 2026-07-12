# Handoff: Unit tests for date validation, reducer guards, and storage date repair

- **Package ID:** PKG-20260712-date-hardening-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712-date-validation-core
- **Blast radius:** none — test files only.

## Goal

Vitest coverage for the new validation layer: the validator matrix, every
reducer date-guard (including the exact blank-screen repro — `SAVE_PROJECT`
with empty dates), and the `normalizeDates` storage repair pass.

## Context the worker needs

- Relevant files (new): `src/utils/dates.test.ts`, `src/store/dateGuards.test.ts`.
- Relevant files (extend): `src/store/storage.test.ts`.
- Under test: `isValidDateStr`, `periodError`, `PERIOD_ERROR_LABELS`,
  `MAX_TASK_PERIOD_DAYS` from `src/utils/dates.ts`; `reducer` (exported) from
  `src/store/AppStore.tsx`; `normalizeDates`, `loadData` from
  `src/store/storage.ts`.
- Follow the existing test style: see `src/store/blockActions.test.ts` and
  `src/store/storage.test.ts` for the `makeEntry`/state-fixture helper pattern,
  and how storage tests seed `localStorage` (vitest node env — check how the
  existing storage tests stub/emulate localStorage and reuse that mechanism).
- Key facts: rejected reducer actions return the SAME state object
  (`expect(next).toBe(state)`); `BIN_DATE` is `''` and is a VALID
  `WorkloadEntry.date` sentinel; `normalizeDates` runs before
  `ensureStartMinutes` in `loadData`.
- Config: `npm test` = `vitest run`, tests match `src/**/*.test.ts`.

## Scope

### In scope

1. **`src/utils/dates.test.ts`:**
   - `isValidDateStr` true: `'2026-07-12'`, `'2028-02-29'` (leap), `'1999-01-01'`.
   - false: `''`, `'2026-02-31'`, `'2026-13-01'`, `'2026-00-10'`, `'2026-2-3'`,
     `'abc'`, `'2026-07-12T00:00'`, `'2026/07/12'`.
   - `periodError`: `('','2026-07-12') → 'missing-start'`;
     `('2026-02-31','2026-07-12') → 'invalid-start'`; `('2026-07-12','') → 'missing-end'`;
     `('2026-07-12','x') → 'invalid-end'`; `('2026-07-12','2026-07-11') → 'reversed'`;
     93-day span with `{ maxDays: MAX_TASK_PERIOD_DAYS }` → `'too-long'`;
     92-day span with the same opts → `null`; valid pair without opts → `null`;
     same start=end → `null`.
   - `PERIOD_ERROR_LABELS` has a non-empty Polish string for every `PeriodError`.
2. **`src/store/dateGuards.test.ts`:** build a minimal valid `AppData` fixture
   (one client, one status, one project, one task, one milestone, one person).
   For each case assert `reducer(state, action)` returns `state` by reference
   AND (spot-check) `state.activity` gained no rows:
   - `SAVE_PROJECT` with `startDate: ''` (THE blank-screen repro), with
     `endDate: '2026-02-31'`, and with reversed dates → rejected.
   - `SAVE_PROJECT` with a valid draft → NOT rejected (project list grows).
   - `SAVE_TASK` with empty start, garbage end, reversed dates, and a 93-day
     period → rejected; a 92-day period → accepted.
   - `SET_TASK_DATES` / `SET_PROJECT_DATES` with an invalid or reversed pair →
     rejected; valid pair → applied.
   - `SAVE_MILESTONE` / `MOVE_MILESTONE` with `''` and garbage dates → rejected;
     valid date → applied.
3. **Extend `src/store/storage.test.ts`** (new `describe('normalizeDates', …)`):
   - Project with `startDate: ''` + valid end → start becomes the end date
     (blank-screen payload repro loads repaired via `loadData`).
   - Task with both dates garbage → both become today; reversed valid pair →
     swapped.
   - Milestone with garbage date → its project's repaired `startDate`.
   - Workload entry with `date: 'not-a-date'` → after `loadData` it lives in
     the person's bin (`date === BIN_DATE`, `startMinutes === 0`) and its hours
     are merged into a single bin row per (task, person); a pre-existing valid
     bin entry (`date: ''`) is untouched.
   - `SavedFilter.criteria.from = 'garbage'` → `''`; valid `from` kept.
   - Comment/activity `createdAt: 'garbage'` → `'1970-01-01T00:00:00.000Z'`.
   - Idempotence: `normalizeDates(normalizeDates(x))` deep-equals
     `normalizeDates(x)`; a fully-valid payload passes through deep-equal
     unchanged (and, if the implementation short-circuits, same reference).

### Out of scope

- Any change to `src/` production code — if a test exposes a real bug in the
  core package, STOP and report it (do not "fix" production code here).
- Component/DOM tests (no react-testing-library in this repo).
- Touching existing passing tests except adding the new describe block to
  `storage.test.ts`.

## Implementation notes

- Reuse/adapt the fixture helpers already present in `storage.test.ts` and
  `blockActions.test.ts` rather than inventing a new pattern.
- Dates in fixtures: use fixed literals (e.g. `'2026-07-06'`…), not `Date.now`,
  except the both-invalid→today case, where you compare against `todayStr()`.
- A valid task fixture must satisfy the other invariants (task belongs to an
  existing project; workload person assigned to the task) so guards under test
  are the only thing that can reject.

## Acceptance criteria

- [ ] All new tests pass; every existing test still passes (`npm test` fully green).
- [ ] The `SAVE_PROJECT` empty-start-date repro test exists and passes.
- [ ] Rejection assertions use identity (`toBe(state)`), not just deep equality.
- [ ] `npx tsc --noEmit` passes (tests are type-checked).

## Tests

- Command: `npm test`
- Expected: full suite green; roughly 30+ new assertions across the three files.

## Report back

Synthesized summary only: files added/extended, test counts before/after,
pass/fail, any production bug discovered (report, don't fix). Log to
`handoffs/RUN-STATE.md`. No raw logs.
