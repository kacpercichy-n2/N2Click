# Run state — 20260720-193430-227 manual task order in project

## Goal

Manual per-project task ordering on ProjectDetailPage (up/down arrows, gated by
`tasks.manage`), stored as new `Task.orderIndex`, mirrored to a new
`tasks.order_index` Supabase column, hydrated back, with deterministic legacy
repair. Ordering must not touch completion semantics or calendar placement.

## Packages

- `handoffs/scheduler-reviews/227-architect-package.md`
  (PKG-20260720-manual-task-order) — Tier: developer, Risk: high,
  Codex: required. Status: ready.

## Changed boundaries (planned)

- `Task` gains `orderIndex` (distinct from `WorkloadEntry.sortIndex`); new
  reducer action `REORDER_PROJECT_TASK` modeled on `REORDER_STATUS`
  (invariant 6: invalid command keeps prior state reference); `saveTask`
  appends new/moved-project tasks at end.
- `normalizeTaskMeta` every-load repair assigns deterministic per-project
  defaults (startDate/createdAt/id order); `DATA_VERSION` stays 7.
- New selector `orderedTasksOfProject` with `(orderIndex, startDate, id)`
  tie-break; ProjectDetailPage arrows with Polish aria-labels.
- New migration `20260720200000_task_order_index.sql` (idempotent column +
  guarded backfill); `migrations.test.ts` list extended; plannerData select +
  mapping, cloudMirror `taskRow`, dataImport row gain `order_index`.

## Verification

- Focused: new `src/store/taskOrder.test.ts` plus commandValidation,
  saveTaskWorkload, taskMeta, storage, cloudMerge, activityAttribution,
  plannerData, cloudMirror, migrations, dataImport suites (exact command in
  the package).
- Browser: none — no existing scenario covers task-list ordering; release
  matrix owns it.
- Scheduler owns final `npm test && npm run build`.

## Open questions

- None blocking. Note: `cloud-database.md` wiki will need the `order_index`
  column documented if the run goes green (final reviewer owns the wiki
  verdict).

## Developer result (2026-07-20)

- Implemented full package: `Task.orderIndex`, `REORDER_PROJECT_TASK` (+direction
  guard for invariant 6), append-at-end saveTask, `orderedTasksOfProject`,
  `normalizeTaskMeta` repair + migrateV1 NaN, seed literals, ProjectDetailPage
  arrows, mirror/hydration/dataImport, migration `20260720200000` + test list.
- Focused command: PASS (381). Full suite PASS (960); `tsc` + `npm run build`
  clean. Wiki: `cloud-database.md` updated; `state-and-persistence.md` unchanged.

## Developer result (2026-07-21) — kanban-on-tasks

- KanbanPage now boards TASKS by task status: new pure `src/pages/kanbanBoard.ts`
  (grouping, archived bucket, client/paid via project + person filter, ordering),
  page rewrite (SET_TASK_STATUS drag gated on `tasks.manage`, card opens
  TaskModal), new card CSS in `styles.css`, new `kanbanBoard.test.ts`.
- Focused PASS (19); full `npx vitest run` PASS 1024/1024; `npm run build` clean.
  Package's 933 baseline was stale — real baseline 1005. Wiki unchanged.

## Test-writer result (2026-07-21) — kanban onboarding copy

- `src/onboarding/catalog.ts`: fixed `id: 'kanban'` summary + two step bodies
  to describe tasks, not projects (board/column steps, click opens task edit).
- `npx vitest run` PASS 1024/1024; `npm run build` clean. No skips.
