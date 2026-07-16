# State and persistence

## Boundaries

- `src/types.ts` owns persisted model types.
- `src/store/AppStore.tsx` is the sole reducer and mutation boundary.
- `src/store/selectors.ts` owns derived reads; pages must not duplicate them.
- `src/store/storage.ts` owns localStorage, migrations, validation/repair on
  load, save outcomes and the same-browser revision envelope.
- In supabase mode a diff-based cloud mirror (`src/supabase/cloudMirror.ts` +
  `src/supabase/plannerData.ts`, driven by `src/supabase/CloudSyncProvider.tsx`)
  sits BEHIND the reducer: it mirrors the six planner families
  (clients/projects/tasks/assignments/comments/activity) to Supabase from state
  diffs AFTER each action, and hydrates them on sign-in via the single
  `MERGE_CLOUD_ENTITIES` reducer action. localStorage stays the render source and
  recovery copy; workload never leaves the browser. Local mode: zero diff.

## Rules that change work

- Persisted dates are `yyyy-MM-dd`; use `src/utils/dates.ts`. `''` is allowed
  only for the bin (`BIN_DATE`) workload sentinel.
- Status completion comes from `Status.isDone`, never status order. At least one
  active and one done status must survive all status mutations.
- Task/project writes preserve existing valid behavior. Reducer commands that
  reject input must return the original state reference. This includes
  `MERGE_CLOUD_ENTITIES`: an invalid cloud payload returns the prior state
  reference; a valid merge replaces same-id rows, keeps local-only rows and
  never touches workload/people/statuses/milestones/savedFilters (by reference).
- `SAVE_TASK` reconciles workload by identity-preserving deltas. Do not replace
  all workload rows when editing a task.
- `saveData` reports success or a classified failure. Failed persistence must
  never surface as `Zapisano` and same-browser conflicts must remain explicit.
- Storage loading is fail-closed. A missing key starts with empty data, but
  unavailable, malformed or structurally invalid stored data must reach the
  recovery screen without replacing the raw payload. The user can export that
  payload before resetting it.
- Successful migrations and deterministic repairs are written back once so
  repaired IDs remain stable. A clean current-version load must not echo-write.
- Workload repaired on load still obeys the day boundary and 0.25-hour grid.
  Positive off-grid hours are snapped to the grid; dated rows above 24 hours
  move to the bin instead of being silently truncated. Non-finite, null or
  non-positive stored hours fail closed.

## Start here for

- reducers, validation, activities, statuses, projects, tasks, people;
- localStorage migrations, write failures, tab conflicts and recovery UI;
- selectors, derived planning/completion/overload state.

## Relevant tests

`src/store/activityAttribution.test.ts`, `blockActions.test.ts`,
`commandValidation.test.ts`, `cloudMerge.test.ts`,
`saveTaskWorkload.test.ts`,
`selectors.test.ts`, `statusActions.test.ts`, `storage.test.ts`,
`dateGuards.test.ts`, `taskMeta.test.ts`. Cloud mirror: `src/supabase/
cloudMirror.test.ts`, `plannerData.test.ts`, `migrations.test.ts`.
