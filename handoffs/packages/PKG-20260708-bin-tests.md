# Handoff: Unit tests for bin entries (reducer + storage normalization)

- **Package ID:** PKG-20260708-bin-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260708-bin-core (parallel-safe with
  PKG-20260708-bin-week-ui — you touch only `*.test.ts` files)
- **Blast radius:** none — test files only.

## Goal

Cover the new bin ("unassigned block") behavior added by PKG-20260708-bin-core:
the four new/changed reducer actions, the SAVE_TASK bin rules, the guards on
existing actions, and the `ensureStartMinutes` bin normalization.

## Context the worker needs

- Relevant files (read): `src/store/AppStore.tsx` (exported `reducer`),
  `src/store/storage.ts` (`ensureStartMinutes`), `src/utils/time.ts`
  (`BIN_DATE`, `isBinEntry`, `HOURS_STEP`), `src/store/selectors.ts`
  (`binEntriesForPerson`, `binEntriesForTask`, `binTotalForPerson`).
- Relevant files (write): extend `src/store/blockActions.test.ts` and
  `src/store/storage.test.ts` — follow their existing fixture style (plain
  `AppData` literals, on-grid values, reference-equality rejection checks).
- Read `handoffs/packages/PKG-20260708-bin-core.md` for the exact intended
  semantics (split rounding rule, shrink-to-bin rule, guards). If the
  implementation deviates from that package, report the mismatch — do NOT
  bend assertions to match a bug.
- Conventions: bin entries have `date: BIN_DATE ('')`, `startMinutes: 0`,
  contiguous `sortIndex` per person's bin. Rejections return the SAME state
  reference (`expect(result).toBe(state)`).

## Scope

### In scope — test cases (one `it` each, roughly)

In `src/store/blockActions.test.ts` (new `describe` blocks):

1. **MOVE_BLOCK_TO_BIN:** dated entry → bin (`date === ''`, `startMinutes === 0`,
   appended after an existing bin entry, i.e. sortIndex 1); the vacated day's
   remaining entries reindex to contiguous 0..n; exactly one activity row added.
2. **MOVE_BLOCK_TO_BIN no-ops:** already-bin entry → `toBe(state)`; unknown
   entryId → `toBe(state)`.
3. **SPLIT_BLOCK halves, even:** 6h dated block, parts=2 → original keeps
   date/startMinutes/sortIndex with 3h; one new 3h bin entry.
4. **SPLIT_BLOCK halves, odd quarters:** 1.25h, parts=2 → original 0.75h stays;
   0.5h bin entry (larger half stays scheduled).
5. **SPLIT_BLOCK quarters:** 1.25h, parts=4 → original 0.5h + three 0.25h bin
   entries, bin sortIndex contiguous in creation order.
6. **SPLIT_BLOCK on a bin entry:** splits within the bin (original stays a bin
   entry, parts appended to bin end).
7. **SPLIT_BLOCK rejections:** 0.25h parts=2 → `toBe(state)`; 0.75h parts=4 →
   `toBe(state)`; unknown id → `toBe(state)`.
8. **DELETE_BLOCK:** removes a bin entry and reindexes the person's remaining
   bin entries; dated entry → `toBe(state)`; unknown id → `toBe(state)`.
9. **SET_BLOCK_TIME shrink-to-bin:** resize 8h→6h (same date/start) → entry has
   6h AND a new 2h bin entry exists for the same task+person; activity message
   contains `wróciło do zasobnika`.
10. **SET_BLOCK_TIME plain move:** same hours, new time/day → NO bin entry
    created (workload length unchanged).
11. **SET_BLOCK_TIME bin→grid:** bin entry dropped on a date/time → gets that
    date + startMinutes, bin group reindexes, task period extends when the date
    is outside it; a drop colliding with the same person's block →
    `toBe(state)`.
12. **SAVE_TASK preserves bin entries:** existing bin entry for a
    still-assigned person survives a re-save (same id present, hours
    unchanged); bin entries of an UNassigned person are dropped.
13. **SAVE_TASK newUnassigned:** payload with `newUnassigned:
    [{personId, hours: 10}]` creates a `date: ''` entry with `startMinutes: 0`
    appended to that person's bin; hours off-grid (e.g. 1.3) get snapped;
    `hours: 0` items are skipped; a personId not in `assigneeIds` is skipped.
14. **MOVE_TASK skips bin:** task with one dated + one bin entry moved +2 days
    → dated entry shifts, bin entry identical (`toEqual` on the object).
15. **SET_TASK_DATES keeps bin:** shrinking the period drops out-of-period
    dated entries but keeps the bin entry.
16. **INSERT_BLOCK bin ref:** payload whose `refEntryId` is a bin entry →
    `toBe(state)`.

In `src/store/storage.test.ts` (extend):

17. **ensureStartMinutes bin normalization:** a bin entry with
    `startMinutes: 300` and gappy sortIndex (0, 3) → normalized to
    `startMinutes: 0` and contiguous 0,1; dated groups in the same payload
    behave exactly as before (existing tests must stay green untouched).
18. **Idempotence + reference equality:** already-clean bin group →
    `toBe(state)`; running the pass twice equals running it once.
19. **Bin group NOT stacked from 08:00:** two valid bin entries must both end
    up at `startMinutes: 0` (not 480/…), proving the stacking rule excludes
    the bin.

### Out of scope

- Any `src/` non-test file, `package.json`, `vitest.config.ts`, UI tests,
  WeekView/TaskModal behavior, CLAUDE.md.

## Implementation notes

- Build minimal fixtures: 1 task (with a valid period covering the dated
  entries), 1–2 people, assignments present for every workload entry's person
  (invariant). Reuse the fixture helpers/pattern already in
  `blockActions.test.ts`.
- Action type names/payloads must match `src/store/AppStore.tsx` exactly —
  read the implementation first; if an action described here is missing or
  named differently, STOP and report instead of guessing.

## Acceptance criteria

- [ ] All cases above implemented with real assertions (no snapshot-only
      tests); rejection cases assert reference equality.
- [ ] Full suite green: existing 37 tests + new ones.
- [ ] No app source file modified.
- [ ] Any semantic mismatch between bin-core's implementation and its package
      spec is reported, not papered over.

## Tests

- Command: `npm test` (then `npx tsc --noEmit && npm run build` as smoke)
- Expected: all pass; tsc clean; build unchanged.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md` (counts, gaps found in
bin-core, deviations). No raw logs.
