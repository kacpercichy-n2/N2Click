# Handoff: Add SCHEDULE_BIN_PART — atomic partial scheduling of a bin row

- **Package ID:** PKG-20260713-bin-split-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low — one new reducer action in `src/store/AppStore.tsx`; no schema change, no migration, no UI. It composes the existing `setBlockTime` path, so its guards are inherited, not forked.

## Goal

A single reducer action that schedules a user-chosen 0.25h-aligned part of a
bin (zasobnik) row onto a calendar day: atomically decrement the source bin row
and create ONE dated block, conserving total planned hours, reusing every
existing `SET_BLOCK_TIME` guard (date validity, 15-min grid, day fit, same-person
collision, 92-day period cap). This is what makes oversized (>24h) bin rows
recoverable — today no reducer path can take *part* of a bin row.

## Context the worker needs

- Relevant files: `src/store/AppStore.tsx` (only file you touch).
- Read first (do NOT modify): `setBlockTime` (AppStore.tsx ~920–1113),
  `splitBlock` (~1168–1222, note the `isBinEntry` no-op at ~1171 and its doc
  comment), `moveBlockToBin` (~1118–1158), `toQuarters` (~904),
  `nextSortIndex` (~219), `reindexDays`, `src/utils/time.ts` (`BIN_DATE`,
  `isBinEntry`, `HOURS_STEP`, `formatDuration`).
- Environment: `npm run dev` on :5173 may already be running (launch config
  `n2hub-dev`). Type-check `npx tsc --noEmit`; tests `npm test`; production
  build via `node -e "import('vite').then(v => v.build())"` (the vite CLI /
  `npm run build` may be permission-denied in unattended sessions). `git`
  commands are denied — do not attempt commits.
- CLAUDE.md is partially stale (it predates the local-login/access-role
  system). Trust the code over the doc.

### Root cause this fixes (architect-verified)

1. `SPLIT_BLOCK` deliberately no-ops on bin entries (AppStore.tsx:1171) because
   its remainder-aggregation design would need a second same-pair bin row,
   violating the one-bin-row-per-(taskId, personId) invariant.
2. The only bin→calendar path is a whole-row drag dispatching `SET_BLOCK_TIME`
   with the row's full `plannedHours` (WeekView `BinCard.finishDrag`), and
   `setBlockTime` correctly rejects `plannedHours > 24` (:938) and blocks that
   don't fit the day (:944). A 30h bin row is therefore permanently stuck.

### Prior decisions (final — do not reopen)

1. **Action shape:**
   `{ type: 'SCHEDULE_BIN_PART'; entryId: string; date: string; startMinutes: number; hours: number }`
   — `entryId` must reference a bin entry; `hours` is the part to schedule.
2. **No data-model change.** One-bin-row invariant preserved. The remainder
   keeps the ORIGINAL row object identity: same `id`, same `sortIndex` rank
   (bin rows all have `startMinutes: 0`, and `reindexDays` sorts by
   `(startMinutes, sortIndex)`, so decrementing `plannedHours` never reorders).
3. **Guard reuse by composition, not duplication:** build an intermediate
   workload (decrement/remove the source row + append a temporary bin sibling
   carrying the part with a fresh `uid()`), then delegate to the existing
   `setBlockTime` for that temporary entry. `setBlockTime` returns its input
   unchanged on any violation, so `next === intermediate` detects rejection and
   the ORIGINAL `state` is returned (house convention: state unchanged on
   violation, no activity row). The transient second same-pair bin row exists
   only inside the pure function on the success path, where `setBlockTime` has
   already dated it before the state escapes; on rejection the intermediate is
   discarded entirely. Nothing observable ever holds two bin rows for the pair.
4. **Hour math in quarter units** (`toQuarters`, like `SAVE_TASK`
   reconciliation): `remainingQ = toQuarters(entry.plannedHours) − toQuarters(hours)`.
   A legacy off-grid row (e.g. 5.1h) is thereby snapped to the quarter grid on
   its first partial schedule — deliberate; document it in the function comment.
5. **Full-amount scheduling goes through the SAME partial code path** (source
   row removed because `remainingQ === 0`, one new dated row created). Do NOT
   special-case it by moving the source row itself — uniform semantics: always
   ONE new dated row, bin row deleted exactly when it reaches zero.
6. **Adjacency merge is inherited:** `setBlockTime` may fuse the new block into
   an exactly-touching same-task same-person block (earlier block's id
   survives). Accepted and intentional — identical to a drag drop.
7. **Budget is untouched:** the delegated entry's `plannedHours` equals the
   `hours` argument, so `setBlockTime` sees neither grow nor shrink; total
   planned hours and `estimatedHours` are conserved by construction.
8. **Activity message:** `setBlockTime`'s existing `fromBin` message
   (`zaplanował(a) blok … z zasobnika na …`) fires; on success append to that
   last activity row: `; w zasobniku pozostało {formatDuration(remaining)}`
   when `remainingQ > 0`, else `; zasobnik opróżniony`.

## Scope

### In scope

- `src/store/AppStore.tsx`:
  - Add the `SCHEDULE_BIN_PART` member to the `Action` union (after
    `SPLIT_BLOCK`, ~line 175).
  - New handler `scheduleBinPart(state, entryId, date, startMinutes, hours)`
    placed in the "Bin (zasobnik) block handlers" section (after `splitBlock`),
    with a doc comment covering decisions 3–8 above. Validation order:
    1. entry exists and `isBinEntry(entry)` — else return `state`;
    2. `hours` finite, `HOURS_STEP ≤ hours ≤ 24`, quarter-aligned (same
       epsilon pattern as `setBlockTime` :941–942) — else return `state`;
    3. `toQuarters(hours) ≤ toQuarters(entry.plannedHours)` — else return `state`;
    4. build the intermediate (source decremented via quarters, or filtered
       out when `remainingQ === 0`; temp part row `{ id: uid(), taskId,
       personId, date: BIN_DATE, plannedHours: hoursQ * HOURS_STEP,
       startMinutes: 0, sortIndex: nextSortIndex(...) }` appended);
    5. `const next = setBlockTime(intermediate, partId, date, startMinutes, hoursQ * HOURS_STEP)`;
       `if (next === intermediate) return state;`
    6. append the remaining-hours suffix to the last activity row (decision 8)
       and return.
  - Wire the reducer `switch` case (after `SPLIT_BLOCK`, ~line 1771).
- Update the stale part of `splitBlock`'s doc comment (~1160–1166): it may keep
  saying SPLIT_BLOCK itself no-ops on bin entries, but add one line pointing at
  `SCHEDULE_BIN_PART` as the bin-row path.

### Out of scope

- Any UI (PKG-20260713-bin-split-ui owns WeekView and copy).
- Any change to `setBlockTime`, `splitBlock` behavior, `moveBlockToBin`,
  `insertBlock`, `SAVE_TASK`, selectors, `types.ts`, `storage.ts` (no version
  bump — no schema change), seed, styles.
- Dated-block split semantics (explicitly out of scope for the whole bundle).
- Tests beyond keeping the existing suite green (PKG-20260713-bin-split-tests
  owns new coverage).

## Implementation notes

- `setBlockTime`'s `touchedKeys` includes `dayKey(personId, BIN_DATE)` because
  the temp entry's `oldDate` IS `BIN_DATE` — the bin pair is reindexed for
  free, keeping the decremented row's contiguous `sortIndex`. Verify this in
  code before relying on it.
- Rejection must return the ORIGINAL `state` object (referential equality is
  asserted by the house test style `expect(next).toBe(state)`).
- `hoursQ * HOURS_STEP` (not the raw `hours` argument) is what you pass down
  and store, so float noise can't leak in.

## Acceptance criteria

- [ ] `SCHEDULE_BIN_PART` on a 30h bin row with `hours: 8` and a valid free
      slot produces: source row same `id`, `plannedHours` 22, still
      `date === ''`; exactly ONE new dated row (8h, requested date/start);
      task/person totals conserved; one activity row ending in
      `; w zasobniku pozostało 22h`.
- [ ] Repeating until the row reaches 0 deletes the bin row exactly at zero
      (last activity row ends `; zasobnik opróżniony`), never earlier.
- [ ] Rejections return the same state reference (no activity row): missing
      entry; dated (non-bin) entry; `hours` 0 / negative / NaN / off-grid /
      > 24; `hours` exceeding the row's remaining quarters; invalid or
      `BIN_DATE` target date; off-grid `startMinutes`; block not fitting the
      day; same-person collision; period extension past 92 days.
- [ ] A collision-free part dropped exactly touching a same-task block merges
      (inherited `setBlockTime` behavior) while the bin remainder is still
      decremented correctly.
- [ ] Task period extends when the target date lies outside it (inherited).
- [ ] No other action's behavior changes; no schema/version change.

## Tests

- Command: `npx tsc --noEmit && npm test` — run `npm test` once BEFORE your
  change to capture the current baseline (11 test files exist; RUN-STATE's
  10/343 predates the onboarding run), then confirm the identical file/test
  count after.
- Expected: 0 tsc errors; every existing test green; no new tests required in
  this package (the test-writer package adds them), but do not break
  `blockActions.test.ts`'s referential-equality assertions.
- Also run the production build once: `node -e "import('vite').then(v => v.build())"`.

## Report back

Synthesized summary only: files changed one-line each, the exact validation
order you implemented, test/tsc/build results, any deviation from decisions
1–8 (there should be none).
