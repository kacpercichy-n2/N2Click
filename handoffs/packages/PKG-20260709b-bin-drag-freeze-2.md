# Handoff: Bin→calendar drag freeze, round 2 — browser repro, root cause, fix, screenshot proof

- **Package ID:** PKG-20260709b-bin-drag-freeze-2
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low-medium — one interactive component path (`WeekView`), possibly one reducer path (`setBlockTime`); no data-model or storage changes allowed without evidence.

## Goal

The user reports the site STILL freezes when dragging a task card from the bin
("Zasobnik") onto the calendar week grid — despite the 2026-07-09 pointer-capture
fix (capture on `currentTarget` + `releaseCapture()` before dispatch,
reviewer-approved). The previous root cause was therefore wrong or incomplete.
Reproduce the freeze in a REAL browser, name the actual root cause with evidence,
fix it, and prove the fix with screenshots. Screenshot artifacts are a REQUIRED
acceptance criterion this time.

## Context the worker needs

- Relevant files (read them fresh — do not trust prior run narratives):
  - `src/components/WeekView.tsx` — `BinCard` (~L453–695: `begin`/`onPointerMove`/`finish`,
    `captureRef`/`releaseCapture`, portal ghost, `unplaceable` guard) and
    `TimedBlock` (~L120–435: same capture pattern; resize handles capture the
    handle `<span>`, drop-to-bin path `MOVE_BLOCK_TO_BIN`). Read the render body
    below L695 too for the exact grid/day-column/bin-pane class names and refs
    (`gridRef`, `viewportRef`, `binRef`).
  - `src/store/AppStore.tsx` — `setBlockTime` (~L771–955: validation, collision,
    period extension, budget grow/shrink, adjacency-merge `for (;;)` at ~L913,
    `reindexDays` at ~L214), `MOVE_BLOCK_TO_BIN`, `INSERT_BLOCK`; the provider's
    persist-on-every-action effect.
  - `src/utils/time.ts` — `BIN_DATE = ''`, `packDayBlocks`, `blockCollides`,
    `clampBlockStart`, `snapToStep`.
  - `src/pages/CalendarPage.tsx`, `src/main.tsx` (`StrictMode` is ON in dev),
    `src/store/seed.ts` (~L216: seed already contains a bin row — Ola, 3h).
  - `src/styles.css` — `.week-bin-ghost` (has `pointer-events: none`),
    `.week-bin-block`, `.week-block`, `user-select: none` on the week panes.
- Prior decisions / prior art: RUN-STATE worker log for
  `PKG-20260709-bin-drop-freeze` (git history of `handoffs/RUN-STATE.md`)
  describes the previous fix. The architect's earlier static pass found no
  unconditional infinite loop in the drop path; the merge `for (;;)` removes one
  entry per iteration and is bounded ON VALID DATA.
- App access: seed via the empty-state banner button `Wczytaj przykładowe dane`.
  The app has a local login screen (`src/pages/LoginPage.tsx`) that gates the app
  when people exist and nobody is logged in; passwordless people log in with ONE
  CLICK on their row. Seeded default user is Kasia (administrator — can edit all
  blocks). Calendar is the `Kalendarz` nav entry; the week view is the default
  timed grid with the bin pane on the right.

## Environment constraints (unattended run — follow exactly)

- Use the Read/Grep/Glob TOOLS for all file reading. Never `cat`, `head`,
  `tail`, `ls`, `grep` in Bash — a global hook rewrites them to `rtk …` which is
  BLOCKED. Allowed: `git <subcommand>`, `npm *`, `npx *`, and the escape hatch
  `node -e '<script>'` (must start exactly with `node -e '`) which can
  `execSync` anything that would otherwise be blocked.
- The dev server is NOT running. Start it detached:
  `node -e 'require("child_process").spawn("npm",["run","dev"],{detached:true,stdio:"ignore"}).unref()'`
  then poll `http://localhost:5173` until it answers (node script with fetch).
- Playwright is NOT installed. Install WITHOUT touching package.json:
  `npm install --no-save playwright` then `npx playwright install chromium`
  and ALSO `npx playwright install webkit` (the user is on macOS — Safari/WebKit
  is a live suspect for a pointer-capture-family bug that Chromium doesn't show).
- Gates after the change: `npx tsc --noEmit` (the rtk rewrite of tsc is
  allowlisted and fine), `npm test` (baseline 195 passing), `npm run build`.

## Scope

### In scope

1. **Repro protocol (do this BEFORE theorizing).** Write a Playwright node
   script and save it as `scripts/browser-check-bin-drag.mjs` (committed, so the
   human and the Codex reviewer can rerun it). The script must:
   - Launch with a fresh browser context (empty localStorage), `page.goto('http://localhost:5173')`.
   - Seed via the banner button (`Wczytaj przykładowe dane`); if the login
     screen appears, click Kasia's row (one-click passwordless).
   - Navigate to the calendar week view; wait for `.week-bin-block` (Ola's 3h
     bin card from seed).
   - Perform the drag with `page.mouse`: `move` to the bin card center, `down`,
     ≥5 intermediate `move` steps into a FREE slot of a day column (real mouse
     input generates pointer events, which is what the app listens to), `up`.
   - **Freeze detection — all three probes, because "freeze" has two shapes:**
     (a) main-thread spin: before the drag, `page.evaluate` installs
     `setInterval(() => (window.__hb = Date.now()), 100)`; after the drop, poll
     `__hb` from node — a stalled heartbeat or a timed-out `page.evaluate('1+1')`
     means a CPU/render loop; (b) pointer-delivery wedge (main thread fine but
     UI dead): after the drop, drag a DIFFERENT grid block ±1h and assert its
     time actually changed, and click a block and assert the TaskModal opens;
     (c) console listener capturing every error/warning for the whole session —
     specifically watch for React's "Maximum update depth exceeded" and any
     uncaught exception (Vite's dev error overlay also signals this).
   - Save screenshots to `reviews/screenshots-20260709/`:
     `01-before-drag.png`, `02-during-drag.png` (ghost visible),
     `03-after-drop.png` — plus, if the freeze reproduces, a `03-freeze.png` of
     the broken state. Create the directory.
   - Run the whole protocol on BOTH chromium and webkit and report the matrix.
2. **If the seed-data drag does not freeze:** escalate through a stress matrix
   before concluding anything (the user's real data is not seed data):
   drop landing EXACTLY adjacent to a same-task/same-person block (triggers the
   adjacency merge + fuse animation); a task with TWO bin rows / extra
   same-task blocks so the merge chain runs multiple iterations; a drop on a day
   outside the task period (period-extension path); repeated rapid drags
   (5+ in a row, StrictMode double-render interplay); a localStorage payload with
   a pathological entry (`plannedHours: NaN` / negative / huge, off-grid
   `startMinutes`) injected before load — the v5 loader may sanitize; check what
   actually reaches the reducer. Also try with the window narrower (≤1180px
   layout) since geometry math (`colWidth`, `viewRect`) changes.
3. **Root cause + fix.** Ranked fresh hypotheses to test with instrumentation —
   do not assume the 2026-07-09 diagnosis was right:
   - **H1 (engine-specific capture wedge):** the capture element is now the card
     ROOT, but a successful drop still unmounts THAT VERY element during its own
     `pointerup` dispatch. `releasePointerCapture` before the dispatch may be
     insufficient in WebKit even though it satisfied Chromium. If webkit repros
     and chromium doesn't, this is it — candidate fix: don't capture at all for
     the bin drag; listen on `window` for pointermove/pointerup during the drag
     (the portal ghost already decouples visuals), or defer the dispatch out of
     the pointerup task (`setTimeout(0)`/microtask) so the unmount happens after
     the event finishes. Pick whichever you can prove fixes the repro.
   - **H2 (render/update loop on the post-drop state):** heartbeat stalls +
     "Maximum update depth exceeded" → bisect with a temporary dispatch counter
     (`window.__dispatchCount++` patched into the reducer wrapper) and React
     Profiler-style console.count in WeekView/CalendarPage renders; suspects:
     `fusedId`/`mergeTargetId` effects, the fuse `onAnimationEnd`, AnimatePresence.
   - **H3 (reducer/util spin on pathological data):** merge `for (;;)`
     (AppStore ~L913) or `packDayBlocks` fed NaN/negative hours — bounded on
     valid data but verify what invalid data does; if the loader lets such rows
     through, harden the loader or the loop, with a unit test.
   - **H4 (perceived freeze — stuck drag state):** if `setPointerCapture` threw
     (captureRef null) or pointerup is lost, `finish` never runs: the ghost
     stays glued mid-screen and the card stays dimmed. Page is technically alive
     but the user calls it a freeze. Fix shape: window-level
     pointerup/pointercancel fallback that ends any active drag.
   - Name ONE root cause in the report, with the evidence line (which probe
     fired, which engine, which console output). If the fix is reducer-level,
     add a vitest regression in `src/store/blockActions.test.ts`. If it is
     component/browser-level, the committed Playwright script IS the regression
     artifact — make it exit non-zero on any probe failure.
4. **Post-fix proof:** rerun `scripts/browser-check-bin-drag.mjs` on both
   engines; all probes green; refreshed screenshots 01–03 showing the block
   landed on the grid (bin row gone, block at the target slot).
5. **If genuinely not reproducible** after the full matrix on both engines:
   say so plainly in the report (do NOT invent a fix), leave the script +
   screenshots as evidence for the human, and fix only concrete defects you can
   demonstrate (e.g. H4's lost-pointerup gap if you can show it). "Not
   reproduced, hardened X with evidence Y" is an acceptable outcome;
   speculative churn is not.

### Out of scope

- No UI redesign, no new UI strings beyond what the fix itself needs (Polish if
  any), no CSS changes unless the root cause demands one.
- No changes to `package.json`/lockfile (Playwright is `--no-save`).
- No storage schema/migration changes unless H3 evidence demands loader
  hardening (then: minimal, with a test).
- No docs edits — `PKG-20260709b-docs-refresh` documents the root cause after you.
- Do not refactor `TimedBlock`/`BinCard` beyond the fix.

## Acceptance criteria

- [ ] `scripts/browser-check-bin-drag.mjs` committed; runs headless against
      localhost:5173; exits non-zero on any freeze probe; covers seed drag +
      all three probes; engine selectable (chromium/webkit).
- [ ] `reviews/screenshots-20260709/` contains at minimum
      `01-before-drag.png`, `02-during-drag.png`, `03-after-drop.png`
      (post-fix, drop landed), plus freeze-state evidence if reproduced.
- [ ] Report names one root cause with the concrete evidence, or states
      "not reproduced" with the full attempted matrix — no hand-waving.
- [ ] After the fix: bin card dropped on a free slot lands (correct date +
      snapped startMinutes, bin row disappears), page passes all three probes,
      console clean, on BOTH chromium and webkit.
- [ ] Plain click on a bin card still opens the task; Escape mid-drag cancels;
      drop on an occupied slot still reverts; `unplaceable` (>24h) rows still
      revert with the danger tint.
- [ ] `npx tsc --noEmit` clean · `npm test` ≥195 passing (plus any new
      regression test) · `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`, plus
  `node scripts/browser-check-bin-drag.mjs` (chromium and webkit) with the dev
  server up.
- Expected: 195+ vitest passing; browser script exits 0 on both engines
  post-fix; screenshots written.

## Report back

Synthesized summary only: repro matrix result (engine × scenario), the root
cause + evidence line, files changed (one line each), probe results post-fix,
screenshot paths, test counts, anything deferred. Log it to
`handoffs/RUN-STATE.md` under the worker log. No raw logs.
