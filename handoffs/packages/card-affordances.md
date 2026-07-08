# Handoff: Clickable-card affordances (hover, chevrons, quick actions)

- **Package ID:** PKG-20260708-card-affordances
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260708-icons-foundation (`ChevronRight`, `GanttChart`, `Plus`); PKG-20260708-saved-filters (both edit ProjectsPage/TasksPage — run after it).
- **Blast radius:** low — presentational JSX + CSS only; no state/data changes.

## Goal
Make every clickable card obviously clickable and consistent: shared hover/focus treatment, a chevron affordance, and small secondary quick actions revealed on hover/focus.

## Context the worker needs
- Relevant files and the clickable surfaces to touch:
  - `src/pages/ProjectsPage.tsx` — project cards: `li.task-card.project-card > button.task-card-main`.
  - `src/pages/TasksPage.tsx` — task cards: `li.task-card > button.task-card-main` (already has a separate `Usuń` button).
  - `src/pages/ProjectDetailPage.tsx` — task rows: `li.project-task-row > button.project-task-main`.
  - `src/pages/DashboardPage.tsx` — list rows: `li.dash-row` with `onClick={() => navigate(...)}` (check the element type; if they are `<li onClick>` make them keyboard-accessible: `role="button"`, `tabIndex={0}`, Enter/Space handling — or wrap content in a `<button>`).
  - `src/pages/PeoplePage.tsx` — person rows: `a.person-row-main` (Link).
  - `src/styles.css` — append; existing hover rules for these classes may exist, extend rather than fight them.
- Icons come ONLY from `src/components/icons.ts`. UI text **Polish**. Do not restyle the theme — use existing `--n2-*` tokens (`--n2-border-strong`, `--n2-glass-strong`, `--n2-transition`, `--n2-shadow-focus`).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`.

## Scope
### In scope
1. **Shared CSS** (append under `/* ---------- Card affordances ---------- */`):
   - One consistent hover/focus recipe applied to all five surfaces above: `cursor: pointer` (verify each), border brightens to `--n2-border-strong`, background lifts to `--n2-glass-strong`, `transform: translateY(-1px)`, `transition: var(--n2-transition)`; `:focus-visible` gets `box-shadow: var(--n2-shadow-focus)`.
   - `.card-chevron` class: `ChevronRight` icon pinned right, `color: var(--n2-text-faint)`, on card hover/focus `color: var(--n2-lavender)` + `transform: translateX(3px)`; `transition` on both.
   - `.card-actions` class: quick-action container, `opacity: 0` → `opacity: 1` on card hover or `:focus-within`; always visible at ≤760px (no hover on touch) via the existing 760px media query pattern — put the override inside a new `@media (max-width: 760px)` block in your appended section.
2. **Chevron markup:** add `<ChevronRight className="card-chevron" size={16} aria-hidden />` to: project cards (ProjectsPage), task cards (TasksPage), project-detail task rows, dashboard `dash-row`s, people rows.
3. **Quick actions** (small `.card-actions` buttons with `title` + `aria-label`, `e.stopPropagation()` so the card click doesn't fire):
   - ProjectsPage project card: `Oś czasu` (icon `GanttChart`) → `navigate('/timeline')`; `+ Zadanie` (icon `Plus`) → `openNewTask(p.id)` (import `useOpenTask` from `src/components/TaskModal`).
   - TasksPage task card: none new (the existing `Usuń` button moves into/aligns with the `.card-actions` reveal pattern — keep it functional and keyboard-reachable).
   - Dashboard rows, people rows, project-detail task rows: chevron only, no quick actions.
4. **Keyboard accessibility fix** for `dash-row` click targets as noted above.
### Out of scope
- No new routes, reducer actions, or data reads beyond what exists; no changes to card CONTENT (text, badges, coins); no changes to KanbanPage/Timeline bars/Calendar blocks; no theme token edits.
- Do not convert any surface from button→div; only upgrade div/li→accessible button semantics where flagged.

## Implementation notes
- Quick actions must be nested OUTSIDE the main `<button>` (buttons can't nest) — place them as siblings inside the `li` with absolute positioning, mirroring how TasksPage already places `task-delete` next to `task-card-main`.
- Nothing here should change layout at rest except the added chevron; spot-check each page.

## Acceptance criteria
- [ ] All five surfaces show the same hover lift + border brighten + chevron slide; keyboard focus shows the focus ring and reveals quick actions (`:focus-within`).
- [ ] Project-card quick actions work: `Oś czasu` navigates, `+ Zadanie` opens the new-task modal pre-filled with the project, and neither triggers the card's own navigation.
- [ ] Dashboard rows operable with Enter/Space via keyboard.
- [ ] At ≤760px quick actions are always visible.
- [ ] Manual checklist items 4 and 11 still pass (project card opens detail; people rows/delete work); console clean.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual: hover/keyboard pass over ProjectsPage, TasksPage, Dashboard, People, ProjectDetail.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
