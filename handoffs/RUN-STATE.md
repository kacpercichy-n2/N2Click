# Run state — 20260721-144300-242 job titles dictionary from UI

## Goal

Admin-managed `jobTitles` dictionary ("Stanowiska" on AdminPage), wired into
the profile "Stanowisko" select (merged with department-derived options and
the legacy free-text value — nothing disappears), persisted additively
(v7 stays) and mirrored to a new `public.job_titles` table (admin-write RLS)
via the departments dictionary path.

## Packages

- `handoffs/scheduler-reviews/242-architect-package.md`
  - PKG-20260721-job-titles-dictionary — developer, medium risk, Codex
    required. Status: ready.

## Changed boundaries (planned)

- types.ts `JobTitle` + `AppData.jobTitles`; AppStore ADD/RENAME/DELETE_JOB_TITLE
  (invariant-6 same-ref rejections incl. case-insensitive duplicates) and
  `CloudDictionariesPayload.jobTitles` in `mergeCloudDictionaries`.
- storage.ts emptyData + coerceArray; persistGate NON_MIRRORED_KEYS; seed.
- AdminPage "Stanowiska" (SimpleList reuse) + cloud preview; PersonProfilePage
  select via new `roleTitles.jobTitleSelectOptions` (accessRoleForTitle and
  roleTitleOptions untouched).
- Cloud: `supabase/migrations/20260721150000_job_titles.sql` (idempotent,
  house RLS, realtime publication), migrations.test list + EXPECTED_POLICIES,
  referenceData OrgSnapshot select, App.tsx dictionary dispatch, cloudMirror
  fifth dict diff entry.

## Deviation (recorded)

Prompt asked for plannerData.ts + CloudMergePayload wiring; dictionaries
hydrate via referenceData → MERGE_CLOUD_DICTIONARIES (departments path), so
plannerData stays untouched.

## Verification

- Focused: new jobTitles suite + storage/roleTitles/migrations/referenceData/
  cloudMirror/taskMeta/persistGate/cloudMerge/exportDryRun/plannerData; build.
- Browser: none — no pointer-path changes.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Open questions

- None blocking. Wiki after green: state-and-persistence + cloud-database
  (both declared) need the new collection/table bullets.

## Developer result (green)

Implemented all boundaries per package (no plannerData change). Fixed extra
OrgSnapshot literals (projectDocuments/cloudMirror/migrationStatus/referenceData
tests) for the new required field. Focused suites pass; `npm test` 1166 pass
(43 files), `npm run build` green. Both declared wiki pages updated. No
deviations beyond the pre-recorded hydration-path one.
