# Handoff: Add explicit `Status.isDone` semantics — model, migration, selectors, reducer guards

- **Package ID:** PKG-20260712c-status-done-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — data model + migration + completion semantics used by /my-work, agenda, timeline. No payments/auth/external calls.

## Goal

Completion is currently *inferred from pipeline position*: `doneStatusId` in
`src/store/selectors.ts` returns the LAST ACTIVE status, so reordering or
archiving statuses silently changes which tasks count as done (resurrecting
completed work as overdue). Replace that with an explicit, stored
`Status.isDone: boolean`, migrate existing data so current semantics are
preserved, switch every completion-dependent selector to the flag, and add
reducer guards so admins cannot destroy the pipeline's structural invariants.

## Context the worker needs

- Relevant files: `src/types.ts` (Status interface, ~line 42),
  `src/store/storage.ts` (DATA_VERSION=6 at line 29, `buildDefaultStatuses`
  ~line 79, `normalizeTaskMeta` ~line 682 as the pattern to copy, `loadData`
  ~line 722), `src/store/selectors.ts` (`activeStatuses` ~69, `doneStatusId`
  ~85, `todayAgendaForPerson` ~292, `overdueTasksForPerson` ~540,
  `unplannedTasksForPerson` ~576), `src/store/AppStore.tsx` (status actions:
  `saveStatus` ~1283, `reorderStatus` ~1312, `deleteStatus` ~1326, reducer
  cases `SET_STATUS_ARCHIVED` / `DELETE_STATUS` ~1686–1694, Action union
  ~166–169), `src/pages/TimelinePage.tsx` (line 261 re-derives the done id
  locally — the only page that does), `src/store/selectors.test.ts` (imports
  `doneStatusId`; lines ~412, ~552–570, ~578, ~734 assume last-active = done),
  `src/store/seed.ts` (line 29–30 destructures `buildDefaultStatuses()` — no
  change needed there, verify only).
- Conventions: `CLAUDE.md` (root) — reducer returns state UNCHANGED on any
  guard violation; all reads via pure selectors; every-load idempotent
  normalize passes (`ensureStartMinutes`, `normalizeDates`, `normalizeTaskMeta`)
  are the house migration pattern.
- Prior decisions (architect — final, do not reopen):
  1. `isDone` is a plain boolean on Status. MULTIPLE statuses may be done.
  2. **Archived done statuses still count as done.** The done-set is over ALL
     statuses with `isDone === true`, archived included — this is what stops
     archival from reviving completed work.
  3. `doneStatusId` is REMOVED (not deprecated). New selectors:
     `doneStatusIds(state): Set<string>` and
     `isDoneStatus(state, statusId: string): boolean`.
  4. Migration default: if no status has `isDone === true` and statuses exist,
     mark the LAST ACTIVE status by `order` (exactly the value old
     `doneStatusId` returns today). If ALL statuses are archived, mark the
     last status overall by `order` (deliberate repair of a pathological case,
     not preservation of it). Zero statuses → mark nothing.
  5. Guards (reducer refuses, returns state unchanged):
     - archive (SET_STATUS_ARCHIVED, archived=true): refused if the status is
       the only ACTIVE status, OR the only `isDone` status among all statuses.
     - restore (archived=false): always allowed.
     - DELETE_STATUS: refused if referenced (existing rule), OR only active,
       OR only `isDone`.
     - new action SET_STATUS_DONE: turning ON always allowed; turning OFF
       refused if it is the only `isDone` status.
  6. Newly created statuses (SAVE_STATUS with statusId=null, incl. Kanban
     quick-create) get `isDone: false`.

## Scope

### In scope

1. `src/types.ts` — add `isDone: boolean` to `Status` with a comment: stable
   completion semantics, independent of pipeline `order` and `archived`.
2. `src/store/storage.ts`:
   - `DATA_VERSION = 7`.
   - `buildDefaultStatuses()`: `isDone: false` on all, `true` on `Gotowe`
     (the last default).
   - New exported `normalizeStatusFlags(data: AppData): AppData`, an
     idempotent EVERY-LOAD pass in the exact style of `normalizeTaskMeta`
     (doc comment included): coerce each status's `isDone` to
     `s.isDone === true`; then, if `statuses.length > 0` and NO status is
     done, apply decision 4's default. Return the same object when nothing
     changed (follow `normalizeDates`'s `changed` pattern if convenient).
   - Wire it into `loadData()` in BOTH return branches (the `version < 2`
     branch and the main branch), composed alongside `normalizeTaskMeta`.
   - Verify `localizeLegacyData` is idempotent for a v6 payload (the version
     bump makes it run once on v6 data — it maps English default status names
     to Polish; confirm Polish names pass through unchanged and note it in
     the code only if a comment is missing).
3. `src/store/selectors.ts`:
   - Delete `doneStatusId`. Add `doneStatusIds` + `isDoneStatus` per
     decision 3 (archived included — say so in the doc comment).
   - Update `todayAgendaForPerson`, `overdueTasksForPerson`,
     `unplannedTasksForPerson` to `!doneIds.has(t.statusId)`. Fix their doc
     comments (they currently say "the last active status").
4. `src/pages/TimelinePage.tsx` line 261 — replace the local
   `activeStatuses(state).slice(-1)[0]?.id` derivation with the new selector
   (`doneStatusIds` once per render is fine).
5. `src/store/AppStore.tsx`:
   - Action union: add `{ type: 'SET_STATUS_DONE'; statusId: string; isDone: boolean }`.
   - `saveStatus`: created statuses get `isDone: false`; rename path must
     preserve the existing `isDone`.
   - Implement guards per decision 5 in the `SET_STATUS_ARCHIVED` case,
     `deleteStatus`, and the new `SET_STATUS_DONE` case (small pure helpers
     inside AppStore.tsx are fine, e.g. `isOnlyActiveStatus` /
     `isOnlyDoneStatus`). No activity-log rows for status admin actions
     (consistent with SAVE_STATUS today).
6. `src/store/selectors.test.ts` — MECHANICAL updates only, to keep the suite
   green: replace `doneStatusId` import/uses with the new selectors, and give
   test fixtures' statuses an `isDone` field wherever the Status shape is
   constructed (the last/"done" fixture status gets `true`). Do not add new
   coverage here — the deep tests are a separate package
   (PKG-20260712c-status-tests). Same mechanical treatment for any other test
   file that fails to compile because of the Status shape change (check
   `src/store/storage.test.ts`, `src/store/blockActions.test.ts`,
   `src/store/saveTaskWorkload.test.ts`).

### Out of scope

- ANY admin/Kanban/TaskModal/ProjectDetailPage UI work (PKG-20260712c-status-admin-ui).
- New test coverage beyond keeping the existing suite green (PKG-20260712c-status-tests).
- Browser-check script and CLAUDE.md edits (PKG-20260712c-status-browser-docs).
- Project-card/formal-sales status fields — explicitly excluded by the user.
- Do not change `SET_TASK_STATUS` / `SET_PROJECT_STATUS`, seed data content,
  or anything about the bin/budget/block model.

## Implementation notes

- The whole point of decision 2: after this package, archiving a used done
  status (when another done status exists) leaves its tasks/projects counted
  as done; reordering statuses can never change doneness.
- `normalizeStatusFlags` must be idempotent by value: a second run on its own
  output changes nothing (once ≥1 `isDone` exists it never rewrites flags).
- "Only active" means: archiving/deleting it would leave ZERO active statuses.
  "Only done" means: no OTHER status (active or archived) has `isDone`.
- Environment: NO git commands, NO `npm run build`/`vite`/`curl`. Allowed:
  `npx tsc --noEmit`, `npm test`, `node <path>`. Production build if needed:
  `node -e "import('vite').then(v => v.build())"`.
- Log your result to `handoffs/RUN-STATE.md` under the worker log (files
  changed one-liners, tests run + result, deviations).

## Acceptance criteria

- [ ] `Status` has `isDone: boolean`; `buildDefaultStatuses()` marks only
      `Gotowe`; fresh empty/seed data therefore has exactly one done status.
- [ ] Loading a stored v6 payload (no `isDone` anywhere) yields `isDone: true`
      on exactly the status old `doneStatusId` would have returned; loading
      the result again changes nothing (idempotent).
- [ ] All-archived v6 payload → last status by `order` becomes done; zero
      statuses → no crash, empty done-set.
- [ ] `doneStatusId` no longer exists anywhere in `src/` (grep clean);
      `doneStatusIds` includes archived done statuses.
- [ ] Reordering statuses (REORDER_STATUS) has zero effect on `doneStatusIds`.
- [ ] Reducer refuses (state unchanged, no partial writes): archiving the only
      active status; archiving the only done status; deleting a referenced /
      only-active / only-done status; un-toggling the only done status.
      Toggling done ON, restoring from archive, and archiving a non-last,
      non-only-done status all still work.
- [ ] TimelinePage overdue tint uses the new selector (no local last-active
      derivation remains; grep `slice(-1)` in `src/pages/` returns nothing).
- [ ] `npx tsc --noEmit` → 0 errors; `npm test` → all green (baseline 9 files /
      320 tests; mechanical fixture updates only).

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: 0 type errors; full suite green with only mechanical adjustments
  to existing tests. New migration/selector/guard tests are NOT yours — they
  land in PKG-20260712c-status-tests.

## Report back

Synthesized summary only: files changed one-line each, test pass/fail counts,
any deviation from decisions 1–6 (there should be none), deferrals. No raw logs.
