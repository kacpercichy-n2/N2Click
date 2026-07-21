# Run state — 20260721-135536-240 unified and persistent filters

## Goal

Add `SavedFilterCriteria.projectId` (+ „Projekt” filter on Tasks), unify
person/client/project filtering across kanban/projects/tasks (kanban gains
presets via additive `FilterPage: 'kanban'`), and persist the last-used filter
per view in a new local-only `AppData.lastFilters` collection (reducer
`SET_LAST_FILTER` + storage.ts repair), so filters survive navigation and
reload. Data version stays 7 (additive, defaulted + sanitized on load).

## Packages

- `handoffs/scheduler-reviews/240-architect-package.md`
  - PKG-20260721-filters-store — developer, medium risk, Codex required.
    Status: ready.
  - PKG-20260721-filters-pages — developer, medium risk, Codex conditional.
    Depends on filters-store. Status: ready.

## Changed boundaries (planned)

- types.ts: `projectId` in criteria, `FilterPage`+'kanban', `FilterViewKey`,
  `LastViewFilter`, `AppData.lastFilters`.
- storage.ts: DEFAULT_FILTER_CRITERIA, emptyData, load coercion,
  normalizeTaskMeta/normalizeDates repair for lastFilters; persistGate
  NON_MIRRORED_KEYS + 'lastFilters'.
- AppStore: SET_LAST_FILTER, SAVE_FILTER_PRESET validation, deleteProject /
  DELETE_WORK_CATEGORY cascades. MERGE_CLOUD_* keep lastFilters by reference.
- Six pages move filter state from useState to store-backed lastFilters.

## Deviation (recorded)

Queue prompt asked for cloud persistence via MERGE_CLOUD_*; savedFilters is a
deliberately local-only per-user concept (wiki + reducer), so lastFilters is
local-only beside it. No Supabase schema.

## Verification

- Focused: storage, filterState (new), cloudMerge, persistGate suites; build.
- Browser: none — no pointer-path changes.
- Scheduler owns final `npm test && npm run build`.

## Open questions

- None blocking. Wiki after green: state-and-persistence (savedFilters →
  + lastFilters, FilterPage 'kanban') likely stale.

## Developer result (both PKGs, green)

Implemented PKG-A + PKG-B. Store: types/storage/AppStore/commandValidation/
persistGate/seed. Pages: FilterPresets + 6 pages moved to store-backed
lastFilters (sanitizers in commandValidation, no cycle). Context expanded to
seed.ts (required lastFilters:{}) + 2 test-literal fixes (exportDryRun/taskMeta).
`npm test` 1142 pass, `npm run build` green. Wiki updated. No blockers.
