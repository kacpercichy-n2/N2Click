# Handoff: Surface placement rejections in Polish (insert form, reassign control, schedule-form defaults)

- **Package ID:** PKG-20260713b-placement-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260713b-placement-core
- **Blast radius:** low — two components (`WeekView` context-menu insert form, `WorkloadPage` BlockRow) + optional one-line style additions. No reducer change.

## Goal

Every automatic-placement rejection introduced by the core package gets a persistent, pre-validated Polish reason in the UI that already hosts the interaction — following the existing "UI mirrors the reducer predicate one-for-one and disables the control" house pattern. No new global toast/notification systems.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx` (insert form derived values ~:1039-1072, form render `.context-insert-form` branch after ~:1457, schedule-form defaults `initScheduleForm` :980-991 and `onSchedDateChange` :1008-1015), `src/pages/WorkloadPage.tsx` (`BlockRow` :37-101), `src/styles.css` (only if a tiny class is genuinely needed — prefer existing `.context-warning`, `.muted`, `title` attributes).
- Patterns to copy: the „Zaplanuj część” form's first-failing blocking-warning chain (`WeekView.tsx:1085-1114` — exact style: reducer-order checks, one `schedWarning` string, shared `Disabled` flag driving both button and Enter path) and the insert form's snap-once `parsedHours` comment block (:1057-1072). Admin-page pattern for disabled controls: fixed Polish `title` on the disabled button.
- Core package exports you rely on: `planRippleInsert` and `findFreeStart` from `src/utils/time.ts` (pure). Read their final signatures in code before using them.
- ENVIRONMENT: unattended run. Bash allows `node`, `npm test`, `npx tsc --noEmit` ONLY. ALL git commands denied. No browser automation in this tier — the browser check is PKG-20260713b-placement-browser-docs.
- Reducer behavior after core (mirror, don't fork): INSERT_BLOCK rejects when (a) budget exceeded (existing `overAllowance`), (b) `planRippleInsert(dayBlocks, rawStart, dur) === null`, (c) widened task period > `MAX_TASK_PERIOD_DAYS`. REASSIGN_ENTRY (dated) rejects when `findFreeStart(targetDayBlocks, dur) === null`.

## Scope

### In scope

1. `WeekView.tsx` insert form — extend the derived-values section with two new BLOCKING checks, evaluated in reducer order after the existing `overAllowance` (first failing wins, exactly like the schedule chain):
   - Ripple fit: compute `rawStart` the way the reducer does (`before` → `menu.entry.startMinutes`; `after` → `blockEndMinutes(...)`), `dayBlocks` = `blocksForPersonDate(state, menu.entry.personId, menu.entry.date)`, and call `planRippleInsert`. `null` → warning `⚠ Wstawka nie mieści się w dobie — bloki za nią musiałyby wyjść poza 24:00.` and disable `Wstaw`.
   - 92-day cap: widen the PICKED task's (`insertTaskId || menu.entry.taskId`) period with `menu.entry.date` exactly like the reducer; if `inclusiveDayCount(...) > MAX_TASK_PERIOD_DAYS` → warning `⚠ Termin zadania przekroczyłby limit 92 dni.` (identical string to the schedule form :1110) and disable `Wstaw`.
   - Render via the existing `.context-warning` element pattern; keep the overload warning (`wouldOverload`) independent and NON-blocking (invariant 3). `confirmInsert` must consult the same combined disabled flag so Enter can never dispatch what the button refuses (existing convention, comment at :946-948).
2. `WorkloadPage.tsx` `BlockRow` — pre-validate the reassign target: for each option person compute `fits = findFreeStart(blocksForPersonDate(state, p.id, date), hoursToMinutes(entry.plannedHours)) !== null`; append ` — brak miejsca` to the option label when it doesn't fit (after the existing capacity text/⚠); when the SELECTED target doesn't fit, disable the `Przenieś` button with `title="Brak wolnego przedziału czasu w tym dniu u wybranej osoby."`. Mirror the predicate exactly — never dispatch a reassign the reducer will silently reject.
3. `WeekView.tsx` schedule-form default start (`initScheduleForm` :990 and `onSchedDateChange` :1014): prefer `findFreeStart(blocks, dur) ?? nextFreeStart(blocks, dur)` so the pre-filled suggestion avoids a collision whenever a real slot exists. The form's existing collision warning continues to handle the no-slot fallback — no new copy needed here.

### Out of scope (do NOT touch)

- The bin drag lifecycle in `WeekView.tsx` (BinDragState/listeners/projectPointer/cancelDrag/finishDrag/begin/ghost portal/dragRef), `TimedBlock` drag/resize, the `unplaceable` predicate and its hints, `user-select: none` — all UNTOUCHABLE (protected by browser-check-bin-drag scenarios).
- The schedule form's validation chain (:1085-1114) beyond the two default-start lines named above.
- Any reducer/selector/store file; any test file; TaskModal/AllocationGrid (deliberate-edit path keeps current policy — no warnings added there); onboarding; global toasts/modals; new dependencies.
- Existing Polish copy anywhere else. New strings are EXACTLY the three given above (plus the ` — brak miejsca` suffix).

## Implementation notes

- Compute the new insert-form checks only when `menu.step === 'form'` and inputs are parseable (NaN/≤0 hours stay silently disabled, as today).
- `planRippleInsert` needs `id`/`sortIndex` on day blocks — `blocksForPersonDate` returns full `WorkloadEntry` rows, so pass-through works.
- BlockRow already maps options with capacity math (:82-91) — extend that map; keep the existing `⚠` overload marker (warning-only) separate from the new hard `— brak miejsca` (blocking).
- Imports: `planRippleInsert`, `findFreeStart`, `blockEndMinutes` (WeekView already imports several time helpers — extend the lists); `MAX_TASK_PERIOD_DAYS`/`inclusiveDayCount` are already imported in WeekView; WorkloadPage needs `findFreeStart`, `hoursToMinutes`, `blocksForPersonDate` (check its current imports first).

## Acceptance criteria

- [ ] Right-click insert whose ripple can't fit the day: `Wstaw` disabled + the exact fit warning shown; fixing hours/position re-enables live.
- [ ] Right-click insert that would break the 92-day cap (pick a far-dated task in the picker): `Wstaw` disabled + the exact 92-day warning; picking a compatible task re-enables.
- [ ] A feasible insert dispatches and lands exactly as before (no behavior change on the happy path).
- [ ] Workload reassign: a target with no fitting slot shows ` — brak miejsca` in its option and a disabled `Przenieś` with the exact Polish title; a fitting target reassigns as before.
- [ ] Schedule-form default start suggestion never collides when a free slot exists; with no slot it behaves as today (collision warning visible, `Zaplanuj` disabled).
- [ ] Overload warnings remain non-blocking everywhere (invariant 3 intact).
- [ ] No UI path can dispatch an action the reducer would silently reject (parity like AdminPage guards).

## Tests

- Command: `npx tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors; full suite green with the test count left by the core+tests packages (no test files touched by you). Interactive verification is deferred to PKG-20260713b-placement-browser-docs — list your exact DOM hooks (classes, disabled states, title/warning strings) in your report for that package.

## Report back

Synthesized summary only: files changed one-line each, the exact rendered Polish strings + DOM hooks for the browser-check package, test/tsc results, deviations.
