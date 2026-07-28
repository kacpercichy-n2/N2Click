# Run state — 20260728-052657-n2hub-288 mobile modal + panel

## Goal

Four mobile (<760 px) fixes: allocation grid becomes a day list in TaskModal
(MO-03/04), visualViewport keyboard inset for modal sheets (MO-22), three-row
task card + details sheet on TasksPage (MO-10), purpose-ordered Panel stack
with empty tiles removed (MO-18). Desktop bit-identical everywhere; no reducer
changes; no new runtime deps.

## Packages (execution order)

1. `handoffs/packages/PKG-20260728-alloc-day-list.md` — developer, ready,
   risk medium, Codex required. New pure `allocationDayList.ts` (+ tests) +
   `AllocationDayList.tsx`; TaskModal conditional render; commits via existing
   `setCell`/`setCellStart` only.
2. `handoffs/packages/PKG-20260728-keyboard-inset.md` — developer, ready,
   risk medium, Codex required. Pure `keyboardInset.ts` (+ tests); wiring in
   shared `useModalShell` (`--n2-kb-inset` on the card); one CSS line in the
   760 px modal block. Run after (1) — same styles.css block.
3. `handoffs/packages/PKG-20260728-task-card-mobile.md` — developer, ready,
   risk medium, Codex conditional. Mobile card branch in TasksPage + new
   bottom details sheet on `useOverlay`; pure `taskCardMobile.ts` (+ tests).
4. `handoffs/packages/PKG-20260728-panel-mobile-order.md` — developer, ready,
   risk medium, Codex conditional. Pure `mobileDashboardOrder` +
   `workloadSummaryLine` in `dashboardPanels.ts` (+ tests); DashboardPage
   mobile stack via conditional rendering.

## Changed boundaries (planned)

TaskModal allocation section (mobile twin of AllocationGrid), shared modal
shell gains a keyboard-inset effect, TasksPage gains a mobile card + one
sheet, DashboardPage gains a mobile branch. All new logic in pure `.ts`
siblings tested in node.

## Verification

Focused per package (vitest files named inside each), then scheduler-owned
`npm test` + `npm run build`. No browser scripts — no covered pointer/drag
paths change.

## Open questions

None blocking — all product decisions settled in the packages.

## Log — PKG-20260728-task-card-mobile (done)

Boundaries: TasksPage mobile card branch + one `useOverlay` details sheet; new
pure `src/pages/taskCardMobile.ts` (+ test); additive `.task-card-m-*` /
`.task-details-*` CSS, `.task-details-sheet` joined the sheet skeleton
selector. `npx vitest run taskCardMobile + overlayShell` 49 pass;
`npm run build` pass. Desktop JSX/CSS untouched. Context as declared.
Deviation: no chevron on the mobile card. Next: reviewer.

## Worker log

- Pkg 4 (keyboard inset): done. New `src/components/keyboardInset.ts` (+ test,
  80 px threshold), one added effect in `useModalShell.ts` (gated on
  `visualViewport` + `MOBILE_NAV_QUERY`), one `max-height` line in the ≤760 px
  modal block. `npx vitest run keyboardInset + modalShell + overlayShell` 73
  pass; `npm run build` pass. Wiki: modal-shell bullet updated. Next: reviewer.
- Pkg 1 (alloc day list): done. New `allocationDayListView.ts` (+ test),
  `AllocationDayList.tsx`, TaskModal conditional render, additive
  `.alloc-daylist*` CSS above the 760 px modal block. Deviation: model renamed
  to `…View.ts` — `allocationDayList.ts` vs `AllocationDayList.tsx` collides on
  case-insensitive macOS (TS1149). `npx vitest run` 55/55 pass; `tsc --noEmit`
  and `npm run build` clean.
- Pkg PKG-20260728-panel-mobile-order (done): `mobileDashboardOrder` +
  `workloadSummaryLine` in `dashboardPanels.ts` (+ tests), `isMobile` stack
  branch in `DashboardPage.tsx`, `.dash-m-*` CSS inside the ≤760 px block.
  Desktop tiles now come from shared render functions (same DOM).
  `npx vitest run src/pages/dashboardPanels.test.ts` 27 pass; `npm run build`
  pass. Context as declared. Next: reviewer.
