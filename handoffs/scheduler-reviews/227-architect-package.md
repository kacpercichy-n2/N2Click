# Handoff: Add manual per-project task ordering (up/down) with cloud mirror

- Package ID: PKG-20260720-manual-task-order
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — persisted schema + reducer integrity

## Goal

Tasks on ProjectDetailPage render in a manual per-project order stored as a new
`Task.orderIndex` field, reorderable with up/down arrows (gated by
`tasks.manage`), mirrored to a new `tasks.order_index` Supabase column and
hydrated back, with legacy data repaired to a stable deterministic default.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `src/types.ts` — `Task` gains `orderIndex: number` (see Prior decisions #1)
- `src/store/AppStore.tsx` — new `REORDER_PROJECT_TASK` action + reducer fn;
  `saveTask` append-at-end (create path ~line 400–419, and project-change edit)
- `src/store/selectors.ts` — new `orderedTasksOfProject` selector
- `src/store/storage.ts` — `normalizeTaskMeta` defaults `orderIndex`
  (~line 769); v1→v2 migration task literals (~line 285) get the field
- `src/store/seed.ts` — sample tasks get `orderIndex` (TS strict forces this)
- `src/pages/ProjectDetailPage.tsx` — use the selector (~line 191), arrow
  buttons in the task list (~line 490–514)
- `src/supabase/plannerData.ts` — tasks select column list (~line 288) +
  row→Task mapping (~line 402)
- `src/supabase/cloudMirror.ts` — `taskRow` gains `order_index` (~line 245)
- `src/supabase/dataImport.ts` — tasks insert row gains `order_index`
  (~line 465)
- `src/supabase/migrations.test.ts` — expected file list (~line 90)
- `new: supabase/migrations/20260720200000_task_order_index.sql`
- `new: src/store/taskOrder.test.ts` — reducer + selector tests
- Extend: `src/store/storage.test.ts` or `src/store/taskMeta.test.ts`,
  `src/supabase/plannerData.test.ts`, `src/supabase/cloudMirror.test.ts`,
  `src/store/activityAttribution.test.ts` (no-activity-row case)

## Invariants

- Invariant 6: any invalid `REORDER_PROJECT_TASK` (unknown task id, edge move,
  wrong payload shape) returns the SAME state reference (`return state`), like
  `reorderStatus` (AppStore.tsx:1647–1658) and the guards exercised by
  `src/store/commandValidation.test.ts`.
- Invariant 5: ordering never affects completion. `Status.isDone`, `statusId`,
  workload, assignments and calendar placement are untouched by reorder.
- Diff-mirror invariants: cloudMirror stays reducer-diff based (prev/next JSON
  compare per task, cloudMirror.ts:449–464); a rejected command produces zero
  ops because the state reference is unchanged. Do not add any mirror push
  outside the reducer diff (storage repair must NOT trigger cloud writes).
- `saveTask` reconciliation and date guards must not regress
  (`src/store/saveTaskWorkload.test.ts`, `src/store/dateGuards.test.ts`).
- `DATA_VERSION` stays 7 — repair is an idempotent every-load normalize pass,
  same precedent as `departmentId` in `normalizeTaskMeta` (storage.ts:782).
- Migration conventions guarded by `migrations.test.ts`: forward-only, name
  `YYYYMMDDHHMMSS_desc.sql`, idempotent DDL (`add column if not exists`), no
  new table so no RLS/policy changes; version must sort AFTER
  `20260720190000_manager_task_management.sql`.
- All new user-facing strings in Polish.

## Scope

1. **Model**: add `orderIndex: number` to `Task` (`src/types.ts`) with a
   comment distinguishing it from `WorkloadEntry.sortIndex` (per-person-day /
   bin semantics — types.ts:157). `orderIndex` is a per-PROJECT display rank
   for the project detail task list only.
2. **Reducer**: `{ type: 'REORDER_PROJECT_TASK'; taskId: string; direction: -1 | 1 }`.
   Copy the `reorderStatus` shape: build the task's project list sorted by the
   canonical key (see Prior decisions #3), swap with the neighbour, renumber
   that project's tasks 0..n-1. Return `state` unchanged-by-reference when the
   task id is unknown or the move falls off either edge. Tasks in other
   projects keep their object identity; tasks whose `orderIndex` value did not
   change should also keep identity (minimizes mirror upserts). No activity
   row (same rationale comment as AppStore.tsx:1645–1646).
3. **Append at end**: in `saveTask` create path, `orderIndex = maxOrderIndex
   (draft.projectId) + 1` (0 for an empty project). On EDIT, if
   `draft.projectId` differs from the stored task's project, re-append at the
   end of the destination project; otherwise preserve the stored value.
4. **Selector + UI**: `orderedTasksOfProject(state, projectId)` in
   `selectors.ts` sorting by `(orderIndex, startDate, id)` (total,
   deterministic even when cloud rows are all 0). ProjectDetailPage replaces
   its inline `.sort` (line 191–193) with the selector and renders ↑/↓ buttons
   per row only when `canManageTasks` (existing `can('tasks.manage')`,
   line 68). Copy the AdminPage pattern (AdminPage.tsx:147–164): `disabled` at
   edges, aria-labels `` `Przesuń zadanie „${t.title}” wyżej` `` / `wyżej`→`niżej`.
   Buttons are siblings of the `project-task-main` button inside the `li` —
   they must not open the task modal.
5. **Storage repair**: extend `normalizeTaskMeta` — for every task whose
   `orderIndex` is not a finite number, assign a deterministic per-project
   default: tasks with a valid value keep it; the rest are appended after the
   project's current max in `(startDate, createdAt, id)` order. Pure legacy
   payload (no task has the field) therefore gets 0..n-1 per project in
   today's displayed order; the pass is idempotent by value. v1→v2 migration
   task construction sets the same deterministic sequence.
6. **Supabase**: new migration `20260720200000_task_order_index.sql`:
   `alter table public.tasks add column if not exists order_index integer not
   null default 0;` plus a guarded, idempotent backfill that only touches
   projects where EVERY task still has `order_index = 0` (rank by
   `start_date nulls last, created_at, id` via `row_number() ... partition by
   project_id`) so re-running never clobbers manual order. Header comment in
   Polish per existing files. Add the filename to the `migrations.test.ts`
   expected list; `EXPECTED_POLICIES` unchanged.
7. **Mirror + hydration**: `taskRow` emits `order_index: t.orderIndex`;
   plannerData tasks select adds `order_index` and the mapping coerces
   (`typeof === 'number' && Number.isFinite` → value, else 0 — same spirit as
   `estimatedHours`). `dataImport.ts` tasks insert includes `order_index`.
   `MERGE_CLOUD_ENTITIES` needs no new validation (tasks are replaced
   wholesale from the typed plannerData payload; consistent with how
   `priority`/`checklist` are trusted post-mapping).
8. **Tests** (developer writes all):
   - `taskOrder.test.ts`: valid swap reorders and renumbers only the target
     project; unknown taskId / first-up / last-down / unknown direction keep
     the prior state REFERENCE (`toBe`); statusId/isDone/workload/assignments
     unchanged after reorder; new task appends at end; project-change edit
     re-appends; selector tie-break with duplicate orderIndex.
   - storage tests: legacy payload default assignment is deterministic and
     idempotent (double pass — value-stable).
   - `plannerData.test.ts`: `order_index` hydrates; missing/garbage → 0.
   - `cloudMirror.test.ts`: an adjacent swap on a normalized project emits
     exactly two task upserts carrying `order_index`; rejected reorder emits
     zero ops.
   - `activityAttribution.test.ts`: `REORDER_PROJECT_TASK` logs no row.

## Out of scope

- Drag-and-drop (arrows only), reordering on any other page (TasksPage,
  dashboard, MyWork), cross-project ordering.
- Any change to calendar/bin placement, `WorkloadEntry.sortIndex`, or
  status ordering.
- RLS/policy changes, realtime publication changes, `DATA_VERSION` bump.
- Server-side enforcement of ordering permissions (client `tasks.manage`
  gating is UX only).

## Acceptance

- [ ] ProjectDetailPage lists tasks by manual order; ↑/↓ move a task one slot;
      controls hidden without `tasks.manage`; Polish aria-labels present.
- [ ] Invalid reorder commands return the identical state reference; valid
      no-op-free swaps change exactly the affected project's task ranks.
- [ ] New tasks appear at the end of their project; moving a task to another
      project via edit appends it at that project's end.
- [ ] Legacy localStorage payloads load with a stable per-project default
      order equal to the previous startDate sort; repair is idempotent.
- [ ] `order_index` round-trips: mirror upsert rows carry it, snapshot
      hydration restores it, dataImport writes it.
- [ ] Migration file passes `migrations.test.ts` (name listed, idempotent,
      no policy regressions).
- [ ] Reorder changes nothing about completion, calendar placement or
      workload rows.

## Verification

- Worker: `npx vitest run src/store/taskOrder.test.ts src/store/commandValidation.test.ts src/store/saveTaskWorkload.test.ts src/store/taskMeta.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/store/activityAttribution.test.ts src/supabase/plannerData.test.ts src/supabase/cloudMirror.test.ts src/supabase/migrations.test.ts src/supabase/dataImport.test.ts`
- Browser: none — `scripts/browser-check-date-hardening.mjs` visits
  `/projects/:id` but covers date rendering only; no scenario covers task-list
  ordering. Release matrix owns it.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

1. **Ordering model: `orderIndex: number` field on `Task`**, not an ordered id
   list on `Project`. The cloud mirror diffs per-entity rows
   (cloudMirror.ts:449–464); a field on the task keeps reorder as plain task
   upserts and hydrates for free through the wholesale task replacement in
   `MERGE_CLOUD_ENTITIES` (AppStore.tsx:2119). An id list on `Project` would
   couple every task create/delete to a project-row write and add a jsonb
   column with orphan-id repair burden. Precedent: `Status.order` +
   `reorderStatus`. Name is `orderIndex`, NOT `sortIndex` —
   `WorkloadEntry.sortIndex` already means per-person-day/bin ordering
   (types.ts:157) and must not be conflated.
2. **Action**: `REORDER_PROJECT_TASK` with `direction: -1 | 1`, modeled on
   `REORDER_STATUS` (payload AppStore.tsx:205, impl 1647–1658, UI
   AdminPage.tsx:151/160). Invariant-6 pattern is literally `return state` on
   any invalid input, verified by reference equality.
3. **Canonical order key** everywhere (reducer neighbour computation and
   selector): `(orderIndex asc, startDate asc, id asc)`. This makes all-zero
   cloud rows display exactly like today's startDate sort and makes the first
   reorder in a never-normalized project deterministic.
4. **Mirror volume**: after normalization an arrow swap changes exactly 2
   tasks → 2 UPDATE (upsert) rows, well within existing batching. One-time
   renumber of a project whose ranks were all 0 may emit up to N task upserts
   once; accepted (bounded by the 92-day/project-size scale, same batching).
5. **Repair location**: `normalizeTaskMeta` every-load pass, no version bump —
   the exact precedent used when `departmentId` was added. Repair never pushes
   to the cloud (mirror is reducer-diff based); cloud rows stay at default 0
   until a real reorder/save, which is visually identical due to the
   tie-break.
6. **SQL backfill** is guarded to all-default projects only, keeping the file
   idempotent under the "manual SQL editor apply" convention documented in
   `20260720170000_task_departments.sql`.
7. Completion/calendar isolation: reorder touches only `tasks[*].orderIndex`;
   no `updatedAt` bump is required (cosmetic ordering; matches
   `reorderStatus`, avoids inflating mirror rows) — keep `updatedAt` unchanged
   on reorder.
