# Handoff: Add the admin-managed "Stanowiska" (job titles) dictionary end to end

- Package ID: PKG-20260721-job-titles-dictionary
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — new cloud table + reducer/merge surface touches invariant 6 and the dictionary mirror path

## Goal

An admin can manage a `jobTitles` dictionary (Administracja → "Stanowiska"); the
"Stanowisko" select in the person profile offers dictionary entries MERGED with
the existing department-derived options and the person's current free-text
value; the dictionary lives in a new `public.job_titles` cloud table mirrored
and hydrated exactly like `departments`.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/cloud-database.md`

## Expected touchpoints

- `src/types.ts`
- `src/store/AppStore.tsx`
- `src/store/storage.ts`
- `src/store/persistGate.ts`
- `src/store/seed.ts` (required `jobTitles: []` in the full AppData literal)
- `src/pages/AdminPage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/utils/roleTitles.ts`
- `src/supabase/referenceData.ts`
- `src/supabase/cloudMirror.ts`
- `src/App.tsx` (MERGE_CLOUD_DICTIONARIES dispatch payload)
- `new: supabase/migrations/20260721150000_job_titles.sql`
- `src/supabase/migrations.test.ts`
- `new: src/store/jobTitles.test.ts`
- `src/store/storage.test.ts`, `src/utils/roleTitles.test.ts`,
  `src/supabase/referenceData.test.ts`, `src/supabase/cloudMirror.test.ts`
- Full-AppData test literals that will fail TS after the new required field
  (known: `src/store/exportDryRun.test.ts`, `src/store/taskMeta.test.ts`
  makeState, `src/supabase/plannerData.test.ts:417`) — add `jobTitles: []`.

## Invariants

- Invariant 6: every rejected command returns the SAME state reference.
- `MERGE_CLOUD_ENTITIES` must keep NOT touching dictionaries — `jobTitles`
  passes through by reference (the `...state` spread already does this; do not
  add it to that merge).
- `accessRoleForTitle` behavior is unchanged (trigger-protected access-role
  coupling); `roleTitleOptions` keeps its exact current output (its tests must
  pass untouched).
- No existing `Person.role` value may disappear from the profile select
  (legacy free-text stays selectable).
- `DATA_VERSION` stays 7 — the collection is ADDITIVE (no migration bump).
- Applied migration files are immutable — new file only; forward-only.
- Retirement/persist gate: a jobTitles-only transition must still persist
  locally (see persistGate below).
- Polish user-facing strings; agents never commit.

## Scope

### 1. Model + reducer (`src/types.ts`, `src/store/AppStore.tsx`)

- `src/types.ts`: add next to `WorkCategory`:
  `export interface JobTitle { id: string; name: string; }` (comment: admin-
  managed stanowiska dictionary, mirrors Department). Add `jobTitles:
  JobTitle[]` to `AppData` directly after `workCategories`.
- Actions (model on the ADD_/RENAME_/DELETE_DEPARTMENT block at
  AppStore.tsx ~3082, same placement):
  - `{ type: 'ADD_JOB_TITLE'; name: string }` — trim; empty → same ref;
    DUPLICATE name → same ref. Duplicate = another row whose
    `name.trim().toLocaleLowerCase('pl-PL')` equals the candidate's.
  - `{ type: 'RENAME_JOB_TITLE'; jobTitleId: string; name: string }` — trim;
    empty, unknown id, or duplicate of a DIFFERENT row (same case-insensitive
    rule) → same ref; renaming a row to its own current exact name → same ref
    (no-op).
  - `{ type: 'DELETE_JOB_TITLE'; jobTitleId: string }` — unknown id → same
    ref; otherwise filter the row out. NO cascade: `Person.role` is free text
    and must keep its value (the select's legacy-option merge covers it).
  - New ids via the existing `uid()` helper.
- `CloudDictionariesPayload` (AppStore.tsx ~2286): add required
  `jobTitles: JobTitle[]`. In `mergeCloudDictionaries`: `Array.isArray` guard,
  `isValidNamedRow` per row, include in the `sameNamedRows` no-op comparison
  and in the replacement spread (`jobTitles: [...jobTitles]`). Empty cloud
  array is VALID (replaces with empty) — only statuses have the fail-close
  invariant.

### 2. Storage + persist gate

- `src/store/storage.ts`: `emptyData()` gains `jobTitles: []`; the load path
  gains `jobTitles: coerceArray(parsedRest.jobTitles, defaults.jobTitles)`
  next to the other collections (~line 1420). No row-level repair pass —
  exact parity with `departments`. No version bump.
- `src/store/persistGate.ts`: add `'jobTitles'` to `NON_MIRRORED_KEYS`
  (same conservative classification as `departments`: dictionary changes
  always persist locally even when retired).
- `src/store/seed.ts`: add `jobTitles: []` (demo data defines no titles).

### 3. Admin CRUD (`src/pages/AdminPage.tsx`)

- New `editor-section` titled `Stanowiska`, placed directly AFTER the
  `Działy` section, inside the existing `isAdminUser` gate. Reuse the
  existing `SimpleList` unchanged; add `const [titleInput, setTitleInput] =
  useState('')`.
  - `items={state.jobTitles}`
  - onRename → `{ type: 'RENAME_JOB_TITLE', jobTitleId: id, name }`
  - onDelete → `window.confirm(`Usunąć stanowisko „${name}”? Osoby zachowają
    dotychczasowy wpis w profilu.`)` then `{ type: 'DELETE_JOB_TITLE',
    jobTitleId: id }`
  - add form: placeholder/aria-label `Nazwa nowego stanowiska`, button
    `Dodaj stanowisko`, submit dispatches `{ type: 'ADD_JOB_TITLE', name:
    titleInput }` and clears the input (same shape as Działy).
  - `field-hint` under the list: `Stanowiska z tej listy pojawiają się w
    profilu osoby obok propozycji wyprowadzonych z działów.`
- `CloudDictionaries` read-only preview (same file): add a `Stanowiska`
  block rendering `state.snapshot.jobTitles` with empty text `Brak stanowisk
  w chmurze.` (snapshot gains the field in step 5).

### 4. Profile select merge (`src/utils/roleTitles.ts`, `src/pages/PersonProfilePage.tsx`)

- New pure helper in `roleTitles.ts` (leave `roleTitleOptions` and
  `accessRoleForTitle` byte-for-byte untouched):

  ```ts
  export function jobTitleSelectOptions(
    jobTitles: JobTitle[],
    departments: Department[],
    current = '',
  ): string[]
  ```

  Order: (1) dictionary names in dictionary order (trimmed, empty dropped),
  (2) `roleTitleOptions(departments)` entries not already present,
  (3) trimmed `current` appended LAST when non-empty and absent.
  Dedup by exact trimmed string match (consistent with roleTitleOptions).
- `PersonProfilePage.tsx` (~line 250): replace
  `roleTitleOptions(state.departments, draft.role)` with
  `jobTitleSelectOptions(state.jobTitles, state.departments, draft.role)`;
  update the import. Do NOT touch the `accessRoleForTitle` onChange coupling
  block.

### 5. Cloud (migration + wiring)

- `new: supabase/migrations/20260721150000_job_titles.sql` — idempotent,
  house-convention (model on `20260720230000_tickets.sql` idempotency +
  `20260716150000_reference_tables.sql` policy shape). Sketch:

  ```sql
  -- Migracja: 20260721150000_job_titles
  -- Słownik stanowisk („Stanowiska” w Administracji): odczyt dla każdego
  -- zalogowanego, zapis wyłącznie administrator. Konwencja domu: RLS w tym
  -- samym pliku, revoke anon, polityki to authenticated + with check,
  -- bez force row level security. Idempotentnie (if not exists / drop policy).

  create table if not exists public.job_titles (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 200),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  drop trigger if exists job_titles_set_updated_at on public.job_titles;
  create trigger job_titles_set_updated_at
    before update on public.job_titles
    for each row execute function app.set_updated_at();

  alter table public.job_titles enable row level security;
  revoke all on public.job_titles from anon;

  drop policy if exists "job_titles_select" on public.job_titles;
  create policy "job_titles_select" on public.job_titles
    for select to authenticated
    using (true);

  drop policy if exists "job_titles_insert_admin" on public.job_titles;
  create policy "job_titles_insert_admin" on public.job_titles
    for insert to authenticated
    with check (app.is_administrator());

  drop policy if exists "job_titles_update_admin" on public.job_titles;
  create policy "job_titles_update_admin" on public.job_titles
    for update to authenticated
    using (app.is_administrator())
    with check (app.is_administrator());

  drop policy if exists "job_titles_delete_admin" on public.job_titles;
  create policy "job_titles_delete_admin" on public.job_titles
    for delete to authenticated
    using (app.is_administrator());

  -- Publikacja realtime (parytet z departments) — idempotentnie:
  do $$
  begin
    begin
      alter publication supabase_realtime add table public.job_titles;
    exception
      when duplicate_object then null;
    end;
  end $$;
  ```

- `src/supabase/migrations.test.ts`: append
  `'20260721150000_job_titles.sql'` to the pinned file list AND add to
  `EXPECTED_POLICIES` (with a short Polish comment, parity with
  reference tables): `'public.job_titles': ['select', 'insert', 'update',
  'delete']`.
- `src/supabase/referenceData.ts`: `OrgSnapshot` gains `jobTitles:
  JobTitle[]`; `loadOrgSnapshot` adds `db.select('job_titles', 'id, name')`
  to the parallel batch, includes its error in the atomic error check, maps
  via `toNamed` + sorts `byName`, returns it in the snapshot.
- `src/App.tsx` (~line 162): add `jobTitles: snap.jobTitles` to the
  `MERGE_CLOUD_DICTIONARIES` payload.
- `src/supabase/cloudMirror.ts`: add a fifth entry to the `dicts` array
  (~line 620): `table: 'job_titles'`, label `'Stanowisko'`, prevRows/nextRows
  `prev.jobTitles`/`next.jobTitles`, `toRow` = `{ id, name }`. No forwardMap
  entry — nothing references job titles by id.
- NO realtime client change (`CloudSyncProvider` subscribes schema-wide) and
  NO `plannerData.ts` change — see Prior decisions.

### 6. Wiki

- `openwiki/n2hub/state-and-persistence.md`: short dated bullet — `jobTitles`
  collection (additive, v7 stays), ADD/RENAME/DELETE_JOB_TITLE validation
  incl. duplicate rule (same-ref rejection), coerceArray repair,
  MERGE_CLOUD_DICTIONARIES now also replaces jobTitles, persistGate
  NON_MIRRORED, profile select merge via `jobTitleSelectOptions`.
- `openwiki/n2hub/cloud-database.md`: `job_titles` in the org-dictionaries
  bullet (read all authenticated, write admin-only; in the realtime
  publication; migration 20260721150000), + test-registry note.

## Out of scope

- No change to `accessRoleForTitle` / `roleTitleOptions` behavior.
- No `plannerData.ts` / `CloudMergePayload` change (org-dictionary path).
- No one-time `dataImport.ts` import of jobTitles and no ExportDryRunPanel
  count row (parity with tickets; cloud dictionary starts empty and is fed by
  the admin panel via the mirror).
- No `person.role` normalization/migration; no `job_title_id` FK on profiles
  (`role_title` stays free text).
- No new npm dependencies, no data version bump, no browser-script changes.

## Acceptance

- [ ] Admin panel shows "Stanowiska" with add/rename/delete (Polish strings,
      confirm on delete); non-admin sees nothing new (existing gate).
- [ ] Reducer: add/rename/delete work; empty name, whitespace name, unknown
      id, and case-insensitive duplicate all return the SAME state reference.
- [ ] Delete leaves every `Person.role` string untouched.
- [ ] Load repair: a legacy payload without `jobTitles` (and one with
      `jobTitles: null`) loads with `[]`; `emptyData()` includes the field.
- [ ] Profile "Stanowisko" select lists: dictionary titles, then
      department-derived options, then the current legacy value last; no
      duplicates; no existing value disappears.
- [ ] `mergeCloudDictionaries` replaces `jobTitles` authoritatively, accepts
      an empty array, rejects malformed rows by same reference, and a
      value-identical payload returns the original state reference.
- [ ] `buildMirrorOps` (or equivalent dict diff) emits upsert on add/rename
      and remove on delete for `job_titles` (UUID ids only), like departments.
- [ ] Migration file exists with the exact name `20260721150000_job_titles.sql`,
      passes every check in `migrations.test.ts` (list, RLS, anon revoke,
      to-authenticated, with check, EXPECTED_POLICIES coverage).
- [ ] `npm run build` green; jobTitles-only transition still persists locally
      (persistGate classification).

## Verification

- Worker:
  `npx vitest run src/store/jobTitles.test.ts src/store/storage.test.ts src/utils/roleTitles.test.ts src/supabase/migrations.test.ts src/supabase/referenceData.test.ts src/supabase/cloudMirror.test.ts src/store/taskMeta.test.ts src/store/persistGate.test.ts src/store/cloudMerge.test.ts src/store/exportDryRun.test.ts src/supabase/plannerData.test.ts`
  then `npm run build`.
- Browser: none — no calendar/bin pointer paths touched; plain forms/selects.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Test expectations (new/extended)

- `new: src/store/jobTitles.test.ts` — mirror `taskMeta.test.ts` dictionary
  style (`makeState` + `reducer`): add trims; empty/whitespace same-ref;
  duplicate (`'Grafik'` vs `' grafik '`) same-ref; rename trims, unknown id
  same-ref, duplicate-of-other same-ref, rename-to-self same-ref; delete
  removes row, unknown id same-ref, people untouched;
  MERGE_CLOUD_DICTIONARIES block: replaces jobTitles, empty array accepted,
  malformed row → same ref, identical payload → same ref.
- `src/store/storage.test.ts` — extend the coerceArray/legacy-load coverage
  with `jobTitles` (missing and non-array), mirroring the tickets assertions.
- `src/utils/roleTitles.test.ts` — `jobTitleSelectOptions`: order
  (dictionary → derived → legacy last), dedup against derived options, legacy
  value preserved, existing suites untouched.
- `src/supabase/referenceData.test.ts` — fake db serves `job_titles`; snapshot
  maps + sorts them; a `job_titles` select error fails the snapshot atomically.
- `src/supabase/cloudMirror.test.ts` — dict diff add/rename/remove for
  `job_titles` (one focused case is enough given the shared dict loop).
- `src/supabase/migrations.test.ts` — list + EXPECTED_POLICIES entries (the
  suite itself asserts the rest).

## Prior decisions

- Hydration path: job titles are an ORG DICTIONARY. They ride
  `referenceData.loadOrgSnapshot` → `OrgSnapshot.jobTitles` → App.tsx
  `MERGE_CLOUD_DICTIONARIES` — exactly like departments. The scheduler prompt's
  "plannerData.ts select + CloudMergePayload group" is deliberately NOT
  followed: that path is the planner-family hydration; routing a dictionary
  through it would split the dictionary model in two. Deviation recorded here
  and in RUN-STATE.
- Duplicate rule is case-insensitive on trimmed names via
  `toLocaleLowerCase('pl-PL')`; it applies only to jobTitles (departments
  keep their historical no-duplicate-check behavior — do not retrofit).
- Delete does not rewrite `Person.role` (free text + legacy-option merge).
- `job_titles` joins the `supabase_realtime` publication (parity with
  departments; admin edits propagate to other sessions via the existing
  schema-wide subscription — zero client realtime changes).
- persistGate: `jobTitles` → `NON_MIRRORED_KEYS` (departments parity).
- Timestamp 20260721150000 (after 20260721130000, the current latest).
- The migration is written to the repo only; applying it to the hosted
  project stays with the human/operator flow (agents never apply migrations).
