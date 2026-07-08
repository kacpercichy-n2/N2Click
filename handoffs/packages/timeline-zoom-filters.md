# Handoff: Timeline zoom, range presets, owner/client filters, conflict indicators

- **Package ID:** PKG-20260708-timeline-zoom
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none (if PKG-20260708-icons-foundation has landed, use `ZoomIn`/`ZoomOut` from `src/components/icons.ts` for the zoom buttons; otherwise use text `−`/`+` and leave a `// TODO icons` note)
- **Blast radius:** low-medium — TimelinePage only, plus one new pure selector. Drag math must keep working at every zoom level.

## Goal
Give the timeline user control: pixel zoom, visible-range presets, filtering by assignee (owner) and client, and per-task conflict (overload) indicators.

## Context the worker needs
- Relevant files: `src/pages/TimelinePage.tsx` (module consts `DAY_W = 26`, `WEEKS = 10`; components `Bar`, `MilestoneMark`, `DayStripes` all read `DAY_W` from module scope), `src/store/selectors.ts` (`hoursForPersonOnDate`, `personCapacity`, `assigneeIdsOfTask`), `src/components/PersonFilter.tsx` (chips component: `people`, `selected: Set<string>` where empty = all, `onToggle`, `onAll`), `src/utils/dates.ts` (`eachDayInclusive`, `diffDays`, `addDaysStr`), `src/styles.css` (append).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. Invariants: dates are `'yyyy-MM-dd'` strings; all reads through pure selectors; no drag libraries (existing pointer-event drag stays as-is). UI text **Polish**. Overload = person's total across ALL tasks on one date > their capacity (warning only).

## Scope
### In scope
1. **Zoom.** Replace module-const `DAY_W` with page state `dayW`, values `14 | 26 | 40` (start at 26). Two buttons in the page header (`aria-label="Pomniejsz"` / `"Powiększ"`) step through the levels; disable at the ends. Thread `dayW` as a prop into `Bar`, `MilestoneMark`, `DayStripes` and every `left/width` computation — drag snapping (`Math.round(dx / dayW)`) must use the current value.
2. **Range presets.** Replace const `WEEKS` with state `weeks`, preset toggle (reuse the `.cal-view-toggle`/`.toggle-btn` pattern from `PaidFilterToggle` in `src/pages/ProjectsPage.tsx`): `2 tyg.` (2), `6 tyg.` (6), `10 tyg.` (10), `26 tyg.` (26). Default 10. Total width math (`240 + totalDays * dayW`) follows.
3. **Owner filter.** `PersonFilter` chips above the timeline (state `Set<string>`, empty = all). A task row renders only if the filter is empty or any of `assigneeIdsOfTask(state, task.id)` is selected. A project row renders if the filter is empty, or it has at least one matching task (project bars themselves have no owner). Client groups with nothing left are hidden.
4. **Client filter.** A `<select>` (`aria-label="Filtruj po kliencie"`, options `Wszyscy klienci` + `state.clients`) that narrows the client groups, same pattern as WorkloadPage's client select.
5. **Conflict indicators.** New pure selector in `src/store/selectors.ts`:
   ```ts
   /** Dates inside the task period where an assignee working on THIS task that day exceeds their capacity. */
   export function conflictDatesForTask(state: AppData, taskId: string): DateStr[]
   ```
   Definition: date `d` is a conflict when some person `p` has a workload entry for this task on `d` AND `hoursForPersonOnDate(state, p, d) > personCapacity(state, p)`. On each task bar, render a small danger tick per conflict day (absolutely positioned span at `(dayIdx(d) - taskStartIdx) * dayW` within the bar, class `timeline-conflict`, background `var(--n2-danger)`, ~4px wide, full bar height or a top notch). Bar `title` gains `⚠ konflikty: <n> dni` when n > 0. Ticks must not intercept pointer events (`pointer-events: none`).
6. CSS appended to `src/styles.css` under `/* ---------- Timeline controls ---------- */`.
### Out of scope
- No changes to drag/resize semantics, reducer actions, KanbanPage, CalendarPage, WorkloadPage.
- No persistence of zoom/filter choices (page-local state only).
- No conflict *resolution* UI (separate package handles that on WorkloadPage).

## Implementation notes
- `Bar` culls itself via `totalDays`; keep that working with variable `weeks`/`dayW`.
- Memoize conflict dates per task with `useMemo` keyed on `state.workload`/`state.people` to avoid recomputing on every drag frame (drag is local state, so renders during drag are Bar-internal — verify).
- Filter chips row + selects go in one toolbar div (`.cal-toolbar`) below the existing header/hint.

## Acceptance criteria
- [ ] Zoom in/out changes day width between 14/26/40 px; bars, milestones, weekend stripes, today line and week labels all stay aligned; dragging a task by N columns at any zoom moves it exactly N days.
- [ ] Presets change the visible range to 2/6/10/26 weeks; `Dzisiaj` / `‹` / `›` navigation still works.
- [ ] Owner filter hides non-matching task rows (and empty projects/clients); client filter narrows groups; both compose.
- [ ] A task whose assignee is over capacity on a day inside the task period shows a danger tick at that day; tooltip mentions the conflict count; no tick when no overload.
- [ ] Manual checklist item 7 in CLAUDE.md still passes (bars grouped by client, task drag moves blocks, edge resize, milestone drag, overdue tint).
- [ ] Console clean.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual: load sample data (has an over-capacity day) and verify a conflict tick appears on the corresponding task bar.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
