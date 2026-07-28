# Run state — 20260728-010300-n2hub-281 tooltip + IconButton

## Goal

Replace native `title` tooltips (111 attribute sites in 25 tsx files — the
prompt's "95" is stale) with an owned Tooltip primitive (group delay 500 ms /
warm-instant, hover + focus-visible, Escape, touch degradation, shortcut hint,
safe aria contract) and upgrade IconButton (44 px halo, aria-disabled/busy,
aria-pressed/expanded, data-size, `title` prop removed → `tooltip`). Raw `×`
lives in OnboardingRoot:569, not "QuickAddModal" (does not exist).

## Packages

- `handoffs/PKG-20260728-tooltip-primitive-iconbutton.md` — developer, ready.
  Pure `tooltipShell.ts` (+tests, node env), thin `Tooltip.tsx` reusing
  `OverlayLayer`/`resolveOverlayPosition` only, IconButton v2, OnboardingRoot
  close swap, migration of all non-calendar files per settled per-site table
  (~87 sites, cases A/B/Bv/C/D).
- `handoffs/PKG-20260728-title-migration-calendar.md` — developer, ready,
  depends on the first, risk high. WeekView (12) / MonthView (4) /
  TimelinePage (8) with declared context expansion to
  `scheduling-and-calendar.md` (invariant 7): observer-only handlers,
  hide-on-pointerdown, context-menu disabled reasons become visible hints.

## Changed boundaries (planned)

New `src/components/tooltipShell.ts` + `Tooltip.tsx`; `IconButton.tsx` API;
`.icon-btn` CSS + `--n2-z-tooltip`; `title=` removed repo-wide.

## Verification

Per package: tooltipShell + components vitest, focused weekView/timeline
suites unmodified, `npm run build`; scheduler owns full `npm test` + build (no
fixed count assumed; last known 1710). Browser bin-drag/placement checks if
playwright available.

## Open questions

None routed as blocking; watch overlapping 44 px halos in dense rows (report,
not redesign).

## Developer result (PKG-…-tooltip-primitive-iconbutton)

Changed: new `tooltipShell.ts`/`.test.ts`/`Tooltip.tsx` (+`DisabledHint`),
IconButton v2, `styles.css` (`--n2-z-tooltip`, `.sr-only`, `.tooltip*`, halo),
OnboardingRoot close, 21 migration files — zero non-calendar `title=` left.
Focused `src/components` 186 pass; full `npm test` 1726 pass; `npm run build`
green. Deviations: PersonDot prop dropped (no consumers), nav gear tooltip only
when collapsed, shared `DisabledHint` for natively-disabled buttons.

## Developer result (PKG-…-title-migration-calendar)

Changed: WeekView/MonthView/TimelinePage (Tooltip observers, `.context-menu-hint`,
Bar `title`→`tooltip`), `browser-check-bin-drag` reads `aria-describedby`, both
wiki pages. `title=` in `src`: zero. `npm test` 74 files / 1726 pass; build green.
Playwright missing → no browser check. Blocker: `browser-check-placement` still
asserts WorkloadPage `title`s removed by package 1.

Follow-up: browser harness ported off `title` in 4 scripts (placement, status
semantics, tab sync, onboarding) — now reads `aria-describedby` → description
text or `aria-label`. WorkloadPage overload cell dropped its self-referencing
`aria-describedby` (name came from the same child). `node --check` clean; tests
1726 pass, build green. No script reads a `title` attribute.

## Developer result (PKG-20260728-kanban-touch-keyboard)

Changed: `KanbanPage.tsx` (HTML5 DnD → Pointer Events + `useTouchDragGate`,
uchwyt klawiaturowy, menu `useOverlay`, region `role="status"`), nowe
`kanbanMove.ts`/`.test.ts`, `compareTasks` wyeksportowany z `kanbanBoard.ts`,
`icons.ts`, Kanban CSS, wiki. Focused 40 pass; `tsc --noEmit` clean;
`npm test` 75 files / 1747 pass; build green. Kontekst bez rozszerzeń.
