# Handoff: Timed work blocks — data model, migration, time math, reducer

- **Package ID:** PKG-20260708-timed-blocks-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — bumps the persisted DATA_VERSION (3 → 4) with a migration, touches the WorkloadEntry shape used by every workload consumer, and changes reducer ordering helpers. No UI layout changes in this package.

## Goal
Give every `WorkloadEntry` a time-of-day (`startMinutes`), migrate existing data, and add the pure time math + selectors + reducer action (`SET_BLOCK_TIME`) that the timed Week view (next package) will consume. After this package the app behaves visually the same as before, but every block has a valid start time and the store can move/resize blocks in time with collision rejection.

## Context the worker needs
- Relevant files: `src/types.ts`, `src/store/storage.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/store/seed.ts`, `src/utils/time.ts` (NEW), `src/components/AllocationGrid.tsx`, `src/components/WeekView.tsx` (only the insert-form `step` attr), `src/components/TaskModal.tsx` (hours validation, if any 0.5-step check exists there — search for `0.5`).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md` (note: it is partially stale — the dark N2 restyle is done, TaskEditorPage is now `src/components/TaskModal.tsx`, UI text is Polish). All persistence through `storage.ts`; all mutations one reducer action with activity appended via `withActivity`; all reads via `selectors.ts`; dates stay `'yyyy-MM-dd'` strings.
- Prior decisions (architect — do NOT revisit):
  1. **New field:** `WorkloadEntry.startMinutes: number` — minutes from local midnight, always a multiple of 15, `0 <= startMinutes` and `startMinutes + plannedHours*60 <= 1440`. Required (not optional) in the type.
  2. **Hours granularity rule (ONE rule everywhere):** planned hours are multiples of **0.25 h** (15 min), range **0.25–24**. This relaxes the old 0.5 step. Update `AllocationGrid`'s `<input step={0.5}>` → `step={0.25}` and the WeekView insert form's `step={0.5}`/`min={0.5}` → `step={0.25}`/`min={0.25}`. Existing 0.5-step data is trivially valid.
  3. **`sortIndex` is KEPT**, redefined as *derived from time order*: within one (person, date) it stays contiguous 0..n and must always equal the rank of the block sorted by `startMinutes`. Achieve this by making `reindexDays` in `AppStore.tsx` sort by `(startMinutes, sortIndex)` instead of `(sortIndex)` before renumbering, and by calling it (existing pattern) from every action that changes times/dates. `blocksForPersonDate` keeps sorting by `sortIndex` — now equivalent to time order.
  4. **Migration (v3 → v4):** bump `DATA_VERSION` to 4. Derive start times by stacking each (person, date) group sequentially in `sortIndex` order from **08:00** (`WORKDAY_START_MIN = 480`): first block starts at 480, each next starts where the previous ends. Clamp: if a block would end past 24:00, set `startMinutes = max(0, 1440 - durationMin)` (pathological >16h days may overlap after migration — accepted, collisions are only enforced on new calendar mutations). Implement as an idempotent `ensureStartMinutes(data)` normalize pass run inside `loadData` on EVERY load (covers both version<4 payloads and any entry missing/invalid `startMinutes`), plus the version bump. `migrateV1` output flows through the same pass — no separate v1 handling needed beyond what exists.
  5. **New entries' start time (SAVE_TASK / INSERT_BLOCK / REASSIGN_ENTRY):** "append to end of day" — `startMinutes` = max end (`start + duration`) across the person's existing blocks that date, snapped UP to the 15-min grid; empty day → 480; clamp so end ≤ 1440 (`start = max(0, 1440 - durationMin)`).
     - `SAVE_TASK`: kept cells (same task+person+date existed before) keep their old `startMinutes` (and old `sortIndex`, as today) even if hours changed — a grown block MAY overlap a later one; that is allowed for non-calendar mutations and the Week view (next package) renders overlaps side-by-side. New cells: append-to-end rule.
     - `INSERT_BLOCK` (right-click Add before/after): becomes a **ripple insert**. "Przed": new block takes `ref.startMinutes`. "Po": new block starts at `ref` end. Then sweep that person's day sorted by `startMinutes` (new block ordered before `ref` on equal start): keep a cursor starting at the new block's end; any subsequent block whose start < cursor is pushed to start at the cursor (cursor advances past it); blocks after a gap big enough to absorb the shift don't move. Clamp pushed blocks at end ≤ 1440 same as above. Keep all its existing invariant-keeping behavior (auto-assign person, extend task period) and reindex the day.
     - `REASSIGN_ENTRY`: moved entry gets append-to-end `startMinutes` on the target person's day (matches its current end-of-day sortIndex semantics).
  6. **One new action** `SET_BLOCK_TIME` (not separate move/resize):
     ```ts
     { type: 'SET_BLOCK_TIME'; entryId: string; date: DateStr; startMinutes: number; plannedHours: number }
     ```
     Reducer validation — **return `state` unchanged** when any fails:
     - entry exists; `startMinutes` multiple of 15 and ≥ 0; `plannedHours` multiple of 0.25 in [0.25, 24]; `startMinutes + plannedHours*60 <= 1440`;
     - **collision:** the range `[startMinutes, start+duration)` must not overlap any OTHER block of the SAME person on the target `date` (touching edges allowed: overlap iff `aStart < bEnd && bStart < aEnd`);
     - if `date` differs from the entry's date and falls outside the task period, extend the task's `startDate`/`endDate` to cover it (like INSERT_BLOCK) **unless** the extended period would exceed the 92-day cap — then reject.
     No-op (return state) when nothing changed. On success: update the entry, `reindexDays` over both affected day keys, `withActivity` on the task. Suggested Polish messages (use existing gender pattern): date changed → `przeniósł/przeniosła blok {h}h na {date} {HH:mm}`; same date, time/duration changed → `zmienił(a) blok na {HH:mm}–{HH:mm} ({h}h)`.
  7. **Capacity overload never blocks** anything (unchanged invariant): only same-person time overlap rejects.

## Scope
### In scope
1. `src/types.ts` — add `startMinutes: number` to `WorkloadEntry` (with a comment stating the invariant: multiple of 15, block fits within 0–1440).
2. `src/utils/time.ts` (NEW, pure, no React/date-fns/state imports — must be unit-testable):
   - Constants: `MINUTE_STEP = 15`, `HOURS_STEP = 0.25`, `WORKDAY_START_MIN = 480`, `DAY_MINUTES = 1440`.
   - `hoursToMinutes(h)`, `minutesToHours(m)`, `snapToStep(minutes)` (round to nearest 15), `clampBlockStart(start, durationMin)` (fit block into 0–1440), `formatMinutes(m)` → `'8:00'` / `'13:45'`, `blockEndMinutes(startMinutes, plannedHours)`.
   - `rangesOverlap(aStart, aEnd, bStart, bEnd): boolean` (strict, touching edges = no overlap).
   - `hasCollision(blocks: Array<{ id: string; startMinutes: number; plannedHours: number }>, start: number, durationMin: number, excludeId?: string): boolean`.
   - `stackStartTimes(blocksInOrder: Array<{ plannedHours: number }>): number[]` — the migration stacking rule (from 480, sequential, clamped) returning start minutes per block.
   - `nextFreeStart(blocks, durationMin): number` — the append-to-end rule (max end, snapped up to grid, clamped).
   - `packDayBlocks<T extends { startMinutes: number; plannedHours: number }>(blocks: T[]): Array<{ block: T; col: number; cols: number }>` — classic calendar column packing for side-by-side rendering of overlapping blocks (greedy column assignment within overlap clusters; `cols` = cluster width). Used by the next package; include it here so it's covered by the test package.
3. `src/store/storage.ts` — `DATA_VERSION = 4`; `ensureStartMinutes(data)` normalize pass applied in `loadData` (all load paths, incl. legacy/v1); keep everything else intact.
4. `src/store/seed.ts` — `addWork` assigns `startMinutes` by stacking from 480 per person/day (reuse `stackStartTimes` or `nextFreeStart` from `utils/time.ts`) so the sample data shows realistic schedules incl. Marek's overloaded Wednesday (10h → 8:00–18:00).
5. `src/store/AppStore.tsx` — decisions 3, 5, 6 above: `reindexDays` sorts by `(startMinutes, sortIndex)`; `SAVE_TASK`/`INSERT_BLOCK`/`REASSIGN_ENTRY` start-time rules; new `SET_BLOCK_TIME` action + handler.
6. `src/store/selectors.ts` — add pure selectors:
   - `blockEnd(entry: WorkloadEntry): number` (or re-export from utils/time),
   - `blockCollides(state, personId, date, startMinutes, plannedHours, excludeEntryId?): boolean` — wraps `hasCollision` over that person's blocks on that date,
   - keep `blocksForPersonDate` sorted by `sortIndex` (now time order).
7. Step-attribute updates per decision 2 (`AllocationGrid`, WeekView insert form, any other `step={0.5}` hour input — grep `step={0.5}`).
### Out of scope
- NO WeekView layout/drag changes (next package) beyond the input `step`/`min` attrs.
- No MonthView, WorkloadPage, TimelinePage, Dashboard changes (they must keep compiling and behaving identically — hours math is untouched).
- No CLAUDE.md edits.
- No tests (separate test-writer package) — but keep `utils/time.ts` and the reducer import-safe for vitest (no side effects at module load beyond what exists today).

## Implementation notes
- `looksLikeData` and the `{ ...emptyData(), ...parsed }` default-fill can't fill a per-entry field — that's why `ensureStartMinutes` must map over `workload` explicitly. Make it idempotent: entries with a valid `startMinutes` (finite, ≥0, block fits, multiple of 15 — snap if off-grid) are kept as-is; groups with any missing value get the stacking treatment for the missing ones only? No — simpler and deterministic: if ANY entry in the payload lacks a valid `startMinutes`, restack ONLY the (person, date) groups containing invalid entries, preserving `sortIndex` order. Groups fully valid stay untouched.
- Follow the existing handler style (pure functions above the reducer switch, e.g. `insertBlock`, `reassignEntry`).
- `fmt`/hour display helpers already round to 2 decimals — 0.25 values render fine.

## Acceptance criteria
- [ ] `npx tsc --noEmit` and `npm run build` pass.
- [ ] Fresh seed: every workload entry has `startMinutes` ≥ 480 stacked without same-person overlap; Marek's Wed = 8:00–14:00 (6h t1) then 14:00–18:00 (4h t3).
- [ ] A v3 payload in localStorage (e.g. current data before this change) loads with version 4 and every entry gets a stacked `startMinutes`; no entry lost; `sortIndex` still contiguous per person/day. A v1 payload still migrates end-to-end.
- [ ] `SET_BLOCK_TIME` moving a block to a free 15-min slot (same or other day) updates date/start/hours, reindexes both days, appends one activity row; moving onto an overlapping same-person range returns state unchanged (deep-equal); moving to a date outside the task period extends the period (unless >92 days → rejected).
- [ ] `INSERT_BLOCK` "przed"/"po" places the new block at the ref's start/end and ripple-shifts only that person's later overlapping blocks; other people's blocks and other days untouched; task period/assignment invariants kept.
- [ ] `SAVE_TASK` round-trip in the task editor preserves existing blocks' `startMinutes`; a newly added day's cell lands after the person's last block that day.
- [ ] Calendar week view (still the old list UI) renders blocks in time order; app behaves otherwise identically (manual smoke: dashboard, workload, timeline unchanged).

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green, no new warnings. Unit tests come in PKG-20260708-time-tests.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md` (files changed one line each, tests run, deviations). No raw logs.
