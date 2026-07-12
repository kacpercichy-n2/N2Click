# Handoff: Status admin UI (done toggle + guard pre-validation) and Kanban archived column

- **Package ID:** PKG-20260712c-status-admin-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260712c-status-done-core
- **Blast radius:** low–medium — admin panel, Kanban, status selects; no data-model changes.

## Goal

Surface the new `Status.isDone` semantic in the admin panel (visible, togglable,
guard-aware in Polish), stop archived statuses from hiding referenced projects
on the Kanban board, and stop status selects from mis-rendering entities whose
current status is archived.

## Context the worker needs

- Relevant files: `src/pages/AdminPage.tsx` (status list rows ~lines 41–146:
  color input, name input, slug, StatusBadge, reorder ↑↓, archive toggle,
  delete button with `statusInUse` disable), `src/pages/KanbanPage.tsx`
  (columns from `activeStatuses` ~line 36 and 143; cards filter
  `p.statusId === s.id`; quick-create form at the end), `src/components/TaskModal.tsx`
  (status select from `activeStatuses`, ~line 295), `src/pages/ProjectDetailPage.tsx`
  (status select from `activeStatuses`, ~line 100), `src/styles.css` (kanban +
  admin sections; use existing `--n2-*` tokens), `src/store/selectors.ts`
  (`doneStatusIds`, `isDoneStatus`, `activeStatuses`, `allStatusesOrdered`),
  `src/store/AppStore.tsx` (actions `SET_STATUS_DONE`, `SET_STATUS_ARCHIVED`,
  `DELETE_STATUS` — guards already implemented by the core package).
- Conventions: `CLAUDE.md` — ALL UI strings Polish; reducer silently rejects
  guard violations, so the UI MUST pre-validate and explain (disabled control +
  `title`); plain CSS, no new deps; kanban uses native HTML5 DnD.
- Prior decisions (architect — final):
  - Archival of referenced statuses stays ALLOWED (archive-first philosophy).
    Kanban compensates with a clearly-labeled extra column (below).
  - Guard conditions to pre-validate (mirror the reducer exactly): "only
    active status" (archiving/deleting it would leave zero active statuses)
    and "only done status" (no other status, active or archived, has
    `isDone`). Referenced-delete disable already exists — keep it.
  - When several disable reasons apply to one button, show the first matching
    title in this order: referenced (delete only) → only-active → only-done.

## Scope

### In scope

1. **AdminPage — done toggle per status row.** Add a checkbox after the
   StatusBadge in every row (archived rows too):
   - Checked = `s.isDone`; change dispatches
     `{ type: 'SET_STATUS_DONE', statusId: s.id, isDone: !s.isDone }`.
   - Visible label text: `Ukończenie`. Control `title` (normal state):
     `Projekty i zadania w tym statusie liczą się jako ukończone — niezależnie od kolejności w lejku.`
   - Pre-validate: when the row is the ONLY done status, the checkbox is
     `disabled` with title
     `To jedyny status oznaczający ukończenie — najpierw oznacz inny status.`
   - `aria-label`: `Status „{name}” oznacza ukończenie`.
2. **AdminPage — archive/delete pre-validation.**
   - Archive button disabled when the row is the only active status, title
     `Nie można zarchiwizować ostatniego aktywnego statusu.`; or when it is
     the only done status, title
     `Nie można zarchiwizować jedynego statusu ukończenia — najpierw oznacz inny status.`
     (Restore of an archived row is never disabled.)
   - Delete button: keep the existing referenced-disable + title, and
     additionally disable with
     `Nie można usunąć ostatniego aktywnego statusu.` /
     `Nie można usunąć jedynego statusu ukończenia.` per the reason order above.
   - Extend the section blurb (the paragraph starting "Statusy sterują
     kolumnami kanbana…") with one sentence:
     `Znacznik „Ukończenie” decyduje, które statusy oznaczają zakończoną pracę — kolejność w lejku nie ma na to wpływu.`
3. **KanbanPage — archived column.** After the last active-status column and
   before the admin quick-create form, render ONE extra column when at least
   one FILTERED project (post paid/client filters) has an archived
   `statusId`:
   - Header name `Zarchiwizowane` + count, visually distinct (muted color,
     dashed top border — new CSS class, e.g. `kanban-col archived-col`).
   - Column `title` tooltip:
     `Projekty w zarchiwizowanych statusach — przeciągnij kartę do aktywnej kolumny, aby przywrócić.`
   - Cards render exactly like other kanban cards and remain DRAGGABLE OUT
     (dropping on an active column dispatches `SET_PROJECT_STATUS` as today).
   - The column is NOT a drop target: no `onDragOver`/`onDrop` handlers, no
     drag-over highlight.
   - Column hidden entirely when no filtered project has an archived status.
4. **Status selects with an archived current value.** In `TaskModal` and
   `ProjectDetailPage`: when the edited entity's current `statusId` refers to
   an ARCHIVED status, append that one status to the select's options (at the
   end), labeled `{name} (zarchiwizowany)`, so the select shows the true value
   instead of a phantom. Only the entity's own archived status — do not list
   all archived statuses.
5. **styles.css** — styles for the done checkbox row element and the archived
   kanban column. Reuse tokens (`--text-muted`, `--n2-surface-muted`, etc.);
   respect `prefers-reduced-motion` conventions (no new animation needed).

### Out of scope

- Reducer/selector/model/migration changes (done in core; if you find a guard
  mismatch, STOP and report — do not patch the reducer here).
- New tests (PKG-20260712c-status-tests) and the browser-check script + docs
  (PKG-20260712c-status-browser-docs).
- Tasks-page/Projects-page filter dropdowns (they may keep listing active
  statuses only — a task in an archived status still renders under "all").
- Any project-card formal/sales status fields.

## Implementation notes

- Kanban archived grouping: `const archivedIds = new Set(state.statuses.filter(s => s.archived).map(s => s.id))`,
  then `projects.filter(p => archivedIds.has(p.statusId))`. Note a project may
  also reference a DELETED status id in hand-edited payloads — statuses are
  delete-refused while referenced, so don't handle that case.
- AdminPage's `statusInUse` helper already exists — add sibling helpers for
  only-active / only-done computed from `state.statuses`.
- Keep the exact Polish strings above verbatim (tests + browser check will
  assert on them).
- Environment: NO git, NO `npm run build`/`vite`/`curl`. Verify with
  `npx tsc --noEmit && npm test`. If you want a visual check, the dev server
  may already answer on :5173; otherwise start via the vite node API
  (`createServer()`), never `npm run dev`.
- Log your result to `handoffs/RUN-STATE.md` (worker log).

## Acceptance criteria

- [ ] Admin: every status row shows the `Ukończenie` checkbox reflecting
      `isDone`; toggling ON a second status works; un-toggling the only done
      status is disabled with the exact Polish title.
- [ ] Admin: archiving/deleting the only active status and the only done
      status are disabled with the exact Polish titles; restore never disabled;
      existing referenced-delete disable unchanged.
- [ ] Kanban: with a used status archived, its projects appear in a single
      trailing `Zarchiwizowane` column (count correct, respects paid/client
      filters); dragging a card from it into an active column changes the
      project's status; dropping INTO it is impossible; the column disappears
      when empty.
- [ ] TaskModal / ProjectDetailPage selects show `{name} (zarchiwizowany)` for
      an entity whose status is archived; saving without touching the select
      keeps the archived status (no accidental reassignment).
- [ ] All new strings Polish; no console errors/warnings.
- [ ] `npx tsc --noEmit` → 0 errors; `npm test` → green (no existing tests
      broken).

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: both green. UI behavior itself is covered by
  PKG-20260712c-status-browser-docs's Playwright script — make sure your DOM
  gives it stable hooks (the exact Polish titles + `Zarchiwizowane` header
  text are the hooks; add a `data-testid` only if genuinely needed).

## Report back

Synthesized summary only: files changed one-line each, test results, exact
selectors/classnames added for the browser check, deviations. No raw logs.
