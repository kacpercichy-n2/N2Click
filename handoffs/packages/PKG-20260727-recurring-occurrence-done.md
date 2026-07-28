# Handoff: Per-occurrence "done" for recurring tasks (override `done` in `tasks.recurrence` jsonb)

- Package ID: PKG-20260727-recurring-occurrence-done
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium (touches canonical recurrence form enforced on three boundaries)
- Codex review: required — canonical-form change rides through storage repair, reducer and cloud hydration

## Goal

Zuzanna's ticket: marking one of ~25 daily recurring occurrences as done must not
mark the whole series. Add an optional `done` flag to the per-date
`RecurrenceOverride` (stored inside the EXISTING `tasks.recurrence` jsonb), a new
reducer action to toggle it, a presentational done state on the calendar
occurrence overlay, and unambiguous Polish labels for "this occurrence" vs
"whole series (task status)". Occurrences stay presentational (never
materialized, never feed totals/overload/collision — invariant 1).

## Wiki context

- `openwiki/n2hub/state-and-persistence.md` (sections CYKLICZNOŚĆ ZADAŃ + WYKONANE BLOKI)
- `openwiki/n2hub/scheduling-and-calendar.md` (recurring-occurrence overlay rules)
- `openwiki/n2hub/cloud-database.md` (`tasks.recurrence` jsonb entry)

## Expected touchpoints

- `src/types.ts` — `RecurrenceOverride` (~line 203): add `done?: true` + doc comment.
- `src/utils/recurrence.ts` — `normalizeOverride`, `expandOccurrences`,
  `RecurrenceOccurrence` (gains required `done: boolean`).
- `src/store/AppStore.tsx` — new action `SET_OCCURRENCE_DONE` (union near
  `SET_RECURRENCE_OVERRIDE` ~line 272, reducer case near ~2920, handler next to
  `setRecurrenceOverride` ~1018); small change inside `setRecurrenceOverride`
  (preserve `done` on time-shift upsert).
- `src/store/selectors.ts` — new `occurrenceIsDone(state, task, occurrence)`
  next to `blockIsDone` (~728).
- `src/components/WeekView.tsx` — `RecurBlockImpl` (~1234), `recurMenu` state
  (~1389), `openRecurMenu` (~1549), recurMenu JSX (~2352).
- `src/components/TaskModal.tsx` — override list labels (~1585–1592).
- `src/styles.css` — additive `.week-recur-block.done` rule near ~2064; reuse
  `.block-done-mark` (~2027).
- Tests: `src/utils/recurrence.test.ts`, `src/store/recurrenceActions.test.ts`,
  `src/store/selectors.test.ts`, `src/store/cloudMerge.test.ts`,
  `src/supabase/plannerData.test.ts` (extension only).

NO migration file. `tasks.recurrence` jsonb (20260721170000_task_recurrence)
already exists and is mirrored end-to-end; overrides are opaque jsonb content,
so no schema, RLS or `migrations.test.ts` change. Verified: the mirror sends the
field verbatim (`cloudMirror.ts` ~274 `recurrence: t.recurrence ?? null`),
hydration canonicalizes via `normalizeRecurrence` for published rows only
(`plannerData.ts` ~493), and `MERGE_CLOUD_ENTITIES` treats `recurrence` as an
opaque row value compared by `sameRowValue` (deep, key-order independent) inside
`reconcileRows` — the override rides the MERGE_CLOUD_ENTITIES tasks family with
reference-preserving semantics for free. Invalid-payload fail-close in
`mergeCloudEntities` is structural (collections/ids/periods) and unchanged.

DATA_VERSION: stays 7. Same reasoning as per-block done and recurrence itself:
`done` is an optional key inside an already-optional, additive field;
`normalizeTaskMeta` (storage.ts ~972) re-canonicalizes `recurrence` through
`normalizeRecurrence` on every load, legacy values without `done` round-trip
unchanged (idempotent, no echo-write).

## Invariants

1. Occurrences are NEVER materialized as `WorkloadEntry` rows and never feed
   totals/`dayTotal`/overload/collision/`packDayBlocks` (invariant 1). The new
   flag is presentational state only.
2. Invalid reducer input returns the SAME state reference (invariant 6),
   including every reject path of the new action and the untouched
   fail-close behavior of `MERGE_CLOUD_ENTITIES`.
3. Canonical recurrence form is enforced identically on all THREE boundaries
   (reducer, `normalizeTaskMeta`, cloud hydration) and stays idempotent by
   value — it is load-bearing for `sameRowValue` / reference-preserving merges.
4. `overridden` on `RecurrenceOccurrence` keeps its current meaning
   (time-shift replaced the rule's times). A done-only override renders
   `overridden: false` — the "Przywróć zgodnie z regułą" visibility rule in the
   recur menu must not change meaning.
5. No pointer/drag handlers on `.week-recur-block`; no change to any pointer
   lifecycle, bin drag or rendered-column hit-testing path (invariant 7).
6. `Task.statusId` is never changed by the per-occurrence toggle; a done task
   status still lights ALL occurrences (mirror of `blockIsDone`).
7. No new runtime dependencies; retirement mode untouched; all new user-facing
   strings in Polish.

## Scope

### 1. Canonical override shape (`src/types.ts` + `src/utils/recurrence.ts`)

`RecurrenceOverride` gains `done?: true` (canonically only the literal `true`,
mirroring `skip?: true`). The four canonical forms per date:

- `{ date, skip: true }` — skipped day. NEVER carries `done`: a skipped day has
  no occurrence, so `skip` wins and `done` is dropped (decided rule).
- `{ date, done: true }` — done-only (rule times unchanged). This must now be
  VALID — today `normalizeOverride` drops it.
- `{ date, startMinutes, durationMinutes }` — time-shift (as today).
- `{ date, done: true, startMinutes, durationMinutes }` — done + time-shift.

`done: false` (or any non-`true` value) is DROPPED, never stored.

`normalizeOverride` new logic (exact):
1. `date` must be a real occurrence date (unchanged reject).
2. `skip === true` → return `{ date, skip: true }` (done dropped).
3. `done = rec.done === true`.
4. Evaluate the time pair as today (grid, duration ≥ 15, start+duration ≤ 1440,
   DIFFERS from the rule). If valid-and-differing → keep both time fields;
   otherwise omit them (an equal-to-rule or invalid pair carries no
   information — it must NOT nuke a valid `done`).
5. Return `{ date, ...(done ? { done: true } : {}), ...(timeShift ?? {}) }`;
   if neither `done` nor a time-shift survives → `null` (drop).

Consequences to assert: idempotent round-trip for all four forms; a time-shift
equal to the rule WITH `done: true` collapses to `{ date, done: true }`;
garbage `done` values are dropped without invalidating the rest of the override.

`expandOccurrences`: `RecurrenceOccurrence` gains required `done: boolean`.
Collect a `doneDates: Set<string>` from overrides with `done === true` alongside
the existing skips/shifts pass (note: a done-only override has NO time fields,
so it currently falls through the `else if` — it must still land in
`doneDates`). Both shifted and unshifted occurrences get
`done: doneDates.has(date)`. `overridden` semantics unchanged (time-shift only).

### 2. Reducer (`src/store/AppStore.tsx`)

NEW action (chosen over extending `SET_RECURRENCE_OVERRIDE`, and justified):
`SET_RECURRENCE_OVERRIDE` has full-replacement semantics — its callers
(WeekView recur menu, TaskModal) pass a complete payload and `null` means
"restore to rule". Overloading it with partial-merge semantics would force every
existing call site to know the current `done` to avoid wiping it and would
complicate its no-op contract. A dedicated toggle mirrors the `SET_BLOCK_DONE`
precedent, keeps both diffs surgical and keeps invariant 6 no-op semantics
trivial.

```ts
| { type: 'SET_OCCURRENCE_DONE'; taskId: string; date: string; done: boolean }
```

Handler `setOccurrenceDone(state, taskId, date, done)` (place next to
`setRecurrenceOverride`, same style):

Reject paths — each returns the SAME state reference:
- unknown `taskId`;
- `task.recurrence === undefined`;
- `!isOccurrenceDate(rule, task.startDate, date)`;
- an existing `{ skip: true }` override on `date` (skipped day has no
  occurrence to mark; the UI cannot reach it — defense in depth);
- no-op: `done === true` while the date's override already has `done: true`, or
  `done === false` while the date has no override `done` (covered structurally
  by the `sameRowValue(rule, next)` guard, but list them as explicit test cases);
- structurally bad payload (non-boolean `done`, non-string date — TypeScript
  narrows most, keep the `sameRowValue` guard as the terminal no-op check).

Mutation: upsert the date's override PRESERVING an existing time-shift —
`done: true` → `{ date, done: true, ...(existing time-shift fields) }`;
`done: false` → remove the `done` key (if the override then carries neither
`skip` nor a time-shift, it disappears entirely). Implement exactly like
`setRecurrenceOverride`: build `nextOverrides`, run
`normalizeRecurrence({ ...rule, overrides: nextOverrides }, task.startDate)`,
guard `sameRowValue(rule, next)` → same reference, then map tasks with a fresh
`updatedAt` and `withActivity(state, 'task', taskId, done ?
'oznaczył(a) wystąpienie cyklicznego zadania jako zrobione' :
'cofnął(-ęła) wykonanie wystąpienia cyklicznego zadania')`.

Change inside `setRecurrenceOverride` (~1051): the time-shift branch must carry
forward an existing `done` for that date —
`nextOverrides = [...others, { date, ...(prevDone ? { done: true as const } : {}), startMinutes, durationMinutes }]`
where `prevDone` reads the replaced override's `done === true`. The skip branch
stays `{ date, skip: true }` (drops `done` by construction — canonical rule).
`override: null` still clears EVERYTHING for the date including `done`
(document in the JSDoc). New edge: a time-shift equal to the rule with
`prevDone` now normalizes to `{ date, done: true }` instead of removing the
override — the old "shift equal to rule = removal" comment must be updated.

Also verify (no code change expected): `setTaskRecurrence` ("edytuj wszystkie")
re-canonicalizes kept overrides through `normalizeRecurrence`, so `done`
survives a rule change automatically; `SAVE_TASK`'s startDate re-anchor
(~AppStore 642) likewise.

### 3. Selector (`src/store/selectors.ts`)

```ts
/** Wystąpienie jest zrobione, gdy jego wyjątek tak mówi LUB status zadania jest done. */
export function occurrenceIsDone(state: AppData, task: Task, occurrence: RecurrenceOccurrence): boolean {
  return occurrence.done === true || isDoneStatus(state, task.statusId);
}
```

Place directly under `blockIsDone` (~728), same doc style.

### 4. UI (`src/components/WeekView.tsx`, `src/components/TaskModal.tsx`, `src/styles.css`)

WeekView occurrence overlay (`RecurBlockImpl`):
- New memo-friendly prop `done: boolean`, computed by the parent as
  `occurrenceIsDone(state, task, occurrence)` (parent already holds `state`).
- When done: add `done` to the `className` list and render the existing
  checkmark span: `<span className="block-done-mark" title="Wykonane" aria-label="Wykonane">` —
  same markup as TimedBlock (~676). Append `" — zrobione"` to the tooltip.
- NO handler changes: click/keyboard still opens the task, right-click the menu.

CSS (additive only): `.week-recur-block.done { opacity: …; }` mirroring the
visual treatment of `.week-block.done` (~1899) — no changes to existing rules.

Recur context menu (`recurMenu` state + JSX ~2352):
- `recurMenu` state gains `done: boolean` — the occurrence's OWN override flag
  (`occ.done`), captured in `openRecurMenu`. Also capture
  `seriesDone: boolean` = `isDoneStatus(state, task.statusId)` at open time.
- Menu items (exact Polish strings), inserted after „Pomiń ten dzień”:
  - when `!seriesDone && !done`: **„Oznacz to wystąpienie jako zrobione”** →
    `dispatch({ type: 'SET_OCCURRENCE_DONE', taskId, date, done: true })`, close menu;
  - when `!seriesDone && done`: **„Cofnij wykonanie tego wystąpienia”** →
    same dispatch with `done: false`, close menu;
  - when `!seriesDone`: **„Oznacz całą serię jako zrobioną (status zadania)”** →
    `dispatch({ type: 'SET_TASK_STATUS', taskId, statusId })` where `statusId`
    is the FIRST status in `state.statuses` order with `isDone === true`
    (deterministic; guaranteed to exist by the ≥1-done invariant), close menu;
  - when `seriesDone`: render a single non-interactive hint row (reuse
    `context-menu-title`-style div, not a button):
    **„Cała seria jest zrobiona (status zadania)”** — per-occurrence toggling is
    hidden because it could not change what the user sees (status wins in
    `occurrenceIsDone`); un-doing the series stays in TaskModal via „Edytuj wszystkie”.
- Permission gating unchanged: the menu already opens only for
  `canManageTasks` (`openRecurMenu` early return).

TaskModal override list (~1585): a done-only override currently falls into the
time branch and would render „— 00:00, 0 h”. Fix labels:
- skip: unchanged („— pominięto”);
- done-only (`ov.skip !== true && ov.startMinutes === undefined`): „— zrobione”;
- time-shift (`ov.startMinutes !== undefined`): current time text, plus
  „ · zrobione” suffix when `ov.done === true`.
„Przywróć zgodnie z regułą” stays as-is (clears the whole override incl. done —
acceptable, it is the documented restore-to-rule semantic).

MonthView: out of scope (⟳ marker only, unchanged).

### 5. Tests (inseparable from the implementation)

`src/utils/recurrence.test.ts` (extend):
- `{date, done:true}` alone is valid and round-trips unchanged (idempotence);
- `done: false` / garbage `done` dropped; override left with nothing → dropped;
- `done` composes with a differing time-shift (all four canonical forms);
- `skip: true` + `done: true` input canonicalizes to `{date, skip:true}`;
- time-shift equal to the rule + `done: true` collapses to `{date, done:true}`;
- `expandOccurrences`: `done: true` only on its own date, other dates
  `done: false`; done-only occurrence has `overridden: false`; shifted+done
  occurrence has both flags. Update existing `toEqual` expectations for the new
  required `done` field.

`src/store/recurrenceActions.test.ts` (extend, new describe `SET_OCCURRENCE_DONE`):
- happy path: mark one date done → only that date's override changes, sibling
  occurrence dates unaffected (expand a window and assert per-date `done`);
- toggle done on a date WITH a time-shift preserves the shift; setting a
  time-shift via `SET_RECURRENCE_OVERRIDE` on a done date preserves `done`;
- `done: false` removes the key (override drops when empty);
- EVERY reject path returns the SAME reference: unknown taskId, no rule,
  non-occurrence date, skipped date, no-op true→true and false-when-absent;
- `override: null` (restore) also clears `done`.

`src/store/selectors.test.ts` (extend): `occurrenceIsDone` — own flag true /
task status done lights an un-flagged occurrence / neither → false.

`src/store/cloudMerge.test.ts` (extend the existing recurrence reference test
~876): a value-identical recurrence WITH a `done` override keeps the row
reference; a cloud-side `done` change produces a new row; an invalid payload
still returns the SAME state reference (existing block, re-assert).

`src/supabase/plannerData.test.ts` (extend the round-trip test ~360): the
canonical value including a `{date, done:true, startMinutes, durationMinutes}`
override survives mirror → hydration byte-identically.

Regression: `src/store/recurrenceActions.test.ts`, `src/utils/recurrence.test.ts`,
`src/store/cloudMerge.test.ts`, `src/store/storage.test.ts`,
`src/supabase/cloudMirror.test.ts` must stay green.

## Out of scope

- Any Supabase migration, RLS or `migrations.test.ts` change (none needed).
- DATA_VERSION bump (stays 7 — see rationale above).
- Materializing occurrences, WorkloadEntry writes, totals/overload/collision.
- MonthView, kanban, dashboards, TimelinePage.
- Changing `SET_BLOCK_DONE` / per-block done semantics.
- Calendar events (`CalendarEvent.recurrence`) — events have no done concept;
  `canonicalEventRecurrence` reuses `normalizeRecurrence`, so a stray `done`
  in an event override would now be preserved as canonical; this is harmless
  (presentational field never read for events) — do NOT special-case it.
- Touch/pointer/drag paths, `liveSyncGate`, browser-check scripts.

## Acceptance

- [ ] Marking one occurrence done marks ONLY that date; all other occurrences
      of the series render un-done (unit-tested via `expandOccurrences` +
      reducer test).
- [ ] Setting the task status to a done status still lights every occurrence
      (`occurrenceIsDone`), without touching overrides.
- [ ] The per-occurrence toggle never changes `Task.statusId`; the series item
      dispatches `SET_TASK_STATUS` only.
- [ ] All listed reject paths of `SET_OCCURRENCE_DONE` return the same state
      reference; `MERGE_CLOUD_ENTITIES` invalid-payload fail-close unchanged.
- [ ] Canonical form idempotent; `done:false` never stored; `skip` drops `done`;
      done survives rule edits and composes with time-shifts both ways.
- [ ] Done occurrence reuses `.block-done-mark` + additive `.done` class; no
      pointer/drag handler added to the overlay.
- [ ] Exact Polish strings as specified in Scope §4.
- [ ] TaskModal override list renders done-only overrides as „— zrobione”
      (no „00:00, 0 h” artifact).

## Verification

- Worker: `npx vitest run src/utils/recurrence.test.ts src/store/recurrenceActions.test.ts src/store/selectors.test.ts src/store/cloudMerge.test.ts src/supabase/plannerData.test.ts src/store/storage.test.ts src/supabase/cloudMirror.test.ts`
- Browser: none — the occurrence overlay has no pointer/drag path and no
  covered browser-check interaction changes; the context menu is plain React.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Overrides live inside the existing `tasks.recurrence` jsonb — deliberately no
  separate table/column; task-row RLS is inherited (cloud-database wiki).
- Per-block done precedent: additive optional flag, DATA_VERSION 7, "own flag
  OR done status" display rule (`blockIsDone`), `.block-done-mark` visuals.
- `skip` beats `done` (a skipped day has no occurrence).
- New dedicated `SET_OCCURRENCE_DONE` action instead of widening
  `SET_RECURRENCE_OVERRIDE` (smaller blast radius, trivial no-op contract).
- Series-done menu item picks the FIRST `isDone` status in `state.statuses`
  order (deterministic; existence guaranteed by the ≥1-done invariant).
- Wiki: after green, the CYKLICZNOŚĆ ZADAŃ section of
  `state-and-persistence.md` and the recurring-occurrence bullet of
  `scheduling-and-calendar.md` describe the canonical override forms and menu
  actions — both become stale and need a short update; final
  reviewer/orchestrator owns that adjudication.
