# Run 240 — unified and persistent filters (architect decomposition)

Two dependent developer packages. PKG-A lands the data model, storage repair
and reducer actions with focused tests; PKG-B wires the six pages. PKG-B must
not start before PKG-A is green.

## Settled architecture decisions (bind both packages)

1. **`SavedFilterCriteria.projectId: string`** (`''` = all). Additive:
   `DATA_VERSION` stays 7; `DEFAULT_FILTER_CRITERIA` gains `projectId: ''`; the
   existing `normalizeTaskMeta` savedFilters pass fills it via the
   `{ ...DEFAULT_FILTER_CRITERIA, ...f.criteria }` spread and resets a dangling
   `projectId` (no matching `data.projects` row) to `''` — same precedent as
   `workCategoryId`. `deleteProject` (also reached from `DELETE_CLIENT`) gains a
   cascade clearing `projectId` in `savedFilters` and `lastFilters`, mirroring
   the `DELETE_WORK_CATEGORY` cascade.
2. **`FilterPage = 'projects' | 'tasks' | 'kanban'`** (additive). No load-time
   dropping by page today — keep it that way, so existing `'projects'`/`'tasks'`
   presets survive byte-for-byte and any unknown page value simply never
   renders.
3. **Last-used filters live NEXT TO `savedFilters` in `AppData`, local-only.**
   New field:

   ```ts
   export type FilterViewKey =
     | 'projects' | 'tasks' | 'kanban' | 'workload' | 'calendar' | 'timeline';

   export interface LastViewFilter {
     criteria: SavedFilterCriteria; // single-select dims + from/to dates
     personIds: string[];           // PersonFilter multi-chips; [] = all
     departmentId: string;          // workload-only dim; '' = all
     serviceTypeId: string;         // workload-only dim; '' = all
     planning: string;              // tasks-only planning filter; '' = all
   }

   // AppData
   lastFilters: Partial<Record<FilterViewKey, LastViewFilter>>;
   ```

   **Deviation from the queue prompt, recorded:** the prompt says "persist in
   the same place as savedFilters via reducer + storage.ts + MERGE_CLOUD_*",
   but in this codebase savedFilters has NO cloud path: the wiki states "Only
   per-user saved filters and sample/reset remain local-only concepts" and
   `MERGE_CLOUD_ENTITIES` explicitly "never touches
   people/statuses/savedFilters/dictionaries (by reference)". There is no
   saved_filters table, mirror family or migration; filters are per-user while
   every mirrored planner family is org-shared, so cloud-authoritative merge
   would need new per-user schema — out of scope and against the recorded
   architecture. "Same place as savedFilters" is therefore honored literally:
   `AppData` + reducer + storage.ts, local-only, and every `MERGE_CLOUD_*`
   action must leave `lastFilters` (and `savedFilters`) untouched by reference
   — asserted by test.
4. **Persist gate:** add `'lastFilters'` to `NON_MIRRORED_KEYS` in
   `src/store/persistGate.ts`. Retirement is disabled today, but a
   lastFilters-only transition must never be classified mirrored-only (that
   would skip the local save that is its ONLY persistence).
5. **Presets vs chips:** PersonFilter multi-chips (kanban/calendar/timeline)
   are view state persisted in `lastFilters.personIds`, NOT part of preset
   criteria (criteria keeps single `personId`). Kanban presets snapshot the
   FilterPanel dims only (`paid`, `clientId`, `projectId`).
6. **Reducer contract (invariant 6):** structurally malformed payloads return
   the SAME state reference; dangling ids are sanitized to `''` on write;
   value-identical writes are no-ops returning the same reference.

---

# Handoff: Add projectId criteria, kanban FilterPage and persistent lastFilters to the store

- Package ID: PKG-20260721-filters-store
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — storage/reducer persistence boundary

## Goal

`SavedFilterCriteria.projectId`, `FilterPage` incl. `'kanban'`, and a new
local-only `AppData.lastFilters` collection with reducer write path and
load-time repair — all additive at data version 7, fully covered by focused
vitest.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`

## Expected touchpoints

- `src/types.ts` — `SavedFilterCriteria.projectId`, `FilterPage` + `'kanban'`,
  new `FilterViewKey`, `LastViewFilter`, `AppData.lastFilters` (shapes above).
- `src/store/storage.ts` — `DEFAULT_FILTER_CRITERIA.projectId: ''`;
  `emptyData().lastFilters = {}`; same-version load path coerces a
  present-but-non-object `lastFilters` to `{}` (peer of `coerceArray` calls
  around line 1369); `normalizeTaskMeta` extends the savedFilters pass with
  dangling-`projectId` → `''` and adds an idempotent `lastFilters` repair
  (unknown view keys dropped, criteria filled from `DEFAULT_FILTER_CRITERIA`
  with the same priority/workCategoryId/projectId sanitization, `personIds`
  coerced to a deduped string array, `departmentId`/`serviceTypeId`/`planning`
  coerced to strings with unknown planning values → `''`); `normalizeDates`
  extends the from/to repair to `lastFilters` criteria. Value-idempotent: a
  clean second pass returns the same object.
- `src/store/AppStore.tsx` — new action
  `{ type: 'SET_LAST_FILTER'; view: FilterViewKey; filter: LastViewFilter }`
  (sanitize → compare by value → no-op returns same reference; malformed
  payload/unknown view returns same reference); `SAVE_FILTER_PRESET` gains
  validation (unknown `page` or malformed criteria → same reference; dangling
  projectId/workCategoryId sanitized to `''`); `deleteProject` cascade clears
  `criteria.projectId` in `savedFilters` + `lastFilters`;
  `DELETE_WORK_CATEGORY` cascade extended to `lastFilters`.
- `src/store/commandValidation.ts` — pure exported sanitize/validate helpers
  (ticket-draft pattern) shared by the reducer; storage may reuse them.
- `src/store/persistGate.ts` — `'lastFilters'` in `NON_MIRRORED_KEYS`.
- Check-only (expect no change; report if wrong): `src/store/exportDryRun.ts`,
  `src/supabase/dataImport.ts` (collection lists), `src/store/seed.ts`
  (builds on `emptyData`), `MERGE_CLOUD_*` reducer branches (must already
  leave `lastFilters` alone because they only replace named collections).
- Tests: `src/store/storage.test.ts`, `src/store/cloudMerge.test.ts`,
  `src/store/persistGate.test.ts`, `new: src/store/filterState.test.ts`.

## Invariants

- Invariant 6: every rejected command returns the prior state reference.
- Data version stays 7; additive fields are defaulted + sanitized on every
  load; repairs are value-idempotent (clean load must not echo-write — one
  writeback adding `lastFilters: {}` to a legacy payload is expected, the
  second load must be byte-stable).
- `MERGE_CLOUD_ENTITIES` / `MERGE_CLOUD_DICTIONARIES` / `MERGE_CLOUD_PEOPLE`
  keep `savedFilters` and `lastFilters` by reference.
- Storage loading stays fail-closed; existing `'projects'`/`'tasks'` presets
  load unchanged (plus the additive `projectId: ''`).

## Scope

- Exactly the touchpoints above plus focused tests.

## Out of scope

- Any page/component change (PKG-B).
- Any Supabase schema, mirror family or migration for filters.
- Presets for the workload view.

## Acceptance

- [ ] Legacy savedFilter without `projectId` loads with `projectId: ''`;
      dangling `projectId` resets to `''`; existing criteria untouched.
- [ ] Payload without `lastFilters` loads as `{}`; malformed entries (non-object
      collection, unknown view key, non-array personIds, off-enum
      priority/planning, invalid from/to) are sanitized deterministically and
      idempotently.
- [ ] `SET_LAST_FILTER`: valid write lands in state; unknown view / malformed
      filter / value-identical write each return the SAME state reference.
- [ ] `SAVE_FILTER_PRESET` accepts page `'kanban'`; unknown page returns the
      same reference; existing name+page overwrite behavior unchanged.
- [ ] `deleteProject` clears matching `projectId` in savedFilters and
      lastFilters; unrelated filters keep their references.
- [ ] `MERGE_CLOUD_ENTITIES` with a full valid payload leaves
      `state.lastFilters` and `state.savedFilters` by reference.
- [ ] `shouldSkipLocalPersist` returns false for a lastFilters-only transition.

## Verification

- Worker: `npx vitest run src/store/storage.test.ts src/store/filterState.test.ts src/store/cloudMerge.test.ts src/store/persistGate.test.ts`
- Browser: none — no UI in this package.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Settled decisions 1–6 at the top of this file, including the recorded
  local-only deviation from the queue prompt's `MERGE_CLOUD_*` wording.

---

# Handoff: Unify filter dimensions and wire persistent last-used filters into the views

- Package ID: PKG-20260721-filters-pages
- Status: ready
- Tier: developer
- Depends on: PKG-20260721-filters-store
- Risk: medium
- Codex review: conditional — required only if the diff touches anything in
  CalendarPage/TimelinePage beyond the filter-state source.

## Goal

Tasks gains a "Projekt" filter, kanban gains a "Projekt" group + saved presets,
projects gains an "Osoba" group, and all six filtered views read/write their
current filter state through `lastFilters` so it survives navigation and
reload.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/state-and-persistence.md` (boundaries only)

## Expected touchpoints

- `src/components/FilterPresets.tsx` — `isCriteriaActive` includes
  `projectId !== ''`. No other component change expected (`FilterPanel` and
  `PersonFilter` stay dumb/controlled).
- `src/pages/TasksPage.tsx` — new "Projekt" `FilterGroup` (options: „Wszystkie”
  + project names sorted; chip renders the project name) driven by
  `criteria.projectId`; preset apply/clear covers it; whole filter state
  (criteria + planning) moves to store-backed `lastFilters['tasks']`.
- `src/pages/ProjectsPage.tsx` — new "Osoba" group on `criteria.personId`
  (project matches when the person is assigned to any of its tasks — reuse
  the existing selector, e.g. `projectsOfPerson`, do not duplicate logic);
  filter state backed by `lastFilters['projects']`. Note: the `?client=` search
  param must still win as the INITIAL value over the remembered filter.
- `src/pages/KanbanPage.tsx` — new "Projekt" group; `FilterPresets
  page="kanban"` rendered like Tasks does; paid/client/project + person chips
  backed by `lastFilters['kanban']` (chips → `personIds`).
- `src/pages/WorkloadPage.tsx` — department/client/service filters backed by
  `lastFilters['workload']` (`departmentId`, `criteria.clientId`,
  `serviceTypeId`). No presets here.
- `src/pages/CalendarPage.tsx` — PersonFilter `Set` backed by
  `lastFilters['calendar'].personIds`.
- `src/pages/TimelinePage.tsx` — `ownerFilter` → `personIds`, `clientFilter` →
  `criteria.clientId`, backed by `lastFilters['timeline']`.

Wiring pattern (same on every page): derive current values from
`state.lastFilters[view]` with neutral defaults; every setter dispatches
`SET_LAST_FILTER` with the full sanitized `LastViewFilter` snapshot (the
reducer no-ops value-identical writes). Keep `Set` locally derived via
`useMemo` from `personIds`; do not store Sets in AppData.

## Invariants

- Invariant 7: do not touch calendar/bin pointer lifecycle, drag/resize or
  rendered-column targeting — only the SOURCE of the selected-people set
  changes on CalendarPage/TimelinePage.
- Kanban board building (`kanbanBoard.buildKanbanColumns`) and draft-task
  exclusions unchanged.
- All new strings Polish: „Projekt”, „Osoba”, „Wszystkie”/„Wszyscy”.
- Presets on projects/tasks keep exact current behavior; applying a preset
  updates the remembered lastFilters (they are the same state now).

## Scope

- Exactly the pages/components above; no reducer/storage changes (PKG-A owns
  them — if a gap is found, report back instead of patching the store here).

## Out of scope

- Status filter on kanban (columns are the statuses), project filter on the
  projects list (it lists projects), presets for workload/calendar/timeline.
- Anchor dates, view modes, zoom levels — only filters are remembered.

## Acceptance

- [ ] Tasks: filtering by „Projekt” narrows the list; the chip removes it; a
      saved preset with a project restores it.
- [ ] Kanban: „Projekt” group + person chips filter cards; „Zapisz filtr”
      creates a `'kanban'` preset that reapplies after reload; existing
      projects/tasks presets are unaffected.
- [ ] Projects: „Osoba” narrows to projects with that person's assignments.
- [ ] Navigate away and back (and reload): tasks, projects, kanban, workload,
      calendar and timeline all restore their last filter state.
- [ ] „Wyczyść wszystko” / removing chips also clears the remembered state.
- [ ] `npm run build` green; no test regressions.

## Verification

- Worker: `npx vitest run src/store/filterState.test.ts && npm run build`
  plus any page-level test the repo already has for touched pages.
- Browser: none — no pointer/drag path changes; release matrix owns the
  browser scenarios.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Settled decisions 1–6 at the top of this file (esp. 5: chips persist in
  `personIds`, presets snapshot FilterPanel dims only).
