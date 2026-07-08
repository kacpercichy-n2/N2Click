# Handoff: Accounts data model — roles, password hash, availability, supervisor (migration v4→v5)

- **Package ID:** PKG-20260708-auth-data
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-budget-store (file-conflict ordering on AppStore.tsx / selectors.ts / storage.ts / types.ts — not a logic dependency)
- **Blast radius:** high — data model + migration + reducer + seed + permission map. Foundation for packages 5–7.

## Goal

Extend `Person` with an access role (replacing `isAdmin`), password hash, phone,
availability (work days + work hours) and supervisor; ship migration v4→v5; ship
the central permission map `can()` and the password-hash utility. Minimal
mechanical UI swaps only, so the app compiles and behaves as today.

## Context the worker needs

- Relevant files: `src/types.ts` (Person ~line 70), `src/store/storage.ts`
  (`DATA_VERSION`, `loadData` migration chain ~line 401, `migrateV1`,
  `DEFAULT_CAPACITY`), `src/store/AppStore.tsx` (`PersonDraft` ~line 71,
  `personFromDraft` ~line 864, Action union, ADD/UPDATE_PERSON cases),
  `src/store/selectors.ts` (`isAdminUser` ~line 438, `currentUser`),
  `src/store/seed.ts` (3 people; Kasia admin), `src/utils/dates.ts`
  (`parseDate`), and the mechanical call sites: `src/App.tsx` (line ~217
  `p.isAdmin` suffix), `src/pages/PeoplePage.tsx` (isAdmin checkbox lines
  21/140–141/164), `src/pages/PersonProfilePage.tsx` (lines 58/91/184–185),
  test fixtures `src/store/blockActions.test.ts:51`,
  `src/store/selectors.test.ts:41`.
- Conventions: CLAUDE.md. storage.ts owns ALL migrations; dates are
  `'yyyy-MM-dd'`; Polish UI strings; reducer is synchronous (hashing happens in
  the UI before dispatch).
- Prior decisions (architect-settled — do not reopen):
  1. **Roles.** `type AccessRole = 'administrator' | 'pm' | 'handlowiec' | 'pracownik'`.
     `Person.isAdmin` is REMOVED and replaced by `accessRole: AccessRole`.
     Polish labels: Administrator / PM / Handlowiec / Pracownik.
  2. **New Person fields (with migration defaults):**
     - `accessRole` — `isAdmin === true` → `'administrator'`, else `'pracownik'`.
     - `phone: string` — `''`.
     - `passwordHash: string` — `''` (empty = "no password set": that person
       logs in without a password — the no-lockout rule, mirroring the
       zero-people admin gate).
     - `workDays: number[]` — ISO weekdays 1 (Mon) … 7 (Sun); default
       `[1,2,3,4,5]`.
     - `workStartMinutes: number` — default 480 (8:00).
     - `workEndMinutes: number` — default `min(1440, 480 + capacity*60)`.
       Work hours are informational (profile display / future hints); capacity
       stays THE overload threshold and availability quantum — no validation
       coupling between them (document in a comment).
     - `supervisorId: string` — `''`; must never form a cycle (see decision 5).
  3. **Migration v4→v5** in `storage.ts`: `DATA_VERSION = 5`; a
     `migrateV4toV5(data)` step applied in `loadData` for payloads with
     `version < 5` (after the existing v1 path merges into the common chain);
     maps `isAdmin` per decision 2 and strips the old key. Same-version loads
     keep working via the `emptyData()` spread defaulting. Loading stays
     idempotent. The documented storage.ts→API extension path is unchanged.
  4. **Security stance.** SHA-256 via WebCrypto in a new
     `src/utils/password.ts`: `hashPassword(plain: string): Promise<string>`
     (hex digest) and `verifyPassword(plain, hash): Promise<boolean>`. Comment
     block MUST state this is cosmetic client-side gating (localStorage app, no
     salt/KDF) and will be replaced by the API's real auth later.
  5. **Supervisor cycle guard.** Reducer-level: on UPDATE_PERSON (and
     defensively ADD_PERSON), if the draft's `supervisorId` equals the person's
     own id or walking the supervisor chain from it reaches the person, store
     `''` instead (deterministic, never throws). Export the pure helper
     `wouldCreateSupervisorCycle(people, personId, supervisorId)` (from
     selectors.ts or a small util) — package 7's UI will reuse it for inline
     validation.
  6. **New actions:** `SET_PASSWORD { personId; passwordHash }` (stores the
     given hash verbatim; `''` clears the password) and `LOGOUT` (sets
     `currentUserId: ''`). No activity-log rows for either (they are not
     project/task events).
  7. **Permission map** in a new `src/store/permissions.ts`:
     `type PermAction` union + `can(user: Person | undefined, action: PermAction,
     opts?: { peopleCount?: number }): boolean` + `ROLE_LABELS: Record<AccessRole, string>`.
     Setup-mode rule: when the app has zero people, everything is allowed
     (mirror `isAdminUser`); implement by having callers pass
     `peopleCount` (or a `canIn(state, action)` wrapper in selectors.ts that
     handles it — your choice, keep ONE obvious entry point). Matrix
     (✓ = allowed):

     | PermAction            | administrator | pm | handlowiec | pracownik |
     |-----------------------|:---:|:---:|:---:|:---:|
     | `projects.manage` (create/edit/delete, status, dates, milestones) | ✓ | ✓ | ✓ | – |
     | `projects.paid` (coin toggle)                                     | ✓ | – | ✓ | – |
     | `clients.manage`                                                  | ✓ | – | ✓ | – |
     | `tasks.manage` (create/edit/delete tasks, statuses, allocations)  | ✓ | ✓ | – | – |
     | `blocks.editAny` (calendar blocks of anyone)                      | ✓ | ✓ | – | – |
     | `blocks.editOwn` (calendar blocks where entry.personId === self)  | ✓ | ✓ | ✓ | ✓ |
     | `people.manage` (add/edit/delete people, roles, supervisors)      | ✓ | – | – | – |
     | `profile.editOwn` (own contact fields, avatar, password)          | ✓ | ✓ | ✓ | ✓ |
     | `workload.reassign` (WorkloadPage reassign control)               | ✓ | ✓ | – | – |
     | `admin.panel` (admin page: statuses, clients*, departments, service types) | ✓ | – | – | – |
     | `users.impersonate` ("Występuj jako" quick switch)                | ✓ | – | – | – |
     | `comments.add`                                                    | ✓ | ✓ | ✓ | ✓ |

     (*`clients.manage` also lets handlowiec manage clients from wherever
     clients are editable outside the admin panel — the admin panel itself stays
     admin-only.) Everyone may VIEW every page except `/admin`. This package
     only SHIPS the map; applying it across pages is PKG-20260708-permission-gating.
  8. **Availability selectors** (in `selectors.ts`, consumed by package 7):
     - `isPersonWorkday(state, personId, date): boolean` — ISO weekday of
       `parseDate(date)` ∈ `person.workDays` (map JS `getDay()` 0=Sun → ISO 7).
     - `availableHoursOnDate(state, personId, date): number` — workday ?
       `personCapacity` : 0.
     - `availableHoursInRange(state, personId, dates: DateStr[]): number` — sum.
  9. **`isAdminUser`** keeps its name/signature and the zero-people-open rule,
     reimplemented as `accessRole === 'administrator'`.
  10. **Seed** (`src/store/seed.ts`): Kasia → `administrator`, Ola → `pm`,
      Marek → `pracownik`; all `passwordHash: ''` (passwordless demo login);
      sample phones; Kasia/Marek default workDays, Ola `[1,2,3,4]` (Mon–Thu) so
      availability math is visibly non-uniform; Marek's `supervisorId` → Kasia,
      Ola's → Kasia; work hours per decision 2 defaults. Keep the existing
      over-capacity day and all other seed content intact.

## Scope

### In scope

- `src/types.ts`, `src/store/storage.ts` (v5 migration), `src/store/AppStore.tsx`
  (PersonDraft: replace `isAdmin` with `accessRole`, add `phone`, `workDays`,
  `workStartMinutes`, `workEndMinutes`, `supervisorId` — NOT `passwordHash`;
  `personFromDraft` returns `Omit<Person, 'id' | 'passwordHash'>` so updates
  never clobber the hash; ADD_PERSON initializes `passwordHash: ''`; new
  SET_PASSWORD / LOGOUT cases; cycle guard), `src/store/selectors.ts`,
  `src/store/permissions.ts` (new), `src/utils/password.ts` (new),
  `src/store/seed.ts`.
- Minimal mechanical UI swaps (NO redesign — full profile UI is package 7):
  - `src/App.tsx` ~217: `(administrator)` suffix from
    `p.accessRole === 'administrator'`.
  - `src/pages/PeoplePage.tsx` + `src/pages/PersonProfilePage.tsx`: replace the
    isAdmin checkbox with a select labeled `Uprawnienia` (4 roles,
    `ROLE_LABELS`); `admin-tag` span shown for administrators as today; draft
    objects extended with the new fields' defaults (no new form controls yet).
- Test fixture updates: `blockActions.test.ts` / `selectors.test.ts` person
  fixtures (`isAdmin: false` → `accessRole: 'pracownik'` + new field defaults).
  If a shared `makePerson` helper exists, update it once.

### Out of scope

- Login screen / logout button / password-change UI (PKG-20260708-auth-login-ui).
- Applying `can()` to pages/nav (PKG-20260708-permission-gating).
- Profile form fields for phone/availability/supervisor and the workload
  availability-math swap (PKG-20260708-profile-availability).
- New tests for the migration/permissions/availability (PKG-20260708-store-tests).
- Any WeekView/styles.css change.

## Implementation notes

- Follow `migrateV1`'s style; keep `localizeLegacyData` order intact
  (v<2 → migrateV1 → localize → v4→v5 → ensureStartMinutes). A clean v5 payload
  must load reference-stable where feasible (at minimum: idempotent).
- `workDays` sanitation in the migration/personFromDraft: dedupe, keep only
  1–7, sort ascending; empty array is allowed (= no workdays) but the DEFAULT is
  Mon–Fri.
- Keep `PersonDraft` consumers compiling — PeoplePage/PersonProfilePage draft
  literals must include the new defaults.
- WebCrypto (`crypto.subtle`) exists on localhost/secure contexts and in
  vitest's node env ≥20 — no polyfill.

## Acceptance criteria

- [ ] A stored v4 payload (people with `isAdmin`) loads: admins →
      `accessRole 'administrator'`, others `'pracownik'`; all new fields get the
      documented defaults; no `isAdmin` key remains; nothing else is lost;
      loading twice is idempotent.
- [ ] A v1 payload still migrates end-to-end (first person becomes
      administrator).
- [ ] `can()` returns exactly the matrix above for each role ×
      each PermAction; with zero people everything is allowed; an undefined
      user (people > 0) gets only `comments.add`-level nothing — i.e. all
      actions false.
- [ ] `hashPassword('a')` resolves to the 64-char hex SHA-256 of `'a'`
      (`ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb`);
      `verifyPassword` round-trips.
- [ ] UPDATE_PERSON with a supervisorId that would create a cycle (self, or
      A→B→A) stores `''`; acyclic chains store as given.
- [ ] SET_PASSWORD updates only the hash; UPDATE_PERSON never clobbers a stored
      hash; LOGOUT clears `currentUserId`.
- [ ] Availability selectors: Ola (Mon–Thu) has 0 available hours on a Friday
      and `capacity` on a Wednesday.
- [ ] App behaves exactly as before in the browser (roles select replaces the
      checkbox; admin gate works for Kasia, blocked for Marek).
- [ ] `npx tsc --noEmit` clean; `npm test` green (fixtures updated);
      `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green; only mechanical fixture edits in existing test files
  (itemize them). Dedicated migration/permission/availability tests come from
  PKG-20260708-store-tests. Dev server already runs on 5173 — don't start one.

## Report back

Synthesized summary only (files changed one-line each, fixture edits itemized,
test results, deviations). Append to `handoffs/RUN-STATE.md` under the current
run's Worker log. No raw logs.
