# Handoff: Week-view budget clamp feedback + merge animation; sidebar collapsed icon circles

- **Package ID:** PKG-20260708-budget-week-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-budget-store (uses its `growAllowanceHours` selector and merge semantics)
- **Blast radius:** low–medium — `WeekView.tsx` drag interactions + `styles.css`. No store changes.

## Goal

(1) Resizing a block in the calendar week view clamps live at the task's budget
(block + bin + headroom) with visible feedback, and a drop that merges two
same-task blocks plays a light "merge paths" animation (respecting
prefers-reduced-motion). (2) Collapsed-sidebar nav icons sit in fixed-size 1:1
circles instead of fit-content boxes.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx` (`TimedBlock` drag state ~line
  65–245: `begin`, `onPointerMove`, `finish`; DragState has
  `projStart/projHours/projDayIndex/overBin/colliding`), `src/styles.css`
  (week-cal block styles; `.sidebar-collapsed` rules inside the
  `@media (min-width: 1181px)` block ~line 2732; global
  `prefers-reduced-motion: reduce` override at the end), `src/App.tsx` (nav
  markup ~lines 171–184 — reference only, should not need edits),
  `src/store/selectors.ts` (`growAllowanceHours`, `blockCollides`).
- Conventions: CLAUDE.md. Polish UI strings; `--n2-danger` for danger tints,
  lavender `#c496ff` accents; the week grid keeps `user-select: none`; the
  global reduced-motion rule must keep working (use plain CSS
  animations/transitions so it neutralizes them — no JS-driven motion).
- Prior decisions (architect-settled):
  1. **Clamp at drag begin.** When a `top`/`bottom` resize starts, compute once:
     `allowance = growAllowanceHours(state, entry.id)` →
     `maxHours = allowance === null ? Infinity : baseHours + allowance`. During
     `onPointerMove` clamp `projHours = min(projHours, maxHours)` (for `top`
     mode also re-derive `projStart` so the end stays fixed). Store an `atCap`
     boolean in DragState when the raw projection exceeded `maxHours`.
  2. **Cap feedback:** class `at-cap` on the block while clamped — thin
     `--n2-warning` outline; the block's `title` while at cap:
     `Limit czasu zadania — brak godzin w zasobniku`. No toast, no modal.
  3. **Will-merge affordance:** during a drag (`move` OR resize), when the
     projected geometry is EXACTLY adjacent (end == start, same day) to another
     block with the same taskId + personId — i.e. the drop will trigger the
     reducer merge — add class `will-merge` to the dragged block and
     `will-merge-target` to the neighbor. Visual: soft lavender glow on both +
     a small connecting "blob" at the touching edge (a `::after`
     radial-gradient pill bridging the gap on the dragged block). Detection must
     mirror the reducer's predicate exactly (same task, same person, same date,
     exact adjacency, no collision).
  4. **Fuse animation on drop:** before dispatching `SET_BLOCK_TIME`, if the
     merge predicate holds, remember the SURVIVING entry id (the
     earlier-starting block's id — reducer keeps that one) in transient state
     (e.g. `fusedId`). After the merged block re-renders, it carries class
     `fused` driving a ~280ms CSS keyframe (slight scale squash + lavender glow
     fading out). Clear `fusedId` on `animationend` plus a timeout fallback.
     Under reduced motion the global override kills the keyframe — merge happens
     instantly, no extra code path needed.
  5. **Sidebar fix (Stream D):** inside the existing
     `@media (min-width: 1181px)` `.sidebar-collapsed` block in `styles.css`,
     make every `.app-nav-link` a fixed 1:1 circle: equal `width`/`height`
     (44px), `border-radius: 999px`, `padding: 0`, icon centered,
     `margin-inline: auto`. Active/hover states must remain clearly visible on
     the circle (keep the existing active background/indicator, adapted to the
     circle). CSS-only if possible; touch `src/App.tsx` nav markup only if a
     wrapper is genuinely required. No behavior change ≤1180px.

## Scope

### In scope

- `src/components/WeekView.tsx`: DragState gains `maxHours`, `atCap`,
  `willMergeWithId`; clamp logic in `onPointerMove`; will-merge detection;
  `fusedId` transient state + class plumbing; title text of decision 2.
- `src/styles.css`: `.week-block.at-cap`, `.week-block.will-merge`,
  `.week-block.will-merge-target`, the connecting-blob `::after`, the
  `fused` keyframe; the `.sidebar-collapsed .app-nav-link` circle rules.

### Out of scope

- Any store/selector/storage/type change (package 1 owns semantics).
- Bin column layout, TaskModal, context menu, month view.
- `INSERT_BLOCK` flow and its form.
- New tests (interaction-only change; store behavior already covered).
- The ≤1180px strip and ≤760px drawer styles.

## Implementation notes

- `growAllowanceHours` reads current state — capture it in `begin()` alongside
  `colWidth`; do not recompute per pointer event.
- Will-merge check runs against `state.workload` for the person's projected day
  excluding the dragged entry; reuse `blockEndMinutes`. It must be false while
  `colliding` or `overBin` is true.
- The `fused` class must be applied via the entry id (the block may have moved
  to a different day column component instance) — a `useState<string | null>`
  at the WeekView level passed down, or a keyed effect; keep it simple.
- Blob visual: keep it subtle (~10px radial gradient, opacity < 0.8); it should
  read as "these will connect", not as a new element.
- Verify on the running dev server (http://localhost:5173 — already running, do
  NOT start another): seeded task with an estimate + bin hours; resize to the
  cap; merge two blocks; toggle OS reduced-motion if possible.

## Acceptance criteria

- [ ] Resizing a budgeted block stops growing at `baseHours + allowance`; the
      block shows the `at-cap` outline and the Polish title while clamped;
      releasing at the cap persists the clamped size (no reducer rejection in
      normal use).
- [ ] Resizing a block of a task with `estimatedHours: null` behaves as before
      (no clamp, no cap styling).
- [ ] Dragging a block so its projected edge exactly touches a same-task
      same-person block shows the will-merge glow + blob on both blocks; moving
      away removes it; it never shows during a collision or over the bin.
- [ ] Dropping in the will-merge position produces one merged block that plays
      the fuse animation once (~280ms) and ends in the normal resting style.
- [ ] With `prefers-reduced-motion: reduce`, no fuse/blob animation plays; the
      merge still happens instantly and correctly.
- [ ] Collapsed sidebar (>1180px): all nav icons sit in identical 44px 1:1
      circles, horizontally centered in the 80px rail; active and hover states
      visible; expanded sidebar and ≤1180px layouts pixel-identical to before.
- [ ] Console free of errors/warnings during the above.
- [ ] `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green, no new unit tests required. Interactive criteria verified
  on the already-running dev server (port 5173); flag anything you could not
  verify from CLI in your report.

## Report back

Synthesized summary only (files changed one-line each, test results, which
interactive criteria were browser-verified vs left for the human walkthrough).
Append to `handoffs/RUN-STATE.md` under the current run's Worker log.
