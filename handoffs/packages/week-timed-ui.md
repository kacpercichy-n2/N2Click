# Handoff: Week view — Google-Calendar-style timed grid with drag & resize

- **Package ID:** PKG-20260708-week-timed-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-timed-blocks-core (requires `startMinutes`, `SET_BLOCK_TIME`, `utils/time.ts` incl. `packDayBlocks`, `blockCollides`)
- **Blast radius:** medium — rewrites `src/components/WeekView.tsx` rendering + interactions and appends CSS. Store/data untouched (only dispatches the actions from the core package). Month view, Workload, Timeline untouched.

## Goal
Replace the Week view's stacked block list with a timed day grid: a left hour axis, blocks absolutely positioned by `startMinutes` with height ∝ `plannedHours`, pointer-drag to move a block within a day or to another day, top/bottom edge-drag to resize in 15-min steps, live collision feedback (danger tint) with invalid drops reverting, and the existing right-click "Dodaj przed / Dodaj po" context menu preserved.

## Context the worker needs
- Relevant files: `src/components/WeekView.tsx` (rewrite the grid, keep the context-menu code paths), `src/styles.css` (existing `.week-grid`/`.week-col*`/`.week-block*` section around lines 1046–1160 and the `@media` override near 2321 — replace/extend; `.context-menu` styles stay), `src/pages/CalendarPage.tsx` (should need no changes — confirm), `src/utils/time.ts` (constants, `formatMinutes`, `snapToStep`, `blockEndMinutes`, `hasCollision`, `packDayBlocks`), `src/store/selectors.ts` (`blocksForPersonDate`, `blockCollides`, `entriesForDate`, `dayTotal`, `overloadedPeopleOnDate`, `personCapacity`, `getTask/getPerson/getProject`), `src/store/AppStore.tsx` (`SET_BLOCK_TIME`, `INSERT_BLOCK` — dispatch only, do not modify), `src/pages/TimelinePage.tsx` (the `Bar` component, lines ~57–153 — the pointer-capture drag pattern to follow), `src/utils/colors.ts` (`personColor`), `src/components/Coin.tsx`.
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md` (partially stale — restyle to the dark `--n2-*` theme is DONE; use existing `--n2-*` tokens, `--n2-danger` for collision/overload tints; UI text Polish; no drag libraries — pointer events like TimelinePage; icons only via `src/components/icons.ts`).
- Prior decisions (architect — do NOT revisit):
  1. **Geometry:** `HOUR_PX = 48` (12px per 15 min). Full 00:00–24:00 grid, day body height `24 * 48 = 1152px`, inside a scrollable wrapper (`max-height: ~70vh; overflow-y: auto`) that auto-scrolls to 07:00 on mount (plain `ref.scrollTop`, once). Sticky day headers (keep totals + ⚠ overload names exactly as today). Left time axis column (~52px): labels `0:00`…`23:00` at each hour line, `Fragment Mono`-style small text (match existing muted label styling); hour lines across all columns, lighter quarter-hour lines optional (hour + half-hour lines are enough).
  2. **Positioning:** `top = startMinutes/60 * HOUR_PX`, `height = plannedHours * HOUR_PX` (min-height ~14px so 0.25h blocks stay clickable). Overlapping blocks in one day (different people normally, same person via editor edits) are laid out side-by-side using `packDayBlocks` — `left = col/cols * 100%`, `width = 100%/cols` (small gap). All filtered people share one day column (as today); person identity stays visible via the existing left border + person dot in `personColor(person.id)`.
  3. **Block content:** keep coin + task title + person dot/name, add the time range `8:00–12:00` (via `formatMinutes`) next to the hours. Click (without drag) opens the task (`useOpenTask`), as today.
  4. **Drag = pointer events, TimelinePage `Bar` pattern:** `setPointerCapture` on pointerdown; track a `drag` state `{ mode: 'move' | 'top' | 'bottom'; entryId; originX; originY; startMinutes; plannedHours; date; dayIndex }`. `move`: vertical delta snaps with `snapToStep` (15-min); horizontal delta maps to day columns (compute target day index from pointer X against the grid container's bounding rect — subtract the axis width; clamp 0–6). `top`: changes start AND hours (end fixed); `bottom`: changes hours only. Resize is same-day only (no horizontal component). Min duration 0.25h, max end 24:00, min start 0:00 — clamp during drag.
  5. **Preview + collision feedback:** while dragging, render the dragged block at its projected position (its normal element repositioned — no separate ghost needed) with a `.dragging` class; compute `blockCollides(state, personId, targetDate, projStart, projHours, entry.id)` every move and add a `.colliding` class (danger border/tint via `--n2-danger`, `cursor: not-allowed`). Optional but desired: a small floating time label showing the projected `HH:mm–HH:mm`.
  6. **Drop rules:** on pointerup with no effective change → treat as click if not moved (TimelinePage `moved` ref pattern). If colliding → do NOT dispatch (block snaps back — React re-render restores it; no alert needed, the tint already explained it). Otherwise dispatch ONE `SET_BLOCK_TIME { entryId, date: targetDate, startMinutes: projStart, plannedHours: projHours }`. The reducer re-validates and may still reject (e.g. 92-day task-period cap) — the UI must tolerate a no-op dispatch (it already will, state simply doesn't change).
  7. **Capacity overload never blocks** (invariant): resizing may push a person over capacity — keep the existing header ⚠ warning behavior (it updates automatically from selectors) and do NOT prevent the drop. Only same-person time overlap prevents.
  8. **Context menu preserved:** right-click still opens "Dodaj przed / Dodaj po" with the hours form (`step={0.25}`/`min={0.25}` after the core package) and the live overload warning; it dispatches `INSERT_BLOCK` which now ripple-inserts in time (core package). No UI changes needed beyond making sure right-click doesn't start a drag (`e.button === 2` guard / only start drag on primary button) and the menu positioning still works inside the scroll container (menu is `position: fixed` from viewport coords — keep that).
  9. **Weekend/today/empty styling** carries over: weekend column tint, today column highlight, `—` empty placeholder is DROPPED (an empty timed column is self-explanatory; keep the header total `—`).
  10. **Motion:** keep `AnimatePresence` for the context menu as-is. Do not animate block drops (snapping is the feedback). Respect the existing global `prefers-reduced-motion` rules.

## Scope
### In scope
- Rewrite the grid rendering + drag/resize interactions in `src/components/WeekView.tsx` per the decisions above.
- Replace/extend the `.week-*` CSS section in `src/styles.css` (grid template: `52px repeat(7, 1fr)`; scroll wrapper; hour lines via repeating-linear-gradient or bordered hour cells; block absolute positioning; `.dragging`, `.colliding`, resize handle affordances `cursor: ns-resize` top/bottom strips ~6px; `touch-action: none` on blocks so pointer drag works). Update the 760px media query so the week grid stays usable (horizontal scroll of the 7 columns is acceptable; axis column stays sticky-left if cheap, otherwise scrolls with it).
- Keep `Props { state, anchor, filter }` and the `CalendarPage` integration unchanged.
### Out of scope
- No MonthView, WorkloadPage, TimelinePage, Dashboard changes.
- No store/reducer/selector/storage changes (they landed in the core package) — if something is missing there, STOP and report instead of adding store code here.
- No new dependencies, no drag library.
- No keyboard-drag a11y (blocks remain buttons: click opens task; note it as a known gap in the report).

## Implementation notes
- Compute per-day render lists once per render: for each day, gather filtered entries (`entriesForDate` + filter), then `packDayBlocks` on ALL of them together (people share the column, so cross-person overlaps are the packing case).
- During drag, apply the projection ONLY to the dragged entry's rendered geometry (cheap: keep drag state local like TimelinePage's `Bar`; don't re-pack the whole day mid-drag — the dragged block may simply overlay others while dragging).
- Day-column X mapping: store the grid body's `getBoundingClientRect()` at drag start; column width = (rect.width − axisWidth)/7. Cross-day move keeps the SAME startMinutes delta logic — vertical position controls time, horizontal controls date.
- Reducer is the source of truth: never mutate locally on drop; just dispatch and let state flow back.
- Escape during drag: cancel (clear drag state, no dispatch) — cheap and prevents stuck captures; also handle `onPointerCancel`.

## Acceptance criteria
- [ ] `npx tsc --noEmit` and `npm run build` pass; console clean on the calendar page.
- [ ] Hour axis 0:00–24:00 with lines aligned to blocks; view opens scrolled to ~7:00; seeded week shows blocks at their stacked times (Marek Wed 8:00–14:00 + 14:00–18:00).
- [ ] A 4h block at 10:00 can be: bottom-resized to 10:00–15:00 (5h, becomes 5 rows of 48px); moved to 8:00 when free; moved to another day when free — each persists (reload) and adds an activity row on the task.
- [ ] Dragging over a same-person occupied range shows the danger tint and dropping there reverts (state unchanged); dropping onto a range occupied only by ANOTHER person succeeds and renders side-by-side.
- [ ] Top-edge drag moves the start and keeps the end fixed; 15-min snapping everywhere; duration can't go below 0.25h; block can't leave 0:00–24:00.
- [ ] Click without drag still opens the task modal; right-click → Dodaj przed/po still works (inserted block appears at ref start/end, later blocks ripple), overload warning in the form still shows.
- [ ] Overload header ⚠ still appears when resizing pushes someone over capacity — and the drop is NOT blocked.
- [ ] Person filter, weekend/today styling, day totals still correct; month view untouched.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual browser walkthrough of the criteria above (note in the report which items you could not verify without a browser).

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
