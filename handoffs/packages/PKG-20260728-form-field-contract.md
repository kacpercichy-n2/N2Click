# Handoff: Wprowadź kontrakt pola formularza (Field) i pełną ścieżkę błędów zapisu w trzech modalach

- Package ID: PKG-20260728-form-field-contract
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — three modals plus a new accessibility contract; regression surface includes autosave, dirty-guard and the IA-12 blocker path.

## Goal

One reusable `Field` contract (pure wiring helpers + thin JSX component) adopted
by TaskModal, EventModal and TicketModal, so every migrated field exposes
`aria-describedby`/`aria-invalid`, every failed save focuses+scrolls the first
invalid field and announces ONE counted Polish summary per modal, validation
follows a blur/save-first timing model, and TaskModal's fields live inside a
real `<form onSubmit>`.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `new: src/components/field.ts` — pure wiring helpers (node-tested)
- `new: src/components/field.test.ts`
- `new: src/components/Field.tsx` — thin JSX component + `focusFieldById` DOM helper
- `src/components/taskSaveBlockers.ts` — add `fieldLabel`, add `periodInvalidTargets`
- `src/components/taskSaveBlockers.test.ts`
- `src/components/TaskModal.tsx`
- `src/components/EventModal.tsx`
- `src/components/TicketModal.tsx`
- `src/styles.css` — one small addition only (see Scope §6)

## Invariants

- Invariant 6 untouched: the store, reducer and `isValidTaskDraft` are NOT
  modified; a blocked form still never dispatches.
- TaskModal autosave (`useAutoSave` call, `dirty`/`signature`/`formValid`
  semantics) and the dirty-registry/navigation-guard behavior are unchanged.
- `collectTaskSaveBlockers` ordering, messages and `focusId` anchors
  (`t-title`, `t-project`, `t-status`, `t-start`, `t-end`, `t-assignees`)
  are unchanged — only ADD fields to `SaveBlocker`.
- The clickable blocker list near the save button, its gating
  `saveAttempted || (isEdit && dirty)`, the `onBlockersChange` report to the
  modal shell and the SaveStatus badge jump keep working.
- Failed save still focuses + scrolls `blockers[0]` (already implemented in
  `doSave` via `focusSaveBlocker`); keep the
  `focus({preventScroll:true})` + `scrollIntoView({block:'center'})` pair.
- CommentsPanel (its own `<form className="comment-form">`) is NOT modified and
  must NOT end up nested inside the new TaskModal form.
- Checklist input Enter keeps adding an item (it already `preventDefault()`s).
- EventModal/TicketModal submit flows (`.ticket-form`, draft-rejection message
  `errors.form`, dirty clearing before close) keep their current semantics.
- All user-facing strings Polish. Current visuals preserved: reuse `.field`,
  `.field-error`, `.field-hint`, `.save-blockers*` classes.
- Retirement mode stays disabled. No new runtime dependencies.

## Scope

### 1. Pure wiring module `src/components/field.ts` (node-tested)

The vitest config is `environment: 'node'` and includes only `src/**/*.test.ts`
— component render tests are NOT possible. All testable logic therefore lives
in this pure module; `Field.tsx` is a thin consumer.

- `fieldIds(controlId: string): { help: string; error: string }` →
  `` `${controlId}-help` `` / `` `${controlId}-error` ``. Deterministic ids let
  range-level errors be shared by two controls.
- `fieldAria(controlId: string, opts: { hasHelp: boolean; hasError: boolean; extraDescribedBy?: string }): { 'aria-describedby'?: string; 'aria-invalid'?: true }`
  — describedby order: error id first, then help id, then `extraDescribedBy`;
  key omitted entirely when empty. `aria-invalid` present only when `hasError`
  (or forced via an explicit `invalid` flag — see Field props).
- `firstInvalidKey<K extends string>(order: readonly K[], errors: Partial<Record<K, unknown>>): K | null`
  — first key in `order` with a defined error.
- `saveErrorSummary(prefix: string, fieldLabels: string[]): string` — dedupe
  labels, `n = labels.length`; `n === 0` → `` `${prefix}.` ``; otherwise
  `` `${prefix} — popraw ${n} ${polishCount(n, 'pole', 'pola', 'pól')}: ${labels.join(', ')}.` ``
  (reuse `src/utils/polishPlural.ts`). Example:
  „Nie można zapisać zadania — popraw 2 pola: Tytuł, Okres.”

### 2. Thin component `src/components/Field.tsx`

- Props: `{ id?: string; label: ReactNode; help?: ReactNode; error?: ReactNode; invalid?: boolean; describedByExtra?: string; className?: string; children: (control: { id: string } & ReturnType<typeof fieldAria>) => ReactNode }`.
- `const auto = useId(); const controlId = id ?? auto;` — migrated fields pass
  their EXISTING stable ids (`t-title`, `event-date`, `ticket-title`, …) so the
  IA-12 focus anchors and any selectors keep working; `useId` is only the
  fallback for future unanchored fields.
- Renders exactly the current structure: `<div className="field">`,
  `<label htmlFor={controlId}>`, `children(controlProps)`,
  help as `<p className="field-hint" id={ids.help}>` when present,
  error as `<p className="field-error" id={ids.error}>` when present.
  Per-field errors get NO `role="alert"` (see §4 — one alert per modal; this
  removes the existing per-field `role="alert"` in EventModal/TicketModal
  deliberately, replaced by the summary alert).
- Also export `focusFieldById(id: string): void` — the existing two-step
  focus+scroll (copy of `focusSaveBlocker` body). Refactor TaskModal's
  `focusSaveBlocker` to delegate to it; EventModal/TicketModal use it on
  failed submit.

### 3. `taskSaveBlockers.ts` additions (no behavior change to existing fields)

- `SaveBlocker` gains `fieldLabel: string | null`: title→`Tytuł`,
  project→`Projekt`, status→`Status`, period→`Okres`, assignees→`Osoby`,
  other→`null`. This is the ONLY source of summary labels for TaskModal.
- `periodInvalidTargets(error: PeriodError): { start: boolean; end: boolean }`
  — `missing-start`/`invalid-start` → start only; `missing-end`/`invalid-end`
  → end only; `reversed`/`too-long` (range-level) → both true.
- Extend `taskSaveBlockers.test.ts` for both additions.

### 4. One `role="alert"` summary per modal

- TaskModal: the existing `<div className="save-blockers" role="alert">` REMAINS
  the single alert region. Replace only the `save-blockers-title` text
  „Nie można zapisać:” with
  `saveErrorSummary('Nie można zapisać zadania', labels)` where
  `labels = blockers.map(b => b.fieldLabel).filter(Boolean)`. The clickable
  list below stays. Gating unchanged. No second alert element anywhere in
  TaskModal.
- EventModal: replace the `errors.form` slot (before `.form-actions`) with one
  `<p className="field-error" role="alert">` that shows, in priority order:
  `errors.form` verbatim when set, else — when any field errors exist —
  `saveErrorSummary('Nie można zapisać wydarzenia', labels)` derived at render
  time from the `errors` object via a colocated const
  `EVENT_FIELDS: ReadonlyArray<{ key: keyof FieldErrors; domId: string; label: string }>`
  = title/`event-title`/`Tytuł`, date/`event-date`/`Data`,
  time/`event-start`/`Godziny`, meetingUrl/`event-url`/`Link do spotkania`.
  This const is the single source for BOTH the summary labels and the
  first-invalid resolution (`firstInvalidKey` over its keys).
- TicketModal: same pattern near `.form-actions` (reuse the `errors.reporter`
  slot area), prefix `existing ? 'Nie można zapisać zgłoszenia' : 'Nie można wysłać zgłoszenia'`,
  const `TICKET_FIELDS` = title/`ticket-title`/`Nazwa zgłoszenia`,
  description/`ticket-description`/`Opis`, reporter/`null` domId/`Zgłaszający`.
- EventModal/TicketModal failed submit: after `setErrors(next)`, call
  `focusFieldById` on the first invalid field's `domId` (skip null domId —
  reporter). TaskModal already does this via `focusSaveBlocker(blockers[0])`.

### 5. Field migration (exact list)

- TicketModal — ALL labeled fields: `ticket-title`, `ticket-area`,
  `ticket-description`, `ticket-kind`, `ticket-priority`. Errors for
  title/description flow through Field's `error` prop; `reporter` stays a
  standalone paragraph (not a field) but is included in the summary.
- EventModal — labeled simple controls: `event-title`, `event-date`,
  `event-start`, `event-end`, `event-url`, `event-location`, `event-desc`,
  `event-until`. The range-level `errors.time` paragraph keeps rendering after
  the start/end `field-row` but gets `id="event-time-error"`; both time inputs
  receive `invalid={!!errors.time}` and `describedByExtra="event-time-error"`
  (when set). The attendees group and recurrence radio/day-chips stay as-is.
- TaskModal — bounded subset: `t-title`, `t-desc`, `t-project`, `t-status`,
  `t-priority`, `t-start`, `t-end`, plus the `t-assignees` group:
  - `t-title`: error „Tytuł jest wymagany” via Field (gated per §6 timing).
  - `t-project`: move the footer paragraph „Wybierz projekt dla tego zadania.”
    (currently above `.editor-actions`) to an inline Field error under the
    select, gated per §6; delete the footer duplicate. The „najpierw utwórz
    projekt” empty-state hint stays as today.
  - `t-status`: inline Field error „Wybierz istniejący status.” only when the
    status blocker is visible per §6 (rare).
  - `t-start`/`t-end`: the shared period error paragraph
    (`PERIOD_ERROR_LABELS[perErr]`) keeps its position after the `field-row`
    but gains `id="t-period-error"` and §6 gating; both date inputs get
    `describedByExtra="t-period-error"` (when the error is visible) and
    `invalid` per `periodInvalidTargets(perErr)`. This satisfies „period errors
    attach to the period field”, including range-level `reversed`/`too-long`
    (both controls marked invalid, one shared description).
  - `t-assignees`: keep the existing `div.assignee-picker` anchor
    (`id`, `tabIndex={-1}`); add `role="group"` +
    `aria-label="Przypisane osoby"`; when the assignees blocker is visible per
    §6, render its message as `<p className="field-error" id="t-assignees-error">`
    directly under the picker and set `aria-invalid` +
    `aria-describedby="t-assignees-error"` on the group div. (No Field wrapper
    for this composite — manual wiring with `fieldAria` is fine.)

### 6. Validation timing (concrete state shape)

- TaskModal: replace `titleTouched` with
  `const [touched, setTouched] = useState<ReadonlySet<SaveBlockerId>>(new Set())`
  plus the existing `saveAttempted`. Mark on blur of the corresponding
  control(s): title→`'title'`, project→`'project'`, status→`'status'`, either
  date input→`'period'`, any assignee checkbox→`'assignees'`. Visibility rule
  for an inline error/`aria-invalid` of field F:
  `blocker(F) exists && (touched.has(F) || saveAttempted)`. Since blockers are
  recomputed every render, a visible error re-validates live and disappears the
  moment it is fixed; an untouched field never starts erroring on keystroke.
  `doSave` keeps setting `saveAttempted=true` on failure (reveals everything)
  and `false` on success. Note this deliberately gates the period and project
  errors that today show instantly — that is the requested task-4 behavior.
  The footer blocker-list gating (`saveAttempted || (isEdit && dirty)`) is NOT
  changed. Do not touch `useAutoSave`, `dirty`, snapshots or the reducer.
- EventModal/TicketModal: keep validate-on-submit as first validation, and
  additionally validate the individual field on blur (title/date required rules,
  meetingUrl format, ticket title/description required). Replace the current
  blind clear-on-change (`setErrors(x => ({...x, k: undefined}))`) with a
  re-check of that field's own rule on change ONLY while it currently has an
  error (live re-validation for erroring fields; clean fields stay silent while
  typing). Extract each per-field rule as a tiny local pure function used by
  blur, change-while-erroring and submit, so the three paths cannot drift.
  `errors.time` re-checks on change/blur of either time input once set.

### 7. TaskModal `<form>` wrap

- Wrap the editor sections from „Szczegóły” through the „Zasobnik” section in
  `<form className="task-editor-form" onSubmit={(e) => { e.preventDefault(); handleSave(); }} noValidate>`
  INSIDE the existing `div.editor.task-editor`. The „Dyskusja” section
  (CommentsPanel owns its own `<form>` — nesting is invalid HTML and would make
  „Skomentuj” submit the task form) and the sticky `.editor-actions` row stay
  OUTSIDE the form, after it, preserving DOM order.
- All 13 existing TaskModal buttons already have `type="button"` — verify none
  inside the wrapped subtree loses it, and that no NEW button is added without
  an explicit type. The checklist Enter handler already prevents default.
  Enter routes through `handleSave` in every mode (for a new draft that is
  „Utwórz szkic”; publish stays button-only) — the existing save path, no new
  logic.
- CSS: `.task-modal-body .editor-section:last-of-type { margin-bottom: 0 }`
  would newly match the last section INSIDE the form and collapse the gap
  before „Dyskusja”. Add one rule to `src/styles.css`:
  `.task-editor-form .editor-section:last-of-type { margin-bottom: var(--n2-space-4); }`
  (new class justified: it scopes the fix to the wrapper). No other style
  changes; verify modal spacing visually in dev.

## Out of scope (explicit, by name — not omissions)

- TaskModal: estimate/sold-hours inputs in „Osoby i godziny”, allocation grid
  cells, checklist input, per-block done rows, the whole „Cykliczność” section
  incl. `recurApplyError` wiring, CommentsPanel/Dyskusja, read-only hints.
- EventModal: attendees checkbox group, recurrence radios/day chips (only
  `event-until` gets a mechanical Field wrap, no new error).
- Auth/account/profile/admin pages (their `aria-invalid` usage stays as-is).
- No changes to `useModalShell`, `confirmDialog`, dirtyRegistry, storage, store.
- No retirement-mode work; no new CSS beyond the single rule in Scope §7.

## Acceptance

- [ ] `src/components/field.ts` + `Field.tsx` exist; every migrated control has
      `id`, label `htmlFor`, and `aria-describedby` referencing existing help
      and/or error element ids (error first; help and error can coexist);
      `aria-invalid` present only when the error is visible.
- [ ] TaskModal renders its fields inside `<form onSubmit>`; Enter in the title
      input triggers the existing save path; „Skomentuj” in Dyskusja does NOT
      save the task; no button inside the form lacks `type="button"`.
- [ ] Failed save in each modal: focus + scroll to first invalid field AND one
      (only one) `role="alert"` region with the counted summary, e.g.
      „Nie można zapisać zadania — popraw 2 pola: Tytuł, Okres.”; correct
      Polish plural for 1/2–4/5+ (pole/pola/pól).
- [ ] Period errors: `t-period-error` referenced from both date inputs;
      `reversed`/`too-long` mark BOTH inputs invalid; `missing-start` only the
      start input; blocker focus still lands per existing `periodFocusId`.
- [ ] Timing: no inline error before blur or save attempt; a field with a
      visible error clears/updates live while typing; a clean field never
      errors on keystroke; failed save reveals all current errors.
- [ ] `taskSaveBlockers` keeps existing messages/order/focusIds; new
      `fieldLabel` and `periodInvalidTargets` covered by tests; summary labels
      derive from `fieldLabel` / the colocated `EVENT_FIELDS`/`TICKET_FIELDS`
      consts (no second hand-maintained label list).
- [ ] New unit tests cover `fieldIds`/`fieldAria` (id derivation, describedby
      order and omission, invalid flag), `firstInvalidKey` (order and
      null-when-clean) and `saveErrorSummary` (0/1/2/5 labels, dedupe).
- [ ] Autosave, dirty guard, blocker list gating and SaveStatus badge jump
      behave exactly as before.

## Verification

- Worker: `npx vitest run src/components/field.test.ts src/components/taskSaveBlockers.test.ts`
  first; then `npm test` and `npx tsc --noEmit` once before reporting.
- Browser: none — no covered browser-check interaction changes (modal shell,
  calendar/bin, persistence untouched); do a manual dev-server smoke of the
  three modals' failed-save path and TaskModal spacing instead.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Node-only vitest ⇒ pure `field.ts` helpers carry ALL tested logic; no DOM
  renderer or new dev dependency may be added for tests.
- Stable DOM ids are passed into Field (anchors preserved); `useId` is fallback
  only.
- One alert per modal: TaskModal reuses `.save-blockers` (title text becomes the
  counted sentence); EventModal/TicketModal repurpose the form-level error slot;
  per-field errors drop `role="alert"`.
- Summary field labels come from `SaveBlocker.fieldLabel` (TaskModal) and the
  colocated field-meta consts (Event/Ticket) — single sources, no drift.
- The `<form>` wraps sections up to and excluding „Dyskusja”; sticky actions
  stay outside; one scoped CSS rule restores the last-section margin.
- Earlier IA-12 layer is built on, not duplicated: `focusSaveBlocker` already
  fires on failed TaskModal save and stays; `collectTaskSaveBlockers` is only
  extended.
