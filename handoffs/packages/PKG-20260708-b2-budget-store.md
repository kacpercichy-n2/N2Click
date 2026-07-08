# Handoff: Close every store-side hour-minting path (budget enforcement round 2)

- **Package ID:** PKG-20260708-b2-budget-store
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — reducer semantics for calendar hour creation change; existing tests will break and must be adapted.

## Goal

The task's planned time is THE budget. Calendar-side actions (`SET_BLOCK_TIME` grow, `INSERT_BLOCK`) must NEVER create hours out of thin air: they may only draw from the person's same-task bin row and — for tasks with an estimate — the task's remaining headroom. Tasks with `estimatedHours === null` lose their unlimited drag-grow: their calendar-side allowance is bin hours only.

## Context the worker needs

- Relevant files: `src/store/selectors.ts` (L281-344: `binEntryForTaskPerson`, `binHoursForTaskPerson`, `taskBudget`, `growAllowanceHours`), `src/store/AppStore.tsx` (`setBlockTime` ~L738-927, `insertBlock` ~L539-624), `src/components/WeekView.tsx` (ONLY the two mechanical lines ~L163-164), `src/store/blockActions.test.ts`, `src/store/selectors.test.ts`.
- Conventions: CLAUDE.md (read fully). Hours in 0.25 steps; integer-quarter math via the existing `toQuarters` helper in AppStore.tsx; activity rows appended inside the same action via `withActivity`; Polish activity strings.
- Prior decisions (architect — final, do not re-open):
  1. **Unified allowance formula.** For a `(taskId, personId)` pair: `allowance = binHoursForTaskPerson(state, taskId, personId) + (estimate === null ? 0 : headroom)` where `headroom = max(0, estimate − totalAll)` (existing `taskBudget`). This replaces the old "null estimate ⇒ unlimited" rule. A number is ALWAYS returned — `null` is gone from the contract.
  2. **Bin-first consumption** everywhere (existing `setBlockTime` pattern): draw from the bin row up to its hours, delete the row at 0, remainder comes from headroom (budgeted tasks only, no row change — the task total simply rises toward the estimate).
  3. **Moving never mints** — unchanged-hours moves/drops (including bin→grid drops via `SET_BLOCK_TIME`) are never budget-checked. Shrink→bin-return behavior is unchanged.
  4. **TaskModal paths stay uncapped at the store level** (`SAVE_TASK`, its `newUnassigned` bin adds) — deliberate re-planning happens there; the UI package adds a non-blocking warning. Do NOT add enforcement to `saveTask`.
  5. The known `SAVE_TASK` `personId|date` collapse issue stays untouched (CLAUDE.md).

## Scope

### In scope

1. `src/store/selectors.ts`:
   - Add `taskGrowAllowance(state, taskId: string, personId: string): number` implementing decision 1 (pure, exported, JSDoc explaining the budget model).
   - Rewrite `growAllowanceHours(state, entryId): number` to delegate: look up the entry, return `taskGrowAllowance(state, entry.taskId, entry.personId)`; missing entry ⇒ 0. **Return type becomes `number` (drop `| null`)**; update the JSDoc (the "null ⇒ unlimited" paragraph is now false).
2. `src/store/AppStore.tsx` — `setBlockTime` grow enforcement (~L807-819): remove the `task.estimatedHours !== null` condition; compute `headroomQ = task.estimatedHours === null ? 0 : Math.max(0, toQuarters(task.estimatedHours) − totalAllQ)` and keep the existing reject (`growDeltaQ > binSameQ + headroomQ` ⇒ return state) and bin-first draw (`takenFromBinQ = min(growDeltaQ, binSameQ)`) for ALL tasks. Existing activity suffixes (`pobrano z zasobnika`, `wróciło do zasobnika`) unchanged.
3. `src/store/AppStore.tsx` — `insertBlock` budget draw (after snapping `hours`, before building the entry):
   - Compute the allowance in quarters for `(payload.taskId, ref.personId)` per decision 1 (bin row = the single bin entry for that pair; note it may differ from `ref.taskId` when the picker chose another task).
   - Reject (`return state`) when `toQuarters(hours) > binQ + headroomQ`. This is the safety net; the UI package adds the live warning/disable.
   - Consume bin-first: decrement that bin row by `min(hoursQ, binQ)` (delete at 0), mirroring the `setBlockTime` grow branch; add `dayKey(ref.personId, BIN_DATE)` to the reindex key set when the bin row changed.
   - Append `; pobrano z zasobnika: {formatDuration(takenQ * HOURS_STEP)}` to the activity message when hours were drawn from the bin.
4. `src/components/WeekView.tsx` ~L163-164 (mechanical only, to keep tsc green): `growAllowanceHours` no longer returns null — `const maxHours = baseHours + growAllowanceHours(state, entry.id);` and fix the stale comment. No other WeekView changes (they belong to PKG-20260708-b2-calendar-ui).
5. Adapt existing tests that the new semantics break — preserve each test's original intent:
   - `blockActions.test.ts`: the default `makeTask` fixture has `estimatedHours: null`, so the INSERT_BLOCK suites (~L221-320, ~L700+) currently mint freely. Give those fixtures budget (an estimate with sufficient headroom, or a same-person same-task bin row) so the original ripple/assignment/period assertions still hold unchanged.
   - `blockActions.test.ts` ~L848 "estimatedHours: null grows freely…" — rewrite to the new contract: null-estimate grow succeeds up to the same-task bin hours (bin row drained) and is rejected past them.
   - `selectors.test.ts` `growAllowanceHours` null-estimate case — now expects the person's bin hours (a number), not `null`.
   - Do NOT add broad new coverage here — that is PKG-20260708-b2-tests. Add only what's needed to keep the suite green plus the rewritten regression test above.

### Out of scope

- WeekView UI (clamp feedback, insert-form warning, bin drag ghost) — PKG-20260708-b2-calendar-ui.
- TaskModal / AllocationGrid / SAVE_TASK warnings or caps.
- Impersonation (separate package). New test coverage beyond keeping the suite green.

## Implementation notes

- Keep all budget math in integer quarters (`toQuarters`) — never float-compare hours.
- `insertBlock` currently returns early for `hours <= 0` and bin refs; insert the budget check after the snap so the checked value is the stored value.
- In `insertBlock`, the bin decrement must be applied to the same `shifted`/workload array that receives the new entry — watch ordering so `reindexDays` sees the final rows.
- The bin row consumed by `insertBlock` is dateless (`BIN_DATE`) — draining it cannot collide with the ripple sweep (which only touches `ref.date` rows), but keep the decrement before `reindexDays`.

## Acceptance criteria

- [ ] `taskGrowAllowance` exported; `growAllowanceHours` returns `number` (never null) and delegates to it.
- [ ] `SET_BLOCK_TIME` grow on a null-estimate task: allowed up to the same-person same-task bin hours (bin drained bin-first, row deleted at 0), rejected (state unchanged, same reference) past them.
- [ ] `SET_BLOCK_TIME` budgeted-task behavior byte-identical to before (bin+headroom, bin-first) — existing tests at ~L777-846 pass unmodified.
- [ ] `INSERT_BLOCK` rejects (same state reference) when snapped hours exceed bin+headroom (headroom 0 for null-estimate tasks); within allowance it drains the bin row first and appends the `pobrano z zasobnika` suffix when it does.
- [ ] `INSERT_BLOCK` ripple/push, auto-assign, and period-extension behavior otherwise unchanged.
- [ ] Moving a block (same hours) and shrinking are never budget-rejected.
- [ ] No new file reads localStorage; no UI changes beyond the two mechanical WeekView lines.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: tsc clean; vitest green with adapted fixtures (count may shift slightly from 157 due to the rewritten regression test — report the exact count); build OK (pre-existing chunk-size warning only).

## Report back

Synthesized summary only (files changed one-line each, every existing-test adaptation listed with its reason, test pass/fail counts, deviations). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs.
