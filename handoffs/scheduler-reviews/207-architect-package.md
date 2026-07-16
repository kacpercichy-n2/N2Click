# Handoff: Add admin-only localStorage export + Supabase migration dry-run tool

- Package ID: PKG-20260716-export-dry-run
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium (touches storage.ts, the sole localStorage boundary — read path only)
- Codex review: conditional — required only if the storage.ts refactor changes more than the read-path extraction described below

## Goal

A read-only, admin-only tool on the Administracja page that (a) downloads a
sanitized JSON backup of the persisted planner data and (b) renders a Supabase
migration dry-run report (counts, ID mappings, unsupported fields, blockers).
It never writes to Supabase and never mutates localStorage or app state.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`

## Expected touchpoints

- `src/store/storage.ts` — add a side-effect-free read export (see Scope 1)
- `new: src/store/exportDryRun.ts` — pure export/dry-run logic
- `new: src/store/exportDryRun.test.ts` — focused tests
- `new: src/components/ExportDryRunPanel.tsx` — UI panel
- `src/pages/AdminPage.tsx` — render the panel as the last admin section
- Read-only reference: `src/types.ts`, `supabase/migrations/20260715210000_core_schema.sql`

## Invariants

- `src/store/storage.ts` stays the ONLY localStorage boundary; the new tool
  must not call `localStorage` directly anywhere (module or component).
- No writes: no Supabase calls at all (do not import `src/supabase/*`), no
  `saveData`, no `clearData`, no new reducer actions, no dispatch. The tool is
  pure read + render + file download.
- Existing `loadDataResult()` behavior and its `latestKnownRevision` bookkeeping
  must not change for the app load path (storage.test.ts must stay green).
- Data version stays 7; no schema/version bump.
- All user-facing strings in Polish. TypeScript strict, no new dependencies.

## Scope

1. **storage.ts read-without-side-effects export.** Extract the existing body
   of `loadDataResult()` into a private helper parameterized by
   `recordRevision: boolean`. Keep `loadDataResult()` byte-for-byte equivalent
   in behavior (records revision). Add:
   `export function peekDataResult(): PeekDataResult` where
   `PeekDataResult = ({ ok: true; data: AppData; storedVersion: number } | { ok: false; reason: LoadFailureReason; error: Error })`.
   `peekDataResult` runs the same parse/migration/repair pipeline but (a) never
   mutates `latestKnownRevision` (assert via `getLatestKnownRevision()` in a
   test) and (b) never writes to localStorage. `storedVersion` is the raw
   `version` field found in the stored JSON (1 when absent, matching the load
   path). A missing key returns `{ ok: true, data: emptyData(), storedVersion: DATA_VERSION }`.

2. **Pure logic module `src/store/exportDryRun.ts`.**
   - `buildExportPayload(data: AppData, storedVersion: number, now: Date): ExportPayload`
     returns `{ format: 'n2hub-backup', appDataVersion: DATA_VERSION, storedVersion, exportedAt: <ISO from now>, data: <sanitized AppData> }`.
     Sanitization: every `person.passwordHash` → `''`; `currentUserId` → `''`;
     `impersonatorId` → `''`. Nothing else altered; no `revision` field (peek
     data never carries one). No credentials/tokens may appear in the output.
   - `buildDryRunReport(data: AppData): DryRunReport` mapping the current model
     onto the Supabase core schema (tables: `departments`, `profiles`,
     `projects`, `project_members`, `tasks`, `task_assignments`; enum
     `access_role`: administrator | manager | worker). Report contents:
     - `counts`: source-collection counts and target-table row counts
       (people→profiles, departments→departments, projects→projects,
       tasks→tasks, assignments→task_assignments; project_members derived as
       distinct (projectId, personId) pairs from assignments joined through
       tasks — count only, no invented rows).
     - `idMappings`: needed remaps, at minimum: every Person needs a new
       `auth.users` id (profiles.id references auth.users — local person ids
       cannot be reused), listed with count; note that other local ids are
       already UUIDs and can carry over.
     - `roleMapping`: administrator→administrator, pm→manager,
       handlowiec→worker, pracownik→worker, with per-role person counts.
     - `unsupported`: (a) whole collections with no target table: clients,
       serviceTypes, workCategories, statuses, milestones, workload, comments,
       activity, savedFilters; (b) per-entity dropped fields: Project
       (clientId, statusId, paid, startDate, endDate, serviceTypeId), Task
       (statusId, startDate, endDate, estimatedHours, priority,
       workCategoryId, checklist), Person (phone, passwordHash, avatar,
       capacity, workDays, workStartMinutes, workEndMinutes, supervisorId).
       Only list non-empty collections / fields actually carrying non-default
       values where cheap to detect; a static list per entity is acceptable —
       decide once and keep tests aligned.
     - `blockers`: violations of the SQL checks and FKs, each with entity id
       and Polish message: empty or >200-char department name; empty or
       >100-char person firstName; empty or >300-char project name; empty or
       >300-char task title; task with dangling projectId; assignment with
       dangling taskId or personId; person departmentId dangling (warning,
       not blocker — column is nullable `on delete set null`); duplicate
       (taskId, personId) assignments (PK conflict → blocker).
     The report is deterministic and pure — no Date.now/randomness inside.

3. **UI `src/components/ExportDryRunPanel.tsx`**, rendered at the bottom of the
   admin branch of `AdminPage` (after existing sections) inside an
   `editor-section` div, so it inherits both the route gate (`admin.panel` in
   App.tsx) and AdminPage's own `isAdminUser` gate — no new gating logic.
   - Heading: `Eksport danych i symulacja migracji`.
   - Permanent hint (field-hint style): `Narzędzie tylko do odczytu (dry run):
     niczego nie zapisuje w Supabase ani nie zmienia danych w tej
     przeglądarce.`
   - Button `Pobierz kopię zapasową (JSON)`: calls `peekDataResult()`; on
     success builds the payload and downloads via
     `new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })`
     + `URL.createObjectURL` + a temporary `<a download>` click +
     `URL.revokeObjectURL`. Filename: `n2hub-kopia-zapasowa-<yyyy-MM-dd>.json`
     (use `todayStr()` from `src/utils/dates.ts`).
   - Button `Uruchom symulację migracji`: calls `peekDataResult()` +
     `buildDryRunReport`, renders the report inline: counts table, role/ID
     mapping list, unsupported list, blockers list. Blockers visually distinct
     (e.g. existing error/danger styling). Result header must repeat the
     dry-run label, e.g. `Wynik symulacji (bez zapisu)`.
   - When `peekDataResult()` fails: show the Polish `error.message` from the
     result plus reason-appropriate hint; no download, no report. Never throw.

4. **Tests `src/store/exportDryRun.test.ts`** (vitest, stub localStorage like
   `src/store/storage.test.ts` does for the peek path):
   - valid data: peek succeeds, `buildExportPayload` strips passwordHash /
     currentUserId / impersonatorId, includes format + versions + exportedAt;
     `getLatestKnownRevision()` unchanged by `peekDataResult()`; localStorage
     content unchanged after peek (no echo-write).
   - malformed data: stored garbage JSON → `peekDataResult()` returns
     `{ ok: false, reason: 'malformed' }`; structurally invalid →
     `'invalid'`; storage throwing → `'unavailable'`.
   - mapping diagnostics: fixture with a dangling task.projectId, a >300-char
     project name, an empty firstName, a duplicate assignment pair and one of
     each access role → report lists exactly those blockers, correct counts,
     role mapping counts, person-id remap entry, unsupported collections.

## Out of scope

- Any import/restore path, any localStorage deletion or write-back changes.
- Any Supabase client usage, network calls, or new migrations.
- Changes to reducers, selectors, save/revision protocol, recovery screen or
  `exportRawData` (the recovery raw-export stays as is).
- Mapping workload/statuses/clients into Supabase (schema does not model them
  yet — they are report content, not migration targets).
- Browser test scripts; wiki edits beyond the report-back note.

## Acceptance

- [ ] Admin sees the new section on /admin; non-admins never reach it (existing
      gates; no new route).
- [ ] Backup download produces JSON with metadata and NO passwordHash /
      currentUserId / impersonatorId values; localStorage byte-identical after.
- [ ] Dry-run report shows counts, role/ID mappings, unsupported fields and
      blockers for the current data; clearly labeled as a no-write simulation;
      all strings Polish.
- [ ] Malformed/invalid/unavailable storage yields a friendly Polish error in
      the panel, no crash, no writes.
- [ ] `peekDataResult()` never changes `getLatestKnownRevision()` and existing
      `storage.test.ts` passes unmodified (additions allowed, edits not).
- [ ] No `localStorage` reference outside `src/store/storage.ts`; no
      `src/supabase/*` import in the new files.

## Verification

- Worker: `npx vitest run src/store/exportDryRun.test.ts src/store/storage.test.ts`
  then `npm run build`.
- Browser: none — new isolated read-only panel; no covered stability-sensitive
  interaction (calendar/bin pointer paths untouched).
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Read API: extend storage.ts with `peekDataResult()` (side-effect-free variant
  of `loadDataResult`) rather than reading localStorage in the tool or reusing
  React state — the task requires validating the persisted payload itself.
- Export uses the normalized (post-migration/repair) AppData, not the raw
  string; raw recovery export already exists (`exportRawData`) and is untouched.
- UI lives on AdminPage as a section, not a new route — reuses existing admin
  gating and matches how the team-account UI was added.
- Download mechanism: Blob + object URL + temporary anchor (no dependency).
- Role mapping follows the working assumption documented in
  `20260715210000_core_schema.sql` (pm→manager, handlowiec/pracownik→worker).
- Tests live with the logic in `src/store/` and are inseparable from the
  implementation (single developer package, no test-writer split).
