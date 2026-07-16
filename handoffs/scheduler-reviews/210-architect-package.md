# Handoff: Przenieś dane planera (klienci/projekty/zadania/przypisania/statusy zadań/komentarze/aktywność) do Supabase za AppStore

- Package ID: PKG-20260716-cloud-planner-data
- Status: ready
- Tier: developer
- Depends on: none (builds on merged stages 200–209)
- Risk: high
- Codex review: required — permissions (new RLS), persistence boundary, new reducer action.

## Goal

In Supabase mode, the seven planner entity groups — clients, projects, tasks,
assignments, task/project status changes, comments, activity events — are
persisted to Supabase through a pure repository layer and a diff-based cloud
mirror behind `AppStore`, hydrated back on sign-in via one new merge reducer
action, with role-scoped RLS (admin global / manager own-department / worker
own-assignment), Polish loading/error/retry/stale states, and no loss of local
work on any failure. Local mode behaves byte-for-byte as today.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `supabase/README.md` (conventions, visibility matrix, transitional boundary)
- Prior settled decisions: `handoffs/scheduler-reviews/209-architect-package.md`

## Expected touchpoints

- `new: supabase/migrations/20260716190000_planner_entities.sql`
- `src/supabase/migrations.test.ts` (extend hard-coded file list + `EXPECTED_POLICIES`)
- `new: src/supabase/plannerData.ts` + `new: src/supabase/plannerData.test.ts`
- `new: src/supabase/cloudMirror.ts` + `new: src/supabase/cloudMirror.test.ts`
- `new: src/supabase/CloudSyncProvider.tsx`
- `new: src/components/CloudSyncBanner.tsx`
- `src/store/AppStore.tsx` (ONLY: `MERGE_CLOUD_ENTITIES` action + reducer case + `lastActionRef` exposure; nothing else in the reducer changes)
- `new: src/store/cloudMerge.test.ts`
- `src/supabase/dataImport.ts` + `src/supabase/dataImport.test.ts` (support new tables/columns)
- `src/store/exportDryRun.ts` + `src/store/exportDryRun.test.ts` (keep dry-run truthful)
- `src/main.tsx` (mount `CloudSyncProvider` inside `OrgDataProvider`, outside the router)
- `src/App.tsx` (mount `CloudSyncBanner` in the shell; renders `null` in local mode)
- `supabase/README.md` (matrix rows + updated transitional-boundary paragraph)
- `openwiki/n2hub/state-and-persistence.md` (end-of-task, single wiki page)

## Invariants

- Agents never commit or push.
- `src/store/AppStore.tsx` stays the ONLY mutation boundary; the reducer stays
  synchronous and pure (no async, no fork). Cloud writes happen strictly AFTER
  the reducer, derived from state diffs. `src/store/storage.ts` stays the only
  localStorage boundary and is NOT modified.
- localStorage persistence and recovery are NOT removed or bypassed: the persist
  effect keeps writing every state (including cloud-hydrated state), so local
  state + localStorage remain the recovery source. A failed save must never
  report `Zapisano`; same-browser tab conflicts stay explicit (existing
  behavior, untouched).
- Invariant 6: invalid reducer commands preserve the prior state reference —
  including the new `MERGE_CLOUD_ENTITIES` with an invalid payload. A rejected
  command produces NO cloud ops (the diff sees no state change).
- Workload/calendar persistence stays 100% local: no `workload` table, no
  WorkloadEntry ever leaves the browser. The merge action never adds, removes
  or edits `workload`, `people`, `statuses`, `milestones`, `savedFilters`,
  dictionaries, `currentUserId`, `impersonatorId`.
- Local mode (`useAuth().mode === 'local'`): zero behavioral diff — no Supabase
  client creation, no banner, no dispatches, no new UI.
- Client-side checks stay UX-only; RLS is the authorization boundary. Publishable
  key only.
- Migration conventions (enforced by `migrations.test.ts`): forward-only,
  `YYYYMMDDHHMMSS_` name, never edit applied files, `enable row level security`
  + `revoke all ... from anon` in the creating file, `set search_path = ''` in
  every function, security-definer functions STABLE, NO
  `force row level security`, policies only `to authenticated`, insert/update
  policies have `with check`.
- No live Supabase and no SDK mocking in vitest: all DB access behind injected
  interfaces (extend the `ImportDb` pattern).
- All user-facing strings in Polish; never surface raw SDK messages (raw
  messages may appear only inside technical diagnostics, as in dataImport).
- Calendar/bin pointer code, `selectors.ts`, `storage.ts`, `commandValidation.ts`
  and all existing reducer cases are untouched.

## Scope

### 1. Migration `supabase/migrations/20260716190000_planner_entities.sql`

New tables (RLS enabled + `revoke all ... from anon` in this file; all policies
`to authenticated`; reuse existing `app.*` helpers — no new SQL helper functions
are needed):

- `public.clients`: `id uuid pk default gen_random_uuid()`, `name text not null
  check (char_length(name) between 1 and 200)`, `archived boolean not null
  default false`, `created_at`/`updated_at` + `app.set_updated_at` trigger.
  Policies: `clients_select` — `using (true)` (business reference data: every
  signed-in user must render client names on visible projects);
  `clients_insert` — `with check (app.is_administrator() or
  app.current_access_role() = 'manager')` (a manager's SAVE_PROJECT may create
  a client atomically via `newClientName`); `clients_update_admin`,
  `clients_delete_admin` — admin-only (local `clients.manage` for `handlowiec`
  collapses to worker in cloud per the settled 209 role mapping — RLS truth).
- `public.comments`: `id uuid pk default gen_random_uuid()`,
  `project_id uuid null references public.projects (id) on delete cascade`,
  `task_id uuid null references public.tasks (id) on delete cascade`,
  `check (num_nonnulls(project_id, task_id) = 1)`,
  `author_id uuid null references public.profiles (id) on delete set null`,
  `body text not null check (char_length(body) between 1 and 10000)`,
  `mention_ids uuid[] not null default '{}'`, `created_at timestamptz not null
  default now()`. Indexes on `project_id`, `task_id`. Policies (append-only —
  local model has no comment edit/delete; entity deletion cascades):
  `comments_select` — admin OR (`project_id is not null` and
  (`app.manages_project(project_id)` or `app.is_project_member(project_id)`))
  OR (`task_id is not null` and (`app.manages_task(task_id)` or
  `app.is_assigned_to_task(task_id)`)); `comments_insert` — `with check`
  (same visibility) AND (`app.is_administrator()` or
  `author_id = (select auth.uid())`).
- `public.activity_events`: `id uuid pk default gen_random_uuid()`,
  `entity_type text not null check (entity_type in
  ('project','task','person','status','client','system'))`,
  `entity_id text not null default ''` (verbatim local entity id — round-trip
  fidelity; no FK), `project_id uuid null references public.projects (id) on
  delete cascade`, `task_id uuid null references public.tasks (id) on delete
  cascade` (typed FK duplicates set only for project/task rows — they exist for
  RLS + cascade), `actor_id uuid null references public.profiles (id) on delete
  set null`, `impersonator_id uuid null references public.profiles (id) on
  delete set null`, `created_by uuid not null default auth.uid() references
  public.profiles (id)`, `message text not null`, `created_at timestamptz not
  null default now()`. Indexes on `project_id`, `task_id`, `created_by`.
  Policies (append-only log): `activity_events_select` — admin OR
  `created_by = (select auth.uid())` OR (project/task rows visible via
  `app.manages_project`/`app.is_project_member`/`app.manages_task`/
  `app.is_assigned_to_task` as for comments); `activity_events_insert` —
  `with check (created_by = (select auth.uid()))` (any signed-in user logs own
  attributed rows; entity-less rows like `system` allowed).

Alter existing tables (columns are nullable/defaulted so already-imported rows
stay valid; existing `projects_*`/`tasks_*` policies automatically cover them):

- `public.projects`: add `client_id uuid null references public.clients (id) on
  delete set null`, `status_id uuid null references public.statuses (id) on
  delete set null`, `paid boolean not null default false`, `start_date date`,
  `end_date date`, `service_type_id uuid null references public.service_types
  (id) on delete set null`.
- `public.tasks`: add `status_id uuid null references public.statuses (id) on
  delete set null`, `start_date date`, `end_date date`, `estimated_hours
  numeric null`, `priority text not null default 'normal' check (priority in
  ('low','normal','high','urgent'))`, `work_category_id uuid null references
  public.work_categories (id) on delete set null`, `checklist jsonb not null
  default '[]'::jsonb`.

Extend `src/supabase/migrations.test.ts`: append
`20260716190000_planner_entities.sql` to the expected file list; add to
`EXPECTED_POLICIES`: `public.clients: ['select','insert','update','delete']`,
`public.comments: ['select','insert']`,
`public.activity_events: ['select','insert']`. Do not weaken any assertion.

### 2. Repository `src/supabase/plannerData.ts` (pure, node-testable)

- `export interface CloudWriteError { kind: 'permission' | 'transient'; message: string }`
  Classification: PostgREST code `42501` or message matching
  `/row-level security|permission denied|violates row-level/i` → `'permission'`,
  everything else `'transient'`.
- `export interface PlannerDb extends Pick<ImportDb, 'select'> {
    upsert(table: string, row: Record<string, unknown>, onConflict?: string): Promise<{ error: CloudWriteError | null }>;
    remove(table: string, match: Record<string, string>): Promise<{ error: CloudWriteError | null }>;
  }`
  (`remove`, not `delete`, to keep the interface ergonomic.)
- `export function createSupabasePlannerDb(client: SupabaseClient): PlannerDb`
  — thin adapter; reuse `createSupabaseImportDb(client).select` for `select`.
  `dataImport.ts` stays insert-only; upsert/delete exist only here.
- `export const PLANNER_SNAPSHOT_ERROR = 'Nie udało się wczytać danych planera z serwera.'`
- `export async function loadPlannerSnapshot(db: Pick<PlannerDb,'select'>, maps: CloudIdMaps, local: AppData): Promise<LoadPlannerResult>`
  — parallel selects of `clients`, `projects`, `tasks`, `task_assignments`,
  `comments`, `activity_events`; atomic like `loadOrgSnapshot` (ANY select error
  → `{ ok: false, error: PLANNER_SNAPSHOT_ERROR }`; empty collections are
  valid). Maps rows to LOCAL shapes (`Client`, `Project`, `Task`,
  `TaskAssignment`, `Comment`, `ActivityEvent`) using the reverse id maps:
  `status_id` → local status by cloud-id, fallback slug match; `service_type_id`
  / `work_category_id` → by cloud-id then name; `profile_id`/`author_id`/
  `actor_id` → local person by cloud-id then normalized email (unmappable
  author/actor → `''`; an assignment with an unmappable profile is skipped +
  counted in `diagnostics: string[]`). Dates: SQL `date`/null ↔ `'yyyy-MM-dd'`/
  `''`. A cloud project/task row that fails local validity (bad date strings,
  reversed period, task period > 92 days via `periodError`/`isValidDateStr`
  from `src/utils/dates.ts`) is EXCLUDED from the payload with a diagnostic —
  never merged. Assignment rows get their local `id` resolved during merge
  (see Scope 4).

### 3. Mirror `src/supabase/cloudMirror.ts` (pure, node-testable)

- `export interface CloudIdMaps` + `export function buildCloudIdMaps(local: AppData, org: OrgSnapshot): CloudIdMaps`
  — reuses dataImport's settled mapping decisions: people ↔ profiles by
  `normalizeEmail` (`src/auth/profile.ts`); statuses local→cloud by exact id,
  fallback trimmed `slug`; service types / work categories by id, fallback
  trimmed `name`; departments by id, fallback trimmed name; clients / projects /
  tasks / comments / activity ids carried VERBATIM (local `crypto.randomUUID`
  ids are the cloud PKs — same strategy as the 208 import, so imported and
  newly-created rows keep id identity and all local scheduling invariants keep
  working). Non-UUID legacy ids cannot sync → Polish diagnostic, row stays
  local-only (matches `DIAG.nonUuid`).
- `export type CloudOp = { kind: 'upsert' | 'remove'; table: string; row?: Record<string, unknown>; match?: Record<string, string>; sourceId: string; label: string }`
- `export function diffToCloudOps(prev: AppData, next: AppData, maps: CloudIdMaps): { ops: CloudOp[]; diagnostics: string[] }`
  — diffs by id the six mirrored collections and emits, in dependency-safe
  order (clients → projects → tasks → task_assignments → comments →
  activity_events, deletes before upserts of dependents where relevant):
  - clients/projects/tasks: upsert added + changed rows (full row,
    last-write-wins), remove deleted rows (cloud FK cascade cleans dependents);
  - task status changes (`SET_TASK_STATUS`, `SET_PROJECT_STATUS`, kanban) are
    just row updates — covered by the same upsert path;
  - assignments: composite upsert `{ task_id, profile_id }` with
    `onConflict: 'task_id,profile_id'`, remove by the composite match;
  - comments and activity: APPEND-ONLY — insert-upsert new rows only; local
    prunes (entity deletion) are NOT mirrored (cloud cascade owns it);
  - a row referencing an unmappable person/status/dictionary or carrying a
    non-UUID id → no op + Polish diagnostic (work stays local, never thrown).
- `export async function applyCloudOps(db: PlannerDb, ops: CloudOp[]): Promise<ApplyOpsResult>`
  — sequential; on `'transient'` error STOP and return the remaining queue
  (retryable); on `'permission'` error DROP the op, record a notice, continue.
  `ApplyOpsResult = { done: number; dropped: Array<{ label: string; message: string }>; remaining: CloudOp[]; error: string | null }`.
- Polish constants:
  `SYNC_ERROR_MSG = 'Nie udało się zapisać zmian na serwerze. Dane pozostały w tej przeglądarce.'`,
  `SYNC_PERMISSION_MSG = 'Serwer odrzucił zmianę (brak uprawnień) — pozostała tylko w tej przeglądarce.'`,
  `STALE_HINT_MSG = 'Dane mogą być nieaktualne — odśwież dane z serwera.'`.

### 4. AppStore: single new action `MERGE_CLOUD_ENTITIES`

- `{ type: 'MERGE_CLOUD_ENTITIES'; payload: CloudMergePayload }` where
  `CloudMergePayload = { clients: Client[]; projects: Project[]; tasks: Task[]; assignments: Array<{ taskId: string; personId: string }>; comments: Comment[]; activity: ActivityEvent[] }`.
- Merge semantics (never destroys local work): incoming row replaces the
  same-id local row; cloud-only rows are appended; LOCAL-ONLY rows are KEPT
  (never silently deleted — a locally-present row absent in the cloud may be
  unsynced/legacy; cross-client deletion propagation is a documented
  limitation of this stage). Assignments are reconciled by `(taskId, personId)`
  pair: existing local pair keeps its `TaskAssignment.id`; new pairs get
  `crypto.randomUUID()`. `workload` and every non-mirrored collection pass
  through untouched (same references).
- Fail-closed validation: a structurally invalid payload (non-array
  collections, rows failing the same guards the reducer applies —
  `isValidDateStr`/`periodError` on task/project dates, task referencing a
  missing project, assignment referencing missing task/person) → return the
  ORIGINAL state reference (invariant 6). Belt-and-braces with the repository
  filtering in Scope 2.
- Expose last dispatched action type: add `lastActionRef:
  React.MutableRefObject<Action['type'] | null>` to `StoreValue`, set inside a
  thin `dispatch` wrapper (`useCallback` around the reducer dispatch). No
  consumer signature changes; `useStore()` callers are untouched.

### 5. Bridge `src/supabase/CloudSyncProvider.tsx` + `src/components/CloudSyncBanner.tsx`

- Mounted in `src/main.tsx` inside `OrgDataProvider`, outside the router. Uses
  `useStore()`, `useAuth()`, `useOrgData()`. In local mode / signed out / org
  snapshot not ready: state `idle`, renders children only, creates no client.
- Hydration (non-blocking): when org snapshot becomes `ready` for a signed-in
  user (once per user id), build `CloudIdMaps`, `loadPlannerSnapshot`, dispatch
  `MERGE_CLOUD_ENTITIES`. The app keeps rendering localStorage data while
  loading — hydration failure shows the Polish error + `Spróbuj ponownie`
  (reload snapshot), local data stays fully usable.
- Mirroring: an effect on `state` diffs `prevRef.current` → `state` via
  `diffToCloudOps`, enqueues ops, runs one `applyCloudOps` at a time
  (serialized queue). `prevRef` advances when ops are enqueued.
- Diff suppression (exact list): transitions whose `lastActionRef` is
  `MERGE_CLOUD_ENTITIES` (our own hydration), `REPLACE_FROM_STORAGE` (another
  tab already mirrored it), `LOAD_SAMPLE`, `RESET_ALL` (sample/reset are
  local-only operations and must NEVER mass-delete or mass-insert cloud data)
  → set `prevRef = state`, emit nothing.
- `useCloudSync(): { status: 'idle' | 'hydrating' | 'ready' | 'error'; pendingCount: number; error: string | null; dropped: Array<{label, message}>; retry(): void; refresh(): void; dismissDropped(): void }`.
- Stale data (settled): last-write-wins on writes; manual refresh only.
  `refresh()` (banner button `Odśwież dane z serwera`, with `STALE_HINT_MSG`)
  re-runs snapshot load + merge and is ONLY offered when `pendingCount === 0`
  and there is no transient error — with unsynced local ops the banner shows
  the retry path instead (explicit, mirrors the tab-conflict philosophy). No
  polling, no realtime.
- `CloudSyncBanner` (Polish, in `App.tsx` shell): hydrating —
  `Wczytywanie danych z serwera…` (subtle); hydration error — message +
  `Spróbuj ponownie`; transient sync error — `SYNC_ERROR_MSG` + retry button
  (`retryPersist`-style); dropped permission ops — `SYNC_PERMISSION_MSG` +
  per-op labels + dismiss; ready + queue empty — refresh affordance. Local
  mode: renders `null`.

### 6. Import + dry-run extensions (keep stage-208 tooling truthful)

- `src/supabase/dataImport.ts`: move `clients`, `comments`, `activity` out of
  `UNSUPPORTED` into insert-only steps (same select-before-insert, skip-by-id,
  non-UUID diagnostic pattern): clients before projects (dependency); comments
  and activity after tasks, mapping author/actor/mentions through the existing
  `personIdMap` (unmappable author/actor → null, drop unmappable mention ids;
  comment whose parent project/task was not imported → failed + diagnostic).
  Project/task inserts now carry the full column set (`client_id`, `status_id`,
  `paid`, dates, `service_type_id`, `priority`, `estimated_hours`,
  `work_category_id`, `checklist`), resolving dictionary references through the
  maps built by the existing reference-collection steps (status by id-or-slug,
  service type / work category by id-or-name; empty local `''` → null).
  `milestones`, `workload`, `savedFilters` stay `UNSUPPORTED`.
- `src/store/exportDryRun.ts`: these three collections are no longer
  "no target table"; counts move to migratable. Extend both test files with the
  existing fake-db pattern.

### 7. Documentation

- `supabase/README.md`: matrix rows for `clients`, `comments`,
  `activity_events`; rewrite the transitional-boundary paragraph: in supabase
  mode planner clients/projects/tasks/assignments/comments/activity are
  mirrored to Supabase (writes) and hydrated on sign-in (merge, local-only rows
  kept); localStorage remains the render source and recovery copy; workload,
  people administration, milestones, saved filters and dictionary MUTATIONS
  remain local; sample/reset are local-only.
- End-of-task wiki: update `openwiki/n2hub/state-and-persistence.md` only (new
  boundary: cloud mirror + `MERGE_CLOUD_ENTITIES`, workload stays local).

### 8. Tests (node env, injected fakes, no jsdom, no SDK mocks)

- `plannerData.test.ts`: adapter-shape error classification (permission vs
  transient); snapshot mapping incl. reverse id maps, null↔`''` dates,
  unmappable people, invalid cloud rows excluded with diagnostics; atomic
  failure with `PLANNER_SNAPSHOT_ERROR`; empty collections valid.
- `cloudMirror.test.ts`: `buildCloudIdMaps` (email/slug/name fallbacks);
  diff per family — add/rename/delete client, save project incl. status change
  + `newClientName` (emits client upsert then project upsert), save/delete
  task, assignment set delta (composite upsert/remove), comment/activity
  append-only (local prune emits nothing); identical states → zero ops;
  a reducer-rejected command (same state reference) → zero ops; non-UUID /
  unmappable rows → diagnostics, no ops; `applyCloudOps`: transient stops and
  preserves the remaining queue, permission drops with Polish notice and
  continues.
- `cloudMerge.test.ts`: merge replaces by id, keeps local-only rows, appends
  cloud-only rows, preserves assignment ids by pair, leaves `workload`/
  `people`/`statuses`/`milestones`/`savedFilters` reference-identical; invalid
  payload → SAME state reference (invariant 6); valid merge then existing
  guards (`commandValidation.test.ts` suite) still green.
- `migrations.test.ts` extension per Scope 1; `dataImport.test.ts` /
  `exportDryRun.test.ts` extensions per Scope 6.

## Out of scope

- Any `workload` / WorkloadEntry / calendar persistence in Supabase; any change
  to scheduling, calendar/bin pointer code, `selectors.ts`, `storage.ts`,
  `commandValidation.ts`.
- Removing/weakening localStorage persistence, recovery screens, tab-conflict
  lifecycle, login gates, or local mode in any way.
- People administration writes (profiles remain provision-account +
  self-edit per stages 205–206), dictionary/status/department/service-type/
  work-category cloud MUTATIONS (209 read-only boundary stands), milestones,
  saved filters.
- Realtime subscriptions, polling, offline queues persisted across reloads,
  optimistic-lock/version columns, background retry/backoff.
- Cross-client deletion propagation for local-only rows (documented limitation)
  and reconciliation of workload against remotely-changed task dates (existing
  local guards own it on next edit; documented).
- Applying migrations to the hosted project (operator-owned). No push.

## Acceptance

- [ ] New migration exists, follows every convention, and `npx vitest run src/supabase/migrations.test.ts` passes with the extended expectations (clients CRUD; comments and activity_events select+insert; anon revoked).
- [ ] RLS scoping: admin global; manager — own-department projects/tasks/assignments and comments/activity on them; worker — own-assignment tasks (read+update), member projects (read), comments/activity on visible entities, own attributed rows. Verified statically by migrations.test.ts + policy text; behavioral scoping is RLS-owned.
- [ ] In supabase mode, every mutation of the seven groups dispatched through AppStore is mirrored to Supabase via `diffToCloudOps`/`applyCloudOps`; reducer stays pure; a reducer-rejected command emits zero ops.
- [ ] Cloud failure never loses work: state + localStorage keep the change; transient errors show `SYNC_ERROR_MSG` with working retry; permission-denied ops are dropped with `SYNC_PERMISSION_MSG` + labels; no state corruption (prior references preserved).
- [ ] Sign-in hydration merges cloud rows (same-id replace, local-only kept, workload untouched) without blocking the UI; hydration error state has `Spróbuj ponownie` and local data stays usable.
- [ ] `Odśwież dane z serwera` is available only with an empty pending queue; last-write-wins writes; `REPLACE_FROM_STORAGE`, `LOAD_SAMPLE`, `RESET_ALL`, `MERGE_CLOUD_ENTITIES` transitions are never mirrored.
- [ ] Local mode: zero behavioral diff (no client, no banner, no dispatches); full existing test suite green.
- [ ] Import/dry-run migrate clients/comments/activity and full project/task columns idempotently; dry-run no longer reports them as "no target table".
- [ ] All new strings Polish; `supabase/README.md` and `openwiki/n2hub/state-and-persistence.md` updated.

## Verification

- Worker: `npx vitest run src/supabase src/store/cloudMerge.test.ts src/store/commandValidation.test.ts src/store/exportDryRun.test.ts` (focused), then one full `npm test` and `npm run build` before reporting.
- Browser: none — calendar/bin interactions untouched; the banner renders `null` in local mode, so existing browser checks (local mode) see no diff. Release verification owns the matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Adapter mechanism: diff-based post-reducer mirror (state-diff → ops), NOT
  thunks and NOT action interception — invariant 6 makes rejected commands
  free (no diff → no ops), ids come from the reducer, and the reducer never
  forks. Upserts make double-mirroring (two tabs) idempotent.
- Repository split: `plannerData.ts` (DB boundary + snapshot + mappers) and
  `cloudMirror.ts` (id maps + diff + apply), both pure behind `PlannerDb`
  extending the `ImportDb` pattern; `dataImport.ts` itself stays insert-only.
- Existing core schema/RLS does NOT cover the task: clients, comments,
  activity_events tables and project/task planner columns are missing → new
  migration `20260716190000_planner_entities.sql` + migrations.test.ts
  extension (verified against the actual SQL of 20260715210000/210500/20260716150000).
- ID strategy: local `crypto.randomUUID` ids are the cloud PKs (dataImport
  precedent); people by email, statuses by slug, dictionaries by name as
  fallback maps; non-UUID legacy ids stay local-only with diagnostics.
- Hydration merges (cloud wins by id, local-only rows kept) — never deletes
  local rows; cross-client deletes don't propagate this stage (documented).
- Stale data: last-write-wins + manual `Odśwież dane z serwera` gated on an
  empty pending queue; conflicts stay explicit, mirroring the tab-conflict rule.
- Comments and activity are append-only server-side (no update/delete
  policies); entity deletion cleans them via FK cascade.
- Sample data and full reset never touch the cloud (suppressed transitions).
- 209 boundary supersession: cloud reads MAY now dispatch exactly one action
  (`MERGE_CLOUD_ENTITIES`) — the 209 "never dispatch" rule is retired for the
  seven groups and the docs say so; dictionaries/people mutations keep the 209
  read-only rule.
