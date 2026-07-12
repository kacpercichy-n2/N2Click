# Handoff: Reducer + storage tests for identity-preserving SAVE_TASK

- **Package ID:** PKG-20260712b-savetask-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712b-savetask-core (the semantics below must already be implemented)
- **Blast radius:** low — test files only; no production code.

## Environment constraints (unattended session — read first)

Direct `git`, `vite`, `npm run build`, `npm run dev`, and arbitrary shell are DENIED. Allowed: `npm install *`, `node -e '<js>'`, rtk-wrapped read/grep/wc/tsc. Try `npm test` and `npx tsc --noEmit` first; if denied, fall back to node-API equivalents (`node -e "import('vitest/node').then(...)"`). Do NOT run the production build/dev server. Log your result to `handoffs/RUN-STATE.md` (Worker log).

## Goal

Lock in the new SAVE_TASK semantics with reducer tests, and prove a multi-block day survives a storage round-trip.

## Context the worker needs

- Relevant files: NEW `src/store/saveTaskWorkload.test.ts`; extend `src/store/storage.test.ts` (reuse its local `makeEntry` / `withLocalStorage` / `STORAGE_KEY` helpers). Read `src/store/AppStore.tsx` (`saveTask`, `reducer` export, `SaveTaskPayload`) and copy fixture style from `src/store/blockActions.test.ts` / `src/store/dateGuards.test.ts` (minimal `AppData` with one client/status/project/task/person — add a second person where needed).
- The implemented semantics (from the core package — assert exactly this, do not reinterpret): allocation cells carry the **day total** per (person, date). For each pair: equal total → all existing blocks kept byte-identical (id, plannedHours, startMinutes, sortIndex); larger total → whole delta added to the LAST block (highest startMinutes, tie by sortIndex), start clamped via `clampBlockStart` only if it would pass 24:00; smaller-but-positive total → blocks trimmed from the END (descending order), zeroed blocks deleted, survivors keep id + startMinutes, `reindexDays` renumbers; total 0 or cell absent → all pair blocks deleted; pair with no prior blocks → one new entry at `nextFreeStart` + `nextSortIndex`. Hours snap to 0.25 (`snapHours`). Bin (`date === ''`) entries pass through untouched for still-assigned people; `newUnassigned` merges into the person's existing bin row (one-bin-row invariant). Unassigned person → all their dated + bin entries dropped.

## Scope

### In scope — required cases (one `it` each minimum, in `saveTaskWorkload.test.ts`)

Fixture baseline: task T with person P having TWO dated blocks on day D (2h @ 480 idx 0, 3h @ 840 idx 1) and one bin row (4h, date '', startMinutes 0), plus one dated block on another day D2. Dispatch real `SAVE_TASK` actions whose draft mirrors the stored task (unchanged fields) unless the case says otherwise.

1. **Unchanged save is lossless:** cells = current day totals (D: 5, D2: its hours) + assignee unchanged → the task's entire workload set deep-equals the pre-save set INCLUDING ids; exactly one activity row appended.
2. **Grow:** D cell 5 → 6 → block @ 840 becomes 4h (same id), block @ 480 untouched.
3. **Grow with clamp:** separate fixture, single block 0.5h @ 1380; cell → 3 → 3h with startMinutes 1260.
4. **Shrink within last block:** D 5 → 4 → 840-block 2h, 480-block unchanged, both ids kept.
5. **Shrink across blocks:** D 5 → 1.5 → 840-block deleted, 480-block 1.5h @ 480, sortIndex 0.
6. **Zero deletes pair:** D cell 0 (omit the cell) → both D blocks gone; D2 and bin rows byte-identical.
7. **Snap:** D cell 5.1 → treated as 5 (lossless, same rows).
8. **New day:** cell on empty day D3 → exactly one new entry, `startMinutes`/`sortIndex` per `nextFreeStart`/`nextSortIndex` (assert concrete values given the fixture).
9. **Mixed dated + bin unchanged:** bin row id/hours preserved across an unchanged save; with `newUnassigned: [{personId: P, hours: 2}]` the existing bin row's id is KEPT and hours become 6 (no second bin row).
10. **Unassign:** `assigneeIds` without P → all P's dated + bin rows for T removed.
11. **sortIndex contiguity:** after case 5, P's day-D sortIndexes are 0..n with rank by startMinutes (also spot-check in case 8's day).

In `storage.test.ts`: one round-trip test — persist a valid v-current payload containing the two-block day, `loadData()` back, assert the two entries survive exactly (`ensureStartMinutes`/`normalizeDates` must not alter valid rows).

### Out of scope
- Any production code change (if a test exposes a real bug, STOP, report it in RUN-STATE.md instead of patching source).
- Modifying existing tests; DOM/browser tests (separate package); TaskModal/AllocationGrid component tests (no RTL in repo).

## Implementation notes

- Import `reducer` and payload types from `../store/AppStore` the same way `dateGuards.test.ts` does; use quarter-exact float literals (0.25 multiples compare exactly).
- Byte-identical assertions: compare sorted-by-id arrays of `{id, taskId, personId, date, plannedHours, startMinutes, sortIndex}` with `toEqual`.

## Acceptance criteria

- [ ] All cases above implemented and passing; each rejection/preservation asserts ids, not just totals.
- [ ] Existing suites untouched and green; `npx tsc --noEmit` clean.

## Tests

- Command: `npx tsc --noEmit` && `npm test` (node-API fallback as above).
- Expected: 0 tsc errors; all pre-existing tests green plus ≥12 new tests.

## Report back

Synthesized summary (files, test counts, any bug found) appended to `handoffs/RUN-STATE.md` Worker log. No raw logs.
