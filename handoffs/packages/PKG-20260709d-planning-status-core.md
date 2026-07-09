# Handoff: Add derived task planning status (selector + badge + TasksPage filter)

- **Package ID:** PKG-20260709d-planning-status-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low — derived-only feature; no storage/types/DATA_VERSION change, no reducer change, no persisted shape touched.

## Goal

Introduce a fully derived "planning status" for tasks (is the task's work scheduled onto calendar days?), expose it as a pure selector + pure core function, render it as a compact Polish badge on four surfaces (TasksPage, TaskModal, ProjectDetailPage, MyWorkPage), and add a planning-status filter to TasksPage's existing FilterPanel.

## Context the worker needs

- **The repo CLAUDE.md is partially stale (v4-era). Trust the code.** The codebase is storage v5 with task hour budgets and a "bin" (zasobnik): a `WorkloadEntry` with `date === ''` (`BIN_DATE` sentinel, `isBinEntry` in `src/utils/time.ts`) is an allocated-but-unscheduled block.
- Relevant files:
  - `src/store/selectors.ts` — where the new selector + pure fn + type live. Reuse `getTask`, `entriesForTask`, and `isBinEntry` (already imported there from `../utils/time`). See the existing budget cluster: `taskBudget` (estimate / totalAll / headroom), `binHoursForTaskPerson`.
  - `src/components/StatusBadge.tsx` — visual reference for the pill (`.status-badge` class, `src/styles.css` ~line 1866).
  - `src/pages/TasksPage.tsx` — task cards (`.task-card-top` around line 231) + existing `FilterPanel` wiring (`filterGroups`, `activeCount`, `chips`, `clearFilters`, `criteria`/`applyPreset`, filtering `useMemo` at lines 62–77).
  - `src/components/TaskModal.tsx` — draft totals already computed: `normalizedEstimate` (line ~472; snaps then clears `<= 0` to null), `plannedTotalAll` (dated grid draft, line ~517), `binTotal` (existing + pending bin, line ~536), `overBudget` (line ~542, uses `+ 1e-9` epsilon), `.estimate-compare` block (lines ~653–673).
  - `src/pages/ProjectDetailPage.tsx` — per-task rows, `StatusBadge` at line ~415.
  - `src/pages/MyWorkPage.tsx` — Zasobnik card rows (lines ~87–101).
  - `src/styles.css` — tokens: `--n2-success/-soft`, `--n2-info/-soft`, `--n2-warning/-soft`, `--n2-danger/-soft` (lines 33–38 + danger nearby), `--text-muted`; `.status-badge` at ~1866.
- Prior decisions (all settled — do not re-open):
  1. **Status semantics** — see "Decided semantics" below. They are final.
  2. **Type + labels**: `export type PlanningStatus = 'nie rozplanowano' | 'częściowo' | 'rozplanowano' | 'przekroczono'` — the union values ARE the display labels (exact lowercase strings, per the user). Also export `PLANNING_STATUSES: PlanningStatus[]` in that order. Both live in `src/store/selectors.ts` (derived concept — deliberately NOT in `src/types.ts`, which holds stored shapes only).
  3. **Fourth surface = /my-work** (not the dashboard). Rationale: the dashboard's "Zadania na dziś" renders the shared `TodayAgendaList`, which a prior run pinned as behaviorally frozen; the Zasobnik card on /my-work is the surface that is literally about unscheduled work, where the częściowo-vs-przekroczono distinction is informative. Do NOT touch `TodayAgenda.tsx` or `DashboardPage.tsx`.
  4. **Filter is single-select** (FilterPanel is radio-group by design) and is **NOT added to saved presets**: `SavedFilterCriteria` (`src/types.ts`) and `FilterPresets` stay untouched, because presets are persisted in localStorage and this bundle must not change any stored shape. Known accepted consequence: a preset saves/applies without the planning filter, and a planning-only filter doesn't enable "Zapisz filtr". Document this in the code comment where the filter state is declared.
  5. Epsilon `EPS = 1e-9`, matching TaskModal's `overBudget`. Hours already snap to 0.25 on write paths, so EPS only guards float drift.
  6. No special-casing of `estimatedHours === 0`: stored estimates are `> 0` or `null` (TaskModal clears non-positive to null), and if a zero ever appears it behaves as a zero budget (any hours ⇒ przekroczono), consistent with the TaskModal banner.

## Decided semantics (final — implement exactly)

For a task, over ALL people, define:
- `est` = `task.estimatedHours` (number | null)
- `dated` = Σ `plannedHours` of the task's entries with a real date (`!isBinEntry`)
- `bin` = Σ `plannedHours` of the task's bin entries (`isBinEntry`)
- `total` = `dated + bin`
- `EPS` = `1e-9`

Evaluate in this precedence order (first match wins):

1. `total <= EPS` → **`nie rozplanowano`** — nothing planned at all (regardless of estimate). Matches the existing "Bez planu" alert rule where bin rows count as planned.
2. `est != null && total > est + EPS` → **`przekroczono`** — the plan (dated + bin) exceeds the estimate. Identical condition to TaskModal's `overBudget` banner, whether the excess sits in the grid or the bin.
3. `bin > EPS` → **`częściowo`** — hours are allocated but some still sit in the zasobnik, whose very label is "nierozplanowane"; a task with bin hours can never be "rozplanowano".
4. `est == null` → **`rozplanowano`** — no target to fall short of, and everything that exists is on calendar days.
5. `dated >= est - EPS` → **`rozplanowano`** — the estimate is fully placed on calendar days (bin is 0 here by rule 3; `dated` can't exceed `est + EPS` here by rule 2).
6. otherwise → **`częściowo`** — some dated hours, under the estimate, empty bin.

Worked edge cases (put these in the JSDoc):
- null estimate + 0 hours → nie rozplanowano; null estimate + bin-only → częściowo; null estimate + dated-only → rozplanowano.
- est 8, dated 0, bin 3 (bin-only) → częściowo. est 8, dated 5, bin 3 (total == est) → częściowo (bin still unscheduled). est 8, dated 8, bin 0 → rozplanowano. est 8, dated 8, bin 1 → przekroczono. est 8, dated 9, bin 0 → przekroczono.

## Scope

### In scope

1. **`src/store/selectors.ts`** (place next to the `taskBudget` cluster):
   - `export type PlanningStatus = …` and `export const PLANNING_STATUSES: PlanningStatus[] = ['nie rozplanowano', 'częściowo', 'rozplanowano', 'przekroczono']`.
   - `export function planningStatusForTotals(estimate: number | null, datedHours: number, binHours: number): PlanningStatus` — the pure, state-free core implementing the semantics above (this is what TaskModal calls with draft values, and what unit tests will hammer).
   - `export function taskPlanningStatus(state: AppData, taskId: string): PlanningStatus` — derives `dated`/`bin` from `entriesForTask` + `isBinEntry` and delegates to `planningStatusForTotals`. Missing task ⇒ treat estimate as null (falls out of `getTask(...)?.estimatedHours ?? null`). Pure — no `Date` usage.
   - Full JSDoc on both, including the precedence list and the worked edge cases.
2. **`src/components/PlanningBadge.tsx`** (new): `export function PlanningBadge({ status }: { status: PlanningStatus })` → `<span className={'planning-badge ' + toneClass} >{status}</span>`. Tone classes: `planning-none` (nie rozplanowano), `planning-partial` (częściowo), `planning-full` (rozplanowano), `planning-over` (przekroczono). No inline styles.
3. **`src/styles.css`**: `.planning-badge` base copied from `.status-badge`'s shape (inline-block, `font-size: var(--n2-type-xs)`, `font-weight: 600`, `border: 1px solid`, `border-radius: var(--n2-radius-pill)`, `padding: 2px 10px`, `white-space: nowrap`) + tone modifiers:
   - `.planning-none` — `color: var(--text-muted); border-color: var(--text-muted); background: rgba(255, 255, 255, 0.06);`
   - `.planning-partial` — `color: var(--n2-warning); border-color: var(--n2-warning); background: var(--n2-warning-soft);`
   - `.planning-full` — `color: var(--n2-success); border-color: var(--n2-success); background: var(--n2-success-soft);`
   - `.planning-over` — `color: var(--n2-danger); border-color: var(--n2-danger); background: var(--n2-danger-soft);`
4. **`src/pages/TasksPage.tsx`**:
   - Render `<PlanningBadge status={taskPlanningStatus(state, task.id)} />` in `.task-card-top`, immediately after `<StatusBadge …/>`.
   - New local state `planningFilter` (`'' | PlanningStatus`), predicate `if (planningFilter && taskPlanningStatus(state, t.id) !== planningFilter) return false;` inside the existing filtering `useMemo` (add `planningFilter` to its dependency array; `state` is already a dep).
   - New `FilterGroup` `{ key: 'planning', label: 'Planowanie' }` with options `{ value: '', label: 'Wszystkie' }` + one per `PLANNING_STATUSES` entry (value = label = the status string). Include in `activeCount`, `clearFilters`, and `chips` (chip label `Planowanie: <status>`). Do NOT add it to `criteria`/`applyPreset` (see prior decision 4 — add the explanatory comment).
5. **`src/components/TaskModal.tsx`**: inside the `.estimate-compare` div, append a third segment `<PlanningBadge status={planningStatusForTotals(normalizedEstimate, plannedTotalAll, binTotal)} />` so the badge tracks the DRAFT live (grid + pending bin), never stale saved state. New unsaved task shows "nie rozplanowano" — correct.
6. **`src/pages/ProjectDetailPage.tsx`**: in each task row, render `<PlanningBadge status={taskPlanningStatus(state, t.id)} />` immediately after the existing `<StatusBadge …/>` (~line 415).
7. **`src/pages/MyWorkPage.tsx`**: in the Zasobnik card rows, append `<PlanningBadge status={taskPlanningStatus(state, task.id)} />` after the `.agenda-meta` span (before `.my-work-hours`). (These rows can only ever show częściowo/przekroczono — expected, since bin > 0.)
8. **`CLAUDE.md`**: minimal targeted additions only (the full doc refresh is a separate pending package): one sentence in the selectors/architecture area noting the derived, never-stored `taskPlanningStatus` / `planningStatusForTotals` (4 Polish values + precedence: empty → over-budget → bin-pending → target met), and a mention of the TasksPage "Planowanie" filter + badge surfaces.

### Out of scope

- NO changes to `src/types.ts`, `src/store/storage.ts`, `src/store/AppStore.tsx` (no new state, no actions, no DATA_VERSION bump — the status is never stored).
- NO changes to `FilterPresets.tsx`, `SavedFilterCriteria`, `StatusBadge.tsx`, `TodayAgenda.tsx`, `DashboardPage.tsx`, seed data, or any reducer/activity logging.
- NO planning badge on Kanban, Timeline, Calendar, Workload, or the my-work Alerty/Dzisiaj sections.
- NO unit tests (separate package PKG-20260709d-planning-status-tests) — but keep the pure fn trivially testable.
- NO commit — the top-level orchestrator commits after review.

## Implementation notes

- Keep `planningStatusForTotals` free of any state/`AppData` import needs — plain numbers in, string out.
- Guard against negative inputs defensively (`Math.max(0, …)` on the sums is fine) but don't over-engineer; entries with `plannedHours > 0` is an existing invariant.
- Polish UI only; the four status strings are exact and lowercase.
- Environment gotchas from the previous run: the RTK hook may block rewritten read commands — use Read/Grep/Glob tools; if `npm run build` is approval-blocked, `node node_modules/vite/bin/vite.js build` worked last run.

## Acceptance criteria

- [ ] `planningStatusForTotals` implements the 6-rule precedence exactly (spot-check every worked edge case above by hand or scratch `node -e`).
- [ ] `taskPlanningStatus` returns correct values against seeded data (e.g. a task with bin hours reports częściowo/przekroczono, a fully dated on-estimate task reports rozplanowano).
- [ ] Badge renders on all four surfaces (TasksPage card, TaskModal estimate row, ProjectDetailPage task row, MyWorkPage Zasobnik row) with the tone colors above; TaskModal badge updates live while editing the grid/estimate/bin before saving.
- [ ] TasksPage "Planowanie" filter narrows the list, shows in the active count and as a removable chip, clears with "Wyczyść wszystko", and is deliberately absent from saved presets (comment present).
- [ ] No stored shape changed: `types.ts`, `storage.ts`, `AppStore.tsx` untouched; nothing new persisted.
- [ ] All UI strings Polish; no new dependencies; plain CSS with existing `--n2-*` tokens.
- [ ] CLAUDE.md has the two minimal additions.
- [ ] Gates green: `npx tsc --noEmit` clean · `npm test` 211/211 (no existing test touched) · production build succeeds · no console errors in dev.

## Tests

- Command: `npx tsc --noEmit && npm test` then `npm run build` (fallback `node node_modules/vite/bin/vite.js build`).
- Expected: tsc clean; vitest 211/211 (baseline — this package adds no tests); build succeeds. New unit tests arrive in PKG-20260709d-planning-status-tests.

## Report back

Synthesized summary only (files changed one line each, gate results, deviations/deferrals) appended to `handoffs/RUN-STATE.md` under the run's Worker log. No raw logs.
