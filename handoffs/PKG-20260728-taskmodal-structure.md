# Handoff: Reorder TaskModal into dependency-ordered sections with tabs

- Package ID: PKG-20260728-taskmodal-structure
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — 2069-line stability-sensitive modal, cross-cutting DOM restructure

## Goal

`src/components/TaskModal.tsx` renders its sections from a new pure, unit-tested
section-order model (`src/components/taskModalSections.ts`) in the order
co → kiedy → kto → ile → jak rozłożone → jak sprawdzę → rozmowa, with tabs for
Planowanie/Dyskusja, create-mode gating, a merged planning summary bar (the
separate „Zasobnik” section dies), and collapsed Cykliczność/Klasyfikacja.
STRUCTURAL move only — field logic, autosave, dirty tracking, validators and
AllocationGrid internals are relocated, not rewritten.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `src/components/TaskModal.tsx` (reorder JSX inside `TaskEditor` return, lines ~1186–2069; tab state; sticky context header)
- `new: src/components/taskModalSections.ts` (pure model — house style of `taskSaveBlockers.ts`: doc-comments in Polish, exported types + pure functions)
- `new: src/components/taskModalSections.test.ts` (vitest, pure/node — sibling pattern of `taskSaveBlockers.test.ts`)
- `src/components/CommentsPanel.tsx` (IA-17: move the comment input ABOVE the thread list — structural only)
- `src/styles.css` (owns `.editor-section`, `.estimate-compare` ~1137, `.task-modal-head` ~4962, `.editor-actions-sticky` ~6801, `.sold-hours*` ~6875; add tab/collapsible/context-header rules; delete now-dead `.bin-existing*` rules ONLY after grepping that no other file uses them)
- `scripts/browser-check-savetask-multiblock.mjs` (add a click on the „Planowanie” tab before locating `.alloc-grid` — minimal edit)

## Invariants

- CommentsPanel stays OUTSIDE `<form className="task-editor-form">` (it owns its own `<form>`; nesting is illegal HTML). See required DOM skeleton below.
- Blocker order in `collectTaskSaveBlockers` is UNCHANGED (title → project → status → period → assignees). Do not touch `taskSaveBlockers.ts`; the new visual order finally matches it.
- Field anchors keep their ids: `t-title`, `t-project`, `t-status`, `t-start`, `t-end`, `t-assignees`, `t-category`, `t-department`, `recur-*` — browser checks and `focusSaveBlocker` depend on them.
- Autosave, dirty serialization (`serializeDraft`), `markTouched`/`showError`/`saveAttempted` model, `handleSave`/publish handlers, recurrence dispatch logic (`SET_TASK_RECURRENCE`, `recurTouched`, `recurApplyError`, `DisabledHint` at ~1799), and AllocationGrid props: byte-for-byte relocations, no logic edits.
- The single `role="alert"` save-blockers block stays in the sticky `editor-actions-sticky` footer, outside the form. Hidden submit button stays inside the form (implicit submission).
- Deep links keep working: `?task=…&block=<id>` still scrolls/highlights the block row; `?task=new&project/date/assignee` prefills unchanged.
- Invariant 6 (reducer guards, task-save reconciliation, date guards) untouched. Draft (`isDraft`) behavior unchanged except section placement. Read-only (`readOnly`) rendering keeps the one hidden `task-ro-reason` description.
- No new runtime dependencies; plain CSS; all new strings Polish.

## Scope

### 1. Pure model — `src/components/taskModalSections.ts`

Exact exports (developer may add doc comments, nothing else public):

```ts
export type TaskModalTabId = 'zadanie' | 'planowanie' | 'dyskusja';

export type TaskModalSectionId =
  | 'context'        // sticky: tytuł, projekt, status
  | 'details'        // Szczegóły: opis, priorytet
  | 'period'         // Okres: t-start, t-end (MOVED above hours)
  | 'people-hours'   // Przypisane osoby + godziny sprzedane + availability-panel
  | 'summary'        // merged planning summary bar (replaces „Zasobnik” section)
  | 'checklist'
  | 'recurrence'     // collapsed behind „Powtarzaj to zadanie”
  | 'classification' // collapsed: kategoria, dział
  | 'allocation'     // Dzienny przydział godzin (AllocationGrid)
  | 'done-blocks'    // Wykonane bloki
  | 'discussion';    // CommentsPanel

export interface TaskModalSection {
  id: TaskModalSectionId;
  tab: TaskModalTabId;
  collapsible: boolean; // true only for recurrence + classification
}

export interface SectionFlags {
  isEdit: boolean;         // task exists in state (TaskEditor: `Boolean(existing)`, line ~503)
  isDraft: boolean;        // line ~509
  hasValidPeriod: boolean; // `periodValid` = periodError(...) === null, line ~666
  hasAssignees: boolean;   // assignedPeople.length > 0
  hasBlocks: boolean;      // taskBlocks.length > 0 (line ~1150)
  commentCount: number;    // commentsFor(state, 'task', id).length (selectors.ts ~910)
}

export interface TaskModalTab { id: TaskModalTabId; label: string } // label WITH counter for dyskusja

export function visibleSections(flags: SectionFlags): TaskModalSection[];
export function visibleTabs(flags: SectionFlags): TaskModalTab[];
export function initialTab(args: { hasFocusBlock: boolean; isEdit: boolean }): TaskModalTabId;
export function resolveTabNavKey(key: string, currentIndex: number, count: number): number | null;
```

Rules the model encodes (and tests assert):

- Order within tab `zadanie`: context, details, period, people-hours, summary, checklist, recurrence, classification. Tab `planowanie`: allocation, done-blocks. Tab `dyskusja`: discussion. `visibleSections` returns them in this global order, filtered.
- Visibility: context/details/period/people-hours/checklist/classification → always. summary → `!isDraft`. recurrence → `isEdit && !isDraft` (create mode and drafts render NOTHING — the current dead „Zapisz i opublikuj…” hints die). allocation → `!isDraft && (isEdit || hasValidPeriod)` (create mode: appears only once the period is valid; the „Ustaw prawidłowy okres…” dead section never renders above a nonexistent period again). done-blocks → `isEdit && hasBlocks`. discussion → `isEdit`.
- `visibleTabs`: `zadanie` always; `planowanie` iff allocation or done-blocks visible; `dyskusja` iff discussion visible, label `Dyskusja (N)` via the existing Polish count (plain `(${commentCount})`).
- `initialTab`: `'planowanie'` iff `hasFocusBlock && isEdit`, else `'zadanie'`.
- `resolveTabNavKey`: mirror of `resolveMenuNavKey` (`overlayShell.ts` ~213) for a horizontal tablist — ArrowRight/ArrowLeft wrap, Home/End, `null` otherwise; count ≤ 0 → null.

### 2. TaskModal restructure

Required DOM skeleton inside `TaskEditor` return (`.editor.task-editor`):

```
[role=tablist]                       ← rendered ONLY when visibleTabs().length > 1
<form class="task-editor-form">      ← unchanged onSubmit/noValidate
  [role=tabpanel «zadanie»]          ← sections of tab zadanie, model order
  [role=tabpanel «planowanie»]       ← allocation + done-blocks (form-bearing, stays inside form)
  hidden submit button
</form>
[role=tabpanel «dyskusja»]           ← CommentsPanel — SIBLING of the form, never inside it
[.editor-actions.editor-actions-sticky]  ← unchanged
```

- Panels hide via the `hidden` attribute (stay mounted: no AllocationGrid remount, no state loss, dirty tracking untouched). Panels get `role="tabpanel"`, `aria-labelledby` to their tab; tabs get `role="tab"`, `aria-selected`, `aria-controls`, roving tabindex; selection follows focus on arrow keys (use `resolveTabNavKey`). Tablist `aria-label="Sekcje zadania"`. `useModalShell` provides no tab primitive — this is new thin DOM code over the pure helper.
- `context` section: MOVE the existing `t-title`, `t-project`, `t-status` Fields (incl. `data-autofocus`, empty-projects hint) into a `.task-context-header` div at the top of the zadanie panel, `position: sticky; top: 0` within the `.task-modal-body` scroll container, opaque background, z-index above section content but below the confirm/tooltip tokens. No `<h2>`.
- `details` keeps `<h2>Szczegóły</h2>` with opis + priorytet only.
- `period` section moves up wholesale (heading stays „Okres” — matches `SaveBlocker.fieldLabel`; do not rename).
- `people-hours`: current assignees + sold-hours + availability-panel block, unchanged internally.
- `summary`: rework `.estimate-compare` (~line 1508) into „w kalendarzu {plannedTotalAll} · zasobnik {binTotal} · sprzedane {soldTotal}” (`formatDuration`), keep `PlanningBadge` + `planningStatusForTotals(...)` call, keep the `legacyEstimate` hint and `overBudget` warning. When `binTotal > 0` add one `field-hint`: „Zasobnik = godziny osoby minus godziny w kalendarzu. Bloki bez terminu przeciągniesz na siatkę w widoku tygodnia kalendarza.” Then DELETE the whole „Zasobnik (bez terminu)” section (~1914–1960): per-person bin numbers already live in each `sold-hours-meta` row („w kalendarzu X • zasobnik Y”), so nothing is lost.
- `recurrence`: wrap the existing section body in a toggle „Powtarzaj to zadanie” (`<button type="button" aria-expanded aria-controls>`; NOT `<details>` — house style has none and the body contains buttons). Default expanded iff `liveRule != null`. Collapsing only hides UI — it never dispatches; „Usuń cykliczność” stays the only destructive path. Because `recurApplyError`/`recurTouched` rendering moves inside the expanded body untouched, „validation only after enabling” holds by construction; the AT-07 `DisabledHint` comment/behavior at ~1799 must survive verbatim.
- `classification`: new collapsed section „Klasyfikacja” holding the existing `t-category` + `t-department` fields (moved as-is from Szczegóły). Same toggle pattern, default expanded iff `workCategoryId !== '' || departmentId !== ''`.
- `focusSaveBlocker`: before focusing, switch the active tab to `'zadanie'` (all anchors live there), then focus after commit (effect or `setTimeout(0)` around the existing `focusFieldById`).
- `?block=` deep link: pass `hasFocusBlock` into `initialTab` so the Planowanie panel is visible when the scroll-into-view effect (~1167) runs.
- CommentsPanel: move its input form above the thread list (IA-17); no logic changes.

### 3. CSS (`src/styles.css`)

New: `.task-editor-tabs` / `.task-editor-tab` (selected state via `[aria-selected="true"]`), `.task-context-header` (sticky), collapsible toggle styling (reuse `.btn ghost` look where possible). Adjust `.estimate-compare` for the three-number bar. Remove `.bin-existing`, `.bin-existing-row`, `.bin-existing-name` and `.bin-chip`/`.bin-chips` rules ONLY if `grep` proves no other component uses them (calendar bin cards may share names — verify first).

## Out of scope

- Any change to `taskSaveBlockers.ts`, `fieldContract.ts`, `modalShell.ts`/`useModalShell.ts`, `AllocationGrid` internals, reducers, selectors, storage.
- Retirement mode (stays disabled), new reducer actions, new dependencies, non-Polish strings.
- TicketModal/EventModal parity (they copy the TaskModal pattern but are NOT touched now).
- Wiki edits beyond the report note (final reviewer owns the wiki verdict).

## Acceptance

- [ ] `taskModalSections.test.ts` covers: full order in edit mode; create-mode set is exactly context/details/period/people-hours/summary/checklist/classification before a valid period, + allocation after; draft hides summary/allocation/recurrence; tabs list incl. `Dyskusja (N)` label; `initialTab` for block deep link; `resolveTabNavKey` wrap/Home/End/null cases.
- [ ] TaskModal renders sections strictly from `visibleSections`/`visibleTabs` — no hardcoded order or duplicate visibility conditions for section-level gating.
- [ ] Edit mode shows tabs Zadanie / Planowanie / Dyskusja (N); create mode shows no tablist until a second tab becomes visible; Okres renders above the hours/allocation UI in the DOM.
- [ ] „Zasobnik (bez terminu)” section is gone; summary bar shows kalendarz · zasobnik · sprzedane + PlanningBadge; over-budget warning still appears.
- [ ] Sticky context header (title/project/status) stays visible while scrolling the zadanie panel; sticky footer still works; blocker click from any tab lands focus on the right field.
- [ ] `?task=<id>&block=<id>` opens on Planowanie with the row highlighted; comment input sits above the thread; CommentsPanel remains outside the form element (assert via DOM inspection in the browser script or manual note).
- [ ] Cykliczność renders only for saved, published tasks and only expands via „Powtarzaj to zadanie”; disabled „Zastosuj cykliczność” keeps its DisabledHint reason; Klasyfikacja collapsed by default when empty.
- [ ] All pre-existing unit tests green: `taskSaveBlockers`, `fieldContract`, `modalShell`, `confirmDialog`, `blockActions`, `blockLabel` (first two are the closest regression surface).

## Verification

- Worker: `npx vitest run src/components/taskModalSections.test.ts src/components/taskSaveBlockers.test.ts src/components/fieldContract.test.ts`, then `npm test` and `npm run build`.
- Browser: `scripts/browser-check-savetask-multiblock.mjs` (allocation grid moved behind the Planowanie tab — update the script minimally, then run per its ENGINE convention) and `scripts/browser-check-date-hardening.mjs` (fills `#t-start`/`#t-end` inside the modal). KNOWN PRE-EXISTING RISK: the multiblock script clicks a „Zapisz i zamknij” button that no longer exists in `src` (footer now says „Gotowe”/„Utwórz zadanie”) — if it is red BEFORE your change, record it as pre-existing and fix only the tab-navigation locator, not the button naming.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Tab ids/labels: `zadanie` „Zadanie” (default), `planowanie` „Planowanie”, `dyskusja` „Dyskusja (N)”. Single visible tab ⇒ no tablist rendered.
- Panels hidden with the `hidden` attribute, not unmounted.
- Selection follows focus on ArrowLeft/ArrowRight (plus Home/End); new pure `resolveTabNavKey` mirrors `resolveMenuNavKey` rather than reusing it (different axis, no wrap-in semantics from outside the list needed).
- Section heading stays „Okres” (not „Termin”) to match `SaveBlocker.fieldLabel` and existing period copy.
- Priorytet stays in „Szczegóły”; Klasyfikacja = kategoria + dział only.
- Collapsibles are controlled buttons with `aria-expanded`, not `<details>`.
- Recurrence toggle default-expanded iff a live rule exists; klasyfikacja default-expanded iff a value is set.
- Create mode may still allocate hours before saving: the Planowanie tab appears as soon as the period is valid (this preserves today's create-with-allocations flow while killing the dead sections).
- Report note for the final reviewer: `ui-navigation-and-onboarding.md` line ~193 („formularz obejmuje sekcje OD «Szczegóły» DO «Zasobnik»”) becomes stale — the form now spans the zadanie+planowanie tabpanels and „Zasobnik” no longer exists.
