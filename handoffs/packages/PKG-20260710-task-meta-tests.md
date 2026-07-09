# Handoff: Task metadata tests — v6 migration + checklist/category persistence

- **Package ID:** PKG-20260710-task-meta-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260710-task-meta-model (test files only; may run in parallel with PKG-20260710-task-meta-ui — no file overlap)
- **Blast radius:** none — test files only.

## Goal

Focused unit tests for the v5→v6 storage normalize pass (`normalizeTaskMeta`) and the new reducer behavior (SAVE_TASK metadata round-trip, work-category CRUD with reference clearing), following the existing test idioms.

## Context the worker needs

- Files to CHANGE: `src/store/storage.test.ts` (append a `describe('normalizeTaskMeta')` + a loadData case), new file `src/store/taskMeta.test.ts`.
- Files to READ (never modify): `src/store/storage.ts` (`normalizeTaskMeta`, `DATA_VERSION`, `emptyData`, `DEFAULT_FILTER_CRITERIA`, `loadData`), `src/store/AppStore.tsx` (`reducer`, `SaveTaskPayload`, `TaskDraft`, `*_WORK_CATEGORY` actions), `src/types.ts`, `src/utils/priority.ts`.
- Idioms to follow: `src/store/storage.test.ts` (the `withLocalStorage` stub, `makeEntry`/`makeState` factories, idempotency assertions) and `src/store/blockActions.test.ts` (building `AppData` via `{ ...emptyData(), ...overrides }`, `makeTask` factory — note it now includes `priority`/`workCategoryId`/`checklist` defaults, dispatching through the exported `reducer`).
- Pre-flight: if `normalizeTaskMeta` is not exported from `src/store/storage.ts`, or the reducer actions differ from the spec below, STOP and report — do not adapt source code (test files are your only write surface).

## Scope

### In scope

**A. `src/store/storage.test.ts` — append `describe('normalizeTaskMeta')` (~8–10 tests):**
1. A v5-shaped task (no `priority`/`workCategoryId`/`checklist` keys) gains `priority: 'normal'`, `workCategoryId: ''`, `checklist: []`.
2. An invalid priority value (e.g. `'critical'`) resets to `'normal'`; a valid one (`'urgent'`) is preserved.
3. A dangling `workCategoryId` (no matching row in `workCategories`) resets to `''`; a valid reference is preserved.
4. Malformed checklist sanitize: non-array → `[]`; an item missing `id` gets one generated; non-string `text` coerces to `''`... assert per the actual coercion rules in the implementation (`done: item.done === true`, non-object entries dropped).
5. A saved filter with v5 criteria (missing `priority`/`workCategoryId`) is filled from `DEFAULT_FILTER_CRITERIA` (both become `''`); other criteria fields survive unchanged.
6. An invalid `criteria.priority` resets to `''`.
7. Missing/non-array `workCategories` becomes `[]`.
8. Idempotency: running `normalizeTaskMeta` twice is value-equal to running it once (deep-equal; reference equality only if the implementation guarantees it — check first).

**B. `src/store/storage.test.ts` — one end-to-end `loadData` case (using the existing `withLocalStorage` helper):** a stored `version: 5` payload containing at least one task without the new fields and one saved filter with old criteria loads as `version` = `DATA_VERSION` (6) with all defaults applied and NO data loss (task titles/dates/estimate, workload untouched).

**C. New `src/store/taskMeta.test.ts` (~10–14 tests), building state like `blockActions.test.ts`:**
1. `SAVE_TASK` create: draft with `priority: 'high'`, a real `workCategoryId`, and a 2-item checklist persists all three on the created task.
2. `SAVE_TASK` edit: checklist is replaced WHOLESALE from the draft (removed/toggled items don't survive), priority/category update in place, `updatedAt` bumps.
3. `SAVE_TASK` with empty-text checklist items in the draft: they are dropped on write (per the model package's defensive trim).
4. `ADD_WORK_CATEGORY`: trims the name; empty/whitespace-only name is a no-op (state unchanged).
5. `RENAME_WORK_CATEGORY` renames the right row only.
6. `DELETE_WORK_CATEGORY`: removes the row AND resets `workCategoryId` to `''` on tasks that referenced it, while an unrelated task's category survives.
7. Checklist item `done` toggling persists through a SAVE_TASK round-trip (create → edit toggling one item).

### Out of scope

- ANY non-test file. If something looks buggy, report it — don't fix it.
- UI/component tests (no jsdom in this suite — vitest runs in node env).
- Re-testing existing behavior (blocks, planning status, permissions) beyond what the new assertions need.

## Implementation notes

- Vitest, node environment, `src/**/*.test.ts` — mirror imports/setup of the neighboring test files exactly.
- Build tasks through a local factory with the new defaults; don't hand-write full `AppData` literals.
- `SAVE_TASK` needs a full `SaveTaskPayload` (`assigneeIds: []`, `allocations: []` are fine for metadata-focused cases).
- Keep test names in the existing descriptive-English style of the suite.

## Acceptance criteria

- [ ] All the cases above exist and pass; ~18–24 new tests total.
- [ ] Only `src/store/storage.test.ts` and `src/store/taskMeta.test.ts` changed/added.
- [ ] `npx tsc --noEmit` clean; `npx vitest run` fully green (baseline after the model package + the new tests; report exact counts).

## Tests

- Command: `npx tsc --noEmit && npx vitest run`
- Expected: entire suite green; new tests cover every bullet in Scope A–C.

## Report back

Synthesized summary only (files changed one-line each, test counts, any source bug found via pre-flight). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs. No commit — the orchestrator commits after review.
