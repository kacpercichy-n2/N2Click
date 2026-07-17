# Handoff: Przenieś workload/kalendarz do Supabase i wycofaj aktywne zapisy localStorage po weryfikacji migracji

- Package ID: PKG-20260717-cloud-workload-retirement
- Status: ready
- Tier: developer
- Depends on: none (builds on merged stages 200–210; extends PKG-20260716-cloud-planner-data)
- Risk: high
- Codex review: required — persisted schema (new tables + RLS), reducer integrity (MERGE payload extension), and the persistence trust boundary (localStorage retirement gate).

## Goal

In supabase mode, workload entries (planned hours, calendar drag/resize results,
bin state) and milestones are mirrored to Supabase through the existing
plannerData/cloudMirror architecture and hydrated via `MERGE_CLOUD_ENTITIES`;
an admin-only Polish migration-status view verifies cloud read/write coverage
and — only after an explicit, reversible handshake — suspends per-action
localStorage planner writes, demoting localStorage to a passive, never-deleted
recovery copy. Local mode (no Supabase env) keeps full localStorage behavior
byte-for-byte. No cloud failure may ever lose work.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/scheduling-and-calendar.md` (invariants only — calendar code is untouched)
- `supabase/README.md` (conventions, visibility matrix, transitional boundary)
- Prior settled decisions: `handoffs/scheduler-reviews/210-architect-package.md`

## Expected touchpoints

- `new: supabase/migrations/20260717000000_workload_planner_retirement.sql`
- `src/supabase/migrations.test.ts` (extend file list + `EXPECTED_POLICIES`; never weaken)
- `src/supabase/plannerData.ts` + `plannerData.test.ts` (workload/milestone mappers, extended snapshot, error-classification fix, app_settings accessors)
- `src/supabase/cloudMirror.ts` + `cloudMirror.test.ts` (workload + milestones diff families)
- `new: src/supabase/migrationStatus.ts` + `new: src/supabase/migrationStatus.test.ts` (pure coverage report + retirement handshake)
- `src/supabase/CloudSyncProvider.tsx` (retirement runtime state, safety-net writes, recovery-copy writes, app_settings sync)
- `new: src/components/MigrationStatusPanel.tsx` (admin UI, Polish)
- `src/pages/AdminPage.tsx` (mount the panel, supabase mode only, after `ExportDryRunPanel`)
- `src/store/AppStore.tsx` (ONLY: `MERGE_CLOUD_ENTITIES` payload extension for `workload`/`milestones` + persist-effect gate consultation; no other reducer case changes)
- `new: src/store/persistGate.ts` + `new: src/store/persistGate.test.ts` (pure gate logic)
- `src/store/storage.ts` (ONLY: retirement-marker helpers on a NEW dedicated key; the planner-data pipeline, `saveData`, revision envelope and migrations are NOT modified) + `src/store/storage.test.ts`
- `src/store/cloudMerge.test.ts` (workload/milestone merge semantics)
- `src/supabase/dataImport.ts` + `dataImport.test.ts` (workload + milestones import steps)
- `src/store/exportDryRun.ts` + `exportDryRun.test.ts` (only savedFilters remain unsupported)
- `supabase/README.md` (matrix rows + rewritten transitional-boundary paragraph)
- `openwiki/n2hub/state-and-persistence.md` (end-of-task, single wiki page)

Explicitly verified by the architect: every workload/calendar mutation
(`INSERT_BLOCK`, `SET_BLOCK_TIME`, `MOVE_BLOCK_TO_BIN`, `SPLIT_BLOCK`,
`SCHEDULE_BIN_PART`, `DELETE_BLOCK`, `REASSIGN_ENTRY`, `MOVE_TASK`,
`SET_DAY_ALLOCATIONS`, `SAVE_TASK` reconciliation) flows exclusively through
reducer actions — `src/components/WeekView.tsx` and `src/pages/WorkloadPage.tsx`
only `dispatch(...)`. The cloud mirror hooks in post-reducer; **calendar/bin
pointer code, `WeekView.tsx`, `WorkloadPage.tsx`, `selectors.ts`,
`commandValidation.ts` and `utils/time.ts` need and get NO changes.**

## Invariants

- Agents never commit or push. No new dependencies, no UI framework.
- `AppStore.tsx` stays the ONLY mutation boundary; the reducer stays synchronous
  and pure. Cloud I/O happens strictly AFTER the reducer (diff mirror pattern).
  `storage.ts` stays the only localStorage boundary — the new marker key is
  read/written exclusively through new `storage.ts` helpers.
- Planned hours live only in `WorkloadEntry`; totals stay derived — no derived
  totals are persisted anywhere (cloud included).
- 0.25h hour grid, 15-minute time grid, block fits one day, task period ≤ 92
  days, bin sentinel `date === ''` ↔ SQL `work_date IS NULL`, exactly one bin
  row per `(taskId, personId)`. These are enforced locally as today, encoded as
  SQL CHECKs/partial unique index as belt-and-braces, and re-validated on
  hydration (invalid cloud rows are EXCLUDED with Polish diagnostics, never
  merged).
- Same-person collision keeps blocking calendar drag/resize and automatic
  placement (untouched code paths); overload stays a warning; deliberate
  TaskModal allocation overlaps stay allowed — merged cloud rows may therefore
  overlap in state and render side-by-side (existing behavior).
- Invariant 6: invalid reducer commands — including an invalid extended
  `MERGE_CLOUD_ENTITIES` payload — return the prior state reference; a rejected
  command produces zero cloud ops (no diff).
- `DATA_VERSION` stays 7 — DECIDED. Retirement does not change the persisted
  payload shape; the marker lives on a separate key. Bumping would force
  pointless writebacks/migrations. Do not bump.
- A failed save must never surface as `Zapisano`. Same-browser tab conflicts
  stay explicit wherever localStorage is written (see Scope 5 for the retired-
  mode meaning). NOTHING ever deletes or clears the planner localStorage key as
  part of retirement.
- Local mode (`useAuth().mode === 'local'` / no Supabase env): zero behavioral
  diff — full localStorage persistence, no panel, no gate, no client creation.
  A stale cached marker is IGNORED when Supabase env is not configured.
- Migration conventions (enforced by `migrations.test.ts`): forward-only,
  `YYYYMMDDHHMMSS_` name, RLS enabled + `revoke all ... from anon` in the
  creating file, policies only `to authenticated`, insert/update `with check`,
  no `force row level security`, reuse existing `app.*` helpers — NO new SQL
  functions.
- No live Supabase / no SDK mocking in vitest; all DB access behind the
  injected `PlannerDb`. Components carry no logic vitest cannot reach (node
  env, no jsdom); pure logic lives in testable modules. All new user-facing
  strings in Polish; raw SDK messages only inside technical diagnostics.
- Scheduler runtime files and the prompt queue are untouched.

## Scope

### 1. Migration `supabase/migrations/20260717000000_workload_planner_retirement.sql`

Three new tables (RLS enabled + `revoke all ... from anon` in this file; reuse
`app.is_administrator` / `app.manages_task` / `app.manages_project` /
`app.is_project_member` / `app.is_assigned_to_task` /
`app.profile_in_department` / `app.current_department_id` /
`app.set_updated_at`):

- `public.workload_entries` (WorkloadEntry, local UUID = cloud PK):
  `id uuid pk default gen_random_uuid()`,
  `task_id uuid not null references public.tasks (id) on delete cascade`,
  `profile_id uuid not null references public.profiles (id) on delete cascade`,
  `work_date date` (NULL = bin sentinel, local `''`),
  `planned_hours numeric not null`,
  `start_minutes integer not null default 0`,
  `sort_index integer not null default 0`,
  `created_at`/`updated_at` + `app.set_updated_at` trigger.
  CHECKs (belt-and-braces for the local grid invariants):
  `planned_hours > 0`, `mod(planned_hours * 4, 1) = 0` (0.25h grid),
  `start_minutes >= 0 and start_minutes % 15 = 0`,
  `(work_date is null or planned_hours <= 24)`,
  `(work_date is null or start_minutes + planned_hours * 60 <= 1440)`,
  `(work_date is not null or start_minutes = 0)` (bin rows sit at 0).
  Partial unique index enforcing one bin row per pair:
  `create unique index workload_entries_bin_pair on public.workload_entries (task_id, profile_id) where work_date is null;`
  Indexes on `task_id`, `profile_id`, `(profile_id, work_date)`.
  Policies (per settled role scoping — admin global / manager own-department /
  worker own rows):
  - `workload_entries_select`: `app.is_administrator() or app.manages_task(task_id) or profile_id = (select auth.uid())`
  - `workload_entries_insert` + `workload_entries_update` (both `with check`,
    update also `using`): `app.is_administrator() or (app.manages_task(task_id) and app.profile_in_department(profile_id, app.current_department_id())) or profile_id = (select auth.uid())`
  - `workload_entries_delete`: same expression as select-write
    (`is_administrator or manages_task or own row`).
- `public.milestones` (Milestone: id, projectId, name, date):
  `id uuid pk default gen_random_uuid()`,
  `project_id uuid not null references public.projects (id) on delete cascade`,
  `name text not null check (char_length(name) between 1 and 300)`,
  `milestone_date date not null` (`date` avoided as a column name; mirrors
  `statuses.sort_order` precedent), `created_at`/`updated_at` + trigger.
  Index on `project_id`. Policies: select — `app.is_administrator() or
  app.manages_project(project_id) or app.is_project_member(project_id)`;
  insert/update/delete — `app.is_administrator() or app.manages_project(project_id)`
  (workers' local milestone edits that RLS rejects are dropped with the Polish
  permission notice and stay local — same pattern as clients).
- `public.app_settings` (org-wide runtime flags; carries the retirement state):
  `key text primary key`, `value jsonb not null`,
  `updated_at timestamptz not null default now()` + trigger.
  Policies: `app_settings_select` — `using (true)` (every signed-in client must
  read the retirement flag); insert/update/delete — admin only
  (`app.is_administrator()`, insert/update `with check`).

Extend `src/supabase/migrations.test.ts`: append the new filename to the
expected list; add `public.workload_entries: ['select','insert','update','delete']`,
`public.milestones: ['select','insert','update','delete']`,
`public.app_settings: ['select','insert','update','delete']` to
`EXPECTED_POLICIES`. Do not weaken any assertion.

### 2. Repository extensions `src/supabase/plannerData.ts`

- `classifyWriteError` fix (REQUIRED for correctness): Postgres constraint
  violation codes `23502`, `23503`, `23505`, `23514` classify as
  `'permission'`-kind (op dropped with notice, work stays local) — NOT
  `'transient'`. Today a unique/check violation would stall the retry queue
  forever (e.g. two browsers creating different-id bin rows for the same
  `(task, profile)` pair hitting the partial unique index). Add tests for each
  code.
- `CloudMergePayload` gains `workload: WorkloadEntry[]` and
  `milestones: Milestone[]`.
- `loadPlannerSnapshot`: add parallel selects of
  `workload_entries` (`id, task_id, profile_id, work_date, planned_hours, start_minutes, sort_index`)
  and `milestones` (`id, project_id, name, milestone_date`); atomicity rule
  unchanged (any select error → `{ ok: false, error: PLANNER_SNAPSHOT_ERROR }`).
  Mapping: `work_date` null ↔ `''`; `profile_id` through the reverse person map
  (unmappable → row skipped + diagnostic); grid validation — non-finite or
  non-positive hours, off-0.25 hours, off-15 `start_minutes`, dated row not
  fitting the day, or invalid `work_date` string → row EXCLUDED + diagnostic;
  two cloud bin rows sharing `(task_id, profile_id)` → keep the first, exclude
  the rest + diagnostic. Milestone with invalid `milestone_date` → excluded +
  diagnostic.
- New pure accessors for the retirement flag:
  `RETIREMENT_SETTING_KEY = 'local_writes_retired'`,
  `readRetirementSetting(db): Promise<{ ok: boolean; enabled: boolean }>`
  (select from `app_settings`; missing row = `enabled: false`; select error =
  `ok: false` — callers keep the previous cached value),
  `writeRetirementSetting(db, enabled, profileId): Promise<{ error: CloudWriteError | null }>`
  (upsert `{ key, value: { enabled, completed_at, by_profile } }`).

### 3. Mirror extensions `src/supabase/cloudMirror.ts`

- `diffToCloudOps` dependency order becomes: clients → projects → milestones →
  tasks → assignments → **workload** → comments → activity.
- Milestones family: by-id diff — upsert added/changed (LWW full row), remove
  deleted; non-UUID `id`/`projectId` → diagnostic, no op.
- Workload family: by-id diff — upsert added/changed rows (full row: id,
  task_id, profile_id via `maps.people`, work_date `''`→null, planned_hours,
  start_minutes, sort_index), remove deleted rows by id. Unmappable person or
  non-UUID id/taskId → Polish diagnostic, row stays local, no op.
  `SCHEDULE_BIN_PART` naturally emits its atomic pair (bin-row upsert with the
  decremented hours, or remove at zero + dated-row upsert) — add an explicit
  test. `SAVE_TASK` identity-preserving reconciliation emits only delta rows —
  add an explicit test that an unchanged save emits zero workload ops.
- Polish `label`s: `Blok godzin`, `Blok godzin (usunięcie)`, `Kamień milowy`,
  `Kamień milowy (usunięcie)`.

### 4. AppStore: extended `MERGE_CLOUD_ENTITIES` (only this case + persist gate)

- Merge semantics for `milestones`: replace same-id, keep local-only, append
  cloud-only.
- Merge semantics for `workload`: replace same-id, keep local-only rows, append
  cloud-only rows — then reconcile the ONE-BIN-ROW invariant: if a cloud bin
  row and a local bin row share `(taskId, personId)` under different ids, the
  cloud-id row survives (it exists server-side; avoids future unique-index
  rejections) and `plannedHours` is the grid-snapped SUM of both (work-
  preserving, same philosophy as `ensureStartMinutes`' duplicate-bin merge).
  Dated rows merge strictly by id.
- Fail-closed validation extended (invariant 6): a payload containing a
  workload row with non-finite/non-positive/off-grid hours, off-grid or
  day-overflowing `startMinutes`, an invalid non-bin date, a reference to a
  missing task/person, or a milestone with an invalid date / missing project →
  return the ORIGINAL state reference. (Belt-and-braces with Scope 2 filtering.)
- Persist effect: consult the pure gate (Scope 5) — replace the unconditional
  `saveData(state)` with `if (!shouldSkipLocalPersist(prevAttempted, state)) { ...saveData... }`
  while keeping the existing skip/StrictMode bookkeeping intact. When the write
  is skipped, `saveError` is left unchanged (no false `Zapisano`, no false
  error). NOTHING else in the reducer or provider changes.

### 5. Retirement gate — the exact handshake (DECIDED)

**Marker storage.** Two layers:
1. Org-authoritative: `app_settings` row `local_writes_retired` (Scope 2) —
   set/cleared only by an administrator from the migration-status view.
2. Per-browser cache: NEW dedicated localStorage key
   `n2hub.cloudMigration.v1` — OUTSIDE the planner data key — read/written only
   through new `storage.ts` helpers `readCloudRetirementMarker(): { enabled: boolean }`
   and `writeCloudRetirementMarker(marker)`. `clearData()` does NOT touch it.
   The cache is updated after every successful hydration/refresh from the
   `app_settings` value, so browsers converge on the org decision.

**Runtime rule (pure, in `new: src/store/persistGate.ts`).**
`shouldSkipLocalPersist(prev, next)` returns true ONLY when ALL hold:
- the cached marker is enabled AND Supabase env is configured
  (`isSupabaseConfigured()` from `src/supabase/config.ts` — pure env check, no
  client creation; local mode therefore never skips);
- the cloud mirror is verified-healthy RIGHT NOW: a module-level runtime flag
  `setCloudMirrorHealthy(boolean)` set by `CloudSyncProvider` — true only while
  `status === 'ready'`, no transient error, and hydration for the current user
  succeeded; any degradation (transient error, hydration failure, sign-out,
  going idle) sets it false, so local writes RESUME automatically;
- the state transition touches ONLY cloud-mirrored collections, by reference
  comparison per collection. Mirrored set: `clients`, `projects`, `milestones`,
  `tasks`, `assignments`, `workload`, `comments`, `activity`. Any change to
  `people`, `statuses`, `departments`, `serviceTypes`, `workCategories`,
  `savedFilters`, `currentUserId`, `impersonatorId`, `sampleBannerDismissed` →
  ALWAYS write locally (these collections have no cloud home; retirement must
  not orphan them). A rebuilt-but-equal reference counts as changed — the safe
  direction (extra write, never a lost one).

**Recovery-copy freshness + safety net (in `CloudSyncProvider`, via
`usePersistence().retryPersist`).** While retired, localStorage is written
exactly at these moments, keeping the recovery copy fresh and work safe:
- once after every successful hydration merge (recovery copy = cloud truth);
- once each time the mirror queue drains to empty (state is cloud-confirmed);
- immediately on any transient sync error (at-risk work hits disk before the
  user can lose it) — and the runtime flag flips false so subsequent actions
  write per-action again until health returns;
- on `pagehide` while `pendingCount > 0` (mid-flight reload guard);
- on every non-mirrored-collection change (gate rule above).
Residual risk (documented): a hard crash in the sub-second window between a
mirrored-only action and its cloud confirmation can lose that single action.

**Tab conflicts after retirement (DECIDED meaning).** The batch/recovery writes
above still emit `storage` events, so the existing same-browser
refresh/conflict protocol keeps firing on every real divergence and stays
untouched in code. Cross-browser concurrency is cloud LWW + manual refresh
(210 decision). Document this in README/wiki.

**Arming the marker — admin handshake (in `new: src/supabase/migrationStatus.ts`,
pure, injected `PlannerDb`).** `runRetirementHandshake(db, state, maps, probeIds)`
executes and reports Polish step results:
1. Coverage check (pure `buildCoverageReport(state, maps)`): per family
   (klienci, projekty, kamienie milowe, zadania, przypisania, bloki godzin,
   komentarze, aktywność) local count vs syncable count; ANY unsyncable row
   (non-UUID id, unmappable person/status/dictionary) → handshake FAILS with
   the per-family reasons (retiring would strand local-only work).
2. Cloud read: fresh `loadPlannerSnapshot` must succeed; snapshot-side
   exclusion diagnostics are reported (warnings, not blockers).
3. Cloud write round-trip: upsert a synthetic probe `workload_entries` bin row
   (caller-supplied id + the admin's own profile id, 0.25h), select it back,
   then remove it. Any step failing → handshake FAILS (nothing retired, probe
   removal attempted regardless).
4. Only then `writeRetirementSetting(db, true, profileId)` + write the local
   cache marker.
Reversal: `writeRetirementSetting(db, false, profileId)` + clear cache +
immediately `retryPersist()` (one full local write) — the panel exposes it as
`Przywróć zapisy lokalne`.

### 6. Migration-status view `new: src/components/MigrationStatusPanel.tsx`

Mounted at the end of `AdminPage` (after `ExportDryRunPanel`), rendered only in
supabase mode for a signed-in administrator (`effectiveAccessRole`/org snapshot
as the existing admin gates do); renders nothing in local mode. All strings
Polish. Shows:
- heading `Stan migracji do chmury`;
- per-family coverage table (Grupa / Lokalnie / Do synchronizacji / Poza
  synchronizacją) from `buildCoverageReport`, plus cloud row counts per family
  from an on-demand `Sprawdź stan` snapshot load;
- live sync state from `useCloudSync` (oczekujące zapisy, błąd, odrzucone) and
  retirement state: `Zapisy lokalne: aktywne` / `wyłączone (dane w chmurze)`;
- `Pobierz kopię zapasową` — downloads the existing sanitized backup
  (`peekDataResult` + `buildExportPayload`, same mechanism as
  `ExportDryRunPanel`); the retirement button stays DISABLED until a backup was
  downloaded in this session (the reversible local recovery artifact);
- `Zweryfikuj i wyłącz zapisy lokalne` — enabled only when: status `ready`,
  `pendingCount === 0`, no error, no undismissed dropped ops, coverage shows
  zero unsyncable rows, and the backup was downloaded; runs the Scope 5
  handshake and renders each step's Polish outcome;
- when retired: `Przywróć zapisy lokalne` + a note that the frozen local copy
  and backup file remain intact.
Component stays thin — every decision lives in `migrationStatus.ts` (tested in
node); the component is covered by the build typecheck.

### 7. Import + dry-run (keep stage-208 tooling truthful)

- `dataImport.ts`: move `workload` and `milestones` out of `UNSUPPORTED` into
  idempotent insert-only steps (existing select-before-insert, skip-by-id,
  non-UUID diagnostic pattern): milestones after projects; workload after
  tasks, `profile_id` through the existing `personIdMap` (unmappable person →
  failed + diagnostic), `date '' → work_date null`. `savedFilters` stays
  `UNSUPPORTED` — DECIDED: saved filters are per-user UI preferences, not
  org planner data; they keep persisting locally forever via the gate's
  non-mirrored rule, so retirement loses nothing.
- `exportDryRun.ts`: `workload` → target `workload_entries`, `milestones` →
  target `milestones`; unsupported collections shrink to `Zapisane filtry`;
  add duplicate-bin-pair and off-grid-hours blockers mirroring the SQL checks.
  Extend both test files with the existing fake patterns.

### 8. Documentation

- `supabase/README.md`: matrix rows for `workload_entries`, `milestones`,
  `app_settings`; rewrite the transitional-boundary paragraph — workload and
  milestones now mirrored+hydrated; localStorage active planner writes are
  suspended per-browser only after the admin handshake, localStorage stays a
  passive, never-deleted recovery copy refreshed on hydration/queue-drain;
  local-only forever: people administration, dictionary/status mutations,
  saved filters, sample/reset.
- End-of-task wiki: `openwiki/n2hub/state-and-persistence.md` only (the
  "workload never leaves the browser" sentence is now false; describe the new
  boundary + retirement gate). `scheduling-and-calendar.md` stays accurate
  (interaction code untouched) — report why.

## Out of scope

- ANY change to `WeekView.tsx`, `WorkloadPage.tsx`, `utils/time.ts`,
  `selectors.ts`, `commandValidation.ts`, calendar/bin pointer lifecycle, or
  any existing reducer case other than `MERGE_CLOUD_ENTITIES`.
- Deleting/clearing local planner data, weakening recovery screens, the
  revision envelope, tab-conflict lifecycle, or login gates. No `DATA_VERSION`
  bump.
- `savedFilters` cloud persistence; people/dictionary/status cloud MUTATIONS
  (205–209 boundaries stand); realtime, polling, offline queues persisted
  across reloads, optimistic locking, background backoff.
- Cross-client deletion propagation for local-only rows and workload-vs-remote
  task-date reconciliation (documented 210 limitations, unchanged).
- Applying migrations to the hosted project (operator-owned). No push.

## Acceptance

- [ ] New migration follows every convention; `npx vitest run src/supabase/migrations.test.ts` passes with the three new tables' policies and anon revokes; NO new SQL functions.
- [ ] Workload RLS scoping: admin global, manager own-department tasks' rows (writes restricted to own-department people), worker own rows; milestones scoped by project visibility/management; `app_settings` readable by all authenticated, writable by admin only.
- [ ] In supabase mode every workload/calendar/milestone mutation dispatched through AppStore mirrors via `diffToCloudOps` (SCHEDULE_BIN_PART emits its atomic pair; unchanged SAVE_TASK emits zero workload ops; rejected commands emit zero ops).
- [ ] Constraint-violation write errors (23502/23503/23505/23514) drop the op with the Polish permission notice instead of stalling the retry queue; transient errors still stop-and-retain.
- [ ] Hydration merges workload/milestones (by id, local-only kept, bin pair reconciled to one row with summed grid-snapped hours, invalid rows excluded with diagnostics); an invalid payload returns the SAME state reference; `people`/`statuses`/`savedFilters`/dictionaries stay reference-identical through the merge.
- [ ] Retirement: only an admin can arm it, only through the full handshake (coverage clean → snapshot read OK → probe write/read/remove OK → backup downloaded); the org flag lives in `app_settings`, the browser cache on `n2hub.cloudMigration.v1` via `storage.ts` helpers; reversal restores per-action writes and immediately persists once.
- [ ] While retired+healthy, mirrored-only changes skip per-action `saveData`; localStorage is still written on hydration, queue drain, transient error, `pagehide` with pending ops, and any non-mirrored-collection change; any mirror degradation resumes per-action writes automatically. No path reports success on a failed save.
- [ ] Local mode: zero behavioral diff (gate never skips, no panel, no client); a stale marker with no Supabase env is ignored. Full existing suite green.
- [ ] Import/dry-run handle workload+milestones idempotently; dry-run reports only saved filters as unsupported.
- [ ] All new strings Polish; README + state-and-persistence wiki updated.

## Verification

- Worker: `npx vitest run src/supabase src/store/persistGate.test.ts src/store/cloudMerge.test.ts src/store/storage.test.ts src/store/blockActions.test.ts src/store/commandValidation.test.ts src/store/exportDryRun.test.ts` (focused), then one full `npm test` and `npm run build` before reporting.
- Browser: none — calendar/bin interaction code is untouched and local mode is byte-identical; `blockActions`/`time` unit suites cover the scheduling invariants. Release verification owns the browser matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- 210 architecture is EXTENDED, not replaced: pure `PlannerDb` repository +
  post-reducer diff mirror + single `MERGE_CLOUD_ENTITIES` hydration;
  suppression set (`MERGE_CLOUD_ENTITIES`/`REPLACE_FROM_STORAGE`/`LOAD_SAMPLE`/
  `RESET_ALL`) unchanged; LWW + manual refresh gated on an empty queue;
  local UUIDs as cloud PKs; people by email, statuses by slug, dictionaries by
  name; non-UUID legacy rows stay local with diagnostics; sample/reset never
  touch the cloud.
- NEW (this package): milestones go cloud (shared timeline planning data;
  retirement must not silo them per browser); saved filters stay local
  (per-user preference, still persisted via the non-mirrored gate rule);
  `DATA_VERSION` stays 7; retirement is org-wide via `app_settings` with a
  per-browser cache key outside the planner key; the gate is
  health-conditional (any cloud degradation instantly resumes local writes) and
  collection-scoped (non-mirrored collections always persist locally);
  constraint violations classify as drop-not-retry; bin-pair merge keeps the
  cloud id and sums hours.
