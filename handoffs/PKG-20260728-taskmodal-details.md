# Handoff: TaskModal detail pass — overflow menu, grid grouping, block-done tick, full task page

- Package ID: PKG-20260728-taskmodal-details
- Status: ready
- Tier: developer
- Depends on: none (builds on landed PKG-20260728-taskmodal-structure)
- Risk: high (five items touch `TaskModal.tsx`; IA-08 touches the calendar block surface — invariant 7)
- Codex review: required — cross-module change with a stability-sensitive calendar touchpoint

## Goal

Six owner-approved UX fixes shipped by ONE developer in the internal order
below: a shared ⋯ overflow-menu primitive, then AT-08 (delete out of the
header), AT-10 (comments/activity), AT-13 (checkbox targets + Wyczyść undo),
AT-05 (allocation grid empty-day grouping), IA-08 (calendar ✓ + collapsed
„Wykonane bloki”), IA-15 (full task page at `/tasks/:id`).

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (primary)
- `openwiki/n2hub/scheduling-and-calendar.md` (IA-08 only)
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `new: src/components/OverflowMenu.tsx`
- `src/components/IconButton.tsx` (add optional `haspopup` prop only)
- `src/components/TaskModal.tsx`
- `src/components/taskModalSections.ts` + `taskModalSections.test.ts`
- `src/components/AllocationGrid.tsx`
- `new: src/components/allocationGridView.ts` + `new: allocationGridView.test.ts`
- `src/components/CommentsPanel.tsx`
- `src/components/WeekView.tsx` (TimedBlock only, ~lines 928–1023)
- `src/App.tsx` (routes 480–481, remove `TaskRedirect` at 598)
- `new: src/pages/TaskFullPage.tsx`
- `new: src/pages/taskPageRoute.ts` + `new: taskPageRoute.test.ts`
- `src/utils/dirtyRegistry.ts` + `src/utils/dirtyRegistry.test.ts`
- `src/styles.css`

## Invariants

- `src/store/AppStore.tsx` is the only mutation boundary. NO new reducer
  actions anywhere in this package. Invariant 6 untouched.
- Invariant 7: calendar pointer lifecycle (`begin`/`startDrag`/`finish`/
  `cancelDrag`), touch gate, rendered-column hit-testing and the
  `week-block-bin-btn` contract must not change. New listeners on the tile are
  observers only.
- AllocationGrid editing logic is UNTOUCHED: `onChange` clamping (0–24, step
  0.25 via `setCell` snap), start-time inputs, overload computation
  (`baseHoursFor` + `availableHoursOnDate`), `×N` badge, memoization contract
  (all new props stable: primitives or `useCallback`).
- Existing confirm flow for delete (`handleDelete`, `buildDeleteConsequence`,
  `confirmLabel: 'Usuń zadanie'`, `tone: 'danger'`, `requireAck`) preserved.
- `SaveStatus` stays in the modal header. Save-state and persistence banners
  must not regress; a failed save never reports `Zapisano`.
- `/tasks/new` keeps redirecting to `/tasks?task=new` (static route outranks
  `:id`). Missing id renders the existing „Nie znaleziono zadania” state.
- Retirement mode stays disabled. All user-facing strings Polish. No new
  runtime dependencies (lucide-react and framer-motion are already present).
- Vitest is `environment: 'node'`, include `src/**/*.test.ts` ONLY — there is
  NO jsdom/RTL. Do not write DOM render tests; all new tests are pure-function
  tests in sibling `*.ts` modules (pattern: `taskModalSections.ts`/`.test.ts`).

## Scope — ordered steps

### Step 0 — shared ⋯ menu primitive: `src/components/OverflowMenu.tsx`

Build on `useOverlay` + `OverlayLayer` (`src/components/useOverlay.ts`) — the
same shell as the Kanban card menu (`src/pages/KanbanPage.tsx:509–560` and
`:876–926`); do NOT use `modalShell`/`useModalShell` (this is a popover, not a
dialog). Reuse existing `.context-menu` / `.context-menu-item` CSS.

API (settled):

```ts
interface OverflowMenuItem {
  id: string;
  label: string;          // Polish
  onSelect: () => void;   // menu closes first, then onSelect runs
  danger?: boolean;       // red text — reserved for destructive items
  disabled?: boolean;     // native disabled; shell skips it in nav
}
interface OverflowMenuProps {
  label: string;          // aria-label of the trigger, Polish
  items: OverflowMenuItem[];
  size?: 'sm' | 'md';     // IconButton size, default 'md'
  className?: string;
}
```

- Trigger: `IconButton` with lucide `MoreHorizontal` icon, `label`,
  `expanded={open}`, and a NEW optional IconButton prop
  `haspopup?: 'menu' | 'dialog'` rendered as `aria-haspopup` (only addition to
  IconButton — everything else in `IconButton.tsx` unchanged).
- Popover: `OverlayLayer` > `AnimatePresence` > `motion.div.context-menu` with
  `role="menu"`, inner plain `<div ref={menuRef}>` (the `positionedBox`
  pattern), items as `<button role="menuitem" className="context-menu-item">`
  (+ `danger` class → new CSS rule, red text `var(--n2-danger)`-family, same as
  `.btn.danger` hue).
- `useOverlay({ open, onClose, overlayRef, getAnchorRect: trigger rect,
  triggerRef, menuKeyboard: true, offset: 4 })`. This gives the full a11y
  contract for free: Escape closes top layer only, dismiss on
  `pointerdown`+`click` pair outside, roving tabindex + arrows/Home/End/
  typeahead, focus return to trigger.
- Second click on the trigger toggles closed (triggerRef zone is excluded from
  dismiss — mirror Kanban's `openTriggerRef` handling).
- No pure module, no test: all decision logic already lives in tested
  `overlayShell.ts`.

### Step 1 — AT-08: „Usuń” out of the modal header

`src/components/TaskModal.tsx:364–396` (`TaskModalShell`):

- Remove the red `btn danger-ghost` „Usuń” button (383–388).
- Add `<OverflowMenu label="Więcej działań" ...>` in
  `.task-modal-head-actions`, rendered only when `existing && canManageTasks`,
  placed between `SaveStatus` and the close `IconButton`. Items:
  - `{ id: 'delete', label: 'Usuń zadanie', danger: true, onSelect: handleDelete }`
- `handleDelete` body unchanged. Header ends as: title + SaveStatus +
  „Otwórz pełny widok ↗” link (Step 6) + ⋯ menu + close.

### Step 2 — AT-10: CommentsPanel tabs

`src/components/CommentsPanel.tsx:160–181` (+ consumers: TaskModal „Dyskusja”
tab and `src/pages/ProjectDetailPage.tsx` — the same change applies to both,
note it in the report):

- Delete the `role="tablist"` + two `toggle-btn` tabs entirely („Aktywność”
  stops being a peer tab). Rename state `tab` → `view: 'comments' | 'activity'`.
- New header row `.comments-head`: `<h3 className="comments-title">Komentarze
  ({comments.length})</h3>` + `<OverflowMenu label="Więcej opcji dyskusji"
  items=[{ id: 'activity', label: `Historia zmian (${activity.length})`,
  onSelect: () => setView('activity') }] />`.
- Activity view: heading „Historia zmian ({activity.length})”, a back button
  `<button className="btn ghost">← Wróć do komentarzy</button>` (switches to
  comments), then the existing `.activity-list` markup unchanged.
- CSS: `.comments-head { display: flex; align-items: center;
  justify-content: space-between; gap: 8px; margin-bottom: 12px; }`; all hit
  targets ≥ 32 px (IconButton `md` is 32 px; give the back button ≥ 32 px
  height). Leave `.toggle-btn` CSS alone — other surfaces (calendar toolbar,
  tickets/events switchers) use it.

### Step 3 — AT-13: checkbox targets + „Wyczyść” with undo

The checkboxes in question (verified): the TaskModal checklist rows and the
per-block „Wykonane bloki” rows, both styled by
`.checklist-row input[type='checkbox']` (`src/styles.css:2786`; rows at
`src/components/TaskModal.tsx:1686–1706` — section „Checklista” — and
`:2004–2035`). `.checkbox-field input[type='checkbox']` (styles.css:1119) is a
different surface — do NOT touch it.

- CSS: checkbox `width: 20px; height: 20px;` and `.checklist-row
  { min-height: 40px; }` (keep `gap: 10px`).
- Clickable row: give each checkbox an `id` (checklist: `chk-<item.id>`;
  done-blocks: `blk-<entry.id>`) and convert the `.checklist-text` `<span>` to
  `<label htmlFor=...>` (same class). Keep the existing `aria-label` on the
  inputs; the per-item „Usuń” button stays OUTSIDE the label. Row click beyond
  the label is not required — label + 20 px box gives the ~40 px target.
- „Wyczyść” (AllocationGrid person header, `AllocationGrid.tsx:144–148`):
  remove the plain `link-btn`. Add a per-person
  `<OverflowMenu size="sm" label={`Więcej działań — ${p.name}`}
  items=[{ id: 'clear', label: 'Wyczyść kolumnę', onSelect: () =>
  onClearPerson(p.id) }] />` next to „Wypełnij dni robocze” (which stays a
  visible link-btn). No confirm dialog.
- Undo (settled decision): snapshot lives in **TaskEditor local state** — NOT a
  reducer action. Allocations are editor draft state; SAVE_TASK reconciliation
  makes a store-level undo action pointless and risky. In `TaskModal.tsx`:
  - Pure helpers in `src/components/allocationGridView.ts` (Step 4 module):
    `snapshotPersonColumn(allocations, startTimes, days, personId)` →
    `{ hours: Record<string, number>; starts: Record<string, number> }` and
    `restorePersonColumn(allocations, startTimes, snapshot)` → new pair.
  - `clearPerson` (`TaskModal.tsx:858–877`) captures the snapshot before
    deleting and sets `clearUndo: { personId, hours, starts } | null`.
  - `undoClear(personId)` restores via `restorePersonColumn`, clears
    `clearUndo`.
  - Invalidation: replaced by a subsequent clear; cleared by undo itself, by
    any `setCell`/`fillWeekdays`, by a `startDate`/`endDate` change, and when
    the person is unassigned.
  - New AllocationGrid props (both stable): `undoPersonId: string | null`,
    `onUndoClear: (personId: string) => void` (useCallback). When
    `undoPersonId === p.id`, the person header renders
    `<button className="link-btn">Cofnij</button>`.

### Step 4 — AT-05: allocation grid empty-day grouping (presentation only)

New pure module `src/components/allocationGridView.ts` + test (also hosts the
Step-3 snapshot helpers):

```ts
interface AllocDayInfo { date: string; weekend: boolean; empty: boolean }
type AllocSegment =
  | { kind: 'day'; date: string }
  | { kind: 'group'; dates: string[]; workdays: number; weekends: number; expanded: boolean };
function groupAllocationDays(days: AllocDayInfo[], expandedDates: ReadonlySet<string>): AllocSegment[];
function collapsedGroupLabel(workdays: number, weekends: number): string;
```

Settled rules:

- A day is groupable iff `empty` (day total across ALL people === 0 — weekends
  with values stay visible rows). Runs of ≥ 2 consecutive groupable days form
  a `group`; a single isolated empty day stays a `day`. Order never changes.
- `group.expanded` = every date of the run ∈ `expandedDates`. An expanded
  group renders its header row (button „…— ukryj”) followed by its day rows;
  a collapsed group renders only the header („…— pokaż”).
- `collapsedGroupLabel` uses `src/utils/polishPlural.ts` (`polishCount`).
  Shapes: „14 pustych dni roboczych + 6 weekendowych”, only-workdays
  „3 puste dni robocze”, only-weekends „2 dni weekendowe”, singulars
  „1 pusty dzień roboczy” / „1 weekendowy”. Button text = label + „ — pokaż” /
  „ — ukryj”.

In `AllocationGrid.tsx`:

- Internal `useState<Set<string>>` of expanded dates (component-local — memo
  contract unaffected). „pokaż” adds all group dates; „ukryj” removes them.
  If a day inside an expanded group gains a value, the run splits and both
  halves stay expanded (dates remain in the set) — this is the intended
  behavior, assert it in the test.
- Replace `days.map` (`:157`) with segments: `kind: 'day'` renders the EXACT
  current row JSX; `kind: 'group'` renders
  `<tr className="alloc-collapsed"><td colSpan={people.length + 2}>
  <button type="button" aria-expanded={...}>…</button></td></tr>`.
- Value edge: a cell with `value > 0` gets class `alloc-cell has-value` and
  inline `borderLeftColor: personColor(p.id)`; CSS gives `.alloc-cell`
  `border-left: 3px solid transparent` base so layout never shifts.
- Placeholder: `placeholder="0"` → `placeholder="—"` (`:207`). Nothing else on
  the input changes.

Unit tests (`allocationGridView.test.ts`): all-empty period collapses to one
group with correct workday/weekend split; weekend-with-value stays a day row;
single empty day stays a day row; expanded set dissolves a group; split-run
keeps both halves expanded; label declension for 1/2/5 workdays and weekends
and both-zero-one-side variants; snapshot/restore round-trip and that restore
returns NEW objects without touching other people's keys.

### Step 5 — IA-08: ✓ on the calendar block + collapsed „Wykonane bloki”

`src/components/WeekView.tsx`, `TimedBlock` only (bin cards `:1427` and recur
blocks `:1609` keep their passive marks — recur done goes through
`SET_OCCURRENCE_DONE`, out of scope):

- For `editable` blocks, REPLACE the passive `block-done-mark` span
  (`:972–976`) with a SIBLING button rendered after `week-block-bin-btn`
  (same doctrine, comment at `:995–1000`: children of `role="button"` are
  presentational, so the control must be a sibling):
  `<button type="button" className="week-block-done-btn">` positioned at the
  tile's top-right corner (absolute; reuse the tile's `top` + column calc +
  `transform: tx` exactly like the bin button, offset to the right edge).
  Non-editable blocks keep the passive span so viewers still see ✓.
- Behavior: `onPointerDown={(e) => e.stopPropagation()}` (never starts
  drag/resize or slot handling), `onClick={(e) => { e.stopPropagation();
  dispatch({ type: 'SET_BLOCK_DONE', entryId: entry.id, done: !(entry.done ===
  true) }); }}` — the SAME action as the modal list
  (`src/store/AppStore.tsx:3077`). `aria-pressed={done}`, aria-label:
  done ? `Cofnij wykonanie — ${blockAriaLabel}` :
  `Oznacz jako wykonane — ${blockAriaLabel}`; glyph ✓ `aria-hidden`.
- Visibility: hidden by default (`opacity: 0; pointer-events: none;`), shown
  when (a) `done`, (b) tile hovered — component-local `hovered` state from
  `onPointerEnter`/`onPointerLeave` OBSERVERS added to the tile div (no
  preventDefault/stopPropagation, tooltip doctrine), (c) `:focus-visible` on
  the button, (d) `@media (pointer: coarse)` always. When shown:
  `pointer-events: auto`.
- Keyboard: it is a real sibling button in the tab order. Mirror the bin
  button's `onBlur={onKbFocusOut}` wiring and verify a staged keyboard edit is
  not silently lost when focus moves tile → ✓ (inspect `onKbFocusOut`'s
  relatedTarget/containment logic and include the new button the same way the
  bin button is included).
- Modal: „Wykonane bloki” becomes a COLLAPSED section. In
  `taskModalSections.ts:77` set `done-blocks` `collapsible: true`; in
  `TaskModal.tsx` render it behind a disclosure toggle like „Cykliczność”/
  „Klasyfikacja”, header „Wykonane bloki (wykonano {done}/{total})”, default
  collapsed, `useState(() => Boolean(focusBlockId))` so entering from
  `?task=<id>&block=<id>` still auto-expands, scrolls to and highlights the
  row. Update `taskModalSections.test.ts` (collapsible flags assertion).

### Step 6 — IA-15: full task page at `/tasks/:id`

- Export `TaskEditor` (add `export` at `TaskModal.tsx:492`) — it is already a
  cleanly separable component with `EditorProps`; do NOT move its code.
  Also extract the delete flow into a small exported hook in `TaskModal.tsx`
  (e.g. `useDeleteTaskConfirm(taskId)` wrapping the `:320–341` body) so the
  page and the shell share one confirm flow instead of drifting copies.
- New `src/pages/TaskFullPage.tsx`: standard `.page` layout, full width.
  Chrome mirrors `TaskModalShell` glue: dirty state + `setNavGuard` (new scope,
  below) + `useSaveStatus` + `SaveStatus` (announceId `save:task-page`) +
  blockers badge + `<OverflowMenu>` with „Usuń zadanie” (danger; after delete
  navigate to `/tasks`). Body = `<TaskEditor taskId=... onSaved={() =>
  navigate('/tasks')} onCancel={() => navigate('/tasks')} ...>` — settled: the
  router guard (not a local confirm) owns the dirty prompt on cancel/leave;
  after an explicit save the page returns to `/tasks`, mirroring modal close.
  Auto-save behavior comes along for free from TaskEditor.
  Missing/unknown id → the existing `.empty-state` copy „Nie znaleziono
  zadania” + hint + link „Wróć do listy zadań” (`/tasks`).
- Routing (`src/App.tsx`): `:481` becomes
  `<Route path="/tasks/:id" element={<TaskFullPage />} />`; delete
  `TaskRedirect` (`:598–601`). `/tasks/new` (`:480`) unchanged — static
  segment outranks `:id`, so `id === 'new'` is unreachable.
- Guard scope: `src/utils/dirtyRegistry.ts:37` add `'task-page'` to
  `NavGuardScope`; `navGuardBlocks` treats it like `project-detail`
  (blocks on `pathname` change only — opening `?task=`/`?wydarzenie=` overlays
  on top of the page keeps it mounted). Extend `dirtyRegistry.test.ts`.
- Modal header link: in `TaskModalShell`, when `existing`, render
  `<Link className="link-btn" to={taskFullViewPath(existing.id)}>Otwórz pełny
  widok ↗</Link>` in `.task-modal-head-actions`. No extra close handling: the
  pathname navigation drops `?task=`, the router guard prompts if dirty.
- New pure helper `src/pages/taskPageRoute.ts` + test (route coverage stands in
  for render tests — no DOM env): `taskFullViewPath(id: string): string`
  (encodeURIComponent) and `normalizeTaskRouteParam(raw: string | undefined):
  string | null` (trim; empty/undefined → null → not-found state). Tests:
  encoding of ids with `/`/spaces, round-trip with `decodeURIComponent`,
  null cases.
- Verify `.task-editor` / `.editor-section` / tabs styles are not scoped under
  `.task-modal-card` in `styles.css`; add minimal page-level equivalents only
  where they are (report which, if any).

## Out of scope

- Any new reducer action, store field or storage change.
- Bin cards, recur/event overlays, MonthView, TimelinePage.
- `.toggle-btn` styling shared by other surfaces; `.checkbox-field` checkboxes.
- Retirement mode; backend/sync/notifications; permission model changes.
- Wiki edits (final reviewer owns the single wiki decision; report boundary
  changes only).

## Acceptance

- [ ] One reusable `OverflowMenu` on `useOverlay`/`OverlayLayer`; trigger has
      `aria-haspopup="menu"` + `aria-expanded`; Escape/outside-pair close;
      arrows/Home/End/typeahead work; focus returns to the trigger.
- [ ] Modal header contains only title, SaveStatus, „Otwórz pełny widok ↗”,
      ⋯ menu and close; „Usuń zadanie” lives in the menu with the unchanged
      confirm flow; no red button in the header.
- [ ] CommentsPanel has no tablist; „Historia zmian (n)” opens from its ⋯ menu;
      back button returns to comments; head spacing ≥ 8 px, targets ≥ 32 px.
- [ ] Checklist + done-block checkboxes are 20 px with label-click and ≥ 40 px
      rows; „Wyczyść kolumnę” sits in a per-person ⋯ menu, no confirm, and
      „Cofnij” instantly restores hours AND pinned start times.
- [ ] Empty/weekend day runs (≥ 2) collapse to one bar with the Polish label
      shape „14 pustych dni roboczych + 6 weekendowych — pokaż”; expanding
      works and survives editing; value cells carry a person-colored left
      edge; empty inputs show placeholder „—”; grid editing logic byte-level
      untouched.
- [ ] Calendar tile ✓ toggles `SET_BLOCK_DONE` for that entry; pointer-down on
      ✓ never starts drag/resize; ✓ is keyboard reachable; drag/resize/touch
      gate elsewhere on the tile unchanged. „Wykonane bloki” section is
      collapsed by default and auto-expands for `?block=`.
- [ ] `/tasks/:id` renders the full-page editor (same tabs, grid, auto-save,
      blockers, delete); `/tasks/new` still redirects to the modal; unknown id
      shows „Nie znaleziono zadania”; dirty full page prompts on navigation
      via the `'task-page'` guard scope.
- [ ] All new strings Polish; no new runtime dependency; invalid-state
      reducers untouched.

## Verification

- Worker: `npx vitest run src/components/allocationGridView.test.ts
  src/components/taskModalSections.test.ts src/utils/dirtyRegistry.test.ts
  src/pages/taskPageRoute.test.ts` first, then `npm test` and `npm run build`.
- Browser: `node scripts/browser-check-ui-keyboard.mjs` (Chromium + WebKit) —
  week-block focus/keyboard surface changed; and
  `node scripts/browser-check-savetask-multiblock.mjs` (Chromium + WebKit) —
  allocation-grid row DOM changed. If the multiblock check trips ONLY because
  formerly-empty rows are now collapsed, prefer adjusting the check's row
  targeting minimally and say so in the report; do not weaken its assertions.
- Scheduler owns the final full gate before commit.

## Prior decisions

- ONE developer, this internal order; primitive first. No parallel packages —
  `TaskModal.tsx` is on five of six items.
- Undo snapshot = TaskEditor local state; explicitly NOT a reducer action
  (draft state + SAVE_TASK reconciliation make a store undo wrong-layered).
- „Aktywność” leaves CommentsPanel as a menu entry named „Historia zmian”; the
  same panel change applies on the project page (accepted).
- ✓ affordance is a focusable SIBLING of the tile (bin-button doctrine), not a
  child; passive mark stays for non-editable blocks, bin cards, recur blocks.
- Full page reuses `TaskEditor` via export, no file move; onSaved/onCancel
  navigate to `/tasks`; dirty prompt is owned by the router guard with new
  scope `'task-page'` (pathname-change semantics).
- No DOM-render tests: vitest is node-env, `*.test.ts` only — route coverage
  goes through `taskPageRoute.ts` pure helpers instead.
