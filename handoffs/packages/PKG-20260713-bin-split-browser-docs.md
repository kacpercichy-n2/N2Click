# Handoff: Browser checks for bin split/partial scheduling + docs update

- **Package ID:** PKG-20260713-bin-split-browser-docs
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713-bin-split-core AND PKG-20260713-bin-split-ui (runs last)
- **Blast radius:** low — one script extension, one new script, CLAUDE.md
  edits. The extension touches `scripts/browser-check-bin-drag.mjs`, whose six
  existing scenarios are a protected regression asset: EXTEND it, never
  replace, restructure, or simplify it.

## Goal

Prove in real browsers (Chromium + WebKit) that: an oversized 30h bin row can
be split and scheduled over multiple days without loss; the scheduled parts
render on the calendar while the remainder stays the SAME bin row; totals
survive reload; the oversized-drag refusal keeps working AND its messaging now
points at the split path. Then update CLAUDE.md where behavior descriptions
changed, and confirm every existing bin-drag lifecycle scenario stays green.

## Context the worker needs

- Relevant files: `scripts/browser-check-bin-drag.mjs` (extend),
  `scripts/browser-check-bin-split.mjs` (create), `CLAUDE.md` (targeted edits),
  `handoffs/RUN-STATE.md` (append your worker-log entry).
- Read first, assert reality not guesses: the shipped UI in
  `src/components/WeekView.tsx` (button class `week-bin-schedule-btn`, aria
  label `Zaplanuj część: …`, menu item `Zaplanuj część…`, form fields
  `Dzień`/`Start`/`Godziny`, confirm button `Zaplanuj`, the exact warning and
  hint strings — copy selectors/strings from the CODE, they were specified in
  PKG-20260713-bin-split-ui decisions 1–8); the reducer `scheduleBinPart` in
  `src/store/AppStore.tsx`; the existing script's structure (scenario arg,
  TARGETS map, PATHO localStorage-injection pattern at ~lines 114–136, result
  probes, EXPECT_LAND).
- Environment: dev server on :5173 may already be running (`npm run dev`,
  launch config `n2hub-dev`) — reuse it; Playwright is installed (the existing
  scripts run against chromium and webkit). `npx tsc --noEmit`; `npm test`;
  production build via `node -e "import('vite').then(v => v.build())"`
  (vite CLI / `npm run build` may be permission-denied); `git` denied.
  Browser checks: `node scripts/browser-check-bin-drag.mjs [chromium|webkit] [scenario] [--narrow]`.
- CLAUDE.md is partially stale (predates the login/access-role system). Trust
  code; edit ONLY the sections named below.

### Prior decisions (final)

1. **Extend `browser-check-bin-drag.mjs` with ONE new scenario `oversized`:**
   - Inject (before navigating to the calendar, using the existing PATHO
     localStorage pattern against key `n2hub.data.v1`) a single bin row
     `{ id: 'oversized-30h', taskId: <first task>, personId: <Ola>, date: '',
     plannedHours: 30, startMinutes: 0, sortIndex: <next free> }`, then reload.
   - Drag that specific card (locate it by its 30h hours text) to the `free`
     target slot. Expectations: does NOT land (add `oversized` to the
     non-landing set alongside `collision`/`invalid`), ghost removed, no
     freeze (heartbeat + modal probes pass), the card still shows 30h, and its
     `title` attribute contains `Zaplanuj część` (the aligned refusal hint).
   - Existing scenarios (`free`, `merge`, `window-fallback`, `collision`,
     `separator`, `invalid`), the probe set, screenshots, and CLI contract stay
     behaviorally identical. Keep the diff additive: new TARGETS entry, the
     injection block, the landing-set change, scenario-conditional asserts.
2. **New `scripts/browser-check-bin-split.mjs`** — usage
   `node scripts/browser-check-bin-split.mjs [chromium|webkit]`, single
   continuous flow (model it on `browser-check-status-semantics.mjs` /
   the bin-drag script's conventions: result object, PASS/FAIL verdict,
   non-zero exit on failure, console/pageerror capture, screenshots in
   `reviews/screenshots-20260713-binsplit/`):
   (a) seed sample data, inject the 30h bin row for Ola (same pattern), reload,
       open `/calendar`;
   (b) find the 30h card's `Zaplanuj część` button (class + aria-label), open
       the form, schedule 8h on a free day at a free time → assert: a new grid
       block appears, the card now reads `22h`, zero page errors;
   (c) repeat for two more days (→ 14h, → 6h), asserting the bin row is the
       same single row (one card for that task) each time;
   (d) **identity through reload:** capture the bin row's `id` from
       localStorage before and after a reload — must be equal — and assert
       conservation: dated hours for the injected task + remaining bin hours
       = 30 exactly, after `page.reload()`;
   (e) refusal alignment inside the form: pick a colliding time → the exact
       collision warning is visible and `Zaplanuj` is disabled; fix the time →
       enabled again;
   (f) schedule the final 6h → the task's bin card disappears; total dated
       hours = 30; reload → still true;
   (g) keyboard path: open the form via Tab+Enter on a bin-card button (any
       remaining bin card, e.g. Ola's seeded 3h row) and schedule 0.5h using
       only the keyboard;
   (h) verdict PASS only when all of the above hold with zero `pageerror`s.
3. **CLAUDE.md edits (surgical, Polish UI strings verbatim from code):**
   - Calendar bullet: after the drag/right-click description, add one or two
     sentences: bin cards carry **„Zaplanuj część”** (button + context menu) —
     schedules a chosen 0.25h-aligned part of a bin row onto a day via
     `SCHEDULE_BIN_PART` (atomic: decrements the single bin row — same id —
     creates one dated block, deletes the bin row only at zero, reuses the
     SET_BLOCK_TIME guards); oversized (>24h) bin rows are recovered this way
     and their refusal hint points at it.
   - Architecture "State" bullet: mention `SCHEDULE_BIN_PART` next to
     `SET_BLOCK_TIME` (one clause is enough).
   - Manual test checklist item 8: extend with the split flow (30h bin row →
     parts over several days, remainder same row, totals survive reload,
     collision warning in the form).
   - Do NOT rewrite unrelated sections or fix unrelated staleness.
4. **RUN-STATE.md:** append your worker-log entry under the 2026-07-13 run
   section (files changed, checks run, deviations) — the section already
   exists; do not restructure it.

## Scope

### In scope
- The `oversized` scenario extension, the new split script, the three CLAUDE.md
  edits, the RUN-STATE worker-log entry, running the full check matrix below.

### Out of scope
- Any `src/` production change (if the UI/reducer doesn't match this package,
  STOP and report — don't patch).
- Rewriting or reorganizing the existing script's scenarios/probes; renaming
  its screenshots dir; changing its CLI.
- Unit tests (separate package), onboarding script, other browser scripts.

## Implementation notes

- The dev server must be the CURRENT build (core + ui merged) — restart it if
  it predates those changes.
- Fresh browser context per run gives empty localStorage → sample banner
  (`Wczytaj przykladowe dane` / `Wczytaj przykładowe dane` — copy the exact
  string from the existing script).
- Locate form fields by their Polish `<label>` text; prefer role/label
  locators over brittle CSS where the existing scripts do.
- For localStorage assertions, `JSON.parse(localStorage.getItem('n2hub.data.v1'))`
  inside `page.evaluate` (pattern already in the script).

## Acceptance criteria

- [ ] `node scripts/browser-check-bin-drag.mjs chromium oversized` and
      `… webkit oversized` PASS (no landing, no freeze, hint contains
      `Zaplanuj część`).
- [ ] ALL existing scenarios PASS on BOTH engines, including narrow variants:
      `free`, `merge`, `window-fallback`, `collision`, `separator`, `invalid`,
      plus `free --narrow` and `window-fallback --narrow` (chromium + webkit).
- [ ] `node scripts/browser-check-bin-split.mjs` PASSES on chromium AND webkit
      (steps a–h, zero page errors), screenshots written under
      `reviews/screenshots-20260713-binsplit/`.
- [ ] CLAUDE.md updated exactly per decision 3 (grep: `Zaplanuj część` and
      `SCHEDULE_BIN_PART` each appear; checklist item 8 mentions the split
      flow).
- [ ] `npx tsc --noEmit` 0 errors; `npm test` fully green (no test files
      touched by this package); production build green via the node API.
- [ ] RUN-STATE worker-log entry appended.

## Tests

- Command (full matrix, in order): `npx tsc --noEmit` → `npm test` →
  `node -e "import('vite').then(v => v.build())"` → bin-drag scenarios ×2
  engines (incl. `oversized` + narrow variants) → bin-split script ×2 engines.
- Expected: everything green/PASS; any FAIL is a blocker to report, not to
  paper over.

## Report back

Synthesized summary: per-engine PASS/FAIL table for every scenario + the split
script, files changed one-line each, CLAUDE.md hunks summarized, deviations
(should be none), screenshots location.
