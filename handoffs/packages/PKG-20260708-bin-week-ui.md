# Handoff: Bin column in the week view + split context menu + editor entry point

- **Package ID:** PKG-20260708-bin-week-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-bin-core
- **Blast radius:** low–medium — WeekView layout rework + one new TaskModal section; store untouched.

## Goal

Render the per-person "Zasobnik" (bin of dateless blocks) as an 8th column in
the calendar week grid, behind horizontal scroll together with the weekend
columns (Mon–Fri fill the visible width). Bin blocks drag onto the grid to get
a date+time; grid blocks drag into the bin to lose theirs. Extend the block
context menu with split options and (bin blocks only) delete. Add a small
"add to bin" section to the task editor.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx`, `src/components/TaskModal.tsx`,
  `src/styles.css` (week-cal section ~lines 1046–1246; 760px media query
  ~line 2409), `src/store/AppStore.tsx` (actions from bin-core — read only),
  `src/store/selectors.ts` (`binEntriesForPerson`, `binEntriesForTask`,
  `binTotalForPerson`, `blockCollides`), `src/utils/time.ts` (`BIN_DATE`,
  `isBinEntry`).
- Docs: `CLAUDE.md` (week-view description, invariants 3/4/7), `handoffs/RUN-STATE.md`.
- Prior decisions (architect — binding):
  1. **Layout.** The grid becomes 9 template columns: 52px axis + 7 day columns
     + 1 bin column, all equal width. `.week-cal-scroll` gets `overflow-x: auto`;
     `.week-cal-grid` gets `width: calc((100% - 52px) / 5 * 8 + 52px)` so
     exactly Mon–Fri fill the scroll container's visible width and Sat/Sun/bin
     sit to the right behind horizontal scroll. Initial `scrollLeft` stays 0
     (Mon–Fri visible). Grid template columns become
     `52px repeat(8, minmax(0, 1fr))` (update the inline style in WeekView).
  2. **Sticky axis.** The hour-axis column (`.week-axis`) and the corner
     (`.week-axis-head`) become `position: sticky; left: 0` with a background
     and a z-index above day columns (corner keeps top+left sticky, highest z).
  3. **Bin column content.** Header cell (sticky top, like day headers): title
     `Zasobnik`, subtitle `bez terminu`, total hours of the FILTERED people's
     bin blocks. Body: same grid row as day columns, stacked (NOT
     time-positioned) content from the top: one group per person (person dot +
     name + total), each group listing its bin blocks in `sortIndex` order as
     cards (coin + task title + `{h}h`). Person filter applies. Empty state
     text: `Brak bloków bez terminu`. The bin is week-independent — identical
     content whichever week is shown.
  4. **Drag bin → grid.** A bin card is pointer-draggable (mirror the
     `TimedBlock` pattern: primary button only, `setPointerCapture`, Escape /
     `onPointerCancel` cancel, `moved` ref so a plain click is not a drop).
     While dragging, project the target from the pointer position against the
     grid rect: column index from x (only day columns 0–6 are valid targets),
     start time from y via the existing 15-min snap math, clamped with
     `clampBlockStart`. Show the card following the pointer (transform) with a
     live `blockCollides` danger tint. Valid drop → dispatch
     `SET_BLOCK_TIME { entryId, date: days[i], startMinutes, plannedHours: entry.plannedHours }`;
     invalid target or collision → revert (no dispatch). Clicking a bin card
     opens its task (`useOpenTask`), same as grid blocks.
  5. **Drag grid → bin.** In `TimedBlock`, extend the horizontal day projection
     from clamp 0..6 to 0..7 where index 7 = the bin column; `colWidth` math
     changes from `/7` to `/8`. While hovering index 7, add a distinct `to-bin`
     class (info/lavender tint, NOT danger; skip the collision check). Drop on
     index 7 → dispatch `MOVE_BLOCK_TO_BIN { entryId }` instead of
     SET_BLOCK_TIME. Vertical resize handles unchanged.
  6. **Context menu.** Right-click on a DATED grid block shows, in order:
     `↑ Dodaj przed`, `↓ Dodaj po` (existing, unchanged), separator, `Podziel
     na pół` (disabled when `plannedHours < 0.5`), `Podziel na ćwiartki`
     (disabled when `plannedHours < 1`). Disabled items get
     `title="Blok jest za krótki, aby go podzielić"`. Right-click on a BIN card
     shows: `Podziel na pół`, `Podziel na ćwiartki` (same disable rules), and
     `Usuń blok` (danger style) behind
     `window.confirm(`Usunąć blok ${h}h z zasobnika?`)`. Split items dispatch
     `SPLIT_BLOCK { entryId, parts: 2 | 4 }`; delete dispatches
     `DELETE_BLOCK { entryId }`. Reuse the existing `context-menu` component
     state/markup — one menu, mode by `isBinEntry(entry)`.
  7. **TaskModal.** New editor section between "Przypisane osoby" and "Dzienny
     przydział godzin", heading `Zasobnik (bez terminu)`:
     - Lists the task's EXISTING bin blocks (via `binEntriesForTask`) grouped
       per person as read-only chips (`{h}h`), with the hint
       `Bloki bez terminu przeciągniesz na siatkę w widoku tygodnia kalendarza.`
     - Add-row (only when ≥1 assignee): select over `assignedPeople` + number
       input (`min={0.25} step={0.25} max={24}`) + button `Dodaj do zasobnika`
       that appends to local state `pendingUnassigned: Array<{personId, hours}>`,
       rendered as removable chips (remove button aria-label `Usuń`).
     - `handleSave` passes `newUnassigned: pendingUnassigned` in the SAVE_TASK
       payload (filter hours > 0; people no longer assigned are dropped by the
       reducer anyway).
     - `serializeDraft` includes `pendingUnassigned` (dirty tracking works).
     - The estimate-compare line becomes: `zaplanowano {dated}h` plus, when
       `binTotal > 0`, ` (+ {binTotal}h w zasobniku)` — where `binTotal` =
       existing bin entries of this task for still-assigned people + pending
       additions.
     - No editing/deleting of existing bin blocks in the editor (calendar owns
       that).
  8. **CSS.** New classes in the week-cal section of `src/styles.css` using
     `--n2-*` tokens (suggested: `.week-bin-head`, `.week-bin-col`,
     `.week-bin-group`, `.week-bin-block`, `.week-block.to-bin`). Keep
     `user-select: none` on the grid. 760px media query: replace
     `min-width: 720px` with `min-width: 820px` (52 + 8×96) so all 8 columns
     stay usable. Respect `prefers-reduced-motion` (no new animations needed).
  9. All UI strings Polish (verbatim above).

## Scope

### In scope

- `src/components/WeekView.tsx` — layout (8 columns + width calc), sticky axis
  markup if needed, bin column + `BinBlock` (or similar) component, both drag
  directions, context-menu extension.
- `src/components/TaskModal.tsx` — the bin section + payload + dirty tracking.
- `src/styles.css` — week-cal section additions/edits + the 760px media tweak.

### Out of scope

- Any store/selector/util change (bin-core owns those; if something is missing
  there, STOP and report — don't patch the store from this package).
- Bin reordering, bin-block resize, keyboard drag a11y (accepted gap),
  MonthView, WorkloadPage, sidebar (separate package), `package.json`, tests.
- Do not touch the sidebar/app-shell CSS section (a parallel package edits it —
  keep your diff inside the week-cal / task-modal CSS areas).

## Implementation notes

- `colWidth` in TimedBlock's `begin()` is `(rect.width - AXIS_W) / 7` today —
  change to `/ 8`. `getBoundingClientRect().width` of the grid returns the full
  (overflowing) layout width, so the math still holds under horizontal scroll.
- For bin-card drag targeting, compute against `gridRef` rect: day column i
  occupies `[AXIS_W + i*colW, AXIS_W + (i+1)*colW)`; the body's y-origin is the
  header height (measure the first day column's `getBoundingClientRect()` or
  track a body ref) — same approach TimedBlock uses for vertical deltas,
  except absolute y → minutes.
- The reducer is the source of truth: an invalid dispatch is a silent no-op, so
  always pre-check with `blockCollides` for live feedback, and revert visuals on
  a rejected drop (existing TimedBlock pattern).
- Context menu currently assumes a dated entry (`menu.entry.date` used for the
  overload preview). Guard the "Dodaj przed/po" branch + overload preview to
  dated entries only.

## Acceptance criteria

- [ ] Week view opens showing Mon–Fri filling the width; horizontal scroll
      reveals Sat, Sun, then the Zasobnik column; vertical auto-scroll to ~7:00
      still works; hour axis stays visible while scrolling horizontally.
- [ ] Seeded 3h bin block (Ola / task 1) renders in the bin under Ola's group
      with the column total; person filter hides/shows bin groups.
- [ ] Dragging the bin block onto Wednesday 9:00 dispatches SET_BLOCK_TIME:
      block appears at 9:00–12:00, bin empties, day total updates, persists on
      reload; dropping onto the same person's existing block shows danger tint
      and reverts.
- [ ] Dragging a grid block right into the bin column shows the `to-bin` tint
      and, on drop, moves it to the bin (day total drops, bin shows it).
- [ ] Right-click a 6h grid block → `Podziel na pół` → 3h stays in place, 3h
      appears in the bin; `Podziel na ćwiartki` on a 1h block → 0.25h stays +
      3×0.25h in bin; both items disabled with the Polish title on a 0.25h
      block; `Dodaj przed/po` still fully functional on dated blocks.
- [ ] Right-click a bin card → `Usuń blok` asks for confirmation and deletes;
      bin cards have no `Dodaj przed/po`.
- [ ] Bottom-resize an 8h block to 6h → a 2h block appears in the bin (store
      behavior; verify the bin re-renders).
- [ ] TaskModal: add 10h to the bin for an assignee → chip appears, form is
      dirty; save → SAVE_TASK payload carries `newUnassigned`; reopening shows
      the block under existing bin chips; estimate line shows
      `(+ 10h w zasobniku)`.
- [ ] ≤760px: grid horizontal-scrolls with all 8 columns ≥ ~96px; nothing
      overlaps; no console errors/warnings.
- [ ] All new strings Polish; two consecutive drags on one block still register
      (`user-select: none` intact).

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green, no new warnings; no test files changed. Interactive
  criteria verified by your own dev-server walkthrough (`npm run dev`,
  launch config `n2hub-dev`); list anything you could not verify in the report.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md`. No raw logs.
