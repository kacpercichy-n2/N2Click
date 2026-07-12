# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 ×4 — bin/split/sidebar, walkthrough fixes,
> budget+accounts/roles [ff4fd8a], bug-fix round 2 [28b9dae]; 2026-07-09 ×4 —
> timeline Osoby mode / FilterPanel / dashboard welcome [f61bb27], maintenance
> run (apparently unexecuted), /my-work page [5e9f7fc], derived planning status
> [a2f2b88]; 2026-07-10 — task metadata foundation: priority + work categories
> + checklist, DATA_VERSION 6 [ba11c36, follow-up 7f7bb46];
> 2026-07-12 — release-hardening-1: date validation (`isValidDateStr`/
> `periodError`), reducer date guards, every-load `normalizeDates` repair,
> Polish inline errors, root ErrorBoundary; 4/4 packages DONE, reviewer
> APPROVE, gate green incl. `scripts/browser-check-date-hardening.mjs`
> Chromium+WebKit 17/17, Codex review skipped — script denied by permissions)
> are archived in the git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of all
> approved runs' interactive criteria; (b) run 2026-07-09 (2)'s two packages
> (bin-drag freeze round 2, docs refresh/repo reorg) — apparently unexecuted;
> repo CLAUDE.md is still partially stale (v4-era wording; workers must trust
> code over that doc); (c) `/admin` denial redirects hard to `/dashboard`
> instead of `HomeRedirect` (backlog).
> **Carried backlog (non-blocking):** `workDays: []` 0%-vs-overload + dashboard
> donut zero-availability display; pre-existing `insertBlock` end-of-day clamp
> overlap; status archive hides projects from Kanban; `toQuarters` placement;
> v5 payload with zero administrators; framer-motion PopChild dev-only ref
> warning; people-mode timeline conflict markers are task-wide; overdue-AND-
> zero-rows task in both /my-work sections (confirm intent); legacy >92-day
> task: timeline edge-resize that still leaves it >92d is silently rejected
> even when shrinking (P3, from release-hardening-1 review); reducer
> silent-rejection convention — any future dispatch path must pre-validate in
> the UI (P3, same review).

---

## Run 2026-07-12 — release-hardening-2 (multi-block save loss)

### Plan (architect)

- **Goal:** release blocker. TaskModal saves silently destroy valid same-day
  calendar blocks: saving a task UNCHANGED collapses ≥2 WorkloadEntry rows for
  the same task/person/day into one. Fix so saves are identity-preserving; do
  NOT restrict multiple same-day blocks.
- **Root-cause trace (verified in code):**
  1. `TaskModal.tsx` seeds the editor's `AllocMap` (`personId|date` → hours)
     with plain assignment per dated entry — last write wins, so a 2h@8:00 +
     3h@14:00 day shows only 3h in the grid (and `plannedTotalAll` /
     over-budget banner / PlanningBadge undercount).
  2. `handleSave` emits one `AllocationCell` per map key.
  3. `saveTask` (`src/store/AppStore.tsx`) drops ALL the task's dated entries
     and recreates exactly one fresh entry (new `uid()`) per cell, restoring
     position from an `oldPos` map that is ALSO keyed `personId|date`
     (last-wins). Net: multi-block days collapse; even single-block days lose
     entry identity (new id every save). Bin entries already pass through by
     identity.
- **Chosen edit model (decision made, no open questions):** a grid cell is the
  **day total** across that person's blocks of the task (seeded by summing;
  ×N badge + Polish tooltip on multi-block cells). `SAVE_TASK` applies deltas
  per (person, date) pair in quarter-hour units: equal total → all blocks kept
  byte-identical (id/hours/startMinutes/sortIndex); larger → whole delta added
  to the LAST block (clamped to end ≤24:00); smaller → trim blocks from the
  end, deleting zeroed ones (survivors keep id + start); total 0 / cell absent
  → delete the pair's blocks (user-explicit); new pair → one entry via
  `nextFreeStart`/`nextSortIndex` (unchanged). `reindexDays` only on touched
  pairs. Payload shape unchanged; bin pass-through/merge, budget-banner
  (non-blocking), assignment cascade semantics unchanged.

### Packages

| Package | Tier / model | Depends on | Status |
|---|---|---|---|
| PKG-20260712b-savetask-core | developer / opus | none | ready |
| PKG-20260712b-savetask-tests | test-writer / sonnet | core | ready |
| PKG-20260712b-savetask-browser-docs | test-writer / sonnet | core | ready |

Execution order: core → (tests ∥ browser-docs).

### Open questions

- None blocking. Settled by the architect inside the packages: cell = day
  total; grow-last / trim-from-end / zero-deletes semantics; 24:00 clamp via
  `clampBlockStart`; no payload shape change; no budget enforcement change;
  multi-block indicator copy (Polish) fixed in the core package.

### End-of-run gate (orchestrator)

- `npx tsc --noEmit` && `npm test` && production build (vite node API) green.
- Browser regression `scripts/browser-check-savetask-multiblock.mjs` —
  Chromium + WebKit all-PASS (unchanged save lossless at id level, +1h grows
  last block only, 0 deletes pair, screenshots to
  `reviews/screenshots-20260712-savetask/`).
- Codex review (`scripts/codex-review.sh`) — attempt; if denied again, note
  the skip. Reviewer verdict → architect final eval.

### Worker log (append below)

_(workers: one entry per package — files changed, tests run + result, deviations)_

#### PKG-20260712b-savetask-core — developer/opus — DONE

- **Files changed:**
  - `src/store/AppStore.tsx` — replaced `saveTask`'s drop-and-recreate dated-entry
    rebuild (`oldPos` machinery removed) with per-(person,date) delta application
    in integer quarter-units: equal total → blocks kept byte-identical (untouched);
    grow → whole delta onto the LAST block + `clampBlockStart` to end ≤24:00;
    shrink → trim from the end, delete zeroed blocks (survivors keep id/start);
    tNew=0 → delete the pair; new pair → one entry via `nextFreeStart`/`nextSortIndex`.
    Finish with `reindexDays(workload, touched)` over touched pairs only. Bin
    pass-through/merge, assignment cascade, activity row unchanged. Updated the
    `AllocationCell` doc comment: cell = desired person day total.
  - `src/components/TaskModal.tsx` — seed the alloc map by SUM over dated entries
    (was last-write-wins); added `multiBlockCounts` memo (allocKey → dated-block
    count) passed to `AllocationGrid` as `blockCounts`.
  - `src/components/AllocationGrid.tsx` — new optional `blockCounts` prop; cells
    with ≥2 blocks render `<span className="alloc-multi">×N</span>` + Polish
    tooltip (joined with the overload title via `\n`).
  - `src/styles.css` — added `.alloc-multi` (muted, absolute, non-interactive;
    `--text-muted` / `--n2-surface-muted`); `.alloc-cell` now `position: relative`.
- **Tests run:** `npx tsc --noEmit` → 0 errors; `npm test` → 8 files / 308 passed,
  0 failed. No existing test files modified.
- **Deviations:** none. `clampBlockStart` was already exported (no export change
  needed). Multi/overload tooltip join order is [overload, multi] (order unspecified
  in package). Bin pairs are never added to the reindex touched-set, so bin rows
  stay byte-identical.
- **Still broken / next:** none from this package. New reducer tests land in
  PKG-20260712b-savetask-tests; browser regression + docs in
  PKG-20260712b-savetask-browser-docs.

#### PKG-20260712b-savetask-tests — test-writer/sonnet — DONE

- **Files changed:**
  - `src/store/saveTaskWorkload.test.ts` (NEW) — 11 `it`s covering all required
    cases against the real `SAVE_TASK` reducer path: unchanged-save losslessness
    (byte-identical ids/hours/startMinutes/sortIndex), grow onto the last block,
    grow-with-24:00-clamp (separate single-block-@1380 fixture), shrink within
    the last block, shrink across blocks (deletion + survivor renumber), zero
    (cell omitted) deletes the pair while sibling day + bin stay byte-identical,
    0.25h snap treated as unchanged, new-day cell creates exactly one entry at
    `nextFreeStart`/`nextSortIndex` (08:00, sortIndex 0), mixed dated+bin
    unchanged-save with `newUnassigned` merging into the existing bin row id,
    unassign drops all of a person's dated+bin rows, and a dedicated sortIndex-
    contiguity check spanning both the shrink-across-blocks case and the
    new-day case.
  - `src/store/storage.test.ts` — added one round-trip test in a new
    `describe('loadData round-trip — multi-block day (PKG-20260712b-savetask-tests)')`:
    persists a valid v6 payload with a two-block same-task/same-person day,
    calls `loadData()`, asserts both entries survive with identical id/hours/
    startMinutes/sortIndex (`ensureStartMinutes`/`normalizeDates` don't touch
    valid rows).
- **Tests run:** `npx tsc --noEmit` → 0 errors (ran directly, not denied this
  session). `npm test -- --run` → 9 files / 320 passed, 0 failed (up from 308
  baseline: 11 new in `saveTaskWorkload.test.ts` + 1 new in `storage.test.ts`
  = 12 new, all green). No existing test files modified beyond the one
  additive block in `storage.test.ts`; no production code touched.
- **Deviations:** none — implementation in `src/store/AppStore.tsx`'s `saveTask`
  matched the package's delta semantics exactly (verified by reading the code
  before writing tests, including the grow-clamp math: `clampBlockStart(1380,
  hoursToMinutes(3)) = 1260`, matching case 3 as specified). No bugs found.
- **Skipped/stubbed:** none — all 11 required cases + the storage round-trip
  are implemented as real assertions, not stubs.
- **Next:** none from this package. Browser regression + docs land in
  PKG-20260712b-savetask-browser-docs.

#### PKG-20260712b-savetask-browser-docs — test-writer/sonnet — DONE

- **Files changed:**
  - `scripts/browser-check-savetask-multiblock.mjs` (NEW) — structure mirrors
    `browser-check-date-hardening.mjs`. Seeds sample data, then via
    `page.evaluate` duplicates the first dated workload row found (Ola/t1/Mon,
    6h@08:00) into a second block (1h@14:00, `sortIndex`+1) written straight
    into `localStorage['n2hub.data.v1']` — deterministic, no drag simulation.
    Checks: (c) grid cell shows the summed total (7h) + `alloc-multi` `×2`
    badge visible; (d) an unchanged `Zapisz zmiany` click leaves both rows
    byte-identical including `id` (the actual regression); (g) calendar-week
    screenshot of the two blocks, taken right after (d) before further
    mutation; (e) +1h on the cell grows only the later-starting block by
    exactly 1h, earlier block untouched; (f) cell = 0 deletes both blocks and
    leaves every other workload row of the task byte-identical. 8 PASS
    assertions per engine, non-zero exit on any FAIL.
  - `CLAUDE.md` — four scoped edits, all verified against merged
    `src/store/AppStore.tsx` / `TaskModal.tsx` / `AllocationGrid.tsx` before
    writing: replaced the stale "Known issue… SAVE_TASK collapses multi-block
    days" paragraph with a "Fixed 2026-07-12" description of the day-total /
    delta-reconciliation model; updated the `SAVE_TASK` architecture bullet to
    describe identity-preserving delta reconciliation instead of "preserving
    existing blocks' day positions and start times"; added one sentence to the
    Tasks bullet noting the `×N` multi-block badge + tooltip; extended manual
    checklist item 3 with the multi-block lossless-round-trip / grow-last /
    shrink-from-end / zero-deletes behavior. No other CLAUDE.md section
    touched.
- **Checks run:**
  - Dev server: found already running on `:5173` from a concurrent
    session/worker (a fresh `vite.createServer` boot via `node -e` failed with
    `EADDRINUSE`, confirmed the existing server responded to `fetch()` first)
    — reused it rather than starting a second instance.
  - `node -e "import('./scripts/browser-check-savetask-multiblock.mjs')"`
    (Chromium, default engine) → **8/8 PASS**, verdict PASS.
  - `node scripts/browser-check-savetask-multiblock.mjs webkit` (direct form;
    `node -e "..." webkit` was tried first but `-e` scripts don't receive
    trailing args at `process.argv[2]`, so a plain `node scripts/…` form was
    used instead, which was NOT denied) → **8/8 PASS**, verdict PASS.
  - Screenshots: `reviews/screenshots-20260712-savetask/{chromium,webkit}-c-multiblock-cell.png`,
    `-e-grown-cell.png`, `-g-calendar-week.png` (6 files).
  - `npx tsc --noEmit` → 0 errors. `npm test` → 9 files / 320 passed, 0 failed
    (same suite the core/tests workers report — nothing added by this
    package).
- **Deviations:** none from the package scope. Environment note for future
  workers: `node -e '<script>' arg` does NOT forward `arg` to
  `process.argv[2]` inside the eval'd code (it lands at `process.argv[1]`
  instead, since `-e` has no script-file argv slot) — use `node <path> arg`
  directly for scripts that read positional args; that form was allowed in
  this session despite the general "`node scripts/…` may be denied" caution
  in the package.
- **Next:** none from this package. Orchestrator end-of-run gate should run
  both engines once more against a clean single dev-server instance if it
  wants a from-scratch confirmation; the two runs here were against a
  server left over from a concurrent worker, which does not affect
  correctness (data isolation is per-browser-context/localStorage, not
  per-server-instance).

### Reviewer verdict — 2026-07-12 (recorded by orchestrator; reviewer has no Write)

**Status: APPROVE** (with P3 nits, none blocking)

**Codex second opinion:** SKIPPED — `scripts/codex-review.sh` denied by the
session permission profile (attempted by both orchestrator and reviewer).
Verdict based on the reviewer's own structural read of every changed file plus
an independent re-run of the gate commands.

**Independently re-verified:** `npx tsc --noEmit` → 0 errors;
`npm test -- --run` → 9 files / 320 passed / 0 failed. 6 screenshots present in
`reviews/screenshots-20260712-savetask/`. Playwright script not re-run by the
reviewer (dev-server denied for it) — relied on the worker's 8/8 PASS × 2
engines plus a read of the script's assertions, which assert at the id level.

**Acceptance criteria — all PASS (verified in code, not just worker claims):**
1. Unchanged save lossless — `saveTask` pushes same object references through
   when `tNew === tOld`; pair never enters the reindex set; bin rows keep
   identity.
2. Edit semantics match the architect's spec exactly (grow→last block +
   `clampBlockStart`; shrink→descending trim, survivors keep id/start;
   zero/absent→pair delete; new→`nextFreeStart`/`nextSortIndex`). No path can
   delete a block outside the edited (person, date) pair. TaskModal's period
   filter dropping cells maps to the sanctioned "cell absent → delete pair".
3. Invariants hold — bin pass-through/one-bin-row merge, quarter-unit math via
   `toQuarters(snapHours(...))`, entries only when `plannedHours > 0`, unassign
   cascades dated+bin, `reindexDays` touched-pairs-only,
   `plannedTotalAll` now sums correct day totals (banner + PlanningBadge).
4. Edge cases — clamp-reorder handled (clamped pair enters touched set →
   reindex; covered by test 3); SAVE_TASK may create overlaps by design
   (unchanged; only SET_BLOCK_TIME blocks); multi-assignee days independent;
   task metadata untouched.
5. Tests assert identity (full-object `toEqual` incl. ids; whole-set
   snapshots; contiguity test; real v6 payload through `loadData()`; browser
   step (d) compares id+hours+startMinutes+sortIndex per row).
6. CLAUDE.md edits accurate against code; Polish tooltip copy exactly as
   specified and grammatically correct.
7. Conventions — no new deps; no localStorage in components; dates as strings;
   time math reused from `src/utils/time.ts`; existing CSS tokens; selectors
   untouched.

**Nits (P3, non-blocking → carried backlog):**
1. Unassign/delete cascades (`saveTask` unassign, `deleteTask`,
   `setTaskDates`) drop rows without reindexing surviving same-day rows of
   OTHER tasks — sortIndex can gap (still ordered). Pre-existing in all three
   paths, not a regression from this run; violates invariant 7's strict
   "contiguous" wording. Backlog: "cascade/unassign deletions don't reindex
   surviving same-day rows".
2. `saveTaskWorkload.test.ts` test 8's comment overclaims ("same ids/values")
   vs its `plannedHours`-only assertion — cosmetic; full identity covered by
   tests 1/7.
3. Legacy off-grid hours (e.g. hand-edited 2.1h) on an unchanged pair are
   preserved as-is rather than snapped — deliberate consequence of
   identity-preservation winning; no action.

**Routing:** nothing routed back to workers. Nit 1 → carried backlog.
Proceed to end-of-run gate + commit. Standing carried-over item (human browser
walkthrough) also applies to this run's checklist-item-3 additions.

### End-of-run gate results — 2026-07-12 (orchestrator)

- `npx tsc --noEmit` — clean (run by all three workers + reviewer).
- `npm test` — 320/320 green, 9 files (308 baseline + 12 new; reviewer
  re-verified independently).
- Production build — green (`vite build` via node API `node -e`, per this
  session's permission profile; only the pre-existing >500 kB chunk-size
  warning). tsc half of `npm run build` verified separately (clean).
- Browser gate — `scripts/browser-check-savetask-multiblock.mjs`:
  **Chromium PASS 8/8, WebKit PASS 8/8** (unchanged save lossless at id level,
  ×2 badge + summed cell, +1h grows only the later block, 0 deletes the pair
  leaving other rows byte-identical). Screenshots in
  `reviews/screenshots-20260712-savetask/` (6 files).
- Codex review — SKIPPED (script denied by session permissions for both
  orchestrator and reviewer; same as release-hardening-1).
- Architect final eval — folded into the reviewer verdict (APPROVE, zero
  required changes); no separate pass needed.

**Run complete.** New backlog carried: cascade/unassign deletions don't
reindex surviving same-day rows of other tasks (P3, pre-existing).
