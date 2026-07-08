# Handoff: Enforce task hour budget + bin conservation + adjacent-block merge in the store

- **Package ID:** PKG-20260708-budget-store
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none (run FIRST — packages 2, 3, 4 build on it)
- **Blast radius:** high — core reducer (`SET_BLOCK_TIME`, `SPLIT_BLOCK`, `SAVE_TASK`, `MOVE_BLOCK_TO_BIN`, `REASSIGN_ENTRY`), storage normalize pass, selectors. No UI files.

## Goal

Make calendar block resizing hour-conserving and budget-capped: growing a block
draws hours from the task's bin/budget instead of minting new hours; shrinking
returns hours to the bin (exists — now merged, not appended); a task+person pair
has at most ONE bin entry; two same-task same-person blocks that end up exactly
back-to-back on one day merge into one block.

## Context the worker needs

- Relevant files: `src/store/AppStore.tsx` (reducer; `setBlockTime` ~line 663,
  `splitBlock` ~798, `moveBlockToBin` ~766, `reassignEntry` ~602, `saveTask`
  ~225), `src/store/selectors.ts` (bin selectors ~line 265), `src/store/storage.ts`
  (`ensureStartMinutes` ~345), `src/utils/time.ts` (grid constants, `isBinEntry`,
  `BIN_DATE`), `src/types.ts` (WorkloadEntry doc comment).
- Conventions: CLAUDE.md (single source of truth). All mutations are reducer
  actions; rejections return the SAME state reference; activity rows appended via
  `withActivity` inside the same action; `reindexDays` renumbers sortIndex per
  (person, date); dates `'yyyy-MM-dd'`; hours on the 0.25 grid; Polish strings.
- Prior decisions (architect-settled — do not reopen):
  1. **Budget model.** For a task with `estimatedHours !== null`:
     `headroom = max(0, estimatedHours − sum of ALL the task's workload entries
     (dated + bin, all people))`. A block may GROW by at most
     `binSame + headroom`, where `binSame` = the same person's bin hours for the
     SAME task. Consumption order: bin first, then headroom. Consuming bin keeps
     the task total constant; consuming headroom raises it, capped at the
     estimate. `estimatedHours === null` ⇒ NO budget ⇒ current free-grow
     behavior unchanged.
  2. **Enforcement lives in `SET_BLOCK_TIME` only** (the calendar drag/resize
     path), mirroring how collision-blocking is calendar-only (CLAUDE.md
     invariant 3). `SAVE_TASK` / AllocationGrid edits stay unrestricted (estimate
     remains advisory there). Document this in a code comment.
  3. **New invariant: at most one bin entry per (taskId, personId).** Enforced at
     every bin-writing path (list below) plus an idempotent merge in
     `ensureStartMinutes`.
  4. **Adjacent-merge invariant:** inside `SET_BLOCK_TIME`, after applying the
     new geometry, if the moved/resized block is exactly adjacent (end == start,
     touching, no gap) to another entry with the SAME taskId + personId + date,
     merge them into one entry. The entry with the EARLIER startMinutes survives
     (keeps its id); hours are summed; the later entry is deleted. Repeat until
     no adjacency (a merge can create a new adjacency). Merging applies only in
     `SET_BLOCK_TIME` — NOT in `INSERT_BLOCK` (documented decision: the ripple
     insert keeps its current behavior).
  5. **Quarter-unit arithmetic.** All hour math in integer quarters
     (`Math.round(h / HOURS_STEP)`) to avoid float drift. All inputs are already
     grid-validated.
  6. **Known issue stays untouched:** `SAVE_TASK`'s `personId|date` allocation
     collapse (CLAUDE.md "Known issue") is out of scope; do not fix or worsen it.
     Bin entries remain exempt from that rebuild (current pass-through behavior).

## Scope

### In scope

1. `src/store/selectors.ts` — new pure selectors:
   - `binEntryForTaskPerson(state, taskId, personId): WorkloadEntry | undefined`
     (post-invariant there is at most one; return the first by sortIndex).
   - `binHoursForTaskPerson(state, taskId, personId): number`.
   - `taskBudget(state, taskId): { estimate: number | null; totalAll: number; headroom: number }`
     (`totalAll` = sum of all the task's entries incl. bin; `headroom` as decision 1;
     `headroom = 0` when estimate is null).
   - `growAllowanceHours(state, entryId): number | null` — `null` = unlimited
     (task has no estimate); else `binHoursForTaskPerson + headroom`. The
     allowance applies to the GROW DELTA, not the block's absolute size — say so
     in the doc comment.
2. `src/store/AppStore.tsx`:
   - `setBlockTime`: on grow (`plannedHours > entry.plannedHours`) with a
     budgeted task, reject (same state ref) when
     `growDelta > growAllowanceHours` (safety net — the UI clamps live in
     package PKG-20260708-budget-week-ui). Otherwise consume:
     `takenFromBin = min(growDelta, binSame)` is subtracted from the person's
     same-task bin row (row deleted when it reaches 0); the remainder comes from
     headroom (no row change). Activity message: append
     `; pobrano z zasobnika: ${formatDuration(takenFromBin)}` when
     takenFromBin > 0.
   - `setBlockTime` shrink path: MERGE the freed delta into the existing
     (task, person) bin row when one exists instead of appending a new row
     (create only when none exists). Existing activity suffix
     `; … wróciło do zasobnika` unchanged.
   - `setBlockTime`: after geometry is applied (and bin consumption), run the
     adjacency merge of decision 4, then `reindexDays` over all touched
     (person, date) keys incl. `BIN_DATE` when the bin changed. When a merge
     happened append `; połączono sąsiednie bloki (razem ${formatDuration(mergedHours)})`
     to the activity message.
   - One-bin-row enforcement in the other writers:
     - `splitBlock`: all split-off parts collapse into ONE bin row (summed),
       merged into an existing (task, person) bin row if present.
     - `moveBlockToBin`: if a (task, person) bin row exists, add the moved
       block's hours to it and DELETE the moved entry (the existing row's id
       survives); else current behavior (entry becomes the bin row).
     - `saveTask` `newUnassigned`: multiple items for one person+task merge into
       one row, and merge into a passed-through existing bin row if present.
     - `reassignEntry` (bin entry → other person): merge into the target
       person's existing same-task bin row if present (target row id survives).
3. `src/store/storage.ts` — `ensureStartMinutes`: within each person's bin
   group, merge duplicate rows per taskId (keep the lowest-sortIndex row's id,
   sum plannedHours, drop the rest), then renumber sortIndex 0..n. Must stay
   idempotent and return the same reference when nothing changed.
   `DATA_VERSION` stays 4 (idempotent normalize, no shape change).
4. `src/types.ts` — extend the `WorkloadEntry` doc comment with the two new
   invariants (one bin row per task+person; no adjacent same-task same-person
   dated blocks surviving a SET_BLOCK_TIME).
5. Mechanical updates to EXISTING tests so `npm test` stays green (do not delete
   coverage; adjust expectations to the new invariants and itemize each in your
   report). Expected touch points: `src/store/blockActions.test.ts`
   (SPLIT_BLOCK bin-row counts; SET_BLOCK_TIME shrink now merging into an
   existing bin row; SAVE_TASK `newUnassigned` merging; MOVE_BLOCK_TO_BIN /
   REASSIGN_ENTRY merge cases) and `src/store/storage.test.ts` (bin
   normalization now also merges per-task duplicates). NEW test coverage is a
   separate package (PKG-20260708-store-tests) — only adapt what breaks.

### Out of scope

- Any UI file (`WeekView.tsx`, `TaskModal.tsx`, pages, `styles.css`) — package 2.
- `INSERT_BLOCK` behavior (no adjacency merge there — decision 4).
- Budget enforcement in `SAVE_TASK` / AllocationGrid (decision 2).
- The `SAVE_TASK` `personId|date` collapse known issue (decision 6).
- New tests beyond keeping the existing suite green.
- `seed.ts` (no change needed).

## Implementation notes

- Follow the existing handler style: compute `without`/`updated` arrays, collect
  touched `dayKey`s, one `reindexDays` call, one `withActivity` append,
  rejections return `state` (reference equality is asserted in tests).
- Adjacency test: `blockEndMinutes(a.startMinutes, a.plannedHours) === b.startMinutes`
  (or symmetric). Only exact touching — a 15-min gap is NOT adjacent.
- Merge loop: after each merge re-scan the person's day for the surviving
  entry's task; bounded by the day's block count.
- Order inside `setBlockTime`: validate → collision check → task-period
  extension → apply geometry → budget consumption (grow) or bin emit (shrink) →
  adjacency merge → reindex → activity.

## Acceptance criteria

- [ ] Growing a block of a task with `estimatedHours: 10` whose entries already
      total 10h is rejected (same state reference) for any positive delta when
      the person has no same-task bin hours.
- [ ] Grow by 2h with a 1.5h same-task bin row and ≥0.5h headroom succeeds:
      the bin row is consumed (deleted at 0h), 0.5h comes from headroom, and the
      task total rises by exactly 0.5h — never past the estimate.
- [ ] Grow by 1h with a 4h same-task bin row succeeds with the bin row reduced
      to 3h and the task total unchanged (pure bin draw).
- [ ] Growing a block of a task with `estimatedHours: null` behaves exactly as
      today (free grow, no bin consumption).
- [ ] Shrinking merges the delta into an existing (task, person) bin row —
      the workload gains NO second bin row for that pair.
- [ ] After any covered action, no (taskId, personId) pair has two bin entries —
      including SPLIT_BLOCK ×4, repeated shrinks, `newUnassigned` with duplicate
      persons, MOVE_BLOCK_TO_BIN onto an existing row, and REASSIGN_ENTRY of a
      bin row onto a person who already has one.
- [ ] SET_BLOCK_TIME that lands a block exactly at another same-task same-person
      block's end (same day) yields ONE merged entry: earlier block's id, summed
      hours, correct startMinutes, contiguous sortIndex; activity message
      contains `połączono sąsiednie bloki`.
- [ ] Different-task or different-person touching blocks do NOT merge.
- [ ] `ensureStartMinutes` merges duplicate per-task bin rows, is idempotent
      (second run returns the same reference), and leaves clean data untouched.
- [ ] Move-only drags (hours unchanged) are never budget-rejected.
- [ ] `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green. Existing tests updated mechanically where the new
  invariants change expectations (itemize each edit). New tests land in
  PKG-20260708-store-tests. Do NOT start a second dev server (5173 is in use).

## Report back

Synthesized summary only: files changed one-line each, every existing-test edit
itemized with its reason, test pass/fail counts, deviations, deferrals. Append
to `handoffs/RUN-STATE.md` under the current run's Worker log. No raw logs.
