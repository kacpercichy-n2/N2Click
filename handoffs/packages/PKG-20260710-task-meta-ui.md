# Handoff: Task metadata UI — TaskModal fields, checklist editor, TasksPage badges + filters, Admin categories

- **Package ID:** PKG-20260710-task-meta-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260710-task-meta-model
- **Blast radius:** low–medium — UI layer only (TaskModal, TasksPage, AdminPage, FilterPresets, one new component, CSS). No store/schema changes beyond consuming what the model package shipped.

## Goal

Surface the new task metadata (priority, work category, checklist) in the Polish UI: edit all three in `TaskModal`, show priority/category/checklist-progress on `TasksPage` cards, filter by priority + category through the existing `FilterPanel` (joining saved presets), and manage the category dictionary in `AdminPage`.

## Context the worker needs

- Relevant files: `src/components/TaskModal.tsx`, `src/pages/TasksPage.tsx`, `src/pages/AdminPage.tsx`, `src/components/FilterPresets.tsx`, `src/pages/ProjectsPage.tsx` (verify-compiles only), new `src/components/PriorityBadge.tsx`, `src/styles.css`, `CLAUDE.md` (minimal additions), and read-only reference: `src/components/PlanningBadge.tsx`, `src/components/FilterPanel.tsx`, `src/utils/priority.ts`, `src/store/selectors.ts` (`getWorkCategory`), `src/store/AppStore.tsx` (`TaskDraft`, work-category actions).
- Relevant docs: repo `CLAUDE.md` (Polish UI, dark N2 theme, no UI framework; note it is partially stale — trust code).
- Prior decisions (settled — do not reopen):
  1. Priority/category filters JOIN saved presets. `DEFAULT_CRITERIA` in `FilterPresets.tsx` becomes a re-export of `DEFAULT_FILTER_CRITERIA` from `src/store/storage.ts` (keep the exported name `DEFAULT_CRITERIA` so ProjectsPage/TasksPage import sites survive); `isCriteriaActive` gains the two new `!== ''` checks.
  2. On task cards the priority badge renders ONLY when `priority !== 'normal'` (noise reduction); the TaskModal select always shows all four.
  3. Checklist MVP = add / toggle done / delete. NO reorder, NO inline text edit.
  4. Checklist edits flow through the draft and `SAVE_TASK` (never dispatch per-keystroke) — participate in `serializeDraft` dirty tracking like every other field.
  5. NO calendar/timeline/kanban affordances this bundle — the WeekView pointer surface is deliberately untouched.
  6. Polish labels come from `PRIORITY_LABELS` (`src/utils/priority.ts`): Niski / Normalny / Wysoki / Pilny. Badge tones: urgent→danger, high→warning, low→info, normal→neutral/muted.

## Scope

### In scope

1. **`src/components/PriorityBadge.tsx`** (new) — mirror `PlanningBadge.tsx`: a pill span, `className="priority-badge priority-<value>"`, label from `PRIORITY_LABELS`. Renders all four values (call-site decides visibility).

2. **`src/styles.css`** — `.priority-badge` base copied from `.planning-badge`/`.status-badge` (line ~1866) + four tone modifiers using ONLY existing tokens (`--n2-danger`/`-soft`, warning, info, `--text-muted`; see how `.planning-badge` tones are done). Plus minimal checklist styles (`.checklist-list`, `.checklist-row`, done-state strikethrough via `text-decoration`, add-form row) reusing existing form/button classes wherever possible. Respect `prefers-reduced-motion` conventions (no new animations needed).

3. **`src/components/TaskModal.tsx`**
   - Details section: a new `.field-row` (below the project/status/estimate row) with two fields: „Priorytet" select (`TASK_PRIORITIES` order, labels from `PRIORITY_LABELS`, default `'normal'` for new tasks / `existing.priority` for edits) and „Kategoria" select (`''` option labeled „Brak kategorii" + `state.workCategories`). Both honor `readOnly`/`roTitle` like neighboring fields.
   - New editor-section „Checklista" placed directly after the Details section: list rows = checkbox (toggles `done`; done rows render struck-through), item text, „Usuń" (`btn danger-ghost`, or the `X` icon button pattern) — plus an add form (text input + „Dodaj" button; Enter submits; trim; ignore empty). New items: `{ id: crypto.randomUUID(), text, done: false }`. Show a muted „ukończono {done}/{total}" counter when total > 0. All controls disabled when `readOnly`.
   - State: `useState<TaskPriority>`, `useState<string>` (categoryId), `useState<ChecklistItem[]>`, seeded from `existing` or defaults (`'normal'`, `''`, `[]`).
   - Extend `serializeDraft` input and the `TaskDraft` built in `handleSave` with all three fields.
4. **`src/pages/TasksPage.tsx`**
   - Card (`task-card-top` area): `PriorityBadge` when `task.priority !== 'normal'` (place after `PlanningBadge`); category name as a muted chip/label when set (`getWorkCategory`); checklist progress `✓ {done}/{total}` (use the existing `Check` icon from `components/icons`) when `task.checklist.length > 0` — place in the card meta area, e.g. next to `task-card-hours`.
   - Two new single-select `FilterGroup`s: „Priorytet" (`''` „Wszystkie" + 4 values labeled via `PRIORITY_LABELS`) and „Kategoria" (`''` „Wszystkie" + `state.workCategories`).
   - Wire completely: predicate in the filtering `useMemo` (+ BOTH new states in its dependency array), `activeCount`, chips (labels „Priorytet: Wysoki", „Kategoria: Kreacja"), `clearFilters`, `criteria` object (now includes `priority` + `workCategoryId`), and `applyPreset` (sets both; note the planning filter stays preset-EXCLUDED — leave its existing comment and behavior alone).
5. **`src/components/FilterPresets.tsx`** — `DEFAULT_CRITERIA` re-exported from storage's `DEFAULT_FILTER_CRITERIA` (single source); `isCriteriaActive` extended.
6. **`src/pages/AdminPage.tsx`** — fourth dictionary section „Kategorie prac" after „Typy usług", using the existing `SimpleList` + add-form pattern verbatim; delete confirm: `Usunąć kategorię „X"? Zadania stracą tę etykietę.`; dispatches the three `*_WORK_CATEGORY` actions. Update the page's header comment.
7. **`src/pages/ProjectsPage.tsx`** — no functional change; just verify it compiles with the widened criteria (it spreads `DEFAULT_CRITERIA`).
8. **`CLAUDE.md`** — minimal targeted additions only (Task fields bullet, Tasks/Admin page descriptions, data-model lines). No full refresh (that remains a separately pending package).

### Out of scope

- Anything in `src/store/` (shipped by PKG-20260710-task-meta-model) — if the model layer looks wrong, STOP and report, don't patch it here.
- Calendar (`WeekView`, `MonthView`, `CalendarPage`), `TimelinePage`, `KanbanPage`, `DashboardPage`, `MyWorkPage`, `GlobalSearch` — no metadata affordances there this bundle.
- New tests (PKG-20260710-task-meta-tests); do not touch test files.
- Checklist reorder / inline edit / per-item persistence actions.
- No new dependencies, no Tailwind/UI libs, no new tokens in styles.css.

## Implementation notes

- Follow the exact existing idioms: field markup and `readOnly`/`NO_PERM_TITLE` handling from TaskModal's status select; filter wiring from the existing „Planowanie" group (TasksPage lines ~48–192); badge CSS from `.planning-badge`.
- Dirty tracking: `serializeDraft` (in TaskModal) must include priority, workCategoryId, and the checklist array (order-sensitive serialization is fine) so Cancel/close confirm behaves.
- Keep every new UI string Polish.
- Gates: `npx tsc --noEmit` · `npx vitest run` (same count as after the model package — this package adds none) · production build · quick smoke via `npm run dev` if feasible.

## Acceptance criteria

- [ ] TaskModal: priority + category selects present, seeded correctly for new/existing tasks, disabled when read-only; saved values round-trip through reopen.
- [ ] TaskModal checklist: add via button AND Enter (trimmed, empty ignored), toggle strikes through, delete removes; `{done}/{total}` counter; all draft-only until „Zapisz"; Cancel discards; dirty indicator reacts to checklist-only edits.
- [ ] TasksPage cards: priority badge only for non-normal priorities with correct tone classes; category label only when set; `✓ done/total` only when checklist non-empty.
- [ ] TasksPage filters: „Priorytet" and „Kategoria" groups filter correctly, show chips, count into `activeCount`, clear via „Wyczyść wszystko", and are SAVED into and APPLIED from presets (old presets apply as „all" for both). „Planowanie" remains preset-excluded.
- [ ] AdminPage: „Kategorie prac" section adds/renames/deletes categories; deleting one clears it from tasks (verify via a task card) after confirm.
- [ ] `DEFAULT_CRITERIA` has a single source of truth in `storage.ts`; ProjectsPage compiles and behaves unchanged.
- [ ] No console errors/warnings; all UI strings Polish; only existing CSS tokens used.
- [ ] `npx tsc --noEmit` clean; `npx vitest run` green (unchanged count); production build succeeds.

## Tests

- Command: `npx tsc --noEmit && npx vitest run` (+ production build)
- Expected: suite green with the same test count as after PKG-20260710-task-meta-model (this package adds no tests). Manual smoke of the four acceptance surfaces if a dev server is available.

## Report back

Synthesized summary only (files changed one-line each, gate results, deviations/deferrals). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs. No commit — the orchestrator commits after review.
