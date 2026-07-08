# Handoff: Week view layout — axis outside horizontal scroll, bin beside the grid

- **Package ID:** PKG-20260708-week-layout-fix
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none (first package of the walkthrough-fix run; the
  duration-format package runs AFTER this one — both edit WeekView.tsx/styles.css)
- **Blast radius:** medium — WeekView structure + drag geometry rework; store,
  reducer and all other views untouched.

## Goal

Fix the two walkthrough layout defects: (1) the sticky-left hour axis is
translucent and slides OVER day columns/headers during horizontal scroll,
making both unreadable; (2) the Zasobnik is the 8th in-grid column and only
appears after scrolling past Sunday. Target layout (human-mandated):
**[fixed hour axis] [horizontally scrollable 7-day grid, Mon–Fri primary,
weekend behind scroll] [Zasobnik panel always visible at the right edge,
outside the scroller]** — no translucent overlap in any scroll position, both
drag directions still working across the new container boundaries.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx` (current: single
  `.week-cal-scroll` container, `.week-cal-grid` with
  `52px repeat(8, 1fr)` columns, sticky-left `.week-axis`/`.week-axis-head`,
  `GRID_COLS=8`, `BIN_COL_INDEX=7`, `bodyRef` on the first day column, BinCard
  hit-testing against `gridRef.parentElement`), `src/styles.css` (week-cal
  section ~lines 1166–1498; ≤760px media block ~line 2684).
- Read-only reference: `src/store/AppStore.tsx` (`SET_BLOCK_TIME`,
  `MOVE_BLOCK_TO_BIN` — unchanged), `src/store/selectors.ts` (`blockCollides`,
  bin selectors — unchanged).
- Docs: `CLAUDE.md`, `handoffs/RUN-STATE.md` (previous run's verdict — the
  blocker-3 hit-test fix you will be REPLACING with simpler geometry).
- Prior decisions (architect — binding):
  1. **DOM structure** (three independent panes + a header row; NO sticky
     positioning anywhere in the week view afterwards):
     ```
     .week-cal
     ├── .week-head-row            (flex row, not scrollable)
     │   ├── .week-corner          (52px spacer)
     │   ├── .week-head-track      (flex:1; overflow:hidden)
     │   │   └── .week-head-inner  (width calc(100%/5*7); 7 day headers)
     │   └── .week-bin-head        (width 200px — existing markup reused)
     └── .week-main                (flex row; height min(70vh, content))
         ├── .week-axis-pane       (52px; overflow:hidden; 1152px axis inside)
         ├── .week-days-viewport   (flex:1; overflow:auto BOTH axes;
         │   └── .week-days-grid    display:grid; repeat(7, 1fr);
         │                          width max(calc(100%/5*7), 672px);
         │                          height 1152px; the 7 .week-day-col)
         └── .week-bin-pane        (width 200px; overflow-y:auto; the
                                    existing .week-bin-col content)
     ```
     Both scrollbars live on `.week-days-viewport` (visible: vertical between
     days and bin, horizontal under the days). `width: calc(100%/5*7)` makes
     Mon–Fri fill the viewport exactly; Sat/Sun sit behind horizontal scroll.
  2. **Scroll sync** — one `onScroll` handler on the viewport:
     `axisPane.scrollTop = viewport.scrollTop` and
     `headTrack.scrollLeft = viewport.scrollLeft` (refs; direct property
     assignment, no state, no rAF needed). The head track and axis pane are
     `overflow: hidden` so the user can't scroll them independently. Add
     `scrollbar-gutter: stable` to BOTH `.week-days-viewport` and
     `.week-head-track` so classic (non-overlay) scrollbars can't misalign
     headers vs columns.
  3. **Geometry/refs rework:**
     - `gridRef` now points at `.week-days-grid` (7 columns, no axis inside):
       TimedBlock `colWidth = gridRect.width / 7`; day projection clamps 0..6.
       Delete `GRID_COLS`/`BIN_COL_INDEX`/the `/8` math and the `AXIS_W`
       offsets from drag code.
     - Grid→bin targeting: new `binRef` on `.week-bin-pane`; during a
       TimedBlock move-drag, `overBin = e.clientX >= binRect.left && e.clientX
       <= binRect.right && e.clientY within binRect` → new boolean in
       DragState (replaces `projDayIndex === 7`); keeps the `to-bin` lavender
       tint; drop dispatches `MOVE_BLOCK_TO_BIN`. Day translateX still clamps
       to columns 0..6.
     - BinCard drop targeting gets SIMPLER than the blocker-3 fix: target
       column/time from `.week-days-grid` rect (`col = floor((x-rect.left)/colW)`,
       y-origin = `gridRect.top` — the grid starts at 0:00, no header inside);
       valid iff the pointer is ALSO inside the viewport's client rect
       (`viewportRef.getBoundingClientRect()`) — that single clamp replaces
       the old sticky-header/axis exclusion math. Delete `bodyRef`.
     - Auto-scroll to ~7:00 on mount: `viewport.scrollTop = (7*60/60)*HOUR_PX`
       (repoint the existing effect's ref).
  4. **No drag auto-scroll at the horizontal edges** — to drop on Sat/Sun the
     user scrolls first (accepted gap, same as the approved run; note it in
     your report, don't build it).
  5. **CSS:** delete the sticky rules (`.week-axis` sticky-left,
     `.week-axis-head` sticky corner, `.week-day-head`/`.week-bin-head` sticky
     top, `.week-cal-grid` width calc `(100%-52px)/5*8+52px`). All pane
     backgrounds OPAQUE (`var(--card-bg)` / `var(--card-bg-2)` as today — no
     translucent surfaces over content). Keep: day-column hour/half-hour
     gradient lines, weekend/today tints on headers AND columns, overload ⚠
     names in headers, `user-select: none` (apply to `.week-axis-pane`,
     `.week-days-grid`, `.week-bin-pane` — NOT to `.week-cal` root, the
     context menu with its select/input lives inside it). Bin pane keeps
     `border-left: 1px solid var(--n2-border-strong)` + `var(--card-bg-2)`.
  6. **≤760px media block:** replace `.week-cal-grid { min-width: 820px }`
     with the grid's `min-width` floor already in the width rule
     (`max(calc(100%/5*7), 672px)` ≈ 96px/day) and narrow `.week-bin-head` /
     `.week-bin-pane` to 160px. `.week-cal-scroll` rules go away with the class.
  7. Everything else is untouched: context menu (split/delete/insert), all
     dispatch payloads, block/bin-card inner markup, Polish strings, MonthView,
     CalendarPage props (`{state, anchor, filter}`).

## Scope

### In scope

- `src/components/WeekView.tsx` — container restructure, refs, scroll-sync
  handler, TimedBlock/BinCard geometry per decisions 1–4.
- `src/styles.css` — week-cal section rewrite per decisions 5–6 (stay inside
  the week-cal/bin section + the ≤760px `.week-cal*` lines).

### Out of scope

- Store/selectors/utils/types/seed, TaskModal, MonthView, CalendarPage,
  sidebar/app-shell CSS, all `*.test.ts`, `package.json`.
- Duration text formatting (`2.75h` etc.) — the NEXT package; keep the current
  `fmt(...)h` strings byte-identical so its diff stays clean.
- Drag edge auto-scroll, bin reordering, keyboard-drag a11y.

## Implementation notes

- Pane heights: `.week-main` gets `max-height: 70vh`; axis pane and bin pane
  stretch to the same flex row height. The axis pane bottom may show a few
  extra pixels vs the viewport (horizontal scrollbar height) — accepted;
  scrollTop sync keeps labels aligned with the grid lines.
- The header track's inner row must use the same box model as the grid
  (borders on the same side — currently `border-left` per column) so header
  and column edges align at every scrollLeft.
- Escape-cancel, pointer capture, `moved` click guard, collision tint logic
  all stay as-is — only the rect sources change.
- Blocker-3 regression from the previous verdict must stay fixed under the new
  geometry: a drop with the pointer over the header row, over the axis pane,
  or outside the viewport must revert (the decision-3 viewport clamp covers
  all three — verify each).

## Acceptance criteria

- [ ] At every horizontal scroll position, hour labels never overlap day
      headers/blocks; the axis is fully opaque and outside the scrolling area.
- [ ] Zasobnik panel (with the seeded Ola 3h card) is visible at the right
      edge WITHOUT any scrolling, at 1920px and at ~1000px viewport widths.
- [ ] Mon–Fri exactly fill the days viewport at scrollLeft 0; Sat+Sun appear
      on horizontal scroll; day headers stay perfectly column-aligned while
      scrolling (including with `Always show scroll bars` forced on macOS).
- [ ] Vertical scroll moves axis and grid together (no drift after fast
      scrolling); opens auto-scrolled to ~7:00; day headers remain visible at
      every vertical position.
- [ ] Bin→grid drag: drop on a free slot schedules the block at the projected
      day/time; drop over a same-person block shows danger and reverts; drop
      over the header row, the axis pane, the bin itself, or outside the
      viewport reverts.
- [ ] Grid→bin drag: `to-bin` tint over the bin panel, drop moves the block to
      the bin; drag Mon→Tue ±1h still snaps to 15-min and persists; top/bottom
      resize still works; two consecutive drags on one block both register.
- [ ] Context menu (Dodaj przed/po, split, Usuń blok) works unchanged on both
      dated blocks and bin cards.
- [ ] ≤760px: days grid keeps ≥ ~96px columns behind horizontal scroll, bin
      pane 160px, nothing overlaps; month view untouched; console clean.
- [ ] No sticky positioning remains in the week-view CSS; no store/test files
      touched.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: tsc clean; 64/64 tests stay green (none cover WeekView markup);
  build succeeds. Interactive criteria verified via `npm run dev`
  (`n2hub-dev`); list anything unverifiable in your report.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md` (run section
"Walkthrough fixes"). No raw logs.
