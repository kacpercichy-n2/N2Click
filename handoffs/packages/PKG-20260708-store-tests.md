# Handoff: Vitest coverage — budget/merge reducer rules, v4→v5 migration, permissions, availability

- **Package ID:** PKG-20260708-store-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260708-budget-store AND PKG-20260708-auth-data (test the shipped behavior; read their RUN-STATE reports first)
- **Blast radius:** none — test files only. Do NOT modify any implementation file; if you find a spec/implementation mismatch, report it instead of fixing it.

## Goal

Unit-test the two store packages: budget-capped resize + bin conservation +
one-bin-row invariant + adjacent-block merge (`PKG-20260708-budget-store`), and
the v5 person model — migration, permission map, password utility, cycle guard,
availability selectors (`PKG-20260708-auth-data`).

## Context the worker needs

- Relevant files (read, don't edit): `src/store/AppStore.tsx` (reducer),
  `src/store/selectors.ts`, `src/store/permissions.ts`, `src/store/storage.ts`
  (`ensureStartMinutes`, `loadData`/migration — note `loadData` reads
  localStorage; test the exported pure pieces, and for migration either call the
  exported migrate/normalize functions or stub `localStorage` the way
  `src/store/storage.test.ts` already does), `src/utils/password.ts`.
- Test files to extend / create: `src/store/blockActions.test.ts`,
  `src/store/storage.test.ts`, `src/store/selectors.test.ts`, new
  `src/store/permissions.test.ts`.
- Follow the existing fixture style (`makeState`/`makePerson` helpers in
  `blockActions.test.ts`); rejections assert REFERENCE equality
  (`expect(next).toBe(state)`).
- The exact decided semantics are in the two upstream packages
  (`handoffs/packages/PKG-20260708-budget-store.md`,
  `handoffs/packages/PKG-20260708-auth-data.md`) — treat those as the spec.

## Scope

### In scope — cases to cover

`blockActions.test.ts` (SET_BLOCK_TIME budget/merge):
1. Grow rejected (same reference) when task estimate exhausted and person has
   no same-task bin hours.
2. Grow drawing purely from the bin: bin row reduced by the delta, task total
   unchanged; activity contains `pobrano z zasobnika`.
3. Grow draining the bin row to 0 → row deleted; remainder drawn from headroom;
   task total never exceeds the estimate.
4. Grow with `estimatedHours: null` → free grow, bin untouched (regression).
5. Grow must NOT consume another person's bin row or another task's bin row.
6. Shrink merges the delta into an existing (task, person) bin row (no second
   row); shrink with no existing row creates exactly one.
7. Move-only drag (hours unchanged) never budget-rejected even at zero
   allowance.
8. Adjacency merge: drop landing exactly at a same-task same-person block's end
   → ONE entry, earlier block's id survives, hours summed, sortIndex contiguous,
   activity contains `połączono sąsiednie bloki`.
9. Cascade merge: three same-task blocks where the drop makes A|B|C all
   touching → one entry.
10. No merge across different tasks, different people, or with a 15-min gap.
11. One-bin-row invariant across writers: SPLIT_BLOCK ×4 (one summed bin row,
    merged into a pre-existing row), MOVE_BLOCK_TO_BIN onto an existing row
    (existing row id survives, moved entry gone), SAVE_TASK `newUnassigned`
    with two items for one person (single row), REASSIGN_ENTRY of a bin row to
    a person who already has one (target row id survives).
12. Supervisor cycle guard: UPDATE_PERSON with self-supervision → stored `''`;
    A→B→A → `''`; valid chain stored as-is.
13. SET_PASSWORD sets only the hash; UPDATE_PERSON preserves an existing hash;
    LOGOUT clears `currentUserId`.

`storage.test.ts`:
14. `ensureStartMinutes` merges duplicate per-task bin rows (lowest-sortIndex id
    kept, hours summed, sortIndex renumbered); idempotent — second run returns
    the same reference; distinct-task bin rows untouched.
15. Migration v4→v5: an `isAdmin: true` person → `accessRole 'administrator'`;
    `isAdmin: false` → `'pracownik'`; new fields get documented defaults
    (`phone ''`, `passwordHash ''`, `workDays [1..5]`, `workStartMinutes 480`,
    `workEndMinutes 480 + capacity*60` capped at 1440, `supervisorId ''`); no
    `isAdmin` key remains; version becomes 5; loading a v5 payload is
    idempotent.

`selectors.test.ts`:
16. `growAllowanceHours`: null estimate → null; bin + headroom summed; headroom
    floored at 0 for an over-budget legacy task.
17. Availability: person with `workDays [1,2,3,4]` → 0 on a Friday date,
    capacity on a Wednesday; `availableHoursInRange` sums a Mon–Sun week
    correctly.

`permissions.test.ts` (new):
18. The full matrix from PKG-20260708-auth-data decision 7 — one assertion per
    (role, action) cell, table-driven; zero-people setup mode allows everything;
    undefined user (people present) gets false for every action.
19. `hashPassword('a')` →
    `ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb`;
    `verifyPassword` accepts the right password and rejects a wrong one.

### Out of scope

- Editing ANY implementation file, WeekView/TaskModal, styles.
- UI/interaction tests (browser walkthrough is a human gate).
- Restructuring existing tests beyond adding describes/fixture params.

## Implementation notes

- Table-driven where natural (permission matrix, merge predicates).
- Use fixed dates in 2026-07 (a known Mon–Sun week: 2026-07-06 is a Monday).
- If any case is impossible to write because the implementation deviates from
  the upstream package spec, STOP on that case, cover the rest, and flag the
  mismatch in your report — do not bend the assertion to the code if the code
  contradicts the spec.

## Acceptance criteria

- [ ] All 19 case groups above have at least one meaningful `it` (split into
      more where clearer); assertions check real values, not just "truthy".
- [ ] Rejection cases assert reference equality.
- [ ] `npm test` green; `npx tsc --noEmit` clean; no implementation file
      modified (verify with `git status` in your report).

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: previous count + your new tests, all passing. Don't run the dev
  server (5173 already in use); `npm run build` not required for a test-only
  package (reviewer re-runs it).

## Report back

Synthesized summary only: test files touched, number of new `it`s per file,
pass/fail counts, any spec/implementation mismatches found, skipped cases with
reasons. Append to `handoffs/RUN-STATE.md` under the current run's Worker log.
