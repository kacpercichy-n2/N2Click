# Handoff: Przenieś odczyty referencyjne i organizacyjne do Supabase (tryb supabase)

- Package ID: PKG-20260716-cloud-reference-reads
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — touches schema (new migration), the auth/permission trust boundary and the import tool.

## Goal

In Supabase mode, the signed-in user's profile, department, access role, team
visibility, statuses, service types and work categories are read from Supabase
(RLS-scoped selects) with Polish loading/empty/error states; localStorage
remains the planner's storage and the documented fallback. No planner write
path changes.

## Wiki context

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `supabase/README.md` (conventions + visibility matrix)

## Expected touchpoints

- `new: supabase/migrations/20260716150000_reference_tables.sql`
- `new: src/supabase/referenceData.ts`
- `new: src/supabase/referenceData.test.ts`
- `new: src/supabase/OrgDataProvider.tsx`
- `src/supabase/dataImport.ts` (+ `src/supabase/dataImport.test.ts`)
- `src/store/exportDryRun.ts` (+ its test file)
- `src/store/useCan.ts`
- `src/auth/profile.ts` (comment header only — see Scope 6)
- `src/main.tsx` (mount provider)
- `src/App.tsx` (canTeam wiring only)
- `src/pages/AccountPage.tsx`
- `src/pages/TeamPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/teamScope.ts` (+ `src/pages/teamScope.test.ts`)
- `supabase/README.md` (transitional-boundary paragraph + matrix rows for new tables)
- `src/supabase/migrations.test.ts` must pass unchanged (it parses the new SQL)

## Invariants

- Agents never commit or push.
- No project/task/workload write migration; localStorage persistence is not
  removed or bypassed. `src/store/storage.ts` stays the only localStorage
  boundary; `src/store/AppStore.tsx` stays the only mutation boundary. Cloud
  reads NEVER dispatch into AppStore (no new reducer action; no clobbering of
  local people/statuses — local ids keep referencing planner data).
- A failed save must never report `Zapisano`; invalid reducer commands preserve
  the prior state reference (untouched here — verify no regression).
- Statuses invariant (>=1 active and >=1 done) is a local-store rule; cloud
  status reads are display-only in this step and must not feed status mutations.
- Local mode (`detectAuthMode` => 'local') behaves EXACTLY as today: no Supabase
  client creation, no new UI sections, no permission changes.
- All new user-facing strings in Polish; never surface raw SDK messages.
- Client-side checks stay UX-only; RLS is the authorization source. No secret
  keys; the client uses only the publishable key path (`src/supabase/config.ts`).
- Migration conventions (enforced by `src/supabase/migrations.test.ts` and
  documented in `supabase/README.md` / top of `20260715210000_core_schema.sql`):
  forward-only, `YYYYMMDDHHMMSS_` prefix, never edit applied files, RLS enabled
  in the same migration that creates a table, `revoke all ... from anon`,
  `set search_path = ''` in any function, NO `force row level security`.
- No live Supabase in vitest; all DB access behind the injected interface
  (pattern: `ImportDb` in `src/supabase/dataImport.ts`). No SDK mocking.

## Scope

1. **Migration `supabase/migrations/20260716150000_reference_tables.sql`** —
   three reference tables in `public`:
   - `statuses`: `id uuid pk default gen_random_uuid()`, `name text not null`
     (length check 1..100), `slug text not null`, `color text not null default ''`,
     `sort_order integer not null default 0`, `archived boolean not null default false`,
     `is_done boolean not null default false`, `created_at`/`updated_at` +
     `app.set_updated_at` trigger. (`sort_order`, not `order` — reserved word;
     maps to `Status.order`.)
   - `service_types` and `work_categories`: `id uuid pk default gen_random_uuid()`,
     `name text not null` (length check 1..200), timestamps + trigger.
   - Same migration: `enable row level security` on all three, `revoke all ... from anon`,
     policies mirroring the existing naming style
     (`departments_insert_admin` etc.):
     - SELECT `to authenticated using (true)` — dictionaries are organization-wide
       reference data for every signed-in user;
     - INSERT/UPDATE/DELETE admin-only via existing `app.is_administrator()`
       (`with check` on insert/update). No new helper functions needed.
2. **Import tool** (`src/supabase/dataImport.ts`): move `statuses`,
   `serviceTypes`, `workCategories` out of `UNSUPPORTED` into supported
   insert-only steps (before departments; they are dependency-free). Mirror the
   departments strategy exactly: select existing, skip when id already present
   or when a semantic key matches (statuses: trimmed `slug`; service types and
   work categories: trimmed `name`), non-UUID local id => `DIAG.nonUuid`
   diagnostic, insert with the explicit local id, map `order`→`sort_order`,
   `isDone`→`is_done`. Update `src/store/exportDryRun.ts` so these three
   collections are no longer listed under "no target table" and are counted as
   migratable; keep the dry-run panel truthful. Extend `dataImport.test.ts`
   (and the dry-run test file) with the fake-db pattern already used there.
3. **Read module `src/supabase/referenceData.ts`** (pure, node-testable):
   - `export type ReferenceDb = Pick<ImportDb, 'select'>` — reuse
     `createSupabaseImportDb` as the runtime adapter; do not add a second one.
   - `CloudProfile` type: `id, firstName, lastName, email, roleTitle,
     cloudRole ('administrator'|'manager'|'worker'), departmentId (string|null)`.
   - `cloudRoleToAccessRole`: `administrator→'administrator'`, `manager→'pm'`,
     `worker→'pracownik'`. (Reverse of the documented frontend→cloud mapping;
     `handlowiec` is not representable server-side and intentionally lands on
     `pracownik` UX in supabase mode — the RLS truth. Document in a comment.)
   - `loadOrgSnapshot(db, userId)` selects, in parallel: `profiles`
     (`id, first_name, last_name, email, role_title, access_role, department_id`),
     `departments` (`id, name`), `statuses` (all columns above),
     `service_types`, `work_categories`; maps rows to frontend shapes
     (`Status`, `ServiceType`, `WorkCategory`, `Department` from `src/types.ts`),
     sorts statuses by `sort_order` then name, dictionaries by name. Returns
     `{ ok: true; snapshot: OrgSnapshot } | { ok: false; error: string }`.
     ANY failed select => whole snapshot fails (atomic) with one Polish message
     (e.g. `Nie udało się wczytać danych organizacji z serwera.`). Empty
     collections are VALID (`ok: true` with empty arrays), never an error —
     RLS returning few rows is the expected scoping, not a failure.
   - `snapshot.profile: CloudProfile | null` = the row whose `id === userId`
     (auth user id, NOT email). `null` when RLS returned no own row — a valid
     "no cloud profile" state, not an error.
   - `effectiveAccessRole(localUser, orgState, opts: { mode, impersonating })`
     — pure: returns the mapped cloud role ONLY when mode==='supabase', the
     snapshot is ready, `snapshot.profile` exists and NOT impersonating;
     otherwise the local `accessRole` (or undefined without a user). This is the
     precise fallback rule for permissions.
4. **Provider `src/supabase/OrgDataProvider.tsx`** (thin React, no logic worth
   unit-testing beyond the pure module): state machine
   `idle | loading | error(message, retry) | ready(snapshot)`. Loads once per
   signed-in user id (pattern: `loadedUserIdRef` in `SessionProvider.tsx`),
   resets to `idle` on sign-out and in local mode, exposes `useOrgData()` and a
   `reload()`. Mount in `src/main.tsx` inside `SessionProvider`, wrapping the
   router. Guard against setState-after-unmount with the existing `cancelled`
   pattern.
5. **Permission/visibility wiring (UX only, mirrors RLS):**
   - `src/store/useCan.ts`: in supabase mode pass the user through
     `effectiveAccessRole` (shallow copy of the current `Person` with
     `accessRole` overridden) before `can()`. Local mode path byte-identical in
     behavior. While loading or on error: local role remains in force (silent,
     documented fallback — authorization is server-side anyway).
   - `src/App.tsx`: `canTeam` uses the same effective role (small wiring only;
     do not restructure the shell; no global banner).
   - Impersonation ("Występuj jako") keeps the acted-as person's LOCAL role —
     the cloud override applies only when acting as self.
6. **UI surfaces (all supabase-mode only; local mode renders exactly today's UI):**
   - `AccountPage`: new section `Profil w chmurze` — loading `Ładowanie profilu…`;
     error message + `Spróbuj ponownie` (calls `reload()`); ready → name, e-mail,
     Polish role label, department name or `Brak działu`; `snapshot.profile === null`
     → `Brak profilu w chmurze dla tego konta.`
   - `TeamPage`: in supabase mode build the hierarchy from
     `snapshot.profiles` + `snapshot.departments` (RLS already scopes rows:
     admin all, manager own department, worker self — do not re-filter, only
     group; cloud has no supervisor field, so omit the supervisor line). Add a
     pure builder (in `teamScope.ts`, e.g. `buildCloudTeamHierarchy`) reusing
     `TeamDepartmentView`. Loading/error/empty states in Polish; keep
     `canViewTeam` as the nav/route UX gate (fed by the effective role). The
     provisioning form section stays as-is. Local mode keeps the current
     local-store hierarchy.
   - `AdminPage`: new read-only, admin-gated section `Słowniki w chmurze` listing
     cloud statuses (name + done/archived markers), service types and work
     categories, with loading/error/empty states and a fixed note that the
     planner still uses local dictionaries until data migration. The existing
     local dictionary editors stay untouched and remain what the planner uses.
   - Update the stale comment in `src/auth/profile.ts` (role/department no
     longer "always from the local Person" in supabase mode) — behavior of
     email association itself is unchanged and still required (planner data
     references local person ids).
7. **Document the transitional boundary** (exact wording to place in the
   `referenceData.ts` header, `supabase/README.md`, and reflect in the wiki
   page): *In supabase mode, the authenticated profile, department, access role
   and team visibility are read from Supabase and RLS output is authoritative;
   client checks are UX only. Cloud statuses/service types/work categories are
   loaded and displayed, but planner rendering and all mutations still use the
   local localStorage dictionaries, because local tasks/projects/workload
   reference local ids — this holds until the data-write migration step. Local
   mode uses localStorage exclusively. Loading/error in supabase mode falls
   back to the local role for UX gating.* End-of-task wiki: update
   `openwiki/n2hub/ui-navigation-and-onboarding.md` (the "role/department always
   come from the local Person" sentence is now wrong for supabase mode).
8. **Tests** (node env, injected fakes, no jsdom, no SDK mocks):
   - `referenceData.test.ts`: role-scoped fixtures where the fake `ReferenceDb`
     returns what RLS would (admin: all profiles; manager: own-department rows +
     own department only; worker: self only) — assert snapshot mapping, own-
     profile resolution by user id, role mapping, sorted output; any select
     error => `ok:false` with the Polish message; empty collections => ok;
     missing own profile => `profile: null`.
   - `effectiveAccessRole`: matrix over mode/state/impersonation/fallbacks.
   - `teamScope.test.ts`: cloud hierarchy builder (grouping, `Bez działu`
     bucket only when ungrouped profiles exist, empty input => empty list).
   - `dataImport.test.ts`: three new collections — insert, skip-by-id,
     skip-by-slug/name, non-UUID diagnostic, select-error accounting.

## Out of scope

- Migrating project/task/workload reads or ANY writes to Supabase; no reducer
  changes; no changes to `storage.ts`, selectors, scheduling/calendar code.
- Removing or weakening localStorage persistence, the login gates, or the
  local-mode person picker.
- Realtime subscriptions, caching layers, offline sync, retries/backoff.
- Editing cloud dictionaries from the UI (read-only this step).
- Applying migrations to the hosted project (operator-owned).
- Changing `SessionProvider`'s session/password-change logic.
- Clients, milestones, comments, activity, savedFilters tables (still
  unsupported — keep their `UNSUPPORTED` entries and diagnostics).

## Acceptance

- [ ] New migration exists, follows all conventions, and `npx vitest run src/supabase/migrations.test.ts` passes.
- [ ] In supabase mode (signed in), profile/department/role/team/statuses/service types/work categories load via RLS-scoped selects through the injected adapter; each new surface shows Polish loading, empty and error (+retry) states.
- [ ] `useCan`/`canTeam` reflect the cloud role when the snapshot is ready and self-acting; fall back to the local role while loading/on error/in local mode/while impersonating — verified by `effectiveAccessRole` tests.
- [ ] TeamPage in supabase mode renders exactly the RLS-returned rows (no client re-filtering); local mode output unchanged.
- [ ] Planner pages (kanban, task modal, admin dictionary editors) still run on local dictionaries; no reducer action added; no dispatch from cloud-read code paths except none at all.
- [ ] Import tool migrates the three dictionaries idempotently (rerun => skipped) and dry-run no longer reports them as "no target table".
- [ ] Local mode: zero behavioral diff (no client creation, no new sections).
- [ ] Transitional boundary documented in `referenceData.ts`, `supabase/README.md`; wiki page updated.

## Verification

- Worker: `npx vitest run src/supabase src/pages/teamScope.test.ts src/store` (focused; then the full `npm test` once before reporting)
- Browser: none — no covered stability-sensitive interaction changes (calendar/bin untouched; new sections are plain reads); release verification owns the browser matrix.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Migration path chosen over keeping the three dictionaries local-only (the
  scheduler task lists them as Supabase reads; no blocker found). Timestamp
  `20260716150000`; column `sort_order`.
- Dictionary SELECT is granted to all `authenticated` (org-wide reference
  data); writes admin-only via `app.is_administrator()`. No new SQL helpers.
- Reuse `createSupabaseImportDb` / `Pick<ImportDb,'select'>` as the read
  adapter — one DB boundary, one fake pattern.
- Own profile matched by auth user id, not email; email association to the
  local `Person` (for planner data) stays unchanged.
- Cloud→frontend role mapping: `manager→pm`, `worker→pracownik`;
  `handlowiec` collapses to worker semantics in supabase mode (matches RLS).
- Snapshot load is atomic (any select failure fails the whole snapshot);
  empty results are valid; missing own profile is a state, not an error.
- Cloud reads never enter AppStore; planner keeps local dictionaries this step
  (local ids reference planner data; id identity with cloud rows is not
  guaranteed). This is the documented temporary fallback boundary.
- Impersonation preview keeps local roles; cloud role override applies only
  when acting as self.
- No global shell error banner; per-surface error states with retry.
