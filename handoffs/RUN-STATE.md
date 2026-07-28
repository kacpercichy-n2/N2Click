# Run state — 20260728-034631-n2hub-286 taskmodal details

## Goal

Six owner-approved TaskModal/calendar UX fixes (AT-05 grid grouping, AT-13
checkboxes + Wyczyść undo, AT-08 delete out of header, AT-10 comments/activity,
IA-08 calendar ✓ tick, IA-15 full task page) plus ONE shared ⋯ overflow-menu
primitive on `useOverlay`/`OverlayLayer`.

## Packages

- `handoffs/PKG-20260728-taskmodal-details.md` — developer, ready, risk high,
  Codex review required. Single package (TaskModal.tsx on 5 of 6 items);
  internal order: OverflowMenu primitive → AT-08 → AT-10 → AT-13 → AT-05 →
  IA-08 → IA-15.

## Changed boundaries (planned)

New `src/components/OverflowMenu.tsx` (+ IconButton `haspopup` prop), new pure
`src/components/allocationGridView.ts`, `taskModalSections.ts` done-blocks
collapsible, WeekView TimedBlock gains a sibling ✓ button (invariant 7:
observers + stopPropagation only), `/tasks/:id` becomes `TaskFullPage`
(exported `TaskEditor`, new dirtyRegistry scope `'task-page'`, new
`src/pages/taskPageRoute.ts`). CommentsPanel loses its tablist (also affects
ProjectDetailPage — accepted).

## Verification

Focused: allocationGridView / taskModalSections / dirtyRegistry / taskPageRoute
tests, then `npm test` + `npm run build`. Browser:
`browser-check-ui-keyboard.mjs` and `browser-check-savetask-multiblock.mjs`
(Chromium + WebKit). Scheduler owns the final gate.

## Open questions

None blocking — all product decisions settled in the package (undo lives in
editor draft state, no reducer action; activity becomes „Historia zmian” menu
entry; full-page save/cancel navigate to `/tasks`).

## Wiki

Likely stale after landing: `ui-navigation-and-onboarding.md` (overlay-shell
consumers list, `/tasks/:id` route, CommentsPanel) and
`scheduling-and-calendar.md` (block ✓ affordance). Final reviewer adjudicates.

## Developer result (2026-07-28)

All seven items landed. `npm test` 1845 pass, `npm run build` green; focused
[allocationGridView/taskModalSections/dirtyRegistry/taskPageRoute] 57 pass.
Context expanded only to `styles.css` z-index ladder: the ⋯ popover portals to
body, so it needed `--n2-z-menu-over-modal`. Blocker: browser checks could NOT
run — `playwright` is not installed (`ERR_MODULE_NOT_FOUND`); multiblock row
targeting pre-adjusted to `tr[data-date]`, unverified.
