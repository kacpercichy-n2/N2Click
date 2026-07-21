# Handoff: Render recurring occurrences in the calendar and edit rules in TaskModal

- Package ID: PKG-20260721-recurrence-ui
- Status: ready
- Tier: developer
- Depends on: PKG-20260721-recurrence-core
- Risk: high
- Codex review: required — touches WeekView (stability-sensitive, invariant 7)

## Goal

Recurring tasks are editable in TaskModal (section „Cykliczność”) and their
occurrences render as visually distinct, purely presentational blocks in
WeekView (with a context menu „Edytuj to wystąpienie” / „Edytuj wszystkie”)
and as a marker in MonthView — with ZERO changes to drag/pointer lifecycle or
grid hit-testing.

## Wiki context

- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/state-and-persistence.md` (model bullet written by the core package)

## Expected touchpoints

- `src/components/TaskModal.tsx`
- `src/components/WeekView.tsx`
- `src/components/MonthView.tsx`
- `src/styles.css` (`.week-recur-block`, menu reuse of `.context-menu`, month marker)
- `openwiki/n2hub/scheduling-and-calendar.md`

Model/actions/selector/util come from the core package and are used as-is:
`Task.recurrence`, `SET_TASK_RECURRENCE`, `SET_RECURRENCE_OVERRIDE`,
`recurrenceOccurrencesForDate(state, date, filter)`,
`expandOccurrences` / `RecurrenceOccurrence` from `src/utils/recurrence.ts`.

## Invariants

- Invariant 7 (HARD): do not modify TimedBlock/BinCard pointer handlers, the
  window-owned bin-drag lifecycle, `packDayBlocks` usage, rendered-column
  (`data-day-index`) hit-testing, merge/fuse logic or the existing block/slot
  context-menu flows. Occurrence rendering is ADDITIVE overlay only.
- Occurrences never enter `packDayBlocks`, `dayTotal`, overload, availability
  or collision logic; real blocks lay out byte-identically with or without
  recurring tasks.
- Occurrence blocks have NO pointerdown/drag/resize handlers (no drag at all —
  the allowed skip). zIndex BELOW `.week-block` so they can never sit on top
  of a real/dragged block.
- Existing prompt-236 slot menu: right-click on bare grid still opens „Dodaj
  zadanie”; right-click on an occurrence must NOT open it.
- All new user-facing strings in Polish. Time 15-min steps, duration shown via
  `formatDuration`, dates `yyyy-MM-dd`.

## Scope

### 1. TaskModal — section „Cykliczność”

Place after the „Checklista” section. Visibility: EXISTING, PUBLISHED tasks
only. Hidden for creation and drafts with the hint
„Zapisz i opublikuj zadanie, aby ustawić cykliczność.”. Requires a valid
`startDate` (hint „Ustaw datę rozpoczęcia, aby dodać cykliczność.”).

Controls (local component state seeded from `existing.recurrence`, NOT part of
TaskDraft/auto-save):
- Weekday picker: 7 toggle chips labeled with `WEEKDAY_LABELS`
  (Pon…Nd → ISO 1…7).
- „Początek”: `<input type="time" step={900}>` → minutes (reuse WeekView's
  timeToMinutes pattern locally).
- „Czas trwania”: select of 0.25 h steps (0:15…8:00, `formatDuration` labels)
  → `durationMinutes`.
- „Do dnia (opcjonalnie)”: `<input type="date">`; empty = open-ended.
- Buttons: „Zastosuj cykliczność” → dispatch `SET_TASK_RECURRENCE` with the
  draft (disabled + inline Polish error when no weekday selected or until <
  startDate); „Usuń cykliczność” (only when a rule exists) → dispatch with
  `recurrence: null`.
- When `recurrence.overrides` exist, list them read-only
  („15.08.2026 — pominięto” / „15.08.2026 — 10:00, 1 godz.”) each with
  „Przywróć zgodnie z regułą” → `SET_RECURRENCE_OVERRIDE` with
  `override: null`.
- Explicit dispatch only — the section must NOT mark the SAVE_TASK draft dirty
  nor trigger the useAutoSave path.

### 2. WeekView — occurrence overlay + context menu

- In the day-column render (after the `packed.map` output, same
  `.week-day-col` container), map
  `recurrenceOccurrencesForDate(state, d, filter)` to `<RecurBlock>` divs:
  absolutely positioned `top = (startMinutes / 60) * HOUR_PX`,
  `height = max((durationMinutes / 60) * HOUR_PX, MIN_BLOCK_H)`, full column
  width, class `week-recur-block` (+ `overridden` modifier class).
- Distinct visuals in `styles.css`: dashed 2px border in the project/person
  hue at reduced opacity, striped translucent background
  (`repeating-linear-gradient`), small „⟳” prefix before the task title;
  `z-index` below `.week-block`.
- Interactions: `onClick` → `openTask(task.id)`; `onContextMenu` →
  `e.preventDefault(); e.stopPropagation();` then open the NEW `recurMenu`.
  Keyboard: `tabIndex={0}` + Enter/Space → open task (no pointer lifecycle).
- Defense-in-depth: in `openSlotMenu`, next to the existing
  `.closest('.week-block')` guard add `.closest('.week-recur-block')`.
- New `recurMenu` state (pattern copy of `slotMenu`: portal-free `.context-menu`
  div, own ref, Escape/outside-click/scroll close — do NOT extend `MenuState`):
  `{ taskId, date, startMinutes, durationMinutes, x, y, step: 'menu' | 'edit' }`.
  - Step `menu`: title = task title + date; items „Edytuj to wystąpienie”
    (→ step `edit`), „Edytuj wszystkie” (→ `openTask(taskId)`, close),
    „Pomiń ten dzień” (→ `SET_RECURRENCE_OVERRIDE` `{ skip: true }`, close).
    When the occurrence is overridden, add „Przywróć zgodnie z regułą”
    (→ `override: null`).
  - Step `edit`: time input (step 900) + duration select prefilled from the
    occurrence; „Zapisz” → `SET_RECURRENCE_OVERRIDE`
    `{ startMinutes, durationMinutes }`; „Anuluj” → close. Client-side guard
    mirrors reducer rules (end ≤ 24:00) with a Polish inline error.
- Right-clicking a REAL block or bare grid behaves exactly as before.

### 3. MonthView — marker only

MonthView renders no individual blocks (only totals/dots), so occurrences get
a presentational marker, not blocks or menus (parity with normal entries;
deliberate deviation from the prompt's letter, aligned with its invariant-7
spirit): in each cell with ≥1 occurrence render `⟳` (class
`month-cell-recur`, style/pattern of `month-cell-birthday`) with
`title`/`aria-label` „Cykliczne: <task titles>”. Compute per-day via
`recurrenceOccurrencesForDate(state, d, filter)`. Cell totals/intensity/dots
unchanged.

### 4. Wiki

Update `openwiki/n2hub/scheduling-and-calendar.md`: new bullet — recurrence is
presentational-only (blocks outside packing/collisions/totals, no drag, menu
actions map to the two reducer actions, MonthView marker), pointer paths
untouched.

## Out of scope

- Any change to the model/reducer/storage/cloud (core package owns them).
- Drag/resize of occurrence blocks; any pointer-lifecycle change.
- Materializing occurrences („zamień na blok”), bin interactions.
- Filters/pages beyond WeekView/MonthView/TaskModal; new npm deps.

## Acceptance

- [ ] TaskModal shows „Cykliczność” per the visibility rules; apply/clear
      dispatch the actions; overrides listed with restore buttons; section
      never triggers task auto-save.
- [ ] WeekView renders occurrence blocks visually distinct (dashed/striped,
      ⟳), positioned by time, below real blocks, with no pointer handlers
      besides click/context/keyboard-open.
- [ ] Context menu offers „Edytuj to wystąpienie” (time shift), „Pomiń ten
      dzień”, „Edytuj wszystkie”, „Przywróć zgodnie z regułą” when overridden;
      slot menu never opens from an occurrence.
- [ ] MonthView shows the ⟳ marker + Polish tooltip; totals/dots unchanged.
- [ ] Diff of WeekView contains no edits inside TimedBlock/BinCard pointer
      handlers, drag lifecycle, packDayBlocks flow or existing menus (overlay
      + recurMenu + one openSlotMenu guard only).
- [ ] All user-facing strings Polish.

## Verification

- Worker: `npm test` (must stay green, incl. core-package suites) and
  `npm run build`.
- Browser: `node scripts/browser-check-bin-drag.mjs` — WeekView children
  changed; drag/bin lifecycle must be provably intact. (Placement/split checks
  stay with release verification.)
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- No drag for occurrences (explicitly allowed by the prompt) — occurrence
  edits go through the context menu / TaskModal only.
- MonthView gets a marker, not blocks/menu (it renders no blocks for normal
  entries either).
- „Edytuj wszystkie” opens TaskModal (rule lives in the „Cykliczność”
  section); no separate rule editor in the calendar.
- Occurrence visibility follows `entriesForDate` filter semantics via the
  selector: empty filter = all, otherwise any assignee in the filter.
- Recurrence UI dispatches are explicit (no auto-save coupling) to keep the
  delicate SAVE_TASK reconciliation path untouched.
