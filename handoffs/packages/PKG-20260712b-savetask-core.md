# Handoff: Make SAVE_TASK identity-preserving for multi-block days (core)

- **Package ID:** PKG-20260712b-savetask-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — touches the single write path for task allocations (silent data loss bug); no schema/DATA_VERSION change.

## Environment constraints (unattended session — read first)

Direct `git`, `vite`, `npm run build`, `npm run dev`, and arbitrary shell are DENIED by the permission profile. Allowed: `npm install *`, `node -e '<js>'`, and rtk-wrapped read/grep/wc/tsc. Try `npm test` and `npx tsc --noEmit` first; if denied, fall back to the node-API equivalents (`node -e "import('vitest/node').then(...)"`, tsc via its node API) rather than stopping. Do NOT run the production build or dev server — the orchestrator gates those. Log your result to `handoffs/RUN-STATE.md` (Worker log section) when done.

## Goal

Saving a task through TaskModal must never silently delete or merge same-day calendar blocks. An unchanged Save must be structurally lossless: every `WorkloadEntry` row of the task (id, date, plannedHours, startMinutes, sortIndex) survives byte-identical. Allocation edits get the exact deterministic semantics specified below.

## Context the worker needs

- Relevant files: `src/components/TaskModal.tsx`, `src/components/AllocationGrid.tsx`, `src/store/AppStore.tsx` (`saveTask`, `reindexDays`, `nextSortIndex`, `dayKey`), `src/utils/time.ts` (`snapHours`, `HOURS_STEP`, `nextFreeStart`, `hoursToMinutes`, `isBinEntry`, `clampBlockStart` — export it if it is currently module-internal), `src/styles.css`.
- Conventions: `CLAUDE.md` (invariants section; note parts are v4-era stale — trust code over doc). Polish UI strings only.
- Root cause (verified trace — do not re-derive, just confirm as you go):
  1. `TaskModal.tsx` seeds `allocations: AllocMap` (`personId|date` → hours) with `map[allocKey(w.personId, w.date)] = w.plannedHours` — with ≥2 blocks on one person/day, **last write wins**, so the grid shows only one block's hours and `plannedTotalAll` undercounts (over-budget banner + PlanningBadge are wrong too).
  2. `handleSave` emits one `AllocationCell` per map key.
  3. `saveTask` in `AppStore.tsx` drops ALL of the task's dated entries (`workloadOther`) and recreates exactly one fresh entry (new `uid()`) per cell, taking position from `oldPos` — also keyed `personId|date`, last-wins. Two blocks → one block, wrong hours, new id.
- Only `TaskModal.tsx` dispatches `SAVE_TASK` in production code (tests also do). Do NOT change the `SaveTaskPayload` shape; cells now semantically mean "desired day total for that person" — update the `AllocationCell` doc comment to say so.

## Scope

### In scope — exact semantics (no design decisions left to you)

**A. TaskModal seeding (`TaskModal.tsx`):**
- Seed the alloc map by SUM: `map[key] = (map[key] ?? 0) + w.plannedHours` over the task's dated (non-bin) entries. (0.25-multiples add exactly in floats; no epsilon needed.)
- Compute a live `multiBlockCounts: Record<string, number>` (allocKey → number of dated entries of this task on that person/day) via `useMemo` over `state.workload`; pass it to `AllocationGrid` as a new optional prop.

**B. AllocationGrid (`AllocationGrid.tsx` + `styles.css`):**
- New optional prop `blockCounts?: Record<string, number>`. When a cell's count ≥ 2: render a small muted badge inside the cell (`<span className="alloc-multi">×N</span>`) and set the cell `<td>` title to exactly: `Bloki w kalendarzu: N. Edycja sumy wydłuży ostatni blok lub skróci bloki od końca; 0 usunie wszystkie.` (If the cell is also overloaded, join both titles with `\n`.)
- Add a minimal `.alloc-multi` rule in `styles.css` using existing `--n2-*` tokens (muted, small, non-interactive; don't disturb the input layout).
- No other grid behavior changes; `baseHoursFor` stays correct because cell value = the task's true day total.

**C. `saveTask` in `AppStore.tsx` — replace the dated-entry rebuild with delta application. Definitions:** a *pair* = (personId, date) over the task's dated entries; all hour arithmetic in integer quarter-units `q(h) = Math.round(h / HOURS_STEP)`; pair's existing blocks sorted ascending by `(startMinutes, sortIndex)`; "last block" = the final element of that order. For every pair in the union of existing-entry pairs and allocation-cell pairs (cells for unassigned people skipped, as today; entries of unassigned people dropped, as today):
1. `T_new` = `q(snapHours(cellHours))` for the pair's cell, else `0`. `T_old` = sum of `q(plannedHours)` over the pair's existing blocks.
2. `T_new === T_old` → keep every block **exactly** (same objects; id, plannedHours, startMinutes, sortIndex untouched; pair NOT added to the reindex touched-set).
3. `T_new > T_old` and `T_old > 0` → add the whole delta to the **last block's** `plannedHours` (id, sortIndex unchanged). Then clamp so it still ends by 24:00: `startMinutes = clampBlockStart(startMinutes, hoursToMinutes(newHours))`; if the clamp moved the start, add the pair to the touched-set (order may change).
4. `0 < T_new < T_old` → trim from the end: walk blocks in DESCENDING order with `deficit = T_old − T_new`; reduce each block by `min(q(block), deficit)`; a block reaching 0 is deleted; stop at deficit 0. Surviving blocks keep id and startMinutes (they just end earlier). Any deletion → pair into touched-set.
5. `T_new > 0` and `T_old === 0` → create ONE new entry (as today): `uid()`, hours `T_new * HOURS_STEP`, `startMinutes = nextFreeStart(all of that person's blocks that day across all tasks, hoursToMinutes(hours))`, `sortIndex = nextSortIndex(...)`. Pair into touched-set.
6. `T_new === 0` and `T_old > 0` (cell zeroed, or absent — e.g. dropped by the period filter) → delete ALL the pair's blocks. This is user-explicit deletion and is allowed. Pair into touched-set.
- Remove the now-dead `oldPos` machinery. Finish with `reindexDays(workload, touched)` over touched pairs only — untouched pairs' rows must come out byte-identical.
- Bin handling (`taskBinKept` pass-through + `newUnassigned` one-bin-row merge) is already identity-preserving — leave it exactly as is. Activity row (`withActivity`) unchanged. No budget enforcement added (over-budget stays a non-blocking banner).

### Out of scope
- Any change to `SaveTaskPayload` / `AllocationCell` shape, `SET_BLOCK_TIME`, `INSERT_BLOCK`, split/merge/bin actions, storage.ts, DATA_VERSION.
- Disabling or preventing multiple same-day blocks (explicitly forbidden).
- New tests (PKG-20260712b-savetask-tests) and docs/browser regression (PKG-20260712b-savetask-browser-docs) — separate packages. But keep every existing test green.
- Per-block editing UI in the grid; week-view changes.

## Implementation notes

- Keep the reducer pure; follow the existing `reindexDays` touched-key pattern used by `moveTask`/`SET_BLOCK_TIME`.
- `snapHours` before quarter conversion covers off-grid input (e.g. 2.1 → 2.0).
- Growing the last block may create a same-person overlap with another task's later block — allowed by invariant 3 (only the calendar drag path blocks overlaps); week view packs side-by-side.
- Existing `SAVE_TASK` tests live in `src/store/blockActions.test.ts` ("SAVE_TASK bin behavior"), `src/store/taskMeta.test.ts`, `src/store/dateGuards.test.ts` — all must stay green unmodified.

## Acceptance criteria

- [ ] Open a task with two blocks on one person/day (e.g. 2h @ 8:00 idx 0 + 3h @ 14:00 idx 1): grid cell shows 5, `×2` badge + Polish tooltip present; Save with no edits → both `WorkloadEntry` rows unchanged (same ids, hours, startMinutes, sortIndex); bin rows also unchanged.
- [ ] Same task, cell 5 → 6, Save → 14:00 block becomes 4h, 8:00 block untouched, both ids preserved.
- [ ] Cell 5 → 1.5, Save → 14:00 block deleted, 8:00 block 1.5h @ 8:00, sortIndex reindexed to 0.
- [ ] Cell 5 → 0 (or day dropped from the period), Save → both blocks deleted; other days and bin untouched.
- [ ] Single block 23:00/0.5h, cell → 3, Save → 3h block ending ≤ 24:00 (start clamped to 21:00).
- [ ] New cell on an empty day → exactly one entry appended via `nextFreeStart`/`nextSortIndex` (unchanged behavior).
- [ ] `plannedTotalAll` / over-budget banner / PlanningBadge in TaskModal now reflect the true dated total on multi-block days.
- [ ] `npx tsc --noEmit` clean; full existing test suite green with zero modifications to existing test files.

## Tests

- Command: `npx tsc --noEmit` && `npm test` (fallback: vitest/tsc node APIs via `node -e`).
- Expected: tsc 0 errors; all existing tests pass unmodified. New reducer tests arrive in PKG-20260712b-savetask-tests.

## Report back

Synthesized summary only (files changed one line each, test pass/fail counts, deviations). Append it to `handoffs/RUN-STATE.md` under the Worker log. No raw logs.
