# Run state — 20260716-185100-210 cloud projects and tasks

## Goal

Move clients, projects, tasks, assignments, task status changes, comments and
activity events to Supabase with role-scoped RLS (admin global / manager
own-department / worker own-assignment), behind AppStore via a pure repository
+ diff-based cloud mirror. Workload stays local; localStorage recovery stays;
local mode byte-identical. Polish UX for loading/error/retry/stale.

## Packages

- `handoffs/scheduler-reviews/210-architect-package.md`
  (PKG-20260716-cloud-planner-data) — Tier: developer, Risk: high,
  Codex: required. Status: ready.

## Changed boundaries (planned)

- New migration `supabase/migrations/20260716190000_planner_entities.sql`:
  `clients`, `comments`, `activity_events` tables + planner columns on
  `projects`/`tasks`; RLS in-file; `migrations.test.ts` extended.
- New pure modules `src/supabase/plannerData.ts` (PlannerDb adapter, snapshot
  load, mappers) and `src/supabase/cloudMirror.ts` (id maps, state-diff → ops,
  apply with permission/transient classification), plus tests.
- `src/store/AppStore.tsx`: single new reducer action `MERGE_CLOUD_ENTITIES`
  (merge by id, local-only rows kept, workload untouched, invalid payload
  preserves prior reference) + `lastActionRef`; reducer otherwise untouched.
- New `src/supabase/CloudSyncProvider.tsx` + `src/components/CloudSyncBanner.tsx`
  (hydration, serialized mirror queue, suppression of REPLACE_FROM_STORAGE /
  LOAD_SAMPLE / RESET_ALL / merge transitions, refresh gated on empty queue).
- `dataImport.ts`/`exportDryRun.ts` extended for the new tables/columns.
- Docs: `supabase/README.md` + `openwiki/n2hub/state-and-persistence.md`.

## Verification

- Worker: `npx vitest run src/supabase src/store/cloudMerge.test.ts
  src/store/commandValidation.test.ts src/store/exportDryRun.test.ts`, then one
  full `npm test` + `npm run build`.
- Browser: none (local mode unchanged; calendar/bin untouched).
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Open questions

None — adapter mechanism (post-reducer diff mirror), new-migration decision,
ID strategy (local UUIDs as cloud PKs; email/slug/name fallback maps), merge
semantics (never delete local rows) and stale handling (LWW + gated manual
refresh) are settled in the package.

## Developer result — 210 (PKG-20260716-cloud-planner-data)

Built the full scope: migration `20260716190000_planner_entities.sql`
(clients/comments/activity_events + planner columns; RLS in-file; migrations.test
extended). New pure `plannerData.ts` (PlannerDb, classifyWriteError, snapshot
load/mappers) + `cloudMirror.ts` (buildCloudIdMaps, diffToCloudOps, applyCloudOps)
with tests. AppStore: `MERGE_CLOUD_ENTITIES` (fail-closed, workload untouched) +
`lastActionRef` dispatch wrapper; reducer otherwise untouched. `CloudSyncProvider`
+ `CloudSyncBanner` mounted (main.tsx/App.tsx). dataImport (clients/comments/
activity + full project/task columns) and exportDryRun updated. Docs updated.
Focused `npx vitest run src/supabase src/store/cloudMerge.test.ts
commandValidation.test.ts exportDryRun.test.ts`: 198 pass. Full `npm test`: 863
pass (29 files). `npm run build`: pass. Deviations: (1) `CloudOp` carries an
optional `onConflict` field (needed for composite assignment upsert; keeps
applyCloudOps generic). (2) Diff resolves department refs leniently (unmappable
non-'' → null, like import's deptFallback) while status/service/work-category
refs block+diagnose per package. Reviewer: verify RLS policy text (new tables)
and that the ready+empty banner surfacing STALE_HINT_MSG persistently is
acceptable UX.
