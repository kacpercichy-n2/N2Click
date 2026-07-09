# Handoff: SUPERSEDED — do not execute

- **Package ID:** PKG-20260710-task-meta-core
- **Status:** superseded (never routed)
- **Tier:** —
- **Superseded by:** PKG-20260710-task-meta-model

This file was written in parallel with `PKG-20260710-task-meta-model.md`, which
covers the same data-layer scope (Task priority/workCategoryId/checklist,
`workCategories` dictionary, storage v5→v6, SAVE_TASK + dictionary actions, seed)
with slightly different pinned placements (priority constants in
`src/utils/priority.ts`, `DEFAULT_FILTER_CRITERIA` in `storage.ts`,
`normalizeTaskMeta` as the migration pass). The **model** package is canonical —
`PKG-20260710-task-meta-ui.md` and `PKG-20260710-task-meta-tests.md` reference
its decisions. Workers: skip this file entirely.
