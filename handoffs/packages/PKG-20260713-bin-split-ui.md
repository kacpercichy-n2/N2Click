# Handoff: "Zaplanuj część" UI on bin cards + refusal-copy alignment

- **Package ID:** PKG-20260713-bin-split-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260713-bin-split-core
- **Blast radius:** high — edits `src/components/WeekView.tsx`, which contains
  the COMPLETE, hard-won bin-drag lifecycle. That lifecycle must be preserved
  byte-for-byte (see the untouchable list below). Everything you add is
  form/menu plumbing beside it.

## Goal

Give every bin card — especially oversized (>24h) ones — an accessible
"Zaplanuj część" control that opens a small form (day, start, hours) and
dispatches the new `SCHEDULE_BIN_PART` action, with live pre-validation that
mirrors the reducer guards exactly. Align the existing refusal/hint copy so it
points at this path instead of a split path that never existed for bin rows.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx` (main), `src/styles.css`
  (small additions only).
- Read first: `BinCard` (~492–806) and its drag lifecycle; `MenuState` (~64),
  `openMenu` / insert form / `confirmInsert` / `parsedHours` pattern
  (~828–964, 1140–1290) — your form MUST follow this exact
  snap-once-then-share-the-predicate pattern; the reducer guards in
  `scheduleBinPart` + `setBlockTime` (`src/store/AppStore.tsx`) — mirror, don't
  fork; selectors `binEntryForTaskPerson`, `blockCollides`,
  `hoursForPersonOnDate`, `personCapacity` (`src/store/selectors.ts`); helpers
  `nextFreeStart`, `snapHours`, `hoursToMinutes`, `formatDuration`,
  `formatMinutes`, `MINUTE_STEP`, `HOURS_STEP`, `toQuarters` (private to
  AppStore — reimplement the one-liner locally or inline
  `Math.round(h / HOURS_STEP)`), `isValidDateStr`, `todayStr`,
  `inclusiveDayCount`, `MAX_TASK_PERIOD_DAYS` (`src/utils/dates.ts`).
- Environment: dev server on :5173 may already be running; `npx tsc --noEmit`;
  `npm test`; production build via `node -e "import('vite').then(v => v.build())"`;
  `git` denied. Trust code over the partially stale CLAUDE.md.

### UNTOUCHABLE code (byte-for-byte)

Do not modify, reorder, reformat, or "improve" any of these — the bundle's
gate re-runs every bin-drag lifecycle scenario in Chromium and WebKit:

- `BinCard`'s drag machinery: `BinDragState`, `BinDragListeners`,
  `listenersRef` / `removeWindowListeners`, `projectPointer`, `cancelDrag`,
  `finishDrag`, `begin`, the window/document listener registration set, the
  unmount cleanup effect, the ghost portal, `dragRef` semantics.
- `TimedBlock`'s drag/resize code and the grid/bin hit-testing.
- The `unplaceable` computation (~533–538) — you change only the HINT STRINGS
  and titles around it, not the predicate.
- `user-select: none` on the week grid in styles.css.

Additions inside `BinCard`'s JSX are allowed only as new sibling elements
(the actions row below the existing content) plus new props; the existing
handlers and their wiring stay identical.

### Prior decisions (final — exact copy, do not reopen)

1. **Two entry points, one form.**
   (a) A compact button row on every EDITABLE bin card (also — especially — on
   `unplaceable` cards): `<div className="week-bin-block-actions">` containing
   `<button type="button" className="week-bin-schedule-btn">Zaplanuj część</button>`
   with `title`/`aria-label`
   `` `Zaplanuj część: ${task.title} — ${person.name}, ${formatDuration(entry.plannedHours)} w zasobniku` ``.
   The button must `e.stopPropagation()` in `onPointerDown`, `onClick`, and
   `onKeyDown` so it can never start a drag or trigger the card's
   click/Enter-to-open. It is keyboard-focusable (native button) — that is the
   accessibility path. Hide it (render nothing) when `!editable`, and when the
   row can't produce a valid part: `!Number.isFinite(entry.plannedHours)` or
   `Math.round(entry.plannedHours / HOURS_STEP) < 1`.
   (b) A context-menu item for bin entries, rendered ABOVE `Usuń blok` and
   followed by a separator: `Zaplanuj część…` (same render condition as the
   card button, otherwise fall through to `Usuń blok` only).
2. **Form hosting:** extend `MenuState.step` to `'menu' | 'form' | 'schedule'`.
   Opening from the card button: `setMenu({ entry, x, y, step: 'schedule',
   position: 'after' })` with `x`/`y` from the button's
   `getBoundingClientRect()` (`left`, `bottom + 4`), clamped with the same
   `Math.min(..., window.innerWidth - 280 / window.innerHeight - 240)` pattern
   as `openMenu`. Opening from the menu item: `setMenu({ ...menu, step:
   'schedule' })`. Escape / outside-click closing already generic — reuse.
3. **Form content** (new branch beside the insert form, class
   `context-insert-form` reused, plus `context-schedule-form` if you need a
   hook):
   - Title: `` `Zaplanuj część — ${task.title} (${person.name})` `` and a muted
     sub-line `` `W zasobniku: ${formatDuration(entry.plannedHours)}` ``.
   - `Dzień` — `<input type="date">`, default `todayStr()`.
   - `Start` — `<input type="time" step={900}>`, default derived by
     `nextFreeStart(blocksOfPersonOnSelectedDay, hoursToMinutes(schedHours))`,
     re-derived whenever the selected DATE changes (manual edits otherwise
     kept). Local helpers convert `"HH:MM"` ↔ minutes (pad with `padStart`).
   - `Godziny` — `<input type="number" min={0.25} step={0.25}>` with
     `max = Math.round(entry.plannedHours / HOURS_STEP) * HOURS_STEP`
     (mirror the reducer's `toQuarters` ROUNDING, not floor). Default value:
     `Math.max(0.25, Math.min(maxQ hours, personCapacity(state, person.id), 24))`.
4. **Snap once, share the predicate** (the `parsedHours` house pattern): parse
   the hours field once into `schedHours = snapHours(Math.min(24, raw))`; every
   warning, the disabled state, and the dispatch use that one value, so the
   form can never dispatch what the reducer refuses.
5. **Blocking pre-validations** (each shows its `context-warning` line AND
   disables `Zaplanuj`; order matches the reducer):
   - date invalid (`!isValidDateStr`): `⚠ Podaj prawidłową datę.`
   - hours NaN/≤0: disable silently (like the insert form).
   - hours > remaining (compare in rounded quarters):
     `` `⚠ W zasobniku pozostało tylko ${formatDuration(remaining)}.` ``
   - start not a multiple of 15: `⚠ Start musi być w krokach co 15 minut.`
   - start + duration > 24:00:
     `⚠ Blok nie mieści się w dobie — wybierz wcześniejszy start albo mniej godzin.`
   - `blockCollides(state, person.id, date, startMin, schedHours)`:
     `⚠ Koliduje z innym blokiem tej osoby w tym dniu.`
   - period pre-check — extend `[min(date, task.startDate), max(date,
     task.endDate)]`; if `inclusiveDayCount(...) > MAX_TASK_PERIOD_DAYS`:
     `⚠ Termin zadania przekroczyłby limit 92 dni.`
6. **Non-blocking overload warning** (invariant 3 — warns, never blocks),
   reusing the existing pattern with `hoursForPersonOnDate` + `personCapacity`:
   `` `⚠ ${person.name} będzie mieć ${formatDuration(projected)} — powyżej dostępności ${formatDuration(capacity)}/dzień.` ``
7. **Actions:** primary `Zaplanuj` (disabled per 5), ghost `Anuluj`
   (`setMenu(null)`). Confirm dispatches
   `{ type: 'SCHEDULE_BIN_PART', entryId: menu.entry.id, date, startMinutes, hours: schedHours }`
   then `setMenu(null)`. Enter in the hours field confirms via the same
   guarded function (never a separate path).
8. **Copy alignment** (the calendar's refusal messaging must point at the path
   that now exists):
   - `unplaceableHint` >24h branch →
     `Blok jest dłuższy niż doba — użyj „Zaplanuj część”, aby zaplanować fragment.`
   - `unplaceableHint` off-grid branch, when the schedule button is available →
     `Nieprawidłowy czas trwania — użyj „Zaplanuj część”, aby zaplanować poprawny fragment.`;
     when it is NOT available (non-finite / < 0.25h rows) →
     `Nieprawidłowy czas trwania — usuń blok albo popraw godziny w edytorze zadania.`
   - Normal editable card title →
     `` `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu. Przeciągnij na siatkę albo użyj „Zaplanuj część”.` ``
   - Read-only title unchanged.
9. **Styles** (`src/styles.css`, bin section ~1656): `.week-bin-block-actions`
   (small top-margin row) and `.week-bin-schedule-btn` (compact ghost-style
   button reusing existing `--n2-*` tokens; visible focus outline). No new
   animation; respect existing `prefers-reduced-motion` handling.

## Scope

### In scope

- `src/components/WeekView.tsx`: `BinCard` actions row + new props
  (`onSchedule` callback), `MenuState.step` extension, menu item, schedule-form
  branch with the validations above, copy changes from decision 8.
- `src/styles.css`: the two classes from decision 9.

### Out of scope

- ANY change to drag lifecycle code (see untouchable list) or the
  `unplaceable` predicate.
- Reducer/selectors/types/storage (core package owns the action; it is already
  merged when you start — verify `SCHEDULE_BIN_PART` exists in the `Action`
  union before writing UI).
- `MyWorkPage` (its Zasobnik rows link to the calendar — unchanged),
  `TaskModal`, dated-block split UI (`Podziel na pół/ćwiartki` stay dated-only),
  onboarding (`src/onboarding/`, `data-tour` attributes), month view.
- New tests (test-writer packages own them).

## Implementation notes

- All new UI strings are Polish (whole app is Polish).
- The schedule form must work for a bin row of exactly 0.25h and for 30h+.
- When the menu's entry was deleted/zeroed by a concurrent action, the
  dispatch no-ops in the reducer — no UI crash path needed beyond the existing
  menu-close behavior.
- Manual smoke check in the running dev server: seed sample data (Ola has a 3h
  bin row), schedule 1h via the button, verify the card shows 2h and the block
  renders; verify a colliding time disables the button with the warning; check
  the console stays clean.

## Acceptance criteria

- [ ] Every editable bin card with ≥0.25h (rounded) shows the `Zaplanuj część`
      button with the exact aria-label; unplaceable >24h cards included;
      non-finite/<0.25h rows show no button and get the delete-oriented hint.
- [ ] Button and menu item open the same form; Tab+Enter alone (no pointer)
      can open the form, fill it, and schedule a part.
- [ ] Starting a drag on the card is unaffected by the button (pointer-down on
      the button never begins a drag; pointer-down elsewhere on the card still
      does).
- [ ] Form defaults: today / nextFreeStart-derived start / min(remaining,
      capacity, 24) hours; start re-derives on date change.
- [ ] Each blocking validation shows its exact Polish warning and disables
      `Zaplanuj`; overload warns without disabling; a valid confirm dispatches
      `SCHEDULE_BIN_PART` and the card's hours drop by the scheduled amount.
- [ ] All three title/hint strings from decision 8 verbatim.
- [ ] No modification whatsoever inside the untouchable code regions (verify
      with `git diff` hunks before finishing).
- [ ] Console free of errors/warnings during the smoke flow.

## Tests

- Command: `npx tsc --noEmit && npm test`, then
  `node -e "import('vite').then(v => v.build())"`.
- Expected: 0 tsc errors; the full existing suite green and unchanged in
  count; build green. Browser verification is owned by
  PKG-20260713-bin-split-browser-docs, but run the manual smoke check above
  yourself before reporting done.

## Report back

Synthesized summary only: files changed one-line each, confirmation the
untouchable regions have zero diff hunks, smoke-check observations,
test/tsc/build results, deviations (should be none).
