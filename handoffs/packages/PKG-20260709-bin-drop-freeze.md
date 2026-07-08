# Handoff: Root-cause and fix the bin→calendar drag freeze

- **Package ID:** PKG-20260709-bin-drop-freeze
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low — calendar week view + possibly one reducer path; no data-model change

## Goal

Dragging a card out of the Zasobnik (bin) pane onto the week grid freezes the
site (user-reported, highest priority). Reproduce it, identify the actual root
cause, fix it minimally, and make the bin→grid drop reliable again.

## Context the worker needs

- Relevant files:
  - `src/components/WeekView.tsx` — `BinCard` (~L445–618): `begin` / `onPointerMove` / `finish`, portal drag ghost (L598–615). `TimedBlock` (~L113–413) is the working reference drag.
  - `src/store/AppStore.tsx` — `setBlockTime` (L771–964); the adjacency-merge `for (;;)` loop (L913–934); `reindexDays` (L214–234).
  - `src/store/selectors.ts` — `blockCollides` (L227), `growAllowanceHours`, `taskGrowAllowance`.
  - `src/utils/time.ts` — all pure time math (loop-free except bounded `packDayBlocks` / `stackStartTimes`).
  - `src/store/blockActions.test.ts` — regression-test home (baseline 186 tests green).
  - `src/main.tsx` — **StrictMode is ON** and `MotionConfig` wraps the app; `motion` (framer-motion) is v12 with React 18.3.
  - `handoffs/RUN-STATE.md` — previous run's reviewer verdict documents a known dev-only `PopChild` ref warning from motion v12 + React 18.3 (context-menu `<motion.div ref={menuRef}>` in WeekView L951).
- Conventions: CLAUDE.md (dates as 'yyyy-MM-dd', reducer-only mutations, selector-only reads, Polish UI, plain CSS, no new dependencies). Dev server is already running on port 5173 (`n2hub-dev`) — do NOT start a second one.

## Architect's diagnosis (read before touching anything)

A full static pass of the drop path found **no unconditional infinite loop** —
so do not assume the merge loop and burn time there without evidence:

- The `for (;;)` merge loop in `setBlockTime` removes exactly one entry per
  iteration (`workloadArr.filter(w => w.id !== b.id)`) and exits when no
  adjacency remains → strictly bounded, even with duplicate ids (filter would
  remove all copies). All other reducer loops are index-bounded; `reindexDays`
  is linear; every mounted `useEffect` in App/CalendarPage/WeekView/TaskModal/
  GlobalSearch/AppStore has a deps array and none setState unconditionally; no
  `ResizeObserver`/`requestAnimationFrame`/`setInterval` anywhere in `src/`.
- The reducer rejects (returns the same state ref) on: NaN/off-grid
  `startMinutes`, hours < 0.25 or **> 24**, off-quarter hours, day overflow,
  same-person collision, > 92-day period extension.

**The freeze is therefore state- or environment-dependent.** Reproduce FIRST,
then instrument. Ranked hypotheses:

1. **Render/update loop, not reducer loop.** Instrument: `console.count` in the
   reducer and in `AppStoreProvider` render + a guard counter that throws after
   1000 iterations inside the merge loop (to conclusively confirm/deny it in one
   repro). Use the React Profiler if counts explode.
2. **Data-dependent input from the user's real localStorage.** Export/inspect
   the `n2hub.data.v1` payload before changing anything: look for duplicate
   entry ids, NaN/off-grid `plannedHours`, and oversized bin rows. Known
   related defect (fix in this package regardless of the freeze): **a bin row
   with `plannedHours > 24` can NEVER be dropped** — `setBlockTime` L789
   rejects it, so every drop silently snaps home with no feedback. Repeated
   shrink/split operations accumulate bin hours, so real data hits this.
3. **motion v12 ↔ React 18.3 StrictMode interplay.** The documented `PopChild`
   ref shim is already known to misbehave in dev. Test by temporarily removing
   the `AnimatePresence` wrapper around the context menu; if the freeze
   disappears, the fix is moving `menuRef` to an inner plain wrapper (already a
   backlog suggestion) — not a dependency bump.
4. **Pointer capture + unmount-on-drop.** A successful drop unmounts `BinCard`
   (the entry leaves the bin) while its child still holds pointer capture
   inside the same pointerup turn. Test by calling
   `releasePointerCapture` in `finish` before dispatching, or deferring the
   dispatch with `requestAnimationFrame`.

## Scope

### In scope
- Reproduce the freeze (real pointer drag against the running dev server; use
  the seed data plus a state that mimics heavy budget testing — accumulated bin
  rows, merged blocks — if the clean seed doesn't reproduce).
- Identify and document the root cause (file:line + mechanism) in the worker
  log in `handoffs/RUN-STATE.md`.
- Implement the minimal fix.
- Fix the >24h bin-card UX: while dragging a card that can never be placed
  (`plannedHours > 24` or off-quarter), render the ghost with the existing
  `colliding` danger tint for the whole drag and extend the card's `title`
  hint (Polish, e.g. `Blok jest dłuższy niż doba — podziel go, aby nadać
  termin.`). The reducer stays authoritative and unchanged.
- Regression coverage: if the root cause is reducer-level, add case(s) to
  `src/store/blockActions.test.ts`; if component-level, state in the report why
  no unit test applies and give the exact manual repro for the human
  walkthrough.

### Out of scope
- No bin redesign, no changes to budget/allowance rules, no dependency bumps.
- Do not touch the known `SAVE_TASK` multi-block collapse issue.
- Do not remove StrictMode or the week grid's `user-select: none`.

## Implementation notes

- Remove all instrumentation before finishing.
- If the fix lands in `WeekView.tsx`, keep the two drag implementations
  (`TimedBlock`, `BinCard`) symmetrical where behavior is shared.
- Keep new UI strings Polish.

## Acceptance criteria

- [ ] Bin card → week grid drop works end-to-end: the entry gets the target
      date + snapped `startMinutes`, the bin row disappears, day totals update,
      the site stays responsive, console free of errors.
- [ ] The root cause is written into `handoffs/RUN-STATE.md` (file:line +
      mechanism), not just "fixed".
- [ ] A bin card with > 24h shows the danger tint during the whole drag, its
      drop reverts cleanly, and the title hint explains why (Polish).
- [ ] Plain click on a bin card still opens the task; Escape still cancels a
      drag; collision drops still revert.
- [ ] Gates: `npx tsc --noEmit` clean; `npm test` green (186 baseline + any new
      cases); `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green; new regression case(s) for the root cause if it is
  reducer-level.

## Report back

Synthesized summary only: root cause (file:line + mechanism), files changed
one-line each, test counts, walkthrough items. No raw logs.
