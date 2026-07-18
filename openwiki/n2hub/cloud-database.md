# Cloud database (Supabase)

## Boundaries

- `src/supabase/` is the only cloud boundary; `src/auth/` owns the session gate
  on top of it. Mode is decided once at startup (`src/auth/mode.ts`): valid
  `VITE_SUPABASE_*` config → supabase mode; otherwise local mode with zero cloud
  code paths (no client is ever created).
- `src/supabase/client.ts` + `config.ts` own the lazily created client and env
  validation (publishable key only — secret/service_role keys are rejected).
- Schema and RLS live in `supabase/migrations/*.sql`: `profiles`, `departments`,
  `statuses`, `service_types`, `work_categories`, `clients`, `projects`,
  `project_members`, `milestones`, `tasks`, `task_assignments`,
  `workload_entries`, `comments`, `activity_events`, `app_settings`. RLS is the
  security boundary; client-side checks are UX only.
- Write path: `src/supabase/cloudMirror.ts` diffs state after each reducer
  action into upsert/remove ops executed via `plannerData.ts`
  (`CloudSyncProvider.tsx` is the React bridge). Read path: hydration on sign-in
  merges the eight planner families through the single `MERGE_CLOUD_ENTITIES`
  action. People are update-only profile projections — no cloud path creates or
  deletes local `people` rows. Details, queue durability and the retirement gate:
  [state-and-persistence.md](state-and-persistence.md).
- `src/supabase/provisioning.ts` + `supabase/functions/provision-account/` own
  admin account provisioning; `dataImport.ts` owns the one-time localStorage
  import; `migrationStatus.ts` owns the reversible retirement handshake.

## Rules that change work

- Never import `@supabase/supabase-js` outside `src/supabase/`; never read
  `VITE_SUPABASE_*` outside `config.ts`.
- Cloud errors must never lose local work: failed writes queue durably or fall
  back to localStorage with a Polish diagnostic; a failed save never reports
  `Zapisano`.
- Rejected reducer commands (same state reference) must produce zero cloud ops.
- Schema changes require a new file in `supabase/migrations/` with matching RLS
  policies; keep `.env.example` in sync.

## Start here for

Supabase schema, RLS policies, auth/session, cloud mirror and hydration wiring,
account provisioning, the localStorage import and the retirement handshake.

## Relevant tests

`src/supabase/*.test.ts` (config, session, cloudMirror, plannerData, opQueue,
hydrationOutcome, dataImport, migrationStatus, migrations, provisioning),
`src/store/persistGate.test.ts`.
