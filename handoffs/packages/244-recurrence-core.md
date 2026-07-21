# Handoff: Add task recurrence model, reducer, storage repair and cloud column

- Package ID: PKG-20260721-recurrence-core
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — new reducer surface + cloud column mapping

## Goal

`Task.recurrence` (rule + per-date overrides) exists end to end: TypeScript
model, pure expansion util `src/utils/recurrence.ts`, two reducer actions with
invariant-6 validation, storage repair (DATA_VERSION stays 7), a presentational
selector, and cloud persistence via a new jsonb column `tasks.recurrence`
(forward-only migration, cloud-authoritative hydration). No UI in this package.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/cloud-database.md`

## Expected touchpoints

- `src/types.ts` (Task + new interfaces)
- `new: src/utils/recurrence.ts`
- `new: src/utils/recurrence.test.ts`
- `src/store/AppStore.tsx` (Action union + reducer cases)
- `new: src/store/recurrenceActions.test.ts`
- `src/store/storage.ts` (`normalizeTaskMeta`) + `src/store/storage.test.ts`
- `src/store/selectors.ts` (+ a test block, in `recurrenceActions.test.ts` or `selectors.test.ts`)
- `src/supabase/cloudMirror.ts` (`taskRow`) + `cloudMirror.test.ts`
- `src/supabase/plannerData.ts` (tasks select + hydration) + `plannerData.test.ts`
- `src/store/cloudMerge.test.ts` (one reference-preservation case)
- `new: supabase/migrations/20260721170000_task_recurrence.sql`
- `src/supabase/migrations.test.ts` (file list; EXPECTED_POLICIES unchanged)

## Invariants

- Invariant 1: planned hours live only in `WorkloadEntry`. Occurrences are
  NEVER materialized as workload rows and NEVER feed `dayTotal`,
  `hoursForPersonOnDate`, availability, overload or collision checks.
- Invariant 2: the 92-day task-period cap is untouched; recurrence has its own
  `until` bound and never routes through `periodError`.
- Invariant 6: every invalid command below returns the SAME state reference.
- Invariant 7: no calendar pointer/drag file is touched in this package.
- `MERGE_CLOUD_ENTITIES` reference preservation: a value-identical task with a
  recurrence must keep its object identity (canonical form is load-bearing).
- Data version stays 7; the field is additive (precedent: `isDraft`,
  `draftHours`, `Project.documents`). A clean current-version load must not
  echo-write.

## Scope

### 1. Model (`src/types.ts`)

```ts
export interface RecurrenceOverride {
  // ORIGINAL occurrence date (yyyy-MM-dd); unique within overrides. Overrides
  // never move an occurrence to another day — they shift time or skip the day.
  date: DateStr;
  skip?: true;              // canonical: key present only as literal true
  startMinutes?: number;    // time-shift form: BOTH time fields present
  durationMinutes?: number;
}

export interface TaskRecurrence {
  daysOfWeek: number[];     // ISO 1 (Mon) … 7 (Sun); deduped, sorted asc, non-empty
  startMinutes: number;     // 0..1425, multiple of 15
  durationMinutes: number;  // 15..1440, multiple of 15; start + duration <= 1440
  until?: DateStr;          // inclusive end; key ABSENT = open-ended
  overrides?: RecurrenceOverride[]; // key ABSENT when empty; sorted by date asc
}

// On Task (after draftHours):
recurrence?: TaskRecurrence;
```

CANONICAL FORM (enforced by reducer, storage repair and cloud hydration —
required for `sameRowValue`/reference-preserving merge):
- `recurrence` key present ONLY when a valid rule exists; NEVER on a draft task
  (`isDraft === true`) and NEVER when `task.startDate` is not a valid date.
- `until` key present only when a valid `yyyy-MM-dd` ≥ `task.startDate`.
- An override is either `{ date, skip: true }` (no time keys) or
  `{ date, startMinutes, durationMinutes }` with both on the 15-min grid,
  duration ≥ 15, start + duration ≤ 1440, and the pair DIFFERENT from the base
  rule (an override equal to the rule is dropped, not stored).
- Every override `date` must be an occurrence date of the rule
  (weekday ∈ daysOfWeek, date ≥ task.startDate, date ≤ until when present);
  others are dropped. Duplicate dates: first wins.

### 2. Pure util `src/utils/recurrence.ts` (no external deps, RRULE-lite;
reusable by a future events feature — no imports from store/components, only
`utils/dates` + `utils/time` constants)

```ts
export interface RecurrenceOccurrence {
  date: DateStr;
  startMinutes: number;
  durationMinutes: number;
  overridden: boolean; // true when a time-shift override applied
}

/** ISO weekday 1..7 (Mon..Sun) of a yyyy-MM-dd date. */
export function isoWeekday(date: DateStr): number;

/** Rule WITHOUT overrides from untrusted input; null when invalid. */
export function normalizeRecurrenceRule(
  raw: unknown,
  anchorStart: DateStr,
): Omit<TaskRecurrence, 'overrides'> | null;

/** Full canonical value (rule + overrides) from untrusted input; undefined =
 *  drop the key. Shared by storage repair, cloud hydration and the reducer.
 *  Idempotent by value. */
export function normalizeRecurrence(
  raw: unknown,
  anchorStart: DateStr,
): TaskRecurrence | undefined;

/** True when `date` lands on the rule pattern (ignores overrides/skip). */
export function isOccurrenceDate(
  rule: TaskRecurrence,
  anchorStart: DateStr,
  date: DateStr,
): boolean;

/** Expand to occurrences within [from..to] inclusive, ONLY for that window
 *  (never materialize ahead). Applies overrides: skip removes the date,
 *  time-shift replaces start/duration. Defensive cap: a window longer than
 *  400 days is clamped from `from`. from > to => []. */
export function expandOccurrences(
  rule: TaskRecurrence,
  anchorStart: DateStr,
  from: DateStr,
  to: DateStr,
): RecurrenceOccurrence[];
```

### 3. Reducer actions (`src/store/AppStore.tsx`)

```ts
| { type: 'SET_TASK_RECURRENCE'; taskId: string;
    recurrence: { daysOfWeek: number[]; startMinutes: number;
                  durationMinutes: number; until?: string } | null }
| { type: 'SET_RECURRENCE_OVERRIDE'; taskId: string; date: string;
    override: { skip: true }
             | { startMinutes: number; durationMinutes: number }
             | null }
```

`SET_TASK_RECURRENCE` ("edytuj wszystkie" / rule create / clear):
- Reject (same reference): unknown taskId; task is a draft; `task.startDate`
  invalid; `normalizeRecurrenceRule` returns null (empty/out-of-range
  daysOfWeek, off-grid or non-finite times, duration ≤ 0, start+duration >
  1440, `until` invalid or < startDate).
- `recurrence: null` clears the rule AND its overrides.
- Rule replace PRESERVES existing overrides then re-canonicalizes them against
  the new rule via `normalizeRecurrence` (stale dates and now-equal time
  shifts drop out). Saving a value-identical rule+overrides is a no-op (same
  reference).
- Wrap in `withActivity` like other task mutations (Polish message, e.g.
  „zmieniono cykliczność zadania”).

`SET_RECURRENCE_OVERRIDE` ("edytuj to wystąpienie"):
- Reject (same reference): unknown taskId; task has no `recurrence`; `date` is
  not an occurrence date (`isOccurrenceDate`); time-shift payload off-grid /
  duration < 15 / start+duration > 1440; structurally wrong payload.
- `override: null` removes the override for `date` (restore rule); no-op if
  none exists (same reference).
- Time-shift equal to the base rule pair = remove the override (canonical).
- Upsert is by `date`; result re-sorted by date asc.

`SAVE_TASK` keeps `recurrence` of an existing task untouched (like `isDraft`),
EXCEPT: when a save changes `startDate`, re-run `normalizeRecurrence` against
the new anchor (rule survives; overrides before the new start drop; a task
whose new startDate is invalid — not possible today — would drop the rule).
`DELETE_TASK` removes it with the task (embedded). `PUBLISH_*` does not touch
it (a draft cannot carry one).

### 4. Selector (`src/store/selectors.ts`)

```ts
/** Presentational occurrences of recurring PUBLISHED tasks on a date.
 *  Filter semantics mirror entriesForDate: empty/absent set = all; otherwise
 *  the task is shown when ANY of its assignees is in the filter. Never feeds
 *  totals/overload/collisions. */
export function recurrenceOccurrencesForDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): Array<{ task: Task; occurrence: RecurrenceOccurrence }>;
```

### 5. Storage repair (`src/store/storage.ts`)

In `normalizeTaskMeta`, after `draftHours`: compute
`normalizeRecurrence(t.recurrence, startDate)` (using the task's post-repair
startDate; force-drop when the task is a draft) and spread
`...(recurrence ? { recurrence } : {})`. Legacy payloads without the field are
untouched (no echo-write); garbage is dropped; pass is idempotent by value.
DATA_VERSION stays 7. `emptyData()`/seed unchanged.

### 6. Cloud

Migration `supabase/migrations/20260721170000_task_recurrence.sql`, comment
header in the style of `20260721130000_task_draft_hours.sql`:

```sql
alter table public.tasks
  add column if not exists recurrence jsonb;
```

Nullable, NULL/legacy = no rule; embedded like `checklist`/`draft_hours` —
deliberately NO separate table so visibility inherits the `public.tasks` row
RLS (zero new policies, no realtime-publication change). Overrides carry only
dates/minutes — no profile ids, so no id mapping. Register the filename in
`migrations.test.ts`; `EXPECTED_POLICIES` unchanged. Do NOT apply to the
hosted project in this run.

- `cloudMirror.ts` `taskRow`: `recurrence: t.recurrence ?? null` (canonical
  object persisted verbatim).
- `plannerData.ts`: add `recurrence` to the tasks select; hydrate with
  `normalizeRecurrence(row.recurrence, startDate)` ONLY for published rows
  (`is_draft !== true`), spread as `...(recurrence ? { recurrence } : {})`.
  Cloud-authoritative: hydration output replaces local values wholesale via
  the existing `MERGE_CLOUD_ENTITIES` task path — no merge-reducer change
  needed beyond canonical form.

### 7. Tests (new + extensions)

- `src/utils/recurrence.test.ts`: isoWeekday mapping (Mon=1, Sun=7);
  expansion window (inclusive from/to, anchor lower bound, `until` inclusive,
  open-ended, from > to, 400-day clamp); weekday selection; skip override;
  time-shift override (`overridden: true`); `normalizeRecurrence` canonical +
  idempotent (dedup/sort daysOfWeek, drop stale/equal/duplicate/garbage
  overrides, off-grid rejection, draft-agnostic raw input); `isOccurrenceDate`.
- `src/store/recurrenceActions.test.ts`: both actions — happy paths, EVERY
  reject path returns the same reference, clear drops overrides, rule change
  re-canonicalizes overrides, override upsert/remove/no-op, draft rejection,
  SAVE_TASK startDate-change re-anchor, `recurrenceOccurrencesForDate` (draft
  excluded, filter semantics, no effect on `dayTotal`).
- `storage.test.ts`: legacy task without field round-trips unchanged (no
  echo-write); garbage recurrence dropped; draft task's recurrence dropped;
  canonical value preserved by value.
- `cloudMirror.test.ts` / `plannerData.test.ts`: column round-trip (rule with
  overrides), NULL column => key absent, draft row => key absent.
- `cloudMerge.test.ts`: value-identical task carrying a recurrence keeps its
  object reference on merge.
- `migrations.test.ts`: file list gains `20260721170000_task_recurrence.sql`.

### 8. Wiki

Update `openwiki/n2hub/state-and-persistence.md` (new dated bullet: model,
actions, canonical form, repair, additive-at-v7) and
`openwiki/n2hub/cloud-database.md` (tasks.recurrence column bullet, no-policy
rationale). `scheduling-and-calendar.md` belongs to the UI package.

## Out of scope

- Any UI (TaskModal, WeekView, MonthView) — PKG-20260721-recurrence-ui.
- Materializing occurrences into `WorkloadEntry`, collision/overload coupling.
- Drag of occurrences; changes to any pointer/drag path.
- Applying the migration to the hosted Supabase project.
- New npm dependencies. Backend/notifications per repo guardrails.

## Acceptance

- [ ] `Task.recurrence` typed as specified; canonical form enforced at
      reducer, storage repair and cloud hydration.
- [ ] `src/utils/recurrence.ts` exports the exact signatures above; pure, no
      new deps; expansion is window-only.
- [ ] Both reducer actions validate per spec; every reject returns the prior
      state reference (asserted with `toBe`).
- [ ] DATA_VERSION is still 7; legacy load has no echo-write.
- [ ] Migration file + `migrations.test.ts` registry updated; no policy diff.
- [ ] Mirror/hydration round-trip green; draft rows never hydrate a rule.
- [ ] All listed tests pass.

## Verification

- Worker: `npx vitest run src/utils/recurrence.test.ts src/store/recurrenceActions.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/supabase/cloudMirror.test.ts src/supabase/plannerData.test.ts src/supabase/migrations.test.ts`, then `npm test` and `npm run build`.
- Browser: none — no UI or pointer-path change in this package.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Recurrence lives ON `Task` (embedded jsonb column), not a separate entity:
  no ninth mirror family, no new table/RLS, visibility identical to the task,
  matches `checklist`/`draftHours`/`documents` precedent.
- Anchor = `task.startDate`; end bound = `until` only (task `endDate` does NOT
  clip occurrences — recurrence models ongoing cyclic work; the 92-day cap
  governs only the base period).
- Overrides shift time or skip; they never move an occurrence to another day.
- Time-shift overrides store BOTH startMinutes and durationMinutes (full
  replacement) — simpler canonical form and rendering.
- Drafts cannot carry a rule; enforced at reducer + repair + hydration.
- Cloud-authoritative; retirement gate unaffected (tasks are mirrored).
