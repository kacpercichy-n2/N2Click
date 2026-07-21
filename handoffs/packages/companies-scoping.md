# Handoff: Add Company (Spółka) dictionary, person assignment and company-scoped project visibility

- Package ID: PKG-20260721-companies-scoping
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — security-sensitive RLS policy replacement on `projects_select`

## Goal

A `Company` dictionary (local + cloud), an admin-assigned `companyId` on Person /
`company_id` on profiles, and a NARROWING-ONLY company filter woven into the
`projects_select` RLS policy: users without a company keep exactly today's
visibility; users with a company see only projects of their company (plus
everything they are member of / assigned to, which is by construction in their
company). Admin sees everything, unchanged.

## Wiki context

- `openwiki/n2hub/INDEX.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `new: supabase/migrations/20260721160000_companies.sql` (exact SQL below)
- `src/supabase/migrations.test.ts` (file list + `EXPECTED_POLICIES`)
- `src/types.ts` (Company entity, `AppData.companies`, `Person.companyId?`)
- `src/store/AppStore.tsx` (PersonDraft, actions ADD/RENAME/DELETE_COMPANY,
  MERGE_CLOUD_DICTIONARIES payload, MERGE_CLOUD_PEOPLE row)
- `src/store/storage.ts` (`emptyData`, `coerceArray` load path, `migratePerson`)
- `src/store/seed.ts` (`companies: []`)
- `src/store/persistGate.ts` (`NON_MIRRORED_KEYS` += `'companies'`)
- `src/supabase/referenceData.ts` (CloudProfile.companyId, OrgSnapshot.companies,
  select columns, `buildCloudPeoplePayload`)
- `src/supabase/cloudMirror.ts` (sixth `dicts` entry; `company_id` in profile
  UPDATE row)
- `src/App.tsx` (MERGE_CLOUD_DICTIONARIES dispatch gains `companies`)
- `src/pages/profileEditPolicy.ts` (`'companyId'` in ProfileField + ALL_FIELDS
  only — admin-only)
- `src/pages/PersonProfilePage.tsx` („Spółka” select)
- `src/pages/AdminPage.tsx` („Spółki” CRUD section + cloud-snapshot list parity)
- `new: src/store/companies.test.ts`
- Fixture/extension updates: `src/store/storage.test.ts`,
  `src/store/cloudMerge.test.ts`, `src/supabase/referenceData.test.ts`,
  `src/supabase/cloudMirror.test.ts`, `src/supabase/plannerData.test.ts`,
  `src/supabase/migrationStatus.test.ts`, PersonDraft construction sites/tests
  (e.g. `src/store/blockActions.test.ts` `draftFromPerson`,
  `src/store/commandValidation.test.ts`), `profileEditPolicy` tests if present
- Wiki: `openwiki/n2hub/cloud-database.md`,
  `openwiki/n2hub/state-and-persistence.md`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Invariants

- SECURITY (core): the new `projects_select` must be provably non-widening.
  Shape: `admin OR (company_scope(id) AND <today's non-admin conditions>)`.
  For every non-admin the new predicate is the old predicate AND-ed with
  `company_scope`, and `company_scope` ≡ true when `app.current_company_id()`
  is null — so people without a company keep byte-identical visibility, and
  nobody gains any row they could not see today.
- `company_id` on profiles is ADMIN-ONLY writable — extend the
  `app.protect_profile_privileges` trigger. Without this a manager could null
  their own `company_id` and un-narrow themselves (self-service privilege
  escalation).
- Invariant 6: every invalid reducer command (empty name, unknown id,
  case-insensitive duplicate, malformed merge payload) returns the SAME state
  reference.
- Additive local model: `DATA_VERSION` stays 7; legacy payloads load with
  `companies: []` and `companyId` repaired to `''`.
- Cloud-authoritative: MERGE_CLOUD_DICTIONARIES replaces `companies`;
  MERGE_CLOUD_ENTITIES never touches them (by reference).
- Applied migration files are immutable — new file only, idempotent
  (`if not exists` / `create or replace` / `drop policy if exists`).
- Department/manager behavior for company-less users, department-scoped
  manager rules on other tables, and existing tests (933+) must not regress.
- All user-facing strings Polish.

## Scope

### 1. Migration `supabase/migrations/20260721160000_companies.sql` — EXACT SQL

Use this SQL verbatim (house-style Polish header comment explaining the
narrowing invariant is expected; keep statements as written):

```sql
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function app.set_updated_at();

alter table public.companies enable row level security;
revoke all on public.companies from anon;

drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies
  for select to authenticated
  using (true);

drop policy if exists "companies_insert_admin" on public.companies;
create policy "companies_insert_admin" on public.companies
  for insert to authenticated
  with check (app.is_administrator());

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin" on public.companies
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

drop policy if exists "companies_delete_admin" on public.companies;
create policy "companies_delete_admin" on public.companies
  for delete to authenticated
  using (app.is_administrator());

alter table public.profiles
  add column if not exists company_id uuid
    references public.companies (id) on delete set null;

create index if not exists profiles_company_id_idx
  on public.profiles (company_id);

-- Spółka zalogowanego użytkownika (null = bez spółki => brak zawężenia).
create or replace function app.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

revoke all on function app.current_company_id() from public;
grant execute on function app.current_company_id() to authenticated;

-- Czy projekt mieści się w zakresie spółki zalogowanego użytkownika.
-- Semantyka (ZAWĘŻAJĄCA, nigdy poszerzająca):
--   * użytkownik bez spółki => true (dzisiejsza widoczność bez zmian);
--   * projekt „neutralny” (żaden członek projektu ani osoba przypisana do
--     jego zadań nie ma spółki) => true — świeżo utworzony/nieobsadzony
--     projekt nie znika twórcy między zapisem a hydracją;
--   * w przeciwnym razie => true tylko, gdy jakiś członek projektu lub osoba
--     przypisana do zadania projektu ma spółkę użytkownika.
-- SECURITY DEFINER czyta tabele jako właściciel (bez RLS) — zero rekursji,
-- polityka projects nie odpytuje projects przez ścieżkę objętą RLS.
create or replace function app.project_in_company_scope(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with project_people as (
    select pm.profile_id
    from public.project_members pm
    where pm.project_id = target_project
    union
    select ta.profile_id
    from public.task_assignments ta
    join public.tasks t on t.id = ta.task_id
    where t.project_id = target_project
  )
  select
    app.current_company_id() is null
    or not exists (
      select 1
      from project_people pp
      join public.profiles p on p.id = pp.profile_id
      where p.company_id is not null
    )
    or exists (
      select 1
      from project_people pp
      join public.profiles p on p.id = pp.profile_id
      where p.company_id = app.current_company_id()
    );
$$;

revoke all on function app.project_in_company_scope(uuid) from public;
grant execute on function app.project_in_company_scope(uuid) to authenticated;

-- Spółkę profilu zmienia wyłącznie administrator (jak rola dostępu i dział).
create or replace function app.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or app.is_administrator() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.access_role is distinct from old.access_role
     or new.department_id is distinct from old.department_id
     or new.company_id is distinct from old.company_id then
    raise exception 'Tylko administrator może zmieniać rolę dostępu, dział lub spółkę profilu';
  end if;
  return new;
end;
$$;

-- Widoczność projektów: spółka wyłącznie ZAWĘŻA dzisiejsze warunki
-- (20260720190000): admin wszystko; pozostali — dzisiejsze warunki I zakres
-- spółki. Członek/przypisany ze spółką X sam spełnia zakres spółki X, więc
-- nie traci dostępu; zawężenie realnie dotyka tylko gałęzi is_manager().
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or (
      app.project_in_company_scope(id)
      and (
        app.is_manager()
        or app.is_project_member(id)
        or app.has_assignment_in_project(id)
      )
    )
  );

-- Publikacja realtime (parytet z departments/job_titles) — idempotentnie:
do $$
begin
  begin
    alter publication supabase_realtime add table public.companies;
  exception
    when duplicate_object then null;
  end;
end $$;
```

Note the baseline being replaced: the CURRENT `projects_select` is the one from
`20260720190000_manager_task_management.sql` (`is_administrator OR is_manager OR
is_project_member OR has_assignment_in_project`) — NOT the older
department-based variants from 20260715210500/20260720150000/20260720170000.

### 2. `src/supabase/migrations.test.ts`

- Append `'20260721160000_companies.sql'` to the expected file list.
- Add `'public.companies': ['select', 'insert', 'update', 'delete']` to
  `EXPECTED_POLICIES` with a short Polish comment (parity with job_titles).

### 3. Local model (pattern: JobTitle from task 242, mirrored exactly)

- `src/types.ts`: `export interface Company { id: string; name: string }`
  right after `JobTitle`; `AppData.companies: Company[]` after `jobTitles`;
  `Person.companyId?: string` (optional, `''` = none, comment: admin-assigned,
  narrows cloud project visibility — see cloud-database wiki).
- `src/store/AppStore.tsx`:
  - Actions `ADD_COMPANY {name}`, `RENAME_COMPANY {companyId, name}`,
    `DELETE_COMPANY {companyId}` — copy the jobTitles reducer cases verbatim
    (trim; empty name, unknown id, case-insensitive duplicate via
    `toLocaleLowerCase('pl-PL')`, rename-to-same-name no-op => SAME reference).
    `DELETE_COMPANY` additionally cascade-clears `companyId` on people
    (`p.companyId === action.companyId ? { ...p, companyId: '' } : p`) —
    department-style label cleanup; cloud FK `on delete set null` mirrors it.
  - `PersonDraft` gains `companyId: string` (required, like `supervisorId`);
    `personFromDraft` maps it through; update every PersonDraft construction
    site (PersonProfilePage draft seeding + save, PeoplePage add form if it
    builds drafts, test helpers).
  - `MERGE_CLOUD_DICTIONARIES`: payload gains required `companies: Company[]`;
    validate with `Array.isArray` + `isValidNamedRow`, compare with
    `sameNamedRows`, replace with `[...companies]` (exact jobTitles parity;
    malformed row => same reference; empty cloud array is VALID).
  - `MERGE_CLOUD_PEOPLE`: `CloudPersonMergeRow.companyId: string`;
    `isValidCloudPersonRow` requires `typeof r.companyId === 'string'`;
    `cloudPersonFields` returns it (coerce non-string never needed — validated);
    the `same` comparison includes `person.companyId === fields.companyId`
    (compare via `(person.companyId ?? '')`).
- `src/store/storage.ts`: `emptyData().companies = []`; load path
  `companies: coerceArray(parsedRest.companies, defaults.companies)`;
  `migratePerson` adds `companyId: str(raw.companyId)` (runs on every load).
- `src/store/seed.ts`: `companies: []`.
- `src/store/persistGate.ts`: add `'companies'` to `NON_MIRRORED_KEYS`
  (dictionary parity with `jobTitles`: a companies-only change must never skip
  the local save).

### 4. Cloud wiring

- `src/supabase/referenceData.ts`: `CloudProfile.companyId: string | null`;
  profiles select adds `company_id`; `toCloudProfile` maps it (same
  string-or-null coercion as `department_id`); `loadOrgSnapshot` adds
  `db.select('companies', 'id, name')` to the parallel batch, error joins the
  atomic failure, result sorted `byName` into `OrgSnapshot.companies`;
  `CloudPersonMergeRow.companyId`; `buildCloudPeoplePayload` maps
  `companyId: p.companyId ?? ''` (direct id — after MERGE_CLOUD_DICTIONARIES
  local companies carry cloud UUIDs, same rationale as `departmentId`).
- `src/supabase/cloudMirror.ts`: sixth `dicts` entry
  `{ table: 'companies', label: 'Spółka', prevRows: prev.companies, nextRows:
  next.companies, toRow: id+name }`; profile UPDATE row gains
  `company_id: (p.companyId ?? '') === '' ? null : p.companyId` (parity with
  `department_id`).
- `src/supabase/plannerData.ts`: no functional change expected — only its test
  fixtures gain `companies: []` (OrgSnapshot shape).
- `src/App.tsx`: MERGE_CLOUD_DICTIONARIES dispatch adds
  `companies: snap.companies`.

### 5. UI (Polish strings)

- `src/pages/profileEditPolicy.ts`: add `'companyId'` to `ProfileField` and to
  `ALL_FIELDS` ONLY (not SELF_FIELDS, not MANAGER_FIELDS) — editable by
  administrator and zero-people setup mode, matching the server trigger.
- `src/pages/PersonProfilePage.tsx`: „Spółka” select next to „Dział”
  (`id="pp-company"`, options from `state.companies`, `<option value="">—</option>`,
  `disabled={!allow('companyId')}` with the shared `NO_PERM_TITLE`), draft seeded
  from `person.companyId ?? ''`; locked-field save behavior follows the existing
  pattern (locked fields come from the current record). Read-only profile view:
  show „Spółka: <name>” only if trivial in the existing details list; skip
  otherwise.
- `src/pages/AdminPage.tsx` (already gated by `admin.panel`): new
  `editor-section` „Spółki” directly after „Działy” — `SimpleList` +
  add form (input aria-label „Nazwa nowej spółki”, button „Dodaj spółkę”,
  delete confirm: `Usunąć spółkę „X”? Osoby stracą przypisanie do spółki, a
  widoczność projektów w chmurze przestanie być nią zawężana.`), dispatching
  ADD/RENAME/DELETE_COMPANY. In the „Słowniki w chmurze” block add an
  `<h3>Spółki</h3>` list from `state.snapshot.companies` (empty state „Brak
  spółek w chmurze.”), parity with „Stanowiska”.

### 6. Tests (new + extensions)

- `new: src/store/companies.test.ts` — mirror `jobTitles.test.ts`:
  ADD/RENAME/DELETE_COMPANY happy paths + invariant-6 rejections (same
  reference), case-insensitive duplicate, rename-to-own-name no-op,
  DELETE_COMPANY clears dangling `Person.companyId`,
  MERGE_CLOUD_DICTIONARIES companies block (authoritative replace, empty valid,
  malformed row => same reference, missing/invalid payload => same reference).
- `src/store/storage.test.ts`: `companies` in the additive-collection list;
  legacy payload without `companies` loads `[]` (v7 stays); `migratePerson`
  repair: missing `companyId` => `''`, non-string => `''`, string passes.
- `src/store/cloudMerge.test.ts` (or the MERGE_CLOUD_PEOPLE block’s home):
  `companyId` flows through people merge; row with non-string `companyId`
  fails closed (same reference).
- `src/supabase/referenceData.test.ts`: `company_id` mapping (null and set),
  `companies` in snapshot + sorted; `companies` added to the atomic-error
  table loop; `buildCloudPeoplePayload` carries `companyId`.
- `src/supabase/cloudMirror.test.ts`: fixtures gain `companies: []`; new dict
  case (add/rename => upsert, delete => remove on `companies`, UUID rule);
  profile update row includes `company_id` (null for `''`).
- `src/supabase/plannerData.test.ts`, `src/supabase/migrationStatus.test.ts`:
  OrgSnapshot fixtures gain `companies: []`.
- PersonDraft fixture sites compile (add `companyId: ''`).
- `profileEditPolicy` tests (if the file exists): `companyId` admin-only.

### 7. Wiki

- `cloud-database.md`: `companies` table (dictionary row in the dictionaries
  bullet incl. realtime publication + mirror sixth `dicts` entry + hydration
  path), `profiles.company_id` (admin-only via extended
  `protect_profile_privileges` trigger), new `app.current_company_id()` /
  `app.project_in_company_scope()` helpers, and the `projects_select`
  narrowing semantics (company-less user identical, member/assignee
  self-satisfies scope, neutral projects visible); note registry entries in
  `migrations.test.ts`.
- `state-and-persistence.md`: SPÓŁKI paragraph (pattern of the STANOWISKA one):
  additive collection, reducer actions + invariant 6, `Person.companyId`
  repair, MERGE_CLOUD_* behavior, `persistGate` key, tests.
- `ui-navigation-and-onboarding.md`: one-line note that the profile edit matrix
  gains the admin-only „Spółka” field (profileEditPolicy).

## Out of scope

- NO company filter/grouping in project/task/kanban unified filters
  (`SavedFilterCriteria`) — settled decision, see Prior decisions.
- NO company column/filter on TeamPage, no company-based client-side project
  hiding in local mode (client checks are UX only; RLS is the boundary).
- NO changes to `tasks_select` / `workload_entries` / other policies — company
  narrows project SELECT only; dependents of RLS-hidden projects are dropped by
  the existing client hydration cascade (`loadPlannerSnapshot`). Known accepted
  limitation: a company-scoped manager can still read task rows via raw API.
- NO backfill of `company_id`, no seeding of companies, no provisioning-flow
  changes, no new npm dependencies, no edits to applied migration files.

## Acceptance

- [ ] Migration file exists exactly as specified; `migrations.test.ts` list and
      `EXPECTED_POLICIES` updated; all migration-convention tests green.
- [ ] New `projects_select` matches the specified predicate; non-admin branch is
      the 20260720190000 conditions AND `app.project_in_company_scope(id)`.
- [ ] `app.protect_profile_privileges` blocks non-admin `company_id` changes.
- [ ] Reducer: companies CRUD valid paths mutate; every invalid command returns
      the same state reference (focused tests prove it).
- [ ] Legacy localStorage payload loads with `companies: []` and repaired
      `companyId`; DATA_VERSION remains 7.
- [ ] Org snapshot hydrates companies into local state
      (MERGE_CLOUD_DICTIONARIES) and `companyId` into people
      (MERGE_CLOUD_PEOPLE); admin CRUD mirrors to `public.companies`; profile
      edits mirror `company_id`.
- [ ] AdminPage „Spółki” section and PersonProfilePage „Spółka” select work,
      admin-gated, Polish strings.
- [ ] Focused vitest files green; full `npm test` (933+) and `npm run build`
      green.

## Verification

- Worker: `npx vitest run src/store/companies.test.ts src/store/storage.test.ts src/store/cloudMerge.test.ts src/supabase/migrations.test.ts src/supabase/referenceData.test.ts src/supabase/cloudMirror.test.ts src/supabase/plannerData.test.ts src/supabase/migrationStatus.test.ts`
  then full `npm test` and `npm run build`.
- Browser: none — no calendar/bin pointer paths touched; forms follow existing
  admin/profile patterns. Release verification owns the browser matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.
- The migration is NOT applied to the hosted project by this package (operator
  step; forward-only file + registry convention).

## Prior decisions

- Company semantics: RESTRICTIVE filter, never additive. The prompt's two
  phrasings conflict ("sees only own-company projects" vs "must not widen");
  the resolved reading is `visible = today's conditions AND company-scope`,
  where company-scope is true for company-less users. Company membership grants
  NO new project visibility on its own.
- "Project in company X" := some project member or task assignee of the project
  has `company_id = X`. Projects with no company-carrying people (unstaffed or
  staffed only by company-less profiles) are in-scope for EVERYONE — this keeps
  a manager's freshly created empty project visible to them (otherwise the
  mirror's create → hydrate cycle would drop it) and keeps transitional
  company-less staffing visible. Both clauses are still subsets of today's
  visibility, so nothing widens.
- The narrowing effectively bites only the `is_manager()` branch: a member or
  assignee with company X makes the project company-X-scoped by themselves, so
  member/assignment access can never be lost.
- `profiles.company_id` is admin-only (trigger), matching the admin-only
  „Spółka” select (`profileEditPolicy` ALL_FIELDS only).
- Companies CRUD follows the jobTitles reducer pattern incl. the pl-PL
  case-insensitive duplicate rule; DELETE additionally clears `Person.companyId`
  (department-style cascade; cloud FK `on delete set null`).
- Unified-filters (240) company criterion: deliberately deferred — separate
  additive feature (`SavedFilterCriteria`/`lastFilters` blast radius across six
  views); this package delivers scoping via RLS only.
- Local `Person.companyId` stays optional (`companyId?: string`) to avoid churn
  in Person fixtures; `PersonDraft.companyId` is required for explicit writes.
