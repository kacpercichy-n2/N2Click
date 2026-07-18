# State and persistence

## Boundaries

- `src/types.ts` owns persisted model types.
- `src/store/AppStore.tsx` is the sole reducer and mutation boundary.
- `src/store/selectors.ts` owns derived reads; pages must not duplicate them.
- `src/store/storage.ts` owns localStorage, migrations, validation/repair on
  load, save outcomes and the same-browser revision envelope.
- In supabase mode a diff-based cloud mirror (`src/supabase/cloudMirror.ts` +
  `src/supabase/plannerData.ts`, driven by `src/supabase/CloudSyncProvider.tsx`)
  sits BEHIND the reducer: it mirrors EIGHT planner families
  (clients/projects/milestones/tasks/assignments/workload/comments/activity) to
  Supabase from state diffs AFTER each action, and hydrates them on sign-in via
  the single `MERGE_CLOUD_ENTITIES` reducer action. Workload entries (planned
  hours + calendar/bin) and milestones now go cloud too — the "workload never
  leaves the browser" rule is retired. Only per-user saved filters, people
  administration, dictionary/status mutations and sample/reset stay local.
  Constraint-violation write errors (23502/23503/23505/23514) drop the op with
  the Polish permission notice rather than stalling the retry queue. Local mode:
  zero diff.
- Retirement gate (supabase mode only). After an admin runs the reversible
  handshake in `MigrationStatusPanel` (coverage clean → snapshot read → probe
  write/read/remove → backup downloaded; the probe is a far-past DATED row
  `PROBE_WORK_DATE` to dodge the `workload_entries_bin_pair` NULL-only partial
  unique index, with a pre-probe cleanup remove clearing any orphan), the org
  flag `local_writes_retired`
  lands in `public.app_settings` and a per-browser cache marker on the dedicated
  key `n2hub.cloudMigration.v1` (via `storage.ts` helpers, OUTSIDE the planner
  key; `clearData()` never touches it). `src/store/persistGate.ts`
  (`shouldSkipLocalPersist`) then lets a mirrored-only state transition skip the
  per-action `saveData` ONLY while the cache marker is enabled, Supabase env is
  configured and the mirror is verified-healthy right now
  (`setCloudMirrorHealthy`). Any change to a non-mirrored collection, any mirror
  degradation (transient error, hydration failure, sign-out, idle) or local mode
  resumes per-action local writes automatically. While retired, localStorage is
  still refreshed as a passive, never-deleted recovery copy on hydration, queue
  drain, transient error, `pagehide` with pending ops, and whenever a diff yields
  unmappable-row diagnostics (those rows never reach the cloud, so they are forced
  to localStorage); the same-browser storage/conflict protocol keeps firing on
  every real divergence — a skipped per-action write marks memory dirty
  (`wasLocalPersistSkipped`) so an external tab write raises an explicit conflict
  rather than silently replacing state. A failed save never reports `Zapisano`;
  skipping leaves `saveError` unchanged.

## Rules that change work

- Persisted dates are `yyyy-MM-dd`; use `src/utils/dates.ts`. `''` is allowed
  only for the bin (`BIN_DATE`) workload sentinel.
- Status completion comes from `Status.isDone`, never status order. At least one
  active and one done status must survive all status mutations.
- Task/project writes preserve existing valid behavior. Reducer commands that
  reject input must return the original state reference. This includes
  `MERGE_CLOUD_ENTITIES`: an invalid cloud payload (including an off-grid or
  dangling workload row, or a milestone with a bad date/missing project) returns
  the prior state reference; a valid merge replaces same-id rows, keeps local-only
  rows and reconciles a duplicate bin pair to the cloud-id row with grid-snapped
  summed hours. It never touches people/statuses/savedFilters/dictionaries (by
  reference); workload and milestones ARE now merged.
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
`dateGuards.test.ts`, `taskMeta.test.ts`, `persistGate.test.ts` (retirement
gate). Cloud mirror: `src/supabase/cloudMirror.test.ts`, `plannerData.test.ts`,
`migrationStatus.test.ts` (coverage + handshake), `migrations.test.ts`.
