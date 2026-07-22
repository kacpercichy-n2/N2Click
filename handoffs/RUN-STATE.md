# Run state — 20260721-194939-n2hub-245 events and meetings panel

## Goal

New additive `CalendarEvent` entity: create meetings from the calendar
right-click slot menu, render them in WeekView/MonthView in a distinct color
(purely presentational, invariant 7 untouched), manage them in a new
`/wydarzenia` panel with a URL-driven modal, persist as `AppData.events`
(DATA_VERSION stays 7), mirror to `public.events` (RLS, realtime publication)
and hydrate via optional `MERGE_CLOUD_ENTITIES.events`.

## Packages

- `handoffs/scheduler-reviews/20260721-194939-n2hub-245-architect-package.md` —
  PKG-20260721-events-panel, tier: developer, ready, Codex review required.
  Tests are inseparable from the implementation (no test-writer split).

## Changed boundaries (planned)

- `src/types.ts`, `AppStore.tsx` (ADD/SAVE/DELETE_EVENT + optional `events` in
  mergeCloudEntities), `commandValidation.ts`, `selectors.ts`
  (calendarEventsForDate), `storage.ts` (repairEvents, coerceArray, no version
  bump), `permissions.ts` (`events.manage`: administrator/pm/handlowiec).
- UI: WeekView slot menu + EventBlock, MonthView marker, styles.css
  (`--event-accent` = n2-info cyan), new EventsPage + EventModal
  (`?wydarzenie=`), App NAV/route, icons, dirtyRegistry scope `event-modal`.
- Cloud: new migration `20260721210000_events.sql` (org-open authenticated
  policies — handlowiec maps to cloud `worker`, so no is_manager gate;
  `attendee_ids uuid[]`, `recurrence` jsonb reusing `utils/recurrence.ts`),
  `migrations.test.ts`, `cloudMirror.ts` (tenth family), `plannerData.ts`.
  Migration file only — NOT applied to the hosted database.

## Verification

Focused vitest list in the package, then full `npm test` + `npm run build`.
Browser checks: none (no pointer-path changes allowed).

## Worker result (developer)

Implemented full package across all declared touchpoints. `npm test` PASS
(1295, +39 new); `npm run build` PASS. Browser check: playwright not installed
and package declared Browser=none (WeekView changes additive/presentational,
pointer/drag/hit-test untouched). 4 wiki pages updated. No deviations.

Reviewer blocker fixed: `EventModal.handleSubmit` now snaps times to the 15-min
grid and gates submit through authoritative `isValidEventDraft` — a rejected
draft shows an inline Polish error and keeps the modal open (no silent loss).
Added gate unit tests. `npm test` PASS (1299); `npm run build` PASS.

## PKG-per-block-done (247)

Additive `WorkloadEntry.done?` + `SET_BLOCK_DONE` reducer/validation (invariant 6:
unknown id & no-op keep same ref), `blockIsDone` selector, WeekView per-block tick,
TaskModal „Wykonane bloki” list (open-from-block highlight via `?block=`), cloud
round-trip (plannerData/cloudMirror) + migration `20260721220000_workload_entry_done`
(done boolean default false, no RLS change). DATA_VERSION stays 7. `npm test` PASS
(1308); `npm run build` PASS.

## PKG-filter-bar-pattern (248)

New dumb `src/components/FilterBar.tsx` composing FilterPanel + optional PersonFilter
slot + FilterPresets (now in-bar) + trailing counter, `data-tour` pass-through.
Projects/Tasks/Kanban swapped to it (Kanban PersonFilter moved below header). New
`.filter-toolbar` CSS (kept `.filter-bar` intact). Added FilterBar SSR composition
tests + projectsOfPerson/assigneeIdsOfTask edge cases. `npm test` PASS (1321);
`npm run build` PASS. No reducer/store changes.

## Open questions

None blocking.
