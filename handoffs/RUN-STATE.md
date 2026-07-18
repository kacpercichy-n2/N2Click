# Run state — 20260716-235101-211 cloud workload/calendar + localStorage retirement

## Goal

Mirror workload entries (planned hours, calendar drag/resize, bin) and
milestones to Supabase through the 210 plannerData/cloudMirror architecture,
hydrate them via `MERGE_CLOUD_ENTITIES`, add an admin-only Polish
migration-status view, and — only after an explicit admin handshake (coverage
clean, snapshot read, probe write round-trip, backup downloaded) — suspend
per-action localStorage planner writes, keeping localStorage as a passive,
never-deleted recovery copy. Local mode stays byte-identical.

## Packages

- `handoffs/scheduler-reviews/211-architect-package.md`
  (PKG-20260717-cloud-workload-retirement) — Tier: developer, Risk: high,
  Codex: required. Status: ready.

## Changed boundaries (planned)

- New migration `20260717000000_workload_planner_retirement.sql`:
  `workload_entries` (grid CHECKs, one-bin-row partial unique index, RLS
  admin/manager-dept/worker-own-rows), `milestones`, `app_settings`
  (org retirement flag); `migrations.test.ts` extended.
- `plannerData.ts`/`cloudMirror.ts`: workload+milestone mapping and diff
  families; constraint-violation codes (23xxx) reclassified drop-not-retry.
- `AppStore.tsx`: `MERGE_CLOUD_ENTITIES` payload gains workload/milestones
  (bin pair reconciled, invalid payload keeps prior reference); persist effect
  consults new pure `persistGate.ts` (marker + mirror-health + mirrored-only
  collection check; non-mirrored collections always persist locally).
- `storage.ts`: marker helpers only, new key `n2hub.cloudMigration.v1`.
- New `migrationStatus.ts` + `MigrationStatusPanel.tsx` in AdminPage;
  `CloudSyncProvider` safety-net/recovery writes; dataImport/exportDryRun
  extended; README + state-and-persistence wiki. `DATA_VERSION` stays 7.
- Calendar/bin interaction code untouched (verified reducer-only mutations).

## Verification

- Worker focused: `npx vitest run src/supabase src/store/persistGate.test.ts
  src/store/cloudMerge.test.ts src/store/storage.test.ts
  src/store/blockActions.test.ts src/store/commandValidation.test.ts
  src/store/exportDryRun.test.ts`, then one full `npm test` + `npm run build`.
- Browser: none (interaction code untouched; local mode identical).
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Open questions

None — collection scope (milestones in, savedFilters out), retirement handshake,
marker placement, gate semantics, RLS scoping and version decision are settled
in the package.

## Developer result — 211 (PKG-20260717-cloud-workload-retirement)

Built end to end. Files (one-liners):
- `supabase/migrations/20260717000000_workload_planner_retirement.sql`: NEW —
  `workload_entries` (grid CHECKs + partial unique bin index), `milestones`,
  `app_settings`; RLS + anon revoke + policies (workload role-scoped, milestones
  by project, app_settings read-all/admin-write), reuses `app.*` helpers.
- `migrations.test.ts`: +filename, +3 policy sets.
- `plannerData.ts`: constraint-code fix (23502/03/05/14→permission);
  `CloudMergePayload` +workload/+milestones; snapshot selects+maps (bin null↔'',
  grid revalidation, dup-bin/unmappable exclusion); `readRetirementSetting`/
  `writeRetirementSetting`/`RETIREMENT_SETTING_KEY`.
- `cloudMirror.ts`: milestones+workload diff families; dep order clients→…→
  workload→comments→activity; Polish labels.
- `AppStore.tsx`: `MERGE_CLOUD_ENTITIES` +milestones/+workload merge with bin-pair
  reconcile (cloud id, grid-snapped sum) + fail-closed guards; `mergeById` empty
  short-circuit; persist effect consults `shouldSkipLocalPersist`.
- NEW `persistGate.ts` (health flag + collection scope + marker/env), `storage.ts`
  marker helpers on `n2hub.cloudMigration.v1` (clearData untouched), `config.ts`
  `isSupabaseConfigured()`.
- NEW `migrationStatus.ts` (coverage report + handshake), `MigrationStatusPanel.tsx`
  mounted after `ExportDryRunPanel`; `CloudSyncProvider` health/recovery writes/
  pagehide/app_settings sync + `retired`/`applyRetirement`.
- `dataImport.ts`/`exportDryRun.ts` (+workload/milestone steps/targets/blockers,
  unsupported = only saved filters); README + state-and-persistence wiki.

Tests: focused `npx vitest run src/supabase src/store/persistGate.test.ts
cloudMerge/storage/blockActions/commandValidation/exportDryRun` → 494 pass, 0
fail. Full `npm test` → 31 files, 901 pass. `npm run build` → green.

Deviations (minimal, justified):
1. `runRetirementHandshake` probe takes a `taskId` (not only rowId+profileId) —
   `workload_entries.task_id` is NOT NULL/FK, so a bin probe needs a real cloud
   task; panel supplies the first UUID task; missing/invalid → step fails with a
   Polish message. Faithful to "probe workload_entries bin row".
2. `isSupabaseConfigured()` reads `import.meta.env` merged with `globalThis.process
   .env` (via globalThis, no @types/node) so vitest `vi.stubEnv` can drive it;
   `import.meta.env` stays authoritative in the browser.
3. `MigrationStatusPanel`/handshake build their own `PlannerDb` via
   `getSupabaseClient()` (singleton, same as `ExportDryRunPanel`) rather than
   routing every dep through `CloudSyncProvider` — keeps the provider lean.

Reviewer scrutiny: (a) SQL policy/CHECK/index wording + migrations.test parser
match; (b) bin-pair merge summing + fail-closed guard completeness in
`mergeCloudEntities`; (c) gate health/marker/env interplay and that skipping never
yields a false `Zapisano`; (d) recovery-write timing in `CloudSyncProvider`
(status→ready effect, queue-drain, transient error, pagehide). `scheduling-and-
calendar.md` left unchanged — interaction code (WeekView/WorkloadPage/time/
selectors) is untouched; workload still flows through reducer actions only.

## 20260718-021229-213 hydration safety (dev)

Fixed: plannerData cascade-excludes descendants of excluded projects/tasks; null/unresolvable status_id falls back to first active status (projects+tasks); new hydrationOutcome.ts makes CloudSyncProvider surface a Polish error when MERGE rejects (was silent 'ready'). Fixes 3+4 (people cloud-merge) BLOCKED — applyCloudPeople/mergeCloudPeople don't exist; people stay local. npm test 915/915, build pass.

## 20260718-022729-214 select pagination (dev)

Paginated `createSupabaseImportDb.select` (src/supabase/dataImport.ts:38-73): loops `.range()` per fresh query, ordering by every selected column, stopping on a short page; exported `SELECT_PAGE_SIZE = 1000`. Any-page error returns `{ rows: [], error }`. All callers inherit fix, no signature change. Added 5 pagination tests. vitest 61/61, build pass. Parallel dev's opQueue files untouched.

## 20260718-022729-214 durable cloud queue (dev)

New src/supabase/opQueue.ts (pure: encode/decode fail-closed, planQueueRestore/Deactivation/HydrationStep, Polish notices) + opQueue.test.ts. storage.ts: n2hub.cloudQueue.v1 helpers (untouched by clearData). CloudSyncProvider drains durable queue before snapshot merge, enqueues hydrating-window edits, keeps durable copy on deactivation; new notice+dismissNotice in banner. vitest 195/195, build pass. dataImport.ts untouched.

## 20260718-030057-216 performance hot paths (dev)

Behavior-identical perf fixes: cloudMirror.ts diffToCloudOps skips unchanged collections by array-ref + adds `before===row` fast-path before stringify. selectors.ts: WeakMap-cached one-pass `bookedHoursByPersonDate` powers the 4 overload/conflict selectors (O(W) not O(W²)). WorkloadPage.tsx: one-pass hours map. AppStore.tsx: 9 rejected commands now return prior state ref (invariant 6); deleteStatus already did. Tests added in 3 files. npm test 976/976, build pass.
