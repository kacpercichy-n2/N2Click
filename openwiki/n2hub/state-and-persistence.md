# State and persistence

## Boundaries

- `src/types.ts` owns persisted model types.
- `src/store/AppStore.tsx` is the sole reducer and mutation boundary.
- `src/store/selectors.ts` owns derived reads; pages must not duplicate them.
- `src/store/storage.ts` owns localStorage, migrations, validation/repair on
  load, save outcomes and the same-browser revision envelope.

## Rules that change work

- Persisted dates are `yyyy-MM-dd`; use `src/utils/dates.ts`. `''` is allowed
  only for the bin (`BIN_DATE`) workload sentinel.
- Status completion comes from `Status.isDone`, never status order. At least one
  active and one done status must survive all status mutations.
- Task/project writes preserve existing valid behavior. Reducer commands that
  reject input must return the original state reference.
- `SAVE_TASK` reconciles workload by identity-preserving deltas. Do not replace
  all workload rows when editing a task.
- `saveData` reports success or a classified failure. Failed persistence must
  never surface as `Zapisano` and same-browser conflicts must remain explicit.

## Start here for

- reducers, validation, activities, statuses, projects, tasks, people;
- localStorage migrations, write failures, tab conflicts and recovery UI;
- selectors, derived planning/completion/overload state.

## Relevant tests

`src/store/blockActions.test.ts`, `saveTaskWorkload.test.ts`,
`selectors.test.ts`, `statusActions.test.ts`, `storage.test.ts`,
`dateGuards.test.ts`, `taskMeta.test.ts`.
