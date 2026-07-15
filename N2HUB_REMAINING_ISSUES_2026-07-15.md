# N2Hub — remaining issues

## 1. Imported task periods can exceed 92 days

- Severity: medium
- Type: confirmed data-integrity bug
- Area: `src/store/storage.ts`
- Evidence: `normalizeDates` repairs invalid and reversed task periods but
  explicitly leaves valid periods longer than 92 days unchanged.
- Reproduction:
  1. Store a task with `startDate: 2026-01-01` and `endDate: 2026-12-31`.
  2. Reload the app or call `loadData()`.
  3. The overlong period survives.
- Expected: every loaded task satisfies the documented 92-day hard invariant.
- Actual: the limit is enforced only on normal reducer writes.
- Recommended fix: choose one explicit preservation policy:
  - fail closed and offer export/reset; or
  - clamp the period to 92 inclusive days and atomically move out-of-period
    workload into the bin without losing hours or row identity.
- Coverage needed: exact 92/93-day boundaries, idempotent repair, workload-hour
  conservation, bin identity, and browser recovery/import behavior.
- Wiki impact: document the selected load-repair policy.

## 2. Whole-task timeline moves can create workload collisions

- Severity: medium
- Type: data-integrity regression risk / unresolved domain rule
- Area: `moveTask` in `src/store/AppStore.tsx`
- Evidence: `MOVE_TASK` shifts every dated workload row by `dayDelta` and
  reindexes affected days without running the same-person collision preflight
  used by calendar drag, resize, reassignment, and automatic placement.
- Reproduction:
  1. Give a person a block for task A on Monday and a colliding block for task B
     on Tuesday.
  2. Move task A one day forward from the timeline.
  3. Both blocks can occupy overlapping time on Tuesday.
- Expected: either atomic collision rejection or an explicitly documented
  exception for whole-task moves.
- Actual: overlap is created silently.
- Recommended fix: define the product rule, then preflight every shifted block
  and reject the entire move with a clear explanation if any forbidden overlap
  would be introduced.
- Coverage needed: multi-person/multi-day atomic moves, touching edges,
  pre-existing overlaps, bins, and same-task adjacency.
- Wiki impact: document whether timeline moves share calendar collision rules.

## 3. Timeline drag and resize lack interruption recovery

- Severity: medium
- Type: interaction robustness and accessibility
- Area: `src/pages/TimelinePage.tsx`
- Evidence: timeline task/project bars and milestone marks rely on element-level
  `pointermove`/`pointerup`. They have no `pointercancel`, window blur,
  visibility-change, Escape, or released-outside recovery. Custom timeline bars
  also activate with Enter only, not Space.
- Reproduction:
  1. Start dragging or resizing a timeline bar.
  2. Release the pointer outside the window, switch tabs, blur the window, or
     trigger pointer cancellation.
  3. Return to the page; the preview may remain stale or the intended outcome is
     ambiguous because there is no shared cancel path.
  4. Focus the bar and press Space; it does not open like a native button.
- Expected: interruption always reverts without dispatch, releases capture, and
  clears preview state; Enter and Space both activate button-like bars.
- Actual: only ordinary in-element pointer-up and Enter are handled.
- Recommended fix: add synchronous drag refs and one cancellation routine shared
  by pointercancel, blur, visibility change, Escape, and mouse `buttons === 0`.
  Add Space activation without changing pointer behavior.
- Coverage needed: Chromium and WebKit interruption scenarios for bars,
  resize handles, and milestones, plus keyboard activation.
- Wiki impact: add timeline lifecycle rules if they become stability-sensitive.

## 4. Calendar context forms can be clipped on short viewports

- Severity: medium
- Type: UX/UI
- Area: `src/components/WeekView.tsx`, `src/styles.css`
- Evidence: the fixed context menu positions its top at no lower than
  `window.innerHeight - 240`, but schedule/insert forms can be taller than 240px.
  `.context-menu` has no viewport-aware maximum height or overflow behavior.
- Reproduction:
  1. Use a short mobile viewport such as 320×568 or browser zoom that reduces
     vertical space.
  2. Open a bin scheduling form or an insert form with validation warnings.
  3. Lower actions can extend below the viewport.
- Expected: all fields and actions remain reachable.
- Actual: position clamping assumes a fixed height smaller than some form states.
- Recommended fix: measure/flip the popover or constrain it with a viewport-based
  `max-height` and internal scrolling while keeping the focused control visible.
- Coverage needed: 320×568, 200% zoom, keyboard-only operation, and warning-heavy
  forms in Chromium and WebKit.
- Wiki impact: none unless positioning becomes a shared calendar rule.

## 5. Modal focus containment is incomplete

- Severity: medium
- Type: accessibility
- Area: `src/components/TaskModal.tsx` and other modal/dialog surfaces
- Evidence: TaskModal declares `role="dialog"` and `aria-modal="true"`, locks body
  scrolling, and handles Escape, but does not make the background inert, contain
  forward/reverse Tab navigation, or consistently restore focus to the opener.
- Reproduction:
  1. Open TaskModal using the keyboard.
  2. Tab past the final control or Shift+Tab before the first control.
  3. Focus can leave the modal and reach obscured page controls.
- Expected: modal focus remains inside until close and returns to the initiating
  control afterward.
- Actual: modal semantics are declared without a complete focus lifecycle.
- Recommended fix: introduce a shared dialog-focus utility covering initial
  focus, background inertness, Tab wrapping, Escape, nested confirmation safety,
  and opener restoration.
- Coverage needed: every modal/dialog surface, both Tab directions, dirty-close
  cancellation, deletion confirmation, and route-driven close.
- Wiki impact: document the shared modal accessibility boundary.

## 6. Form errors are not consistently announced to assistive technology

- Severity: low
- Type: accessibility
- Area: `src/pages/LoginPage.tsx`, project/person forms, TaskModal validation
- Evidence: several errors render as plain `.field-error` paragraphs without
  `role="alert"`, `aria-live`, or an `aria-describedby` relationship. The login
  password input sets `aria-invalid` but does not associate or announce the
  “Nieprawidłowe hasło” message.
- Reproduction:
  1. Use a screen reader and submit an incorrect password or invalid form.
  2. Focus remains on the input/button.
  3. The new error is not guaranteed to be announced or programmatically linked.
- Expected: validation changes are announced and associated with their fields.
- Actual: feedback is primarily visual.
- Recommended fix: give each error a stable id, connect it with
  `aria-describedby`, and use `role="alert"` or an appropriate polite live region.
- Coverage needed: DOM accessibility assertions plus keyboard/screen-reader
  smoke tests for login, project, person, milestone, and task forms.
- Wiki impact: none unless a shared validation component is introduced.

## 7. TaskModal remains too dense for frequent planning work

- Severity: low
- Type: UX/UI
- Area: `src/components/TaskModal.tsx`, `src/styles.css`
- Evidence: task metadata, period, status, people, allocation grid, bin hours,
  checklist, validation, and save actions compete in one long editor. Corrected
  totals do not address hierarchy or scanning cost.
- Expected: frequent edits expose the most common fields and allocation state
  quickly, with advanced content progressively disclosed.
- Actual: users must scan and scroll through many equally weighted controls.
- Recommended fix: group the editor into clear sections, keep save/status context
  visible, and progressively disclose secondary metadata without hiding errors
  or changing `SAVE_TASK` reconciliation.
- Coverage needed: experienced-user task-edit flows at desktop and mobile sizes,
  dirty-state navigation, and allocation equivalence tests.
- Wiki impact: update UI documentation if editor ownership is split.

## 8. Several empty states lack contextual next actions

- Severity: low
- Type: UX/UI
- Area: route-level empty states across `src/pages/`
- Evidence: multiple pages explain that no data exists but rely mainly on global
  navigation or the global create action instead of offering a local next step.
- Expected: a new user can move from each empty state to the relevant creation or
  setup flow without guessing.
- Actual: guidance and actions are inconsistent across pages.
- Recommended fix: add permission-aware contextual calls to action and distinguish
  truly empty data from filter-produced empty results.
- Coverage needed: zero-data, filtered-empty, and read-only role scenarios.
- Wiki impact: none unless onboarding route guidance changes.

## 9. Date-range and timeline calculations are duplicated

- Severity: low
- Type: code quality / regression risk
- Area: `src/pages/TasksPage.tsx`, `src/pages/ProjectsPage.tsx`,
  `src/pages/TimelinePage.tsx`, `src/store/selectors.ts`
- Evidence: Tasks and Projects contain near-identical local `rangeLabel`
  implementations. Timeline performs workload reductions that overlap selector
  responsibilities.
- Expected: shared date formatting lives in date utilities and derived workload
  reads live in selectors.
- Actual: equivalent rules can drift between pages.
- Recommended fix: extract one Polish date-range formatter and selector-backed
  timeline totals, then remove page-local copies.
- Coverage needed: same-day, same-month, same-year, cross-year, DST-adjacent, and
  multi-block equivalence cases.
- Wiki impact: unchanged; current boundary already says selectors own derived reads.

## 10. The production JavaScript bundle remains large

- Severity: low
- Type: performance / code quality
- Area: application bundling and route loading
- Evidence: the current production build emits approximately 659.88 kB of
  minified JavaScript, 199.07 kB gzip, and triggers Vite's 500 kB chunk warning.
- Expected: initial navigation loads only code needed for the active route and
  global shell.
- Actual: most application code ships in one large entry chunk.
- Recommended fix: profile before changing behavior, then introduce route-level
  dynamic imports and deliberate vendor splitting where measurements justify it.
- Coverage needed: bundle-size reporting, route-load smoke tests, and comparison
  of initial transfer/interaction metrics before and after splitting.
- Wiki impact: add a performance verification route only if it becomes a CI gate.
