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

## Developer result (2026-07-21) — 233-required-fields

- New `isValidClientDraft` (name + contact person + e-mail OR phone, presence
  only) wired into `ADD_CLIENT`/`SAVE_CLIENT` (same-ref reject); ClientsPage
  asterisks + live Polish error + auto-save gate; AdminPage name-only client
  quick-add replaced by a `/clients` link; seed clients given contacts;
  Status/Klient asterisks in TaskModal + ProjectDetailPage.
- Focused PASS (62); full suite PASS 1044 (baseline 1036, prompt's 933 stale);
  `npm run build` clean. Wiki `state-and-persistence.md` updated.

## Developer result (2026-07-21) — 234-project-documents-and-links

- `Project.documents` (jsonb `projects.documents`, migracja
  20260721010000_project_documents; RLS dziedziczona z projektu). Reduktor
  ADD/SAVE/DELETE_PROJECT_DOCUMENT + `isValidProjectDocumentDraft`,
  `repairProjectDocuments`, karta „Dokumenty” w ProjectDetailPage
  (`projects.manage`), mirror/snapshot/import.
- Schemat `url` wymuszany na 3 granicach (reduktor/repair/render) przez
  `normalizeProjectDocumentUrl` — tylko http(s), brak schematu → `https://`;
  `javascript:`/`data:` odrzucane (przechowywany XSS, projekty są współdzielone).
- Focused PASS (24); full suite PASS 1068 (baseline 1044, prompt's 933 stale);
  `npm run build` clean. Wiki: `cloud-database.md` + `state-and-persistence.md`.

## birthDate test fixtures
- Added `birthDate: ''` to Person/PersonDraft/CloudProfile/CloudPersonMergeRow
  factories+literals across 23 test files. Also updated profileEditPolicy.test.ts
  editable-field assertions (birthDate is self/manager/all-editable per prod).
- tsc clean; full suite PASS 1086/1086. No production files touched.

## PKG-20260721-nav-reorder
- Reordered NAV, inlined Konto (supabase-only), renamed Administracja→Ustawienia
  (route /admin), moved /zgloszenia + help into a `.sidebar-footer` row; new
  shared `TeamTabs` folds Struktura under Zespół (/team gates intact).
- Files: App.tsx, TeamTabs.tsx (new), People/Team/Admin/Projects/Kanban pages,
  catalog.ts, styles.css, wiki. tsc clean; full suite PASS 1104; build clean.
- Browser checks (ui-keyboard, onboarding) deferred — playwright not installed.
