# Handoff: Add a shared reducer-command validation boundary for persistent entity mutations

- Package ID: PKG-20260713-reducer-validation
- Status: ready (amended — see Amendment 2026-07-13 at the end)
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required

## Goal

One small, pure validation module composed into the existing reducer so that
stale-ID, missing-title, dangling-reference and malformed-estimate command
payloads are rejected by returning the ORIGINAL state reference — without
touching any existing guard or reconciliation logic.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `src/store/AppStore.tsx` (wire calls only — no logic redesign)
- `new: src/store/commandValidation.ts`
- `new: src/store/commandValidation.test.ts`
- Amendment: fixture-only edits in `src/store/taskMeta.test.ts`,
  `src/store/saveTaskWorkload.test.ts`, `src/store/blockActions.test.ts`

## Module design (settled — do not re-decide)

Create `src/store/commandValidation.ts` as a sibling module (AppStore.tsx is
already ~2100 lines; a pure sibling keeps the diff reviewable and is directly
unit-testable). It contains ONLY pure read-only predicates — the reducer stays
the sole mutation boundary. Draft types come from AppStore via a
**type-only import** (`import type { TaskDraft, ProjectDraft, PersonDraft }
from './AppStore'`) — type-only, so no runtime import cycle.

Exact exports:

```ts
export type RefEntityKind = 'task' | 'project' | 'milestone' | 'status' | 'person' | 'client';

/** True when an entity of `kind` with this id exists in state. */
export function hasEntity(state: AppData, kind: RefEntityKind, id: string): boolean;

/** Required display name/title: non-empty after trim. */
export function isRequiredName(value: string): boolean;

/** Task estimate: null (no estimate) OR a finite number >= 0.
 *  Deliberately NO quarter-grid check — legacy off-grid estimates (e.g. 5.1h)
 *  must keep round-tripping through an edit (valid-legacy rule). */
export function isValidEstimate(value: number | null): boolean;

/** Title required; draft.projectId and draft.statusId must exist; estimate valid.
 *  Does NOT check dates — the existing periodError guard in saveTask owns that
 *  (compose, never duplicate). Does NOT check workCategoryId — saveTask
 *  self-heals a stale one to '' and that behavior must stay. */
export function isValidTaskDraft(state: AppData, draft: TaskDraft): boolean;

/** Name required; draft.statusId must exist. Client rule:
 *  - create (existing === null): draft.clientId must exist, OR be '' with a
 *    non-empty trimmed newClientName (the atomic create-client path);
 *  - edit: draft.clientId must exist OR be strictly EQUAL to
 *    existing.clientId (a legacy orphan project — ProjectsPage renders a
 *    "Bez klienta" group for unknown clientIds — must remain editable, but a
 *    SWITCH to a dangling client is rejected). */
export function isValidProjectDraft(
  state: AppData,
  draft: ProjectDraft,
  existing: Project | null,
  newClientName?: string,
): boolean;

/** firstName required (non-empty after trim). Nothing else: capacity already
 *  self-heals to DEFAULT_CAPACITY, supervisor cycles are guarded elsewhere. */
export function isValidPersonDraft(draft: PersonDraft): boolean;
```

All rejections are silent same-reference returns (house convention). No new
user-facing strings, Polish or otherwise.

## Exact action → check wiring in `reducer` / handlers

Add checks in `src/store/AppStore.tsx`; each failed check `return state;`
BEFORE any activity row is appended. Existing guards run first, unchanged.

1. `SAVE_TASK` (inside `saveTask`, AFTER the existing `periodError` and
   allocation/newUnassigned guards):
   - `payload.taskId !== null && !hasEntity(state, 'task', payload.taskId)` → reject.
     (Today a stale edit id silently skips the task map but STILL rebuilds
     assignments/workload for the ghost id and appends an activity row — the
     worst live corruption path; call this out in the code comment.)
   - `!isValidTaskDraft(state, draft)` → reject.
   - `payload.assigneeIds.some((id) => !hasEntity(state, 'person', id))` → reject
     atomically. (Allocations/newUnassigned are already filtered by the
     assignee set, so validating `assigneeIds` covers every person reference
     that can persist.)
   ALL THREE checks are wired in the reducer — full enforcement, per the
   Amendment below (the earlier "zero test edits" rule that blocked the
   reference checks is superseded).
2. `SET_TASK_STATUS`: reject unless `hasEntity(state, 'task', taskId)` AND
   `hasEntity(state, 'status', statusId)`. (Today a dangling statusId is
   persisted onto the task and a stale taskId still appends activity.)
3. `SAVE_PROJECT` (inside `saveProject`, AFTER the existing `periodError` guard):
   - `projectId !== null && !hasEntity(state, 'project', projectId)` → reject.
   - `!isValidProjectDraft(state, draft, existingProjectOrNull, newClientName)` → reject.
4. `SET_PROJECT_PAID`: reject unless `hasEntity(state, 'project', projectId)`.
5. `SET_PROJECT_DATES`: keep the periodError guard; additionally reject unless
   the project exists (today a stale id appends a garbage activity row).
6. `SET_PROJECT_STATUS`: the stale-project guard already exists — keep it;
   ADD `hasEntity(state, 'status', statusId)` (dangling statusId currently persists).
7. `SAVE_MILESTONE` (inside `saveMilestone`, AFTER the existing `isValidDateStr`
   guard): reject unless `hasEntity(state, 'project', projectId)`; reject unless
   `isRequiredName(name)`; on edit reject unless
   `hasEntity(state, 'milestone', milestoneId)`.
8. `DELETE_MILESTONE`: reject (same ref) when the milestone does not exist —
   today it returns a NEW, content-identical state object.
9. `SAVE_STATUS` (inside `saveStatus`): keep the existing empty-name guard
   exactly as is (it already covers required-title for statuses); on rename
   reject unless `hasEntity(state, 'status', statusId)` (today a stale rename
   returns a new identical state reference).
10. `DELETE_STATUS`: add `hasEntity(state, 'status', statusId)` FIRST; the
    existing referenced/only-active/only-done refusals stay byte-identical.
11. `ADD_PERSON`: reject unless `isValidPersonDraft(action.person)`. The
    first-person-forced-admin rule and supervisor-cycle guard stay unchanged.
12. `UPDATE_PERSON`: `target` is already looked up — add `if (!target) return
    state;` immediately after the lookup, then reject unless
    `isValidPersonDraft(action.person)`. The last-admin demotion guard and
    cycle guard stay unchanged and run after.
13. `DELETE_PERSON`: add `hasEntity(state, 'person', personId)` BEFORE the
    last-admin guard; the guard and the deletePerson cascade stay unchanged.
14. `SET_CURRENT_USER`: reject unless `action.personId === '' ||
    hasEntity(state, 'person', action.personId)`. `''` stays allowed
    (equivalent to logout, harmless); LoginPage only dispatches live ids.

Already correctly guarded — VERIFY ONLY, do not touch: `MOVE_TASK`,
`SET_TASK_DATES`, `MOVE_MILESTONE`, `IMPERSONATE`, `STOP_IMPERSONATION`,
`SET_STATUS_ARCHIVED`, `SET_STATUS_DONE`, `REORDER_STATUS`.

## Invariants

- Reject-by-same-reference: every rejection returns the ORIGINAL `state`
  object and appends no activity row.
- Existing guards are composed with, never duplicated, weakened or replaced:
  periodError date guards; SAVE_TASK allocation/newUnassigned validation,
  workload delta reconciliation, bin-row identity and workCategoryId
  self-heal; last-admin guards; supervisor-cycle guard; first-person-admin
  rule; status min-count guards (`isOnlyActiveStatus` / `isOnlyDoneStatus`);
  budget/collision guards in `setBlockTime` / `insertBlock` / `scheduleBinPart`.
- Valid legacy payloads keep working: editing a legacy orphan project
  (unchanged dangling clientId), a legacy off-grid estimate (e.g. 5.1h), and
  every currently-green SAVE_TASK/status/workload behavior.
- No behavior/persistence-shape change for any accepted command.

## Scope

- Create `src/store/commandValidation.ts` with exactly the exports above.
- Wire the 14 checks listed above into `src/store/AppStore.tsx`.
- Create `src/store/commandValidation.test.ts` (cases below).
- Amendment: fixture-realism edits in the three named pre-existing test files.

## Out of scope

- Dictionary actions (`ADD/RENAME/DELETE_CLIENT/DEPARTMENT/SERVICE_TYPE/
  WORK_CATEGORY`), `ADD_COMMENT`, `SET_PASSWORD`, `LOGOUT`, filter presets,
  all block/bin actions (`INSERT_BLOCK`, `SET_BLOCK_TIME`, `REASSIGN_ENTRY`,
  `MOVE_BLOCK_TO_BIN`, `SPLIT_BLOCK`, `SCHEDULE_BIN_PART`, `DELETE_BLOCK`),
  `LOAD_SAMPLE` / `RESET_ALL` / `REPLACE_FROM_STORAGE`.
- `MOVE_TASK` dayDelta integer validation (not in the declared check list).
- Navigation guards, activity attribution, authentication, permissions,
  storage conflicts, browser routing, storage.ts repair logic.
- Any new user-facing strings or UI changes.
- Quarter-grid enforcement on `estimatedHours` (settled: no — legacy safety).

## Acceptance

- [ ] Every rejected case in the test list below returns the same state
      reference and leaves `state.activity.length` unchanged.
- [ ] SAVE_TASK with a stale taskId can no longer create ghost assignments,
      workload rows or activity rows.
- [ ] SAVE_TASK can no longer persist a dangling projectId/statusId or an
      unknown assignee person (full point-1 enforcement, per Amendment).
- [ ] SET_TASK_STATUS / SET_PROJECT_STATUS can no longer persist a dangling
      statusId; SET_CURRENT_USER can no longer persist a dangling personId.
- [ ] Valid-legacy cases (orphan-client project edit, off-grid estimate edit,
      SET_CURRENT_USER '') still succeed.
- [ ] All pre-existing focused suites stay green. Assertions, test names and
      tested behavior are unchanged everywhere; the ONLY permitted edits to
      pre-existing tests are the fixture-realism additions defined in the
      Amendment, limited to `taskMeta.test.ts`, `saveTaskWorkload.test.ts`,
      `blockActions.test.ts`.
- [ ] Diff stays inside: the three touchpoint files + the three amended
      fixture files.

## Test plan — `src/store/commandValidation.test.ts`

Copy the fixture pattern from `src/store/dateGuards.test.ts` (hand-built
minimal AppData via `emptyData()`; pure `reducer(state, action)` calls; assert
`expect(next).toBe(state)` and unchanged `activity.length` for rejections).
Extend the fixture with a second status, a second person and one legacy orphan
project (`clientId: 'ghost-client'`).

Rejected (same-ref, no activity row):

1. SAVE_TASK edit with `taskId: 'ghost'` and a non-empty `assigneeIds` +
   `allocations` payload — also assert `next.assignments` / `next.workload`
   gained nothing (the ghost-entity regression test).
2. SAVE_TASK with whitespace-only title.
3. SAVE_TASK with dangling `draft.projectId`.
4. SAVE_TASK with dangling `draft.statusId`.
5. SAVE_TASK with `estimatedHours: -1`; another with `Number.NaN`.
6. SAVE_TASK with an unknown person id in `assigneeIds`.
7. SET_TASK_STATUS with stale taskId; with dangling statusId.
8. SAVE_PROJECT edit with stale projectId; with whitespace-only name; with
   dangling statusId; create with dangling clientId; create with `''` clientId
   and no/blank newClientName.
9. SET_PROJECT_PAID with stale projectId; SET_PROJECT_DATES with stale projectId.
10. SAVE_MILESTONE create with dangling projectId; edit with stale milestoneId;
    create with whitespace-only name.
11. DELETE_MILESTONE with stale milestoneId (same-ref now, not a new copy).
12. SAVE_STATUS rename with stale statusId; DELETE_STATUS with stale statusId.
13. ADD_PERSON with whitespace-only firstName; UPDATE_PERSON with stale
    personId; UPDATE_PERSON with whitespace-only firstName; DELETE_PERSON with
    stale personId.
14. SET_CURRENT_USER with stale personId.

Valid / valid-legacy (state changes as before):

15. SAVE_TASK valid edit (title change) still persists; `estimatedHours: 5.1`
    (off-grid legacy) round-trips unchanged.
16. SAVE_PROJECT edit of the orphan project keeping `clientId: 'ghost-client'`
    succeeds; SAVE_PROJECT create with `clientId: ''` + `newClientName: 'Nowy'`
    still creates client + project atomically.
17. SET_CURRENT_USER with an existing person sets it (and `''` is accepted and
    clears both identity fields).
18. UPDATE_PERSON valid edit still applies and the last-admin demotion is
    still refused (guard composition, not replacement).

## Verification

- Worker: `npx vitest run src/store/commandValidation.test.ts src/store/dateGuards.test.ts src/store/taskMeta.test.ts src/store/statusActions.test.ts src/store/saveTaskWorkload.test.ts src/store/blockActions.test.ts src/store/selectors.test.ts src/store/storage.test.ts`
- Browser: none — pure reducer boundary, no covered interaction changes.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Boundary lives in a new sibling module `src/store/commandValidation.ts`
  (pure predicates), not inside AppStore.tsx; type-only imports avoid cycles.
- Rejections are silent same-ref returns; no error strings, no UI.
- Estimate rule: `null` or finite `>= 0`; NO quarter-grid check (legacy safety).
- Project client rule: strict on create; on edit an UNCHANGED dangling
  clientId passes (legacy orphan projects stay editable), a changed one must exist.
- `workCategoryId` keeps its existing self-heal-to-`''`; statusId/projectId are
  required references and reject instead (different because `''` is a legal
  workCategoryId but not a legal statusId/projectId).
- `SET_CURRENT_USER` with `''` stays allowed; any other id must exist.
- Dictionary entities and block/bin actions are explicitly out of this boundary.

## Amendment 2026-07-13 (architect adjudication — supersedes "zero test edits")

Conflict: full SAVE_TASK reference enforcement (point 1: dangling
`draft.projectId` / `draft.statusId`, unknown `assigneeIds`) failed 18
pre-existing tests whose fixtures are "headless" — drafts reference
`proj1` / `status1` / `p1` while the fixture `projects` / `statuses` / `people`
arrays do not contain those entities. The original package forbade any
pre-existing test edit, so the developer shipped the predicate but left the
reference checks unwired.

Decision: **enforce fully (option A)**. The scheduler prompt explicitly
requires status/project reference validation and its Expected touchpoints
include the `src/store/*.test.ts` glob, so fixture edits are inside the
declared boundary. The "zero test edits" rule was a proxy for "no behavior
weakening", not an end in itself; headless fixtures assert nothing about
dangling references.

Constraints for the fixture edits:

- Files: ONLY `src/store/taskMeta.test.ts`, `src/store/saveTaskWorkload.test.ts`,
  `src/store/blockActions.test.ts`.
- Permitted change: fixture/setup code only — add the Project/Status/Person
  entities whose ids the drafts, tasks and `assigneeIds` already reference,
  following the constant pattern in `dateGuards.test.ts`. Keep existing ids
  (`proj1`, `status1`, `p1`, …) verbatim; no renames.
- Forbidden: adding/removing/altering any `expect(...)`; renaming, deleting,
  skipping or reordering tests; modifying action payloads under test;
  changing any expected value or tested behavior.
- Escape hatch: if any test still fails after fixtures are self-consistent,
  that is a real behavioral conflict — stop and report back; do not adapt the
  test.
- Then wire the remaining point-1 checks in `saveTask` exactly as specified.
- Codex review must specifically diff the three test files to confirm
  fixtures-only edits.
