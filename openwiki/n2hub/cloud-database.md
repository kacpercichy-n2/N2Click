# Cloud database (Supabase)

## Boundaries

- Hosted project: `rclcndcgxbpndpmuemww` (region-default, production alias
  `n2click.vercel.app`). Frontend reaches it only through
  `src/supabase/client.ts` (lazy singleton) with `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY`; missing/invalid env falls back to local mode
  (`src/auth/mode.ts` `detectAuthMode`, silent by design).
- Schema truth lives in `supabase/migrations/` (forward-only,
  `YYYYMMDDHHMMSS_opis.sql`, applied files are immutable). Applied versions are
  recorded in `supabase_migrations.schema_migrations` on the hosted project.
  `src/supabase/migrations.test.ts` pins the expected file list and the RLS
  deny-by-default convention — a new migration must be added there.
- All authorization lives in SQL (RLS policies + `app.*` SECURITY DEFINER
  helpers + protective triggers). Client-side checks are UX only.

## Tables and relations

- `departments` — dictionary. `profiles.department_id`,
  `projects.department_id` → `on delete set null`.
- `profiles` — 1:1 with `auth.users` (same id, `on delete cascade`). Fields:
  `first_name` (required 1–100), `last_name`, `email`, `role_title`
  (stanowisko), `access_role` (enum `administrator|manager|worker`),
  `department_id`, `avatar_path` (private `avatars` bucket,
  `<profile id>/<file>`), `must_change_password` (UX gate: forced first-login
  password change, self-cleared after a successful change),
  `supervisor_id` → `profiles.id` (przełożony; nullable, `on delete set null`,
  no self-reference; only administrators may change it — enforced by the
  `app.protect_profile_privileges` trigger, same as `access_role` and
  `department_id`). There is NO auto-provisioning trigger on `auth.users`:
  profiles are created by the provisioning Edge Function or operator SQL.
- `clients`, `statuses`, `service_types`, `work_categories` — org-wide
  dictionaries; read by every authenticated user, mutations admin-only
  (clients: insert also manager).
- `projects` → `client_id`, `status_id`, `service_type_id`, `department_id`;
  `project_members (project_id, profile_id)` is the explicit worker access
  list. `tasks` → `project_id` (cascade), `status_id`, `work_category_id`,
  `created_by`; `task_assignments (task_id, profile_id)` is task ownership.
- `workload_entries` — planned hours; `task_id` + `profile_id` cascade,
  `work_date NULL` = bin sentinel (unique partial index per
  `(task_id, profile_id)`), grid CHECKs (0.25h, 15-minute starts, day
  boundary). `milestones` → `project_id`. `comments` and `activity_events`
  are append-only (no UPDATE/DELETE policies). `app_settings` — org runtime
  flags (`local_writes_retired`).
- Access model: administrator = everything; manager = own department
  (profiles, projects, memberships/assignments restricted to own-department
  people); worker = own profile, member projects (read), assigned tasks
  (read/update), own workload rows.

## Rules that change work

- New tables/columns arrive ONLY via a new forward-only migration file +
  registry insert + `migrations.test.ts` list update; never edit applied files.
- Every new table: enable RLS in the same file, `revoke all ... from anon`,
  policies `to authenticated` with `with check`, no
  `force row level security` (definer-helper recursion).
- `anon` (publishable) key has no data access — everything requires an
  authenticated session; the key is safe to expose in the client bundle.
- Cloud reads/writes go through the injected-adapter pure modules
  (`src/supabase/referenceData.ts`, `plannerData.ts`, `cloudMirror.ts`,
  `dataImport.ts`) — never raw SDK calls scattered in components (thin page
  wiring like TeamPage supervisor update is the exception and must rely on RLS
  for the real guarantee).

## Relevant tests

`src/supabase/migrations.test.ts` (file list + RLS conventions),
`referenceData.test.ts` (org snapshot mapping incl. `supervisor_id`),
`plannerData.test.ts`, `cloudMirror.test.ts`, `dataImport.test.ts`,
`migrationStatus.test.ts`, `src/auth/session.test.ts`,
`passwordChange.test.ts` (forced-change flow), `src/store/persistGate.test.ts`.
