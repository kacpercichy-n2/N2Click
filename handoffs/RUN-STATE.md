# Run state — 20260721-154537-244 recurring tasks

## Goal

Recurring tasks in the calendar: `Task.recurrence` rule + per-date overrides,
pure `src/utils/recurrence.ts` expansion (window-only, never materialized),
TaskModal section „Cykliczność”, presentational occurrence blocks in
WeekView (context menu: edit one / edit all) and a MonthView marker, cloud
column `tasks.recurrence` (jsonb, RLS inherited from tasks).

## Packages

- `handoffs/packages/244-recurrence-core.md` — PKG-20260721-recurrence-core,
  tier: developer, ready. Model, util, reducer actions, storage repair, cloud
  mapping, migration `20260721170000_task_recurrence.sql`, tests, two wiki
  pages. Codex review required.
- `handoffs/packages/244-recurrence-ui.md` — PKG-20260721-recurrence-ui,
  tier: developer, ready, depends on core. TaskModal + WeekView overlay/menu +
  MonthView marker + scheduling wiki. High risk (invariant 7); Codex review
  required.

## Changed boundaries (planned)

- `src/types.ts`, `AppStore.tsx` (SET_TASK_RECURRENCE,
  SET_RECURRENCE_OVERRIDE), `storage.ts` (normalizeTaskMeta pass, version
  stays 7), `selectors.ts` (recurrenceOccurrencesForDate), new
  `utils/recurrence.ts`, `cloudMirror.ts`/`plannerData.ts`, new migration +
  `migrations.test.ts` registry (EXPECTED_POLICIES unchanged).
- UI: TaskModal, WeekView (additive overlay + recurMenu + one openSlotMenu
  guard), MonthView, styles.css.

## Dev log

- recurrence-core DONE. Added `TaskRecurrence`/`RecurrenceOverride`+Task field,
  `utils/recurrence.ts`, reducer `SET_TASK_RECURRENCE`/`SET_RECURRENCE_OVERRIDE`
  (invariant-6 same-ref), SAVE_TASK startDate re-anchor, storage repair,
  `recurrenceOccurrencesForDate` selector, migration `20260721170000`,
  cloudMirror/plannerData mapping, 2 wiki pages. `npm test` 1244 pass (+~50 new),
  `npm run build` green. Migration NOT applied to hosted Supabase. No context
  expansion beyond declared touchpoints.

- recurrence-ui DONE. TaskModal „Cykliczność" section (weekday chips/start/dur/
  until, explicit dispatch, no auto-save), WeekView additive `.week-recur-block`
  overlay + `recurMenu` (no pointer handlers; openSlotMenu `.week-recur-block`
  guard), MonthView `.month-cell-recur` ⟳, styles.css, scheduling wiki. Overlay
  rendered BEFORE packed.map so real blocks paint on top (deviation from "after")
  — avoids touching `.week-block` stacking. `npm test` 1244 pass, build green,
  browser-check-bin-drag/placement/bin-split all PASS (`topAtBlock=week-block`).
  No context expansion beyond declared touchpoints.

## Key settled decisions

- Recurrence embedded on Task (jsonb column, checklist/draftHours precedent);
  anchor = task.startDate, end = `until` only; overrides shift time or skip,
  never move the date; canonical form is load-bearing for merge no-ops; drafts
  cannot carry a rule; occurrences are presentational only, no drag.

## Verification

Focused vitest per core package; UI package runs full `npm test`, build and
`browser-check-bin-drag`. Migration NOT applied to hosted Supabase.

## Open questions

None blocking.
