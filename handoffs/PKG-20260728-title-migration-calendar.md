# Handoff: Migrate calendar/timeline `title=` sites to Tooltip (drag-safe)

- Package ID: PKG-20260728-title-migration-calendar
- Status: ready
- Tier: developer
- Depends on: PKG-20260728-tooltip-primitive-iconbutton
- Risk: high
- Codex review: required — touches invariant-7 pointer-sensitive surfaces

## Goal

Replace the remaining native `title` tooltips on the drag-sensitive calendar
and timeline surfaces (`WeekView.tsx`, `MonthView.tsx`, `TimelinePage.tsx`)
with the shared `Tooltip` primitive without changing any pointer/drag behavior.

## Wiki context

- `openwiki/n2hub/scheduling-and-calendar.md` — REQUIRED context expansion:
  CLAUDE.md invariant 7 forbids touching calendar pointer surfaces without it.
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `src/components/WeekView.tsx` (12 `title=` sites)
- `src/components/MonthView.tsx` (4 sites)
- `src/pages/TimelinePage.tsx` (8 sites)
- `src/components/PersonChip.tsx` (`PersonDot` — only if its native title is
  still passed by these consumers)
- `src/styles.css` (only if a `.context-menu-hint` line is added)
- `src/components/Tooltip.tsx` / `tooltipShell.ts` — consume, do not redesign

## Invariants

- Invariant 7: calendar/bin pointer lifecycle, drag/resize, rendered-column
  targeting and context-menu behavior MUST NOT change. Tooltip handlers are
  merged observers only (child handlers always still run; no `preventDefault`,
  no `stopPropagation`, no pointer capture). `pointerdown` hides any tooltip
  immediately, so no popup exists during a drag.
- Same-person collision and bin semantics are untouched (no store changes).
- `weekViewModel.test.ts`, `weekViewLayout.test.ts`, `timelineZoom.test.ts`
  must pass UNMODIFIED.
- Existing accessible names and `data-tour="calendar.block"` anchors unchanged.
- Polish strings; no new dependencies; no git state changes; no commits.

## Scope

Case letters as in PKG-20260728-tooltip-primitive-iconbutton (A drop / B
tooltip+describedby / Bv tooltip visual-only / C visible-or-sr-only / D
disabled-with-reason).

### WeekView.tsx

| Sites | Treatment |
| --- | --- |
| :673 timed block, :1149 bin-strip block, :1284 recurring occurrence, :1342 event occurrence | B — wrap the block root with `<Tooltip>`; text = today's title string (keep the drag-hint sentence for editable blocks). Hidden description spans live in the portal, so block DOM/siblings/absolute layout are untouched. Blocks are `role="button"` + `tabIndex=0`, so focus-visible shows the tooltip too |
| :1175 „Zaplanuj część…" strip button | B |
| :706, :1131, :1306 `block-done-mark` `title="Wykonane" aria-label="Wykonane"` | A — drop `title`, keep `aria-label` (this is the exact double-read bug from the prompt) |
| :1957 birthdays badge, :1966 overload badge | B |
| :2194, :2208 context-menu split items (natively `disabled`, reason `Blok jest za krótki…`) | C+D — render the reason as a small visible `.context-menu-hint` line inside the item when disabled, plus `aria-describedby` to it; drop titles. Do NOT wrap menu items in Tooltip (native disabled buttons swallow hover, and the menu owns roving focus) |

### MonthView.tsx

| Sites | Treatment |
| --- | --- |
| :99 day-cell workload summary | B on the interactive day cell |
| :105 birthdays, :115 recurring, :125 events markers | B (marker spans; if a marker is not focusable/interactive, fold its text into the day cell's tooltip/description instead of a hover-only marker tooltip — no info may be hover-only on a non-interactive node) |

If `PersonDot` receives `title` here, drop it — the cell-level
tooltip/description carries the names.

### TimelinePage.tsx

| Sites | Treatment |
| --- | --- |
| :160 Bar `title={title}` (drag move/resize, `role="button"`), :220 milestone diamond | B — Tooltip on the bar/milestone root; keep the editable-mode „przeciągnij…" hint text; `pointerdown` hide guarantees no popup during drag |
| :712 project bar text, :752 task bar text (built strings with dates/conflicts) | These ARE the `title` values fed to Bar — they move into the Tooltip `text` prop; no separate site |
| :695, :740, :786 truncated `timeline-label` titles | Bv — visual tooltip for truncated text; no describedby (text equals the visible/accessible content) |
| :798 person-lane bar | B (same as :752) |

## Out of scope

- Any change to drag math, `begin()`, pointer handlers, `useTouchDragGate`,
  merge/split logic, or context-menu structure beyond the hint line.
- Tooltip/IconButton API changes (report a blocker instead if the primitive
  cannot express something here).
- WorkloadPage, bin drop targets outside the listed files.

## Acceptance

- [ ] `grep -rn 'title=' src --include='*.tsx'` → zero attribute hits repo-wide
      (component `title` props no longer exist; SVG `<title>` elements, if any,
      are elements, not attributes).
- [ ] Block/bar drag, resize, right-click menu and Space/Enter activation
      behave exactly as before (handlers unchanged, tooltip observers only).
- [ ] No tooltip is visible once a `pointerdown` lands on a block/bar.
- [ ] Done-mark double announcement removed (aria-label only).
- [ ] Disabled split items show a visible Polish reason + describedby.
- [ ] Focused suites pass unmodified: weekViewModel, weekViewLayout,
      timelineZoom.

## Verification

- Worker: `npx vitest run src/components/weekViewModel.test.ts
  src/components/weekViewLayout.test.ts src/pages/timelineZoom.test.ts
  src/components/tooltipShell.test.ts`, then `npm run build`.
- Browser: `node scripts/browser-check-bin-drag.mjs` +
  `browser-check-placement.mjs` (Chromium + WebKit) — the covered interaction's
  DOM gains listeners. Playwright has been unavailable in recent runs; if it
  still is, state so explicitly and describe the manual/CDP smoke performed.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Calendar surfaces intentionally shipped as a second package so drag-risk is
  reviewed in isolation; the primitive package must already be merged/green.
- Tooltip-on-drag safety = observer handlers + hide-on-pointerdown (settled in
  the primitive package); no `useOverlay` dismiss machinery on tooltips.
- Context-menu disabled reasons become visible hint text, not tooltips.
