# Current scheduler run

- Run: 021b "Close focused browser and accessibility coverage gaps" — planning complete
- Base branch: `review/claude-auto-20260714-1216`
- Prompt: extend browser checks for 016–020 audit gaps + minimal accessibility

## Packages and changed boundaries

- [PKG-20260714-browser-a11y-gaps](../.claude/handoffs/021b-developer.md)
  — tier: developer, status: ready, risk: medium.
  Boundaries: `scripts/browser-check-placement.mjs` (new zero-availability +
  person-scoped conflict scenario), `scripts/browser-check-bin-split.mjs`
  (Escape recovery + focus-visible near step g), `scripts/browser-check-tab-sync.mjs`
  (keyboard retry + role="alert" in step f). No `src/**` changes; release
  runner and package.json untouched.

## Coverage adjudication

- 016 → bin-split (a)–(h) covered; 017 → placement (a)–(e) covered;
  018 → tab-sync (a)–(g) covered; 020 zero availability → browser gap, closed
  by the new placement scenario. 019a/b/c outside the prompt's named list.

## Focused verification

- Worker: build + preview on :5173, iterate changed scripts in Chromium only;
  one Chromium+WebKit pass of the three changed scripts when stable.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Context expansions

- Read `DashboardPage.tsx`, `WorkloadPage.tsx`, `TimelinePage.tsx`,
  `PersistenceBanner.tsx`, `WeekView.tsx` (Escape), `styles.css`
  (`:focus-visible`) and `selectors.ts` availability contract to pin exact
  user-visible assertions for the package.

## Developer result

- Done. Extended the 3 scripts only. Chromium+WebKit both PASS. Regression
  proofs (temporary src edits, all reverted): placement any-assignee scope →
  marker on co-assignee FAILs; bin-split removed line-1862 outline → outline
  FAILs; tab-sync disabled retry button → activeElement FAILs. WebKit
  `:focus-visible` unmatched under automation → documented manual fallback ran.

## Open questions

- None blocking. WebKit `:focus-visible` matchability under its restricted
  default tab order is delegated to the worker with an approved manual
  fallback path (documented in the package).
