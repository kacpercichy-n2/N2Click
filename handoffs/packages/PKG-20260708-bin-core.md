# Handoff: Unassigned-block ("bin") data model + reducer actions

- **Package ID:** PKG-20260708-bin-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — touches the persistence normalize pass, SAVE_TASK, and SET_BLOCK_TIME. All-local data, no external calls.

## Goal

Workload entries can exist WITHOUT a date ("unassigned", in a per-person bin):
same task+person+hours, no calendar day. Add the sentinel value, the load-time
normalization, the selectors, and every reducer action the bin UI (next package)
will dispatch. No UI in this package.

## Context the worker needs

- Relevant files: `src/types.ts`, `src/utils/time.ts`, `src/store/storage.ts`,
  `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/store/seed.ts`
- Docs: `CLAUDE.md` (invariants section — binding), `handoffs/RUN-STATE.md`
- Prior decisions (architect — do not re-litigate):
  1. **Sentinel, not nullable.** `WorkloadEntry.date` stays type `DateStr`
     (plain string); the empty string `''` means "unassigned / in the bin".
     No field is added or removed.
  2. **NO storage version bump.** `DATA_VERSION` stays 4. Rationale: the JSON
     shape is unchanged; `''` is a newly legal value that no existing v4 payload
     contains, and the idempotent load-time normalize pass covers any payload.
  3. Bin entries always have `startMinutes: 0` and a contiguous `sortIndex`
     per `(personId, '')` group (the bin order). `dayKey(personId, '')` is a
     valid group key — `reindexDays` and `nextSortIndex` already work with it.
  4. Bin hours do NOT count toward any daily total/overload (they match no real
     date — this falls out of the existing date-equality filters, verify, don't
     add code). They DO count in `taskPlannedTotal`, `projectPlannedTotal`,
     `personTotalHours` (accepted and intentional; no change needed there).
  5. Shrink-to-bin applies ONLY to the calendar resize path (`SET_BLOCK_TIME`
     with reduced hours). Editor (`SAVE_TASK`) hour reductions never create bin
     entries. Growing a block never consumes bin hours.
  6. Split rounding: hours are quarter-hour units. `Q = Math.round(plannedHours / 0.25)`,
     `base = Math.floor(Q / parts)`, `r = Q % parts`; the first `r` parts get
     `base + 1` quarters. Part 1 (the largest) STAYS on the original entry;
     parts 2..n become new bin entries. So 1.25h halved → 0.75h stays, 0.5h to
     bin; 1.25h quartered → 0.5h stays, 3 × 0.25h to bin.
  7. Polish activity strings are given verbatim below — use them exactly.

## Scope

### In scope

1. **`src/utils/time.ts`** — add (pure, no new imports):
   - `export const BIN_DATE = '';`
   - `export function isBinEntry(e: { date: string }): boolean` → `e.date === BIN_DATE`.
2. **`src/types.ts`** — update the `WorkloadEntry` comment block: document the
   `''` sentinel ("unassigned / bin"), `startMinutes: 0` for bin entries, and
   that `sortIndex` orders the bin per person.
3. **`src/store/storage.ts`** — extend `ensureStartMinutes` (keep the name):
   bin groups (key ends with `|` + empty date, i.e. `w.date === BIN_DATE`) are
   EXCLUDED from the 08:00 stacking rule; instead every bin entry is normalized
   to `startMinutes: 0` (patch only when ≠ 0) and the group's `sortIndex` is
   renumbered 0..n in existing `sortIndex` order (patch only entries whose index
   changes). Must stay idempotent and return the same reference when nothing
   changes.
4. **`src/store/AppStore.tsx`**:
   - `SaveTaskPayload` gains `newUnassigned?: Array<{ personId: string; hours: number }>`.
   - `saveTask` changes:
     a. The workload rebuild treats the task's existing BIN entries as
        pass-through: keep them unchanged when the person is still in
        `assigneeIds`, drop them when not. Only DATED entries of the task go
        through the existing rebuild logic (unchanged otherwise).
     b. After the rebuild, append each `newUnassigned` item (person must be in
        `assigneeIds`; hours via `snapHours`, skip ≤ 0) as
        `{ date: BIN_DATE, startMinutes: 0, sortIndex: nextSortIndex(..., personId, BIN_DATE) }`
        computed against the accumulated workload so multiple items for one
        person get consecutive indexes.
   - New action `MOVE_BLOCK_TO_BIN { entryId: string }`: dated entry → bin.
     Sets `date: BIN_DATE, startMinutes: 0`, sortIndex appended to the person's
     bin; `reindexDays` with keys `{dayKey(person, oldDate), dayKey(person, BIN_DATE)}`.
     No-op (state unchanged) when entry missing or already a bin entry.
     Activity (entity `task`): `przeniósł/przeniosła blok {h}h ({oldDate}) do zasobnika`.
   - New action `SPLIT_BLOCK { entryId: string; parts: 2 | 4 }`: reject
     (state unchanged) when entry missing or `plannedHours < parts * HOURS_STEP`.
     Apply decision 6: original entry keeps date/startMinutes/sortIndex with the
     first part's hours; remaining parts appended to the END of the person's bin
     in order (works for both dated and bin originals). Reindex the touched
     day + bin keys. Activity: `podzielił(a) blok {h}h na {parts} części (do zasobnika: {binSum}h)`.
   - New action `DELETE_BLOCK { entryId: string }`: deletes ONE entry, allowed
     ONLY for bin entries (dated entry or missing → state unchanged). Reindex
     the person's bin. Activity: `usunął/usunęła blok {h}h z zasobnika`.
   - `setBlockTime` (SET_BLOCK_TIME) changes:
     a. Shrink-to-bin: after all existing validations pass, when
        `plannedHours < entry.plannedHours`, ALSO append a bin entry for the
        same task+person with `delta = entry.plannedHours - plannedHours`
        (already grid-safe). Include the bin day key in the reindex set.
        Append to the resize activity message: `; {delta}h wróciło do zasobnika`.
     b. Bin→grid: when `entry.date === BIN_DATE` (source is the bin) the action
        already mostly works — verify the reindex keys cover the bin group and
        the task-period extension runs. Use a dedicated activity message:
        `zaplanował(a) blok {h}h z zasobnika na {date} {formatMinutes(start)}`.
   - Guards on existing actions (one-liners, use `isBinEntry`):
     - `moveTask` (MOVE_TASK): bin entries are NOT date-shifted (return `w`
       unchanged, don't touch their keys).
     - `setTaskDates` (SET_TASK_DATES): bin entries are KEPT (filter becomes
       `w.taskId !== taskId || isBinEntry(w) || inPeriod.has(w.date)`).
     - `insertBlock` (INSERT_BLOCK): reject when the ref entry is a bin entry.
     - `reassignEntry` (REASSIGN_ENTRY): when the entry is a bin entry, keep
       `date: BIN_DATE, startMinutes: 0` and append to the TARGET person's bin
       (do not call `nextFreeStart` for it).
5. **`src/store/selectors.ts`** — add pure selectors:
   - `binEntriesForPerson(state, personId): WorkloadEntry[]` — bin entries
     sorted by `sortIndex`.
   - `binEntriesForTask(state, taskId): WorkloadEntry[]` — bin entries of a task.
   - `binTotalForPerson(state, personId): number` — summed hours.
6. **`src/store/seed.ts`** — add ONE bin entry to the sample data so the bin is
   visible after "Load sample data": task t1, Ola, 3h,
   `{ date: BIN_DATE, startMinutes: 0, sortIndex: 0 }` (add a small
   `addBinWork(taskId, personId, hours)` helper or push directly; keep the
   existing `addWork` untouched).

### Out of scope

- ANY UI (WeekView, TaskModal, CSS) — next package.
- The pre-existing SAVE_TASK `personId|date` collapse issue for DATED cells
  (CLAUDE.md "Known issue") — do not attempt to fix it. Note: bin entries
  bypass the rebuild entirely, so multiple bin blocks per task+person survive
  saves by design.
- Consuming bin hours when a block grows; bin reordering; multi-user anything.
- `package.json`, test files (test-writer owns those), CLAUDE.md.

## Implementation notes

- Follow the existing handler style: pure functions + `withActivity` inside the
  same action; return `state` (same reference) on every rejection.
- `nextSortIndex(workload, personId, BIN_DATE)` works as-is for the bin.
- In `reindexDays`, bin entries all have `startMinutes: 0`, so ties fall back to
  the old `sortIndex` — bin order is stable. Rely on that; don't add code.
- Confirmed by the architect's audit (no changes needed, just don't break them):
  `hoursForPersonOnDate`, `entriesForDate`, `dayTotal`, `blocksForPersonDate`,
  `overloadedPeopleOnDate`, `conflictDatesForTask`, AllocationGrid's
  `baseHoursFor`, WorkloadPage/DashboardPage/PersonProfilePage day math — all
  filter by exact date equality and ignore `''` entries automatically.

## Acceptance criteria

- [ ] `BIN_DATE` / `isBinEntry` exported from `src/utils/time.ts`; no new deps.
- [ ] `ensureStartMinutes`: a payload containing bin entries with garbage
      `startMinutes`/gappy `sortIndex` loads with `startMinutes: 0` and
      contiguous bin `sortIndex`; a clean payload returns the same reference;
      dated-group behavior byte-identical to before.
- [ ] `SAVE_TASK` with `newUnassigned: [{personId, hours: 10}]` creates a bin
      entry; re-saving the task WITHOUT touching allocations preserves existing
      bin entries; unassigning a person drops their bin entries for that task.
- [ ] `MOVE_BLOCK_TO_BIN` empties the old day (contiguous sortIndex there) and
      appends to the bin; no-op on a bin entry.
- [ ] `SPLIT_BLOCK` on 1.25h with parts=2 → original 0.75h in place + one 0.5h
      bin entry; parts=4 on 1.25h → 0.5h + 3×0.25h in bin; parts=2 on 0.25h →
      state unchanged (reference equality).
- [ ] `SET_BLOCK_TIME` resize 8h→6h appends a 2h bin entry for the same
      task+person; a plain move (same hours) creates NO bin entry; bin→grid
      drop assigns date+start, extends the task period when needed (92-day cap
      still rejects), and reindexes both the bin and the target day.
- [ ] `DELETE_BLOCK` removes a bin entry and reindexes the bin; returns state
      unchanged for a dated entry.
- [ ] MOVE_TASK ±N days leaves bin entries untouched; SET_TASK_DATES keeps bin
      entries; INSERT_BLOCK rejects a bin ref.
- [ ] Every mutation writes its activity row via `withActivity` with the exact
      Polish strings above.
- [ ] Sample data seeds one 3h bin block for Ola on task t1.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: tsc clean; all 37 existing tests stay green (none assert bin
  behavior; if one breaks, report it — do not silently rewrite assertions);
  build succeeds. New unit tests are PKG-20260708-bin-tests (test-writer) — do
  not write them here.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md` (files changed one-line
each, test pass/fail, deviations). No raw logs.
