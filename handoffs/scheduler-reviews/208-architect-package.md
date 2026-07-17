# Handoff: Add guarded, idempotent admin-only import from localStorage export into Supabase

- Package ID: PKG-20260716-supabase-import
- Status: ready
- Tier: developer
- Depends on: PKG-20260716-export-dry-run (merged: `src/store/exportDryRun.ts`, `peekDataResult`, `ExportDryRunPanel`)
- Risk: high (first write path from the app into Supabase; idempotency and partial-failure semantics must be exactly right)
- Codex review: required — new remote write boundary; a subtle idempotency or ordering bug silently corrupts the target database on rerun

## Goal

An administrator-only, explicitly confirmed import that writes the peeked
localStorage data into Supabase in dependency-safe order, is safe to rerun
(select-before-insert, never update/overwrite), continues past per-record
failures, and renders a Polish summary (imported / skipped / failed +
actionable diagnostics). It never mutates localStorage or app state and never
creates auth users.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md` (read path only; no persistence
  behavior changes). There is no wiki page for the `src/supabase/` area —
  context comes from the source files listed below.

## Expected touchpoints

- `new: src/supabase/dataImport.ts` — all import logic (gate, mapping, run)
- `new: src/supabase/dataImport.test.ts` — focused tests (fake `ImportDb`)
- `src/components/ExportDryRunPanel.tsx` — add the import section (modified;
  update its header comment: the panel is no longer read-only)
- Read-only reference (do NOT modify): `src/store/exportDryRun.ts`,
  `src/store/storage.ts` (`peekDataResult`), `src/auth/profile.ts`
  (`normalizeEmail`), `src/auth/SessionProvider.tsx` (`useAuth`),
  `src/supabase/client.ts` (`getSupabaseClient`), `src/types.ts`,
  `supabase/migrations/20260715210000_core_schema.sql`,
  `supabase/migrations/20260715210500_rls_policies.sql`

## Invariants

- `src/store/storage.ts` stays the ONLY localStorage boundary. The new code
  contains zero `localStorage` references and reads planner data exclusively
  through the existing `peekDataResult()`. Nothing is ever deleted or written
  locally — the local backup/export path and recovery screen stay untouched.
- No reducer actions, no dispatch, no changes to `AppStore`, selectors,
  storage, or `exportDryRun.ts`. Active planner reads stay on localStorage.
- Existing export + dry-run behavior of `ExportDryRunPanel` is unchanged
  (`exportDryRun.test.ts` and `storage.test.ts` pass unmodified).
- Import NEVER creates or updates `auth.users` or `public.profiles` rows and
  NEVER updates any existing row in any table — insert-only, after checking
  existence. No `upsert`, no `update`, no `delete` anywhere in the new code.
- No new SQL migration. The current schema's PKs are sufficient (see Prior
  decisions); do not add a `source_local_id` column or marker table.
- Client-side gating is UX only — RLS (admin policies in
  `20260715210500_rls_policies.sql`) remains the real authorization boundary.
- All user-facing strings Polish. TypeScript strict. No new npm dependencies.
- Do not touch scheduler runtime files or the queue; no commits.

## Scope

1. **Minimal DB interface + thin adapter (`src/supabase/dataImport.ts`).**
   Follow the repo's dependency-injection test pattern (`src/auth/session.ts`
   `MinimalAuthClient`, `provisioning.ts` injected fetch) — do NOT `vi.mock`
   the Supabase SDK.

   ```ts
   export interface ImportDb {
     /** SELECT columns FROM table [WHERE inFilter.column IN (inFilter.values)]. */
     select(
       table: string,
       columns: string,
       inFilter?: { column: string; values: string[] },
     ): Promise<{ rows: Array<Record<string, unknown>>; error: string | null }>;
     /** INSERT one row; resolves { error: null } on success. Never throws. */
     insert(
       table: string,
       row: Record<string, unknown>,
     ): Promise<{ error: string | null }>;
   }

   export function createSupabaseImportDb(client: SupabaseClient): ImportDb;
   ```

   `createSupabaseImportDb` wraps `client.from(t).select(c)` /
   `.select(c).in(col, values)` / `.from(t).insert(row)` and maps any thrown
   or returned error to `error: string` (raw SDK messages may pass through to
   diagnostics — they are technical, not secrets; never log tokens). Keep the
   adapter trivially thin; all logic lives behind `ImportDb` so tests inject a
   fake. Chunk every `IN` filter at 100 values inside `runSupabaseImport`
   (callers of `select` pass pre-chunked lists or the helper chunks —
   developer's choice, but the 100 cap must hold).

2. **Pure gate function (testable admin gating).**

   ```ts
   export const IMPORT_CONFIRMATION_WORD = 'IMPORTUJ';

   export interface ImportGateInput {
     isAdmin: boolean;                 // isAdminUser(state) from the page
     authMode: 'local' | 'supabase';   // useAuth().mode
     signedIn: boolean;                // useAuth().state.status === 'signedIn'
     report: DryRunReport | null;      // last dry-run rendered in the panel
     confirmationText: string;         // raw input value
   }

   export type ImportGateResult =
     | { allowed: true }
     | { allowed: false; reason: string }; // Polish, user-visible

   export function evaluateImportGate(input: ImportGateInput): ImportGateResult;
   ```

   Checks in order, first failure wins (exact copy in the copy section):
   admin → supabase mode → signed in → report exists → zero blockers →
   confirmation text equals `IMPORTUJ` (trimmed, case-sensitive). The UI
   disables the import button whenever `allowed` is false and shows `reason`.

3. **Import runner.**

   ```ts
   export interface ImportCollectionSummary {
     collection: string; // target table or 'people' / unsupported collection key
     label: string;      // Polish label
     imported: number;
     skipped: number;    // already present / mapped / no target table
     failed: number;
   }

   export interface ImportDiagnostic {
     collection: string;
     entityId: string;   // offending source id or pair key `${a}|${b}`
     message: string;    // Polish, actionable
   }

   export interface ImportRunResult {
     completed: boolean;        // false = refused before any write
     refusedReason?: string;    // Polish, set only when completed === false
     summary: ImportCollectionSummary[];
     diagnostics: ImportDiagnostic[];
   }

   export async function runSupabaseImport(
     data: AppData,
     report: DryRunReport,
     db: ImportDb,
   ): Promise<ImportRunResult>;
   ```

   Defense in depth: if `report.blockers.length > 0`, refuse immediately
   (`completed: false`, no `db` call). The function performs NO gating on
   roles (that is `evaluateImportGate` + RLS) and never throws — every `db`
   error becomes a `failed` count + diagnostic.

4. **Dependency-safe order and per-collection algorithm.** Derived from the
   FKs in `20260715210000_core_schema.sql`; process strictly in this order:

   1. `departments` — `select('departments', 'id, name')` (admin reads all).
      Build `deptIdMap: Map<localId, supabaseId>`: match by id first; else by
      exact trimmed name (provisioning may have already created departments
      under different ids); matched → skipped. Unmatched → validate the local
      id is UUID-shaped (regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      case-insensitive; non-UUID → failed + diagnostic), then
      `insert('departments', { id, name })`; success → imported and add to
      `deptIdMap`.
   2. `people` (mapping only — READ, never insert). `select('profiles',
      'id, email')`; build `personIdMap: Map<localPersonId, profileId>` by
      `normalizeEmail` equality (skip people with empty email). Mapped →
      skipped (count), imported always 0. Unmapped → failed + diagnostic
      pointing at provisioning (copy below). Duplicate normalized emails in
      local data: map the first, fail the rest with a duplicate-email
      diagnostic.
   3. `projects` — existing ids via chunked
      `select('projects', 'id', { column: 'id', values: chunk })`; existing →
      skipped. New: UUID-validate id, then `insert('projects', { id, name,
      description, department_id })` where `department_id` =
      `deptIdMap.get(p.departmentId) ?? null` (`''` → null; a departmentId
      whose department FAILED to import → import the project with
      `department_id: null` and add a warning-style diagnostic, do not fail
      the project). Track `availableProjectIds` = existing ∪ imported.
   4. `tasks` — same pattern keyed on task id; row `{ id, project_id, title,
      description }` (`created_by` omitted → null). If `!availableProjectIds
      .has(t.projectId)` → failed + diagnostic (no network call). Track
      `availableTaskIds`.
   5. `project_members` — derive distinct pairs exactly like
      `buildDryRunReport` (assignments joined through tasks), then translate:
      `project_id` must be in `availableProjectIds`, `profile_id` =
      `personIdMap.get(personId)`. Unmapped person → failed + provisioning
      diagnostic; unavailable project → failed + diagnostic. Existing pairs:
      chunked select on `project_id`, compare pairs client-side → skipped.
      New → `insert('project_members', { project_id, profile_id })`.
   6. `task_assignments` — same as 5 keyed on `(task_id, profile_id)` with
      `availableTaskIds` + `personIdMap`; existing pair → skipped, new →
      insert; dangling → failed + diagnostic.

   Unsupported collections (no target table): `clients`, `serviceTypes`,
   `workCategories`, `statuses`, `milestones`, `workload`, `comments`,
   `activity`, `savedFilters` — one summary row each with
   `skipped = length`, imported/failed 0, plus (when non-empty) a single
   diagnostic `Brak tabeli docelowej w Supabase — dane pozostają tylko w tej
   przeglądarce.` This satisfies "clients / statuses / categories /
   milestones / comments / workload where supported": the current schema does
   not support them, so they are reported, never silently dropped.

   Idempotency = prior-state detection: existence checks against live PKs
   (`id` or composite pair) mean a rerun after success or partial failure
   skips everything already present and completes only the remainder. Since
   the code is insert-only, an existing row can never be overwritten.

5. **UI: extend `ExportDryRunPanel.tsx`** (decision: extend, not a new
   component — the gate consumes the dry-run `report` state this component
   already owns; a separate panel would duplicate peek/report state or force
   lifting it into AdminPage). Keep existing export/dry-run UI byte-for-byte;
   append an import subsection at the bottom of the panel:
   - Read `useAuth()` for `mode` and `state.status`; receive `isAdmin` via
     the existing render position (panel renders only inside the admin branch
     of AdminPage — still pass `isAdminUser` result explicitly as a prop or
     re-derive via `useStore` + `isAdminUser`; developer's choice, but
     `evaluateImportGate` must receive a real value, not a constant).
   - Render heading, permanent hints, confirmation input, import button.
     Button disabled unless `evaluateImportGate(...).allowed`; when blocked,
     show the Polish `reason` as a `field-hint` (not an error).
   - On click: re-run `peekDataResult()` + `buildDryRunReport(...)` for
     freshness; if peek fails or the fresh report has blockers → show error,
     abort (no writes). Otherwise `runSupabaseImport(freshData, freshReport,
     createSupabaseImportDb(getSupabaseClient()))` with a busy state
     (button disabled + `Importowanie…`), then render the result: summary
     table (Kolekcja / Zaimportowane / Pominięte / Błędy) + diagnostics list
     (reuse `field-error` styling for failures, like blockers today). Reset
     the confirmation input after a run.
   - The import section may render its controls only in supabase mode; in
     local mode show the static hint (copy below) instead — mirroring
     `TeamPage`'s provisioning note.

6. **Tests `src/supabase/dataImport.test.ts`** (vitest, node env, fake
   `ImportDb` backed by in-memory `Map`s per table that records every call in
   order and accumulates inserted rows; a small builder for minimal `AppData`
   fixtures — model on `exportDryRun.test.ts` fixtures). Required cases:
   1. **Admin/mode/confirmation gating** (`evaluateImportGate`): non-admin,
      local mode, signed out, no report, report with blockers, wrong / empty /
      lowercase confirmation → each `allowed: false` with its exact Polish
      reason; fully satisfied input → `allowed: true`.
   2. **Blocker refusal in the runner:** report with 1 blocker →
      `completed: false`, `refusedReason` set, fake db records zero calls.
   3. **Happy path + dependency order:** fresh fixture (2 departments, 2
      people both matching profiles by email, 2 projects, 3 tasks, 3
      assignments) against a DB pre-seeded only with the 2 profiles → all
      inserts succeed; recorded insert calls are grouped in the exact order
      departments → projects → tasks → project_members → task_assignments;
      summary counts match; people row = 0 imported / 2 skipped / 0 failed.
   4. **Idempotent rerun:** run twice against the same accumulating fake →
      second run has imported 0 everywhere, skipped equals first-run
      imported+skipped, zero insert calls for already-present rows, no
      duplicate rows in the fake tables.
   5. **Partial failure + continuation:** fake fails the insert of project A
      (returns `error`) → project A failed with diagnostic; its tasks failed
      with the "project not imported" diagnostic without insert attempts;
      project B and its tasks imported; run again with the fault cleared →
      only the previously failed remainder is inserted, nothing duplicated.
   6. **People mapping:** person with email matching a profile (different
      case/whitespace — `normalizeEmail`) → mapped, assignments use the
      PROFILE id, not the local person id (assert inserted row values);
      person without account → failed with provisioning diagnostic and its
      assignments/memberships failed with an actionable message; duplicate
      normalized emails → first mapped, second failed.
   7. **Department name matching:** DB pre-seeded with department `Kreacja`
      under a different UUID → no department insert; imported project carries
      the EXISTING Supabase department id (assert row value).
   8. **Non-UUID local id** (e.g. legacy `dep-1`) → that record failed with
      the UUID diagnostic, run continues, no insert attempted for it.

## Polish copy (use verbatim; minor grammar fixes allowed)

- Section heading: `Import do Supabase`
- Permanent hint: `Import zapisuje dane w Supabase. Dane w tej przeglądarce
  pozostają nienaruszone — nic nie jest usuwane, a lokalna kopia zapasowa
  nadal działa.`
- Second hint: `Import można bezpiecznie uruchomić ponownie: istniejące
  rekordy zostaną pominięte, nic nie jest nadpisywane.`
- Local-mode note: `Import wymaga trybu Supabase. Skonfiguruj zmienne
  VITE_SUPABASE_* i zaloguj się, aby importować dane.`
- Confirmation label: `Aby odblokować import, przepisz słowo IMPORTUJ:`
- Button: `Importuj dane do Supabase` / busy: `Importowanie…`
- Gate reasons (order of checks): admin `Import może uruchomić wyłącznie
  administrator.`; mode `Import wymaga trybu Supabase.`; session `Zaloguj się
  do Supabase, aby importować dane.`; report `Najpierw uruchom symulację
  migracji.`; blockers `Symulacja wykryła blokery — usuń je i uruchom
  symulację ponownie.`; confirmation `Przepisz słowo IMPORTUJ, aby
  potwierdzić.`
- Runner refusal: `Import przerwany: raport symulacji zawiera blokery.`
- Fresh-check abort: `Dane zmieniły się od ostatniej symulacji i zawierają
  blokery — import przerwany bez zapisu.`
- Result heading: `Wynik importu`; table headers `Kolekcja / Zaimportowane /
  Pominięte / Błędy`
- Diagnostics: missing account `Brak konta Supabase dla adresu e-mail
  „<email>" — załóż konto w zakładce Zespół (Zakładanie konta) i uruchom
  import ponownie.`; empty email `Osoba nie ma adresu e-mail — uzupełnij go i
  załóż konto, aby powiązać dane.`; duplicate email `Zduplikowany adres
  e-mail — dane tej osoby pomiń lub popraw adres.`; project not imported
  `Projekt zadania nie został zaimportowany — popraw błąd projektu i uruchom
  import ponownie.`; non-UUID id `Identyfikator nie jest w formacie UUID —
  rekord wymaga ręcznej migracji.`; dept-fallback warning `Dział projektu nie
  został zaimportowany — projekt zapisano bez działu.`; no target table
  `Brak tabeli docelowej w Supabase — dane pozostają tylko w tej
  przeglądarce.`; insert failure prefix `Zapis nie powiódł się: <error>`
- Collection labels: reuse the Polish labels already in
  `ExportDryRunPanel.tsx` (`Działy`, `Osoby`, `Projekty`, `Zadania`,
  `Przypisania`, …) plus `Członkostwo w projektach` for `project_members`.

## Out of scope

- Creating/updating auth users or profiles (provisioning owns that), any
  Edge Function changes, any SQL migration.
- Switching any planner read to Supabase; removing/altering export, dry-run,
  recovery, or `exportRawData`.
- Importing clients, serviceTypes, workCategories, statuses, milestones,
  workload, comments, activity, savedFilters (no target tables — summary
  rows only).
- Deleting or rewriting localStorage in any way; any reducer/selector change.
- Progress persistence between page loads (the live DB is the import state).
- Browser test scripts; wiki edits beyond the report-back note.

## Acceptance

- [ ] Import button exists only in the admin panel section, disabled with a
      Polish reason until: admin + supabase mode + signed in + dry-run report
      with zero blockers + typed `IMPORTUJ`.
- [ ] Successful import inserts departments → projects → tasks →
      project_members → task_assignments with local UUIDs (departments/
      profiles mapped as specced) and renders the Polish summary.
- [ ] Rerunning import immediately afterwards imports 0 rows, skips
      everything, creates no duplicates (test-proven via accumulating fake).
- [ ] A failing record fails alone: siblings import, dependents fail with
      actionable diagnostics, and a rerun completes only the remainder.
- [ ] People are never inserted; unmatched people and their dependent rows
      produce the provisioning diagnostic.
- [ ] No `localStorage` reference outside `src/store/storage.ts`; no
      `upsert`/`update`/`delete` in the new module; export/dry-run tests pass
      unmodified.
- [ ] `npm run build` green (TypeScript strict).

## Verification

- Worker: `npx vitest run src/supabase/dataImport.test.ts
  src/store/exportDryRun.test.ts src/store/storage.test.ts` then
  `npm run build`.
- Browser: none — new isolated admin panel section; no stability-sensitive
  calendar/bin interaction touched; live-Supabase verification is a manual
  operator step, not a repo check.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- **People are mapped, never created.** `profiles.id` FKs `auth.users`; the
  browser client (publishable key) cannot create auth users — only the
  `provision-account` Edge Function can. Import therefore matches people to
  existing profiles by `normalizeEmail` and turns misses into actionable
  diagnostics. This is also why there is no profile update: provisioning owns
  profile content.
- **Idempotency = carry-over UUID PKs + select-before-insert, insert-only.**
  Local department/project/task ids are already UUIDs (per the 207 dry-run)
  and become the Supabase PKs; junction tables use composite PKs. Existence
  checks against live PKs detect prior import state, so no marker table,
  `source_local_id` column, or migration is needed, and "never overwrite" is
  structural (no update statements exist).
- **Departments additionally match by exact trimmed name** because the
  provisioning UI already creates departments server-side under fresh ids;
  id-only matching would duplicate them. Projects/tasks match by id only
  (names are not unique).
- **UI extends `ExportDryRunPanel`** because the gate consumes the dry-run
  report state that component owns; freshness is re-verified at click time by
  re-running peek + dry-run.
- **Gating is a pure function** (`evaluateImportGate`) so administrator
  gating is unit-testable without React Testing Library (not a repo
  dependency and new deps are banned); RLS remains the real boundary.
- **DB access behind an injected `ImportDb`** mirroring the
  session/provisioning test pattern (fake implementations, no SDK mocking,
  no live Supabase in vitest).
- **Typed confirmation (`IMPORTUJ`)** over a checkbox — stronger explicit
  consent for a remote write, consistent with the task's "explicit user
  confirmation" requirement.
- Tests live with the logic in `src/supabase/` and are inseparable from the
  implementation — single developer package, no test-writer split.
