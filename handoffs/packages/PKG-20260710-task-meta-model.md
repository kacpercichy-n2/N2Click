# Handoff: Task metadata model — priority, work category, checklist, storage v6

- **Package ID:** PKG-20260710-task-meta-model
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — touches the persisted data shape (`Task`, `AppData`, `SavedFilterCriteria`), the storage migration, and `SAVE_TASK`. No auth/payments/external calls; everything is localStorage.

## Goal

Add three stored task-metadata features to the data layer: `priority` (fixed 4-value enum), `workCategoryId` (reference into a new admin-managed `workCategories` dictionary), and an embedded `checklist`. Bump the storage payload to version 6 with a loss-free, idempotent normalize pass. No UI in this package (that is PKG-20260710-task-meta-ui).

## Context the worker needs

- Relevant files: `src/types.ts`, `src/store/storage.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/store/seed.ts`, new file `src/utils/priority.ts`; mechanical fixes to test factories in `src/store/blockActions.test.ts` and `src/store/selectors.test.ts`.
- Relevant docs: repo `CLAUDE.md` (architecture + invariants — note it is partially stale: the code is at `DATA_VERSION = 5` with access roles, bin entries, budget rules; TRUST THE CODE over the doc), `docs/workflow/HANDOFF-TEMPLATE.md`.
- Prior decisions (settled by the architect — do not reopen):
  1. **Category is a dictionary**, not an enum: `WorkCategory { id, name }`, state array `workCategories`, CRUD mirroring ServiceTypes exactly (`ADD/RENAME/DELETE_SERVICE_TYPE` pattern in `src/store/AppStore.tsx` lines ~1499–1521).
  2. **Unset category is `''`**, not `null` — matches the repo convention for `departmentId`/`serviceTypeId` (`'' when unset`).
  3. **Priority type lives in `src/types.ts`** (it is a stored shape); its runtime constants (order + Polish labels) live in the new dependency-free `src/utils/priority.ts` (types.ts has no runtime exports today — keep it that way).
  4. **Checklist is embedded on Task and flows through the SAVE_TASK draft** (wholesale replace on save). NO separate ADD/TOGGLE/DELETE checklist reducer actions — the TaskModal is a draft-based editor with snapshot dirty-tracking, and the checklist participates in the draft like every other field.
  5. **New filter fields DO join saved presets**: `SavedFilterCriteria` gains `priority` and `workCategoryId`. The canonical default-criteria constant moves to `storage.ts` as `DEFAULT_FILTER_CRITERIA` (storage must not import from components); `FilterPresets.tsx` will re-export it as `DEFAULT_CRITERIA` in the UI package.
  6. **New storage version is 6.** The migration is an every-load idempotent normalize pass (same philosophy as `migratePerson` — see the long comment in `loadData` about why normalization runs on EVERY load, not only when `version < N`).

## Scope

### In scope

1. **`src/types.ts`**
   - `export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';`
   - `export interface ChecklistItem { id: string; text: string; done: boolean; }` (ids are `crypto.randomUUID()` like everything else)
   - `export interface WorkCategory { id: string; name: string; }` (mirror `ServiceType`)
   - `Task` gains: `priority: TaskPriority;` · `workCategoryId: string; // '' when unset` · `checklist: ChecklistItem[];`
   - `SavedFilterCriteria` gains: `priority: '' | TaskPriority; // '' = all` · `workCategoryId: string; // '' = all` (both meaningful on tasks; keep `''` for projects — same note style as the existing `paid` field)
   - `AppData` gains: `workCategories: WorkCategory[];` (place near `serviceTypes`)
   - Update the doc comments accordingly.

2. **New `src/utils/priority.ts`** (dependency-free except `types.ts`):
   - `export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high', 'urgent'];` (ascending — this is the select/filter display order)
   - `export const PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Niski', normal: 'Normalny', high: 'Wysoki', urgent: 'Pilny' };`

3. **`src/store/storage.ts`**
   - `DATA_VERSION = 6`.
   - `emptyData()` gains `workCategories: []`.
   - `export const DEFAULT_FILTER_CRITERIA: SavedFilterCriteria = { paid: 'all', clientId: '', statusId: '', personId: '', priority: '', workCategoryId: '', from: '', to: '' };` (near `DEFAULT_CAPACITY`).
   - New exported, idempotent `normalizeTaskMeta(data: AppData): AppData` run on EVERY load (both the `version < 2` branch and the main branch, alongside `migrateV4toV5`/`ensureStartMinutes`). It must:
     - default `workCategories` to `[]` when missing/non-array (defensive; the `{...emptyData(), ...parsed}` spread already covers the plain-missing case);
     - give every task a valid `priority` (value not in `TASK_PRIORITIES` → `'normal'`);
     - give every task a string `workCategoryId`, resetting to `''` any value that does not reference an existing `workCategories` id (dangling-reference sanitize, same spirit as `sanitizeImpersonator`);
     - give every task a sane `checklist`: non-array → `[]`; each item coerced to `{ id: str(item.id) || uid(), text: str(item.text), done: item.done === true }`, dropping non-object entries;
     - normalize every saved filter's criteria via `{ ...DEFAULT_FILTER_CRITERIA, ...f.criteria }` and reset an invalid `criteria.priority` (not `''` and not in `TASK_PRIORITIES`) to `''` — old v5 presets must apply cleanly with the new fields as `''`.
     - Idempotent BY VALUE (second pass changes nothing); returning the same reference when nothing changed is nice-to-have, not required (match `migrateV4toV5`'s always-map style if simpler).
   - Document the function with the same style/level as `ensureStartMinutes` / `migratePerson`.

4. **`src/store/AppStore.tsx`**
   - `TaskDraft` gains `priority: TaskPriority; workCategoryId: string; checklist: ChecklistItem[];`.
   - `saveTask` writes all three on BOTH the create and edit branches (checklist replaced wholesale from the draft; snap/validate nothing — items are already shaped by the modal; do trim item texts and drop empty-text items defensively on write).
   - Three new actions mirroring the service-type trio verbatim (naming, trim/ignore-empty on add, ref-clearing on delete):
     - `{ type: 'ADD_WORK_CATEGORY'; name: string }`
     - `{ type: 'RENAME_WORK_CATEGORY'; workCategoryId: string; name: string }`
     - `{ type: 'DELETE_WORK_CATEGORY'; workCategoryId: string }` — also maps `tasks`, resetting `workCategoryId` to `''` where it matched (the task-side analogue of `DELETE_SERVICE_TYPE` clearing projects).
   - NO new activity-log messages: the existing `SAVE_TASK` "utworzył(a)/zaktualizował(a) zadanie" events already cover metadata edits.

5. **`src/store/selectors.ts`**
   - `export function getWorkCategory(state, workCategoryId): WorkCategory | undefined` mirroring `getServiceType` exactly (including the `''` short-circuit if getServiceType has one — copy its shape).

6. **`src/store/seed.ts`**
   - Add 3 work categories: `Kreacja`, `Wdrożenie`, `Testy`.
   - Task metadata: „Strona główna i cennik" → priority `high`, category Kreacja, checklist of 3 items (`Moodboard zaakceptowany` done:true, `Sekcja hero` done:false, `Tabela cen` done:false); „Koncepcja i plan kampanii" → `normal`, Kreacja, `[]`; „Sprint poprawek do wydania" → `urgent`, Wdrożenie, `[]`; „Regresja QA" → `normal`, Testy, `[]`.

7. **Mechanical test-factory fixes only** (the new required `Task` fields break existing literals): update the task factory/helpers in `src/store/blockActions.test.ts` and `src/store/selectors.test.ts` to include `priority: 'normal', workCategoryId: '', checklist: []` defaults. Do NOT add new tests (that is PKG-20260710-task-meta-tests) and do NOT change any assertion.

### Out of scope

- ALL UI: TaskModal, TasksPage, AdminPage, FilterPresets/DEFAULT_CRITERIA re-export, badges, styles.css — PKG-20260710-task-meta-ui.
- New tests — PKG-20260710-task-meta-tests.
- Calendar/WeekView/Timeline — untouched.
- Any change to `WorkloadEntry`, block actions, budget/bin logic, permissions matrix, `Person`, `Project`.
- No new activity-event types, no notifications, no checklist reordering/inline-edit model.

## Implementation notes

- Follow the existing migration philosophy exactly: normalization runs on every load and is idempotent; a payload stamped v6 with malformed task metadata must still self-heal (see the `migratePerson` rationale comment at `loadData`).
- `localizeLegacyData` runs when `version < DATA_VERSION` — bumping to 6 means v5 payloads pass through it again; it is a no-op on already-Polish data (name-map lookups miss). No change needed, just don't break it.
- `LOAD_SAMPLE`/`RESET_ALL` carry full `AppData` — seed must produce a complete v6 payload (version field comes from `emptyData()`).
- `ProjectsPage.tsx` spreads `DEFAULT_CRITERIA` into its criteria; it compiles unchanged once the constant carries the new `''` fields (the UI package rewires the constant; in THIS package `FilterPresets.tsx`'s local `DEFAULT_CRITERIA` object must gain `priority: ''`, `workCategoryId: ''` so `tsc` stays green — the re-export refactor itself stays in the UI package).
- Gates after this package: `npx tsc --noEmit` · `npx vitest run` (baseline 232 green, only factory fixes in test files) · `npm run build` (if the command is approval-gated, `node node_modules/vite/bin/vite.js build` worked in prior runs). RTK hook note: prefer Read/Grep/Glob tools over shell reads.

## Acceptance criteria

- [ ] `Task`, `SavedFilterCriteria`, `AppData` extended exactly as specified; `TaskPriority`/`ChecklistItem`/`WorkCategory` exported from `src/types.ts`.
- [ ] `src/utils/priority.ts` exports `TASK_PRIORITIES` (ascending order) and `PRIORITY_LABELS` with the exact Polish labels Niski/Normalny/Wysoki/Pilny.
- [ ] `DATA_VERSION === 6`; `emptyData()` includes `workCategories: []` and version 6.
- [ ] `normalizeTaskMeta` exported from `storage.ts`, wired into BOTH `loadData` branches, and idempotent: a v5 payload (tasks without the new fields, presets without the new criteria) loads with priority `'normal'`, `workCategoryId ''`, `checklist []`, criteria filled with `''` — and a second pass changes nothing.
- [ ] Dangling `task.workCategoryId` (no matching dictionary row) resets to `''` on load.
- [ ] `SAVE_TASK` round-trips priority/category/checklist on create AND edit; checklist is replaced wholesale from the draft.
- [ ] `ADD/RENAME/DELETE_WORK_CATEGORY` behave like the service-type trio; delete clears matching `task.workCategoryId` to `''`.
- [ ] `getWorkCategory` selector exists.
- [ ] Seed contains the 3 categories + the specified task metadata and still loads/saves cleanly.
- [ ] `npx tsc --noEmit` clean; `npx vitest run` fully green (232 baseline, factory-only test edits); production build succeeds.

## Tests

- Command: `npx tsc --noEmit && npx vitest run` (+ production build)
- Expected: all existing tests green (232 at last run); NO new tests in this package — only the mechanical factory-default additions in the two named test files.

## Report back

Synthesized summary only (files changed one-line each, gate results, deviations/deferrals). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs. No commit — the orchestrator commits after review.
