# Handoff: Draft task hours, availability panel and publish from the task card

- Package ID: PKG-20260721-task-card-hours-publish
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — draft-hours persistence + publish materialization touch reducer integrity (invariants 1, 4, 6) and the cloud round-trip

## Goal

Drafts (`Task.isDraft`) accept per-person sold hours in TaskModal, persist them
in a new additive `Task.draftHours` field (mirrored to Supabase), materialize
them into bin `WorkloadEntry` rows on publish, show a per-person availability
panel in TaskModal, and offer split "Zapisz szkic" / "Opublikuj" actions in the
modal's sticky action bar.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md` (declared by prompt; see "SZKICE
  ZADAŃ (2026-07-21)" — that section's rules are the baseline you extend)
- `openwiki/n2hub/scheduling-and-calendar.md` — EXPANSION: the sold-hours →
  `binTotals` model of SAVE_TASK is documented there and publish now creates bin
  rows
- `openwiki/n2hub/cloud-database.md` — EXPANSION: new `tasks.draft_hours` column

## Expected touchpoints

- `src/types.ts` (Task: additive optional `draftHours`)
- `src/store/AppStore.tsx` (saveTask draft branch ~535-555; `publishTask`
  ~820-831; `publishProjectDrafts` ~795-814)
- `src/store/storage.ts` (`normalizeTaskMeta` ~837 — repair pass for the field)
- `src/components/TaskModal.tsx` (sold-hours guard ~1019; soldRawByPerson seed
  ~436; draft hint ~1071-1076; sticky actions ~1215-1235; new availability
  panel)
- `src/supabase/cloudMirror.ts` (`taskRow` ~247-266)
- `src/supabase/plannerData.ts` (tasks select ~305, task hydration ~438-453)
- `new: supabase/migrations/20260721130000_task_draft_hours.sql`
- Tests: `src/store/draftTasks.test.ts`, `src/store/storage.test.ts`,
  `src/supabase/cloudMirror.test.ts`, `src/supabase/plannerData.test.ts`
- If `src/supabase/migrations.test.ts` keeps a migration file list, extend it;
  if `src/store/dataImport.ts` maps task fields, carry `draftHours` through the
  same normalization (check both, follow the `order_index`/`documents`
  precedent).

## Invariants

1. Planned hours live only in `WorkloadEntry`. `draftHours` is a pre-publication
   intent, NOT planned hours: no selector, total, calendar, bin or overload
   computation may read it. It exists only while `isDraft === true` and is
   deleted at publish, when the real bin rows are created.
2. Invariant 4: publish creates AT MOST ONE bin row per `(taskId, personId)`.
3. Invariant 6: every invalid command path (bad binTotals on a draft save,
   publish of a missing/non-draft task, publish for a missing project or a
   project without drafts) returns the SAME state reference. Existing
   `saveTask` reconciliation for published tasks must be byte-for-byte
   untouched.
4. Invariant 2: hours snap to the 0.25h grid at every boundary (reducer write,
   load repair, cloud hydration).
5. Invariant 7 / scope: do NOT touch calendar/bin pointer, drag, or
   rendered-column code. `INSERT_BLOCK` stays rejected for drafts.
6. Cloud-authoritative: the field must survive `MERGE_CLOUD_ENTITIES`
   replacement and the reference-preserving merge (`sameRowValue` compares key
   sets — keep the canonical key-presence rule below on BOTH the local and the
   hydration path).
7. Retirement mode stays off; `DATA_VERSION` stays 7 (field is additive, no
   data migration).
8. All user-facing strings in Polish.

## Scope

### 1. Data model (settled design — implement as specified)

- `src/types.ts`: `Task.draftHours?: { personId: string; hours: number }[]`.
  Polish doc comment: sold-hours intent of a draft; materializes into bin rows
  at publish; never read by planning selectors.
- CANONICAL FORM (load-bearing for `sameRowValue` reference preservation): the
  `draftHours` key is PRESENT only when the task is a draft AND the array has
  ≥1 entry with `hours > 0` on the 0.25 grid and unique `personId`. Otherwise
  the key is ABSENT (never `[]`, never on a published task). Enforce this in
  the reducer, in `normalizeTaskMeta` and in cloud hydration.

### 2. Reducer — save (`saveTask` draft branch, AppStore.tsx ~535)

- The draft branch keeps skipping ALL workload reconciliation. Additionally it
  now persists `draftHours` derived from `payload.binTotals`: filter to
  `assigneeIds`, `snapHours` each value, drop `<= 0`, one entry per person
  (Map keyed by personId). Empty result => omit the key (delete it when editing
  a draft whose hours were cleared).
- No new validation needed for well-formedness: the existing atomic reject at
  the top of `saveTask` already refuses non-finite/negative `binTotals`
  (invariant 6). Do not weaken it.
- TaskModal already sends `binTotals` for drafts once the section is unhidden
  (dated allocations are 0 for a draft, so binTargets == sold hours). No
  payload shape change.

### 3. Reducer — publish (`publishTask`, `publishProjectDrafts`)

- Extract a shared helper, e.g.
  `materializeDraftBin(stateWorkload, accumulated, task): WorkloadEntry[]`.
  For each published draft, for each `draftHours` entry where the person
  exists (`hasEntity(state, 'person', personId)`), is currently assigned to the
  task in `state.assignments`, and `snapHours(hours) > 0`: emit ONE bin row
  `{ id: uid(), taskId, personId, date: BIN_DATE, plannedHours: snapHours(hours),
  startMinutes: 0, sortIndex: nextSortIndex(accumulated, personId, BIN_DATE) }`
  (mirror the `binTotals` fresh-row path ~752-760). Defensive invariant-4
  guards: skip a personId already emitted for the task and skip a pair that
  already has a bin row in state (cannot normally happen for drafts).
- Entries skipped as invalid/orphaned are silently dropped — publish must never
  brick on a stale row that arrived from the cloud.
- The published task object DROPS the `draftHours` key (rest-destructure; a
  spread with `isDraft: false` alone keeps the key — not acceptable).
- `PUBLISH_PROJECT_DRAFTS` does all of the above for every draft of the project
  in ONE state transition (atomic). Guard clauses (missing project/task, no
  drafts, non-draft) and activity messages stay exactly as they are.

### 4. Load repair (`normalizeTaskMeta`, storage.ts)

- Published task (`isDraft` false) => drop the key.
- Draft => if the raw value is not an array, drop the key; otherwise keep rows
  with a non-empty string `personId` (orphan personId is kept — existence is
  checked at publish, same philosophy as the tickets orphan reporter) and
  finite `hours > 0` snapped via `snapHours`; dedupe by personId (first wins);
  empty result => drop the key.
- Must stay idempotent (existing test storage.test.ts ~827 covers the pass).

### 5. Cloud persistence (DECIDED: the field IS mirrored)

Rationale (do not revisit): live sync's debounced background rehydration
replaces the tasks collection from the cloud; a local-only field would be wiped
minutes after every draft edit. Same pattern as `projects.documents` jsonb.

- New migration `supabase/migrations/20260721130000_task_draft_hours.sql`
  following the `20260721020000_task_is_draft.sql` header style (Polish
  comment): `alter table public.tasks add column if not exists draft_hours
  jsonb;` — nullable, `null` = none, no RLS/realtime change.
- Cloud jsonb shape: `[{ "profile_id": "<uuid>", "hours": <number> }]`.
- `cloudMirror.ts` `taskRow`: `draft_hours` = mapped entries or `null` when the
  task has no `draftHours`. Map personId via `maps.people.get(personId) ??
  (maps.cloudProfileIds.has(personId) ? personId : undefined)` (the `ticketRow`
  precedent ~290); DROP an unmappable entry (do not null the whole row, matching
  per-row assignment behavior).
- `plannerData.ts`: add `draft_hours` to the tasks select. Hydration: build the
  field only when `row.is_draft === true` and the value is an array; per entry
  map `profile_id` through `personOf`, drop `''`, require finite `hours > 0`,
  snap to grid, dedupe by person; set the `draftHours` key only when ≥1 entry
  survives (canonical form — keeps `sameRowValue` no-op merges no-op).

### 6. TaskModal — hours for drafts (item 1)

- Remove ONLY the `!isDraft &&` guard at ~1019 so `.sold-hours` renders for
  drafts. The bin section (~1123) and allocation grid (~1171) STAY hidden for
  drafts. `.estimate-compare` stays published-only.
- Seed `soldRawByPerson` for an existing DRAFT from `existing.draftHours`
  (workload is empty for drafts, so the current seed yields nothing).
- Adjust the sold-hours helper copy for drafts (the "zasobnik" sentence is
  wrong pre-publication) and the draft hint (~1071): hours entered now SAVE
  with the draft and land in the person's bin on publish. Suggested hint:
  "<strong>Szkic.</strong> Godziny osób zapisują się ze szkicem i po publikacji
  trafią do zasobnika. Zadanie pozostaje szkicem, dopóki go nie opublikujesz."
  (exact wording is the developer's, Polish, must state both facts).

### 7. TaskModal — availability panel (item 2)

- New purely-informational block rendered right below `.sold-hours-total`
  (inside `.sold-hours`, so it appears for drafts AND published tasks whenever
  `assignedPeople.length > 0`); render it only when `periodValid`.
- Per assigned person compute once via `useMemo` over
  `[state, assigneeIds, startDate, endDate, periodValid]`:
  `rangeAvailabilityForPerson(state, p.id, eachDayInclusive(startDate, endDate))`
  (selectors.ts ~1018; returns `{availableHours, bookedHours, overbookedDates}`).
  Import it from `../store/selectors` (already the modal's selector source).
- Row copy (Polish, formatDuration for hours):
  "Dostępność w okresie: dostępne {availableHours} / zajęte {bookedHours}" and,
  when `overbookedDates.length > 0`, an overbooking highlight such as
  "przeciążenie: {n} dn." using the existing `field-error` /
  `sold-hours-warn` classes (reuse existing classes; small additive CSS in
  `src/styles.css` is allowed, no layout rework).
- No save-logic change of any kind; `bookedHours` counts existing workload of
  OTHER tasks (a draft has none of its own) — that is the intended meaning.

### 8. TaskModal — split publish actions (item 3)

- Buttons render only when `!readOnly` (i.e. `tasks.manage` — the existing
  gate; no new permission).
- EXISTING draft: primary actions become "Zapisz szkic" (current
  `handleSave` path, replaces the "Zapisz i zamknij" label for drafts only) and
  "Opublikuj" — runs `doSave()`; only if it returns true, dispatch
  `{ type: 'PUBLISH_TASK', taskId: existing.id }` and close via `onSaved()`.
  Two sequential dispatches are fine: React applies them in order, so
  PUBLISH sees the just-saved `draftHours`.
- NEW draft (`taskId === null`, opened from a project): "Utwórz szkic"
  (unchanged) and "Utwórz i opublikuj" — a SINGLE `SAVE_TASK` dispatch with
  `draft.isDraft: false`; the standard published path materializes `binTotals`
  itself, and no task id is needed. Implement as a parameterized `doSave`
  (e.g. `doSave({ publishNew?: boolean })`), do not duplicate the payload
  assembly.
- Published tasks: action bar unchanged. ProjectDetailPage bulk
  "Zapisz i opublikuj (N)" button: unchanged, stays as the shortcut.

## Out of scope

- No calendar/bin drag, pointer, WeekView or rendered-column changes.
- No changes to `MERGE_CLOUD_ENTITIES` merge logic itself (the canonical
  key-presence rule makes the generic `sameRowValue` work).
- No new permission keys, no backend/auth work, no retirement-mode changes.
- No estimate-model change: a draft's `estimatedHours` already persists as the
  sum of sold hours via the existing `draftForSave`.
- No wiki edits beyond the final green-task check (reviewer owns the verdict;
  expected stale spots: state-and-persistence "SZKICE ZADAŃ" hours sentences,
  cloud-database tasks columns).

## Acceptance

- [ ] Draft save persists snapped, assignee-filtered `draftHours`; zero
      `WorkloadEntry` rows exist for the draft; clearing hours on a draft edit
      removes the key.
- [ ] Invalid `binTotals` (NaN/negative) on a draft save returns the same state
      reference; publish of a missing/non-draft task and
      `PUBLISH_PROJECT_DRAFTS` on a project without drafts still return the
      same reference.
- [ ] `PUBLISH_TASK` on a draft with hours creates exactly one bin row per
      `(taskId, personId)` (`date === ''`, `startMinutes 0`, grid-snapped
      hours, fresh sortIndex), sets `isDraft: false` and removes `draftHours`.
- [ ] `PUBLISH_PROJECT_DRAFTS` materializes all drafts atomically; orphaned or
      unassigned `draftHours` entries are skipped, never duplicated.
- [ ] `normalizeTaskMeta` drops the field on published tasks, normalizes it on
      drafts, stays idempotent.
- [ ] `taskRow` emits `draft_hours` (profile-mapped, `null` when none);
      `loadPlannerSnapshot` hydrates it back only for `is_draft` rows; a
      round-trip of an unchanged draft keeps `sameRowValue` equality (key
      presence matches the canonical form).
- [ ] TaskModal: sold-hours section visible for drafts, seeded from
      `draftHours` on reopen; bin section and allocation grid still hidden for
      drafts; availability line per assigned person with overbooking highlight;
      draft sticky bar shows "Zapisz szkic" + "Opublikuj" (existing draft) /
      "Utwórz szkic" + "Utwórz i opublikuj" (new draft); non-draft bar
      unchanged; nothing publish-related renders without `tasks.manage`.
- [ ] All new strings Polish; `npm run build` clean TypeScript.

## Verification

- Worker:
  `npx vitest run src/store/draftTasks.test.ts src/store/storage.test.ts src/store/saveTaskWorkload.test.ts src/store/cloudMerge.test.ts src/supabase/cloudMirror.test.ts src/supabase/plannerData.test.ts src/supabase/migrations.test.ts`
  (extend `draftTasks.test.ts` for save/publish/hours cases; add storage +
  mirror/hydration cases; the untouched suites in the list are the regression
  canary for invariants 4/6).
- Browser: none — no existing scenario covers the draft modal; release
  verification owns the browser matrix.
- Scheduler owns final `npm test && npm run build` (prompt's 933 baseline is
  stale — recent runs report ~1086; do not chase the number, chase zero
  failures).

## Prior decisions

- `draftHours` lives ON the Task (additive optional field), NOT in workload —
  drafts must never create `WorkloadEntry` rows (settled by the draft-tasks
  package).
- The field IS mirrored to Supabase (`tasks.draft_hours jsonb`,
  `[{profile_id, hours}]`) because cloud hydration replaces the tasks
  collection; local-only storage would lose the hours on every live-sync
  refresh.
- Publish materializes hours as BIN rows (no dated placement, no collision
  logic) — the person plans them on the calendar afterwards, identical to the
  published sold-hours flow.
- After publish the field is deleted from the task (single source of truth in
  workload, invariant 1).
- New-draft "publish" is a plain non-draft SAVE_TASK (no id round-trip); only
  existing drafts use the PUBLISH_TASK action from the modal.
- Availability panel reuses `rangeAvailabilityForPerson`; purely informational,
  never blocks saving.
