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
