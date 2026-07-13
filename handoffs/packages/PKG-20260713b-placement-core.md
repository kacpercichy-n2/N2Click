# Handoff: Centralize free-slot placement + close INSERT_BLOCK/REASSIGN_ENTRY clamp-back and 92-day bypasses

- **Package ID:** PKG-20260713b-placement-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low-medium — reducer write paths for automatic block placement (INSERT_BLOCK, REASSIGN_ENTRY, SAVE_TASK new-pair) + two new pure helpers in `src/utils/time.ts`. No schema change, no migration change, no UI change (UI is PKG-20260713b-placement-ui).

## Goal

Automatically placed blocks (right-click ripple insert, cross-person reassign, new AllocationGrid rows) must never gain a hidden same-person overlap from end-of-day clamp-back, and INSERT_BLOCK must respect the existing 92-day task-period cap. Impossible automatic placement is rejected atomically (state unchanged, house convention); the deliberate-TaskModal-edit path stays non-blocking.

## Context the worker needs

- Relevant files: `src/utils/time.ts`, `src/store/AppStore.tsx` (`insertBlock` ~:691-807, `reassignEntry` ~:810-902, `saveTask` new-pair branch ~:415-433), `src/utils/dates.ts` (`MAX_TASK_PERIOD_DAYS`, `inclusiveDayCount` — already imported in AppStore).
- Conventions: CLAUDE.md (read fully — invariants 3, 4, 7, 8; the fixed-2026-07-12 SAVE_TASK reconciliation note). Reducer rejection = `return state` (same reference), no activity row.
- ENVIRONMENT: unattended run. Bash allows `node`, `npm test`, `npx tsc --noEmit` ONLY. ALL git commands denied — do not attempt. Do not commit. Production build only via `node -e "import('vite').then(v => v.build())"` if you need it (not required for this package).
- Verified bugs this package fixes (all confirmed by the architect against current code):
  1. `AppStore.tsx:731` — inserted block start = `clampBlockStart(rawStart, dur)`. "Dodaj po" on a ref ending near midnight clamps the new block BACK over the ref (the ripple sweep at :749-758 only pushes blocks ordered AFTER the inserted one, never the ref). "Dodaj przed" on a near-midnight ref can likewise clamp back over the preceding block. Hidden same-person overlap.
  2. `AppStore.tsx:752` — ripple push uses `clampBlockStart(cursor, ...)`: when pushed blocks would run past 24:00 they are clamped back onto each other — cascading end-of-day overlap instead of a refusal.
  3. `AppStore.tsx:786-793` — INSERT_BLOCK extends the picked task's period to cover `ref.date` with NO `MAX_TASK_PERIOD_DAYS` check (compare `setBlockTime` :961-972 which rejects at the same spot). Since the task picker can pick ANY task, this silently creates >92-day periods.
  4. `AppStore.tsx:867` — `reassignEntry` places the moved dated block at `nextFreeStart` of the target's day; on a nearly-full day `nextFreeStart`'s trailing `clampBlockStart` (time.ts:130) pulls it back into the target's existing blocks — hidden overlap — even when a free slot exists earlier in the day.
- Prior decisions (architect, final):
  - `nextFreeStart` is NOT removed or changed — `seed.ts` and the SAVE_TASK fallback keep using it, and its existing tests (`time.test.ts:107-121`) stay valid as raw-helper documentation.
  - SAVE_TASK may NEVER reject on placement (CLAUDE.md invariant 3: editor edits can create overlaps and never block) and the grow/trim/unchanged reconciliation paths (:441-484) are byte-for-byte protected (release-blocker fix of 2026-07-12). Only the NEW-pair `startMinutes` computation (:426) changes.
  - Rejected automatic placement returns the ORIGINAL state reference; the sibling UI package surfaces the Polish reason by mirroring the same predicates — do not add toasts/alerts here.

## Scope

### In scope

1. `src/utils/time.ts` — two new PURE, dependency-free, exported helpers (with doc comments in the file's existing style):
   - `findFreeStart(blocks: Array<{ startMinutes: number; plannedHours: number }>, durationMin: number): number | null`
     - Empty `blocks` → `clampBlockStart(WORKDAY_START_MIN, durationMin)` (identical to `nextFreeStart`).
     - Append-after-end preferred: compute `maxEnd` across blocks, snap UP to `MINUTE_STEP`; if `snapped + durationMin <= DAY_MINUTES` return `snapped` (identical to `nextFreeStart` whenever no clamp would occur — this preserves every current non-clamp placement).
     - Otherwise earliest-fit gap scan: candidate starts are `0`, `WORKDAY_START_MIN`, and each block's end snapped UP to `MINUTE_STEP`; try candidates `>= WORKDAY_START_MIN` in ascending order first, then candidates `< WORKDAY_START_MIN` ascending (prefer working hours, fall back to night slots); a candidate wins if `candidate + durationMin <= DAY_MINUTES` and `!hasCollision(blocks, candidate, durationMin)`.
     - No candidate fits → `null`. Never clamps into occupied time.
   - `planRippleInsert(dayBlocks: Array<{ id: string; startMinutes: number; plannedHours: number; sortIndex: number }>, insertStart: number, durationMin: number): Map<string, number> | null`
     - Reproduces `insertBlock`'s current sweep semantics EXACTLY except it never clamps: order = ascending `startMinutes`, the (virtual) inserted block sorts BEFORE existing blocks with an equal start, existing ties by `sortIndex`; walk blocks after the insert position pushing any block whose start < cursor to `cursor` (un-clamped), advancing cursor; untouched blocks past a big-enough gap stay put.
     - Returns `null` when the inserted block (`insertStart + durationMin > DAY_MINUTES`) or ANY pushed block would end past `DAY_MINUTES`; else a `Map<entryId, newStartMinutes>` containing only moved blocks.
2. `src/store/AppStore.tsx` — `insertBlock`:
   - Replace the clamp + inline sweep (:720-758, i.e. the `rawStart` clamp on the entry and the manual `moves` loop) with `planRippleInsert(dayBlocks, rawStart, dur)`; `null` → `return state`. On success the inserted entry's `startMinutes` is `rawStart` un-clamped and the returned map drives `shifted`.
   - Add the 92-day cap: in the task-extension block (:786-793), compute the widened `startDate`/`endDate` as today; if they differ from the task's and `inclusiveDayCount(startDate, endDate) > MAX_TASK_PERIOD_DAYS` → `return state` (whole action atomic — mirror `setBlockTime` :966-967). NOTE: perform this validation BEFORE building the returned object, alongside the other rejections, so no partial mutation path exists.
   - Keep untouched: budget/no-mint enforcement (:701-717), bin draw (:764-776), auto-assign (:780-785), activity message (:795-799), `reindexDays` call.
3. `src/store/AppStore.tsx` — `reassignEntry` dated branch (:857-871): replace the `nextFreeStart(...)` startMinutes computation with `findFreeStart(...)` over the same filtered list (`without` → target person + same date); `null` → `return state`. Bin branch (:822-855) and everything else untouched.
4. `src/store/AppStore.tsx` — `saveTask` new-pair branch (:415-433): `startMinutes: findFreeStart(dayList, durMin) ?? nextFreeStart(dayList, durMin)` — free slot preferred, clamp fallback kept so SAVE_TASK still NEVER rejects on placement (fallback overlap renders side-by-side per invariant 3). `dayList` = the existing `around.filter(...)` expression, computed once into a local.
5. Update the doc comment on `nextFreeStart` (time.ts) with one sentence pointing writers at `findFreeStart` for collision-safe automatic placement.

### Out of scope (do NOT touch)

- `SET_BLOCK_TIME`, `SCHEDULE_BIN_PART`, `SPLIT_BLOCK`, `MOVE_BLOCK_TO_BIN`, `MOVE_TASK`, `SET_TASK_DATES` — their guards are complete; do not duplicate validation or "improve" them.
- SAVE_TASK grow/trim/unchanged reconciliation (:441-484 incl. the :452 grow clamp), allocations validation, bin handling — protected release-blocker behavior. `saveTaskWorkload.test.ts` expectations at :207 and :287 must still pass UNCHANGED.
- `ensureStartMinutes` / `storage.ts` (migration keeps clamp policy), `seed.ts` (sample data exempt).
- Any UI file (`src/components/`, `src/pages/`) — that is PKG-20260713b-placement-ui.
- Existing tests: do not modify any test file (additions are PKG-20260713b-placement-tests). If an existing test fails, STOP and re-check your change — the architect verified none of the current suite blesses the reducer-level clamp-back you are removing.
- No new dependencies, no toast/notification system, no activity-log rows for rejections, no data-model/version change.

## Implementation notes

- `planRippleInsert`'s equal-start tie-break must match the current comparator (:740-745): inserted block first, then `sortIndex`. Represent the inserted block virtually (e.g. reserved id or a flag) — do not require callers to fabricate a sortIndex.
- `insertBlock`'s `rawStart` for "po" can be off-grid when the ref has legacy off-grid hours; current code does not snap it and neither should you (behavior-preserving; snapping is out of scope).
- `reassignEntry`: the target-day filter must exclude the moved entry itself (it already does via `without`) and bin rows are excluded naturally (`w.date === date`, dated).
- Rejections must not allocate/mutate before returning — follow the existing early-return shape.
- Keep both helpers free of store/React/date-fns imports (time.ts header contract).

## Acceptance criteria

- [ ] `findFreeStart` returns exactly `nextFreeStart`'s result in every case where `nextFreeStart` would not clamp (empty day, normal append); returns an earlier real free slot when append would clamp; returns `null` when no slot fits; never returns a colliding start.
- [ ] INSERT_BLOCK: "Dodaj po" whose insert or ripple would cross 24:00 → state returned unchanged (same reference); a fitting near-midnight insert (touching 24:00 exactly) still succeeds; no pushed block ever overlaps another after the action.
- [ ] INSERT_BLOCK: an insert that would widen the picked task's period past `MAX_TASK_PERIOD_DAYS` → state unchanged; within the cap → period extends exactly as before.
- [ ] REASSIGN_ENTRY (dated): appends to the target's day end when that fits (current behavior preserved); lands in an earlier free gap when the end doesn't fit; state unchanged (same reference) when the target's day cannot fit the block at all. Bin-entry reassign behavior byte-identical.
- [ ] SAVE_TASK: a new (person,day) cell on a day whose only occupancy is e.g. 20:00-24:00 lands at a free slot (08:00), not clamped into overlap; on a day with NO fitting gap it falls back to today's clamped placement and the save still succeeds (never rejected). Existing `saveTaskWorkload.test.ts` passes unmodified.
- [ ] All existing tests green, zero modified.

## Tests

- Command: `npx tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors; 11 files / 369 tests all green (current baseline), zero test files changed by you. New unit coverage is delivered by PKG-20260713b-placement-tests — coordinate via the helper signatures above, which are frozen.

## Report back

Synthesized summary only: files changed one-line each, exact helper signatures shipped, validation order inside `insertBlock` after the change, test/tsc results, deviations (should be none), anything the UI/tests packages must know (e.g. exported names).
