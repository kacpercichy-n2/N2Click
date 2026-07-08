# Handoff: Task filters + saved filter presets (Projects & Tasks)

- **Package ID:** PKG-20260708-saved-filters
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-workload-resolution (both edit `src/store/AppStore.tsx` — run after to avoid conflicts). Logically independent.
- **Blast radius:** medium — extends the persisted data shape (`AppData`) and the reducer; touches ProjectsPage and TasksPage toolbars.

## Goal
Stronger retrieval: TasksPage gets a real filter toolbar (client, status, assignee, date range); ProjectsPage gains a date-range filter; both pages can save the current filter combination as a named preset, persisted in the app data, applied/deleted with one click.

**Architect decisions (do not revisit):**
- New `savedFilters: SavedFilter[]` field on `AppData`. **No DATA_VERSION bump**: `loadData` already default-fills missing fields via `{ ...emptyData(), ...parsed }`, so old payloads load with `savedFilters: []`. Do not touch the migration paths.
- Date-range semantics: an entity passes when its period **overlaps** the range (`entity.startDate <= to && entity.endDate >= from`); empty `from`/`to` = unbounded on that side.

## Context the worker needs
- Relevant files: `src/types.ts` (`AppData`), `src/store/storage.ts` (`emptyData()` — add the field), `src/store/AppStore.tsx` (Action union + reducer; follow `ADD_CLIENT`/`DELETE_CLIENT` for the pattern; no activity logging for presets), `src/pages/ProjectsPage.tsx` (existing filters: `paidFilter`, `clientFilter`, `statusFilter`, plus `?client=` param if PKG-global-search landed first), `src/pages/TasksPage.tsx` (currently NO filters), `src/store/selectors.ts` (`assigneeIdsOfTask`), `src/components/PersonFilter.tsx` (not used here — selects are enough), `src/styles.css` (append).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. Persistence ONLY through the reducer/storage module. Dates `'yyyy-MM-dd'`. UI text **Polish**.

## Scope
### In scope
1. **Types** (`src/types.ts`):
   ```ts
   export type FilterPage = 'projects' | 'tasks';
   export interface SavedFilterCriteria {
     paid: 'all' | 'paid' | 'unpaid'; // meaningful on projects; keep 'all' for tasks
     clientId: string;   // '' = all
     statusId: string;   // '' = all
     personId: string;   // '' = all; assignee — meaningful on tasks
     from: DateStr | ''; // period overlap lower bound
     to: DateStr | '';   // period overlap upper bound
   }
   export interface SavedFilter { id: string; name: string; page: FilterPage; criteria: SavedFilterCriteria; }
   ```
   Add `savedFilters: SavedFilter[]` to `AppData` and to `emptyData()` in `src/store/storage.ts`.
2. **Reducer actions** (`src/store/AppStore.tsx`):
   - `{ type: 'SAVE_FILTER_PRESET'; name: string; page: FilterPage; criteria: SavedFilterCriteria }` — trims name, no-op when empty; replaces an existing preset with the same (page, trimmed name) else appends.
   - `{ type: 'DELETE_FILTER_PRESET'; filterId: string }`.
3. **TasksPage toolbar** (`.cal-toolbar` pattern): selects for client (`Wszyscy klienci`), status (`Wszystkie statusy`, active statuses), assignee (`Wszystkie osoby`, `state.people`; a task passes when `assigneeIdsOfTask` contains the person), and two date inputs (`Od` / `Do`, `aria-label="Filtruj od daty"/"Filtruj do daty"`) with overlap semantics. Client match goes through the task's project (`getProject(state, t.projectId)?.clientId`). Filters compose (AND). Show a `Wyczyść filtry` ghost button when any filter is active, and a result count (`{n} z {total} zadań`).
4. **ProjectsPage**: add the same `Od`/`Do` date-range inputs (overlap on project period) next to the existing filters.
5. **Preset UI on both pages** (shared component `src/components/FilterPresets.tsx`):
   - Props: `page`, current criteria, `onApply(criteria)`.
   - Renders preset chips (`.filter-chip` style) for `state.savedFilters` of that page: click = apply (parent sets its filter states), small ✕ inside the chip = `DELETE_FILTER_PRESET` behind `window.confirm('Usunąć zapisany filtr „{name}”?')`.
   - `Zapisz filtr` button (enabled only when some criterion is non-default) → inline name input + confirm → `SAVE_FILTER_PRESET`.
   - Fields a page doesn't use stay at their defaults in saved criteria (`paid: 'all'` on tasks, `personId: ''` on projects) and are ignored on apply.
6. CSS appended under `/* ---------- Filter presets ---------- */`.
### Out of scope
- No changes to KanbanPage/Timeline/Workload filters; no URL-syncing of filters (beyond the existing `?client=` init if present); no free-text filter (global search covers it); no migration/version bump; no export/import.

## Implementation notes
- Presets are shared app data (no per-user scoping exists — consistent with the no-auth model).
- Keep filtering in `useMemo`; dataset is small, string comparisons on `'yyyy-MM-dd'` are safe for the overlap test.
- Applying a preset on ProjectsPage maps criteria → `setPaidFilter/setClientFilter/setStatusFilter/setFrom/setTo`; on TasksPage → its five setters.

## Acceptance criteria
- [ ] TasksPage: each filter narrows the list correctly; combinations AND; `Wyczyść filtry` resets; count label accurate.
- [ ] ProjectsPage: date range narrows groups; existing paid/client/status filters unchanged (manual checklist item 4 passes).
- [ ] Saving a preset with a name persists it (visible after browser reload — checklist item 13); applying restores every criterion; deleting removes it (confirm dialog); same-name save on the same page overwrites.
- [ ] Presets saved on Projects don't appear on Tasks and vice versa.
- [ ] A pre-existing localStorage payload without `savedFilters` loads cleanly (empty presets, no data loss).
- [ ] Console clean.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual: create/apply/delete presets on both pages + reload persistence + legacy-payload load (delete `savedFilters` key from the stored JSON in devtools and reload).

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
