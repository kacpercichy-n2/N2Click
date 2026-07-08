# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 "Unassigned bin + block split + sidebar collapse" —
> APPROVED; 2026-07-08 "Walkthrough fixes: fixed hour axis, bin beside grid,
> duration format" — APPROVED) are archived in git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of both
> approved runs' interactive criteria; (b) commit hygiene — `git add` the
> untracked `src/utils/uiPrefs.ts`, `src/store/selectors.test.ts`, package and
> review files; (c) CLAUDE.md refresh (bin/zasobnik, week-view panes,
> formatDuration convention) — human task, not a worker package.

---

## Run: 2026-07-08 — Hour budget + block merging · accounts/roles/permissions · sidebar icon fix

### Plan (architect)

- **Goal:** (B, priority) Calendar block resizing stops minting hours: growth
  draws from the task's bin/estimate budget and clamps at it, shrink returns
  hours to the bin, same-task bin rows merge to one per person, and two
  same-task blocks dropped exactly back-to-back fuse into one block with a
  light merge animation (reduced-motion safe). (C) Local login gating the app
  (per-person SHA-256 password hash, cosmetic by design, API-ready seam), four
  access roles (administrator/PM/handlowiec/pracownik) replacing `isAdmin` via
  migration v4→v5, a central `can()` permission map applied across the UI,
  extended profiles (telefon, dni robocze, godziny pracy, przełożony z blokadą
  cykli) and workday-aware available-hours math. (D) Collapsed-sidebar nav
  icons in fixed 1:1 circles (bundled into the week-UI package).

- **Stream A verdict (foundation audit): ADEQUATE — no package emitted.**
  Reasons: (1) data volumes are bounded by design (single-team planner behind
  a ~5 MB localStorage ceiling; hundreds of tasks / thousands of entries at
  worst) and every selector is a pure linear scan — measured hot paths don't
  exist at this scale; (2) all reads already flow through centralized pure
  selectors, so introducing memoized byId maps later is a local, non-breaking
  change behind the same call sites; (3) the storage.ts→API extension path
  must stay thin — adding an index/normalization layer now would complicate
  that swap for no current gain; (4) the v4→v5 migration in this run is the
  sanctioned vehicle for the shape changes Stream C needs. Watch item (noted,
  not actioned): `conflictDatesForTask`/`hoursForPersonOnDate` compose to
  O(workload²)-ish in pathological data — revisit only if entry counts reach
  ~10k or profiling shows render lag.

- **Key decisions (pre-resolved — details in the packages, no open questions):**
  - Budget model: headroom = max(0, estimatedHours − task total incl. bin);
    grow allowance = same-person same-task bin + headroom, consumed bin-first;
    `estimatedHours null` ⇒ free grow (today's behavior). Enforcement in
    `SET_BLOCK_TIME` only (reducer rejects; UI clamps live) — SAVE_TASK /
    AllocationGrid stay advisory. Known SAVE_TASK `personId|date` collapse
    issue explicitly untouched.
  - New invariants: ≤1 bin entry per (taskId, personId) (all bin writers +
    idempotent merge in `ensureStartMinutes`, DATA_VERSION stays 4 for that);
    exact-adjacent same-task same-person dated blocks merge inside
    SET_BLOCK_TIME (earlier id survives; cascades; NOT in INSERT_BLOCK).
  - Auth: session = persisted `currentUserId`; login screen when people exist
    and nobody resolves; zero people = setup mode (no lockout); empty
    `passwordHash` = passwordless login (recovery path; admin can clear any
    password); `isAdmin` removed → `accessRole`, migration v4→v5
    (admin→administrator, else pracownik); permission matrix lives in new
    `src/store/permissions.ts` (spelled out in PKG-…-auth-data); "Występuj
    jako" becomes administrator-only quick switch + universal "Wyloguj";
    UI-level enforcement only until the API era.
  - Availability: `workDays` (ISO 1–7, default Mon–Fri) + informational work
    hours; available-hours totals become per-person workday sums; overload
    threshold rule intentionally unchanged.

- **Packages** (waves are parallel-safe by disjoint files; order matters):
  - **Wave 1:** 1. `handoffs/packages/PKG-20260708-budget-store.md` —
    tier: developer — budget/merge/bin invariants in reducer + storage +
    selectors (+ mechanical existing-test updates).
  - **Wave 2 (parallel):**
    2. `handoffs/packages/PKG-20260708-budget-week-ui.md` — tier: developer —
       WeekView clamp feedback + will-merge/fuse animation + Stream D sidebar
       icon circles (WeekView.tsx + styles.css only; depends 1).
    3. `handoffs/packages/PKG-20260708-auth-data.md` — tier: developer —
       types v5 + migration + permissions.ts + password util + seed +
       mechanical UI/fixture swaps (depends 1 for file-conflict ordering).
  - **Wave 3 (parallel):**
    4. `handoffs/packages/PKG-20260708-store-tests.md` — tier: test-writer —
       full unit coverage for packages 1+3 (test files only; depends 1 and
       auth-data).
    5. `handoffs/packages/PKG-20260708-auth-login-ui.md` — tier: developer —
       LoginPage + App.tsx gate + logout/quick-switch + password UI (depends
       auth-data; after budget-week-ui for styles.css ordering).
  - **Wave 4:** 6. `handoffs/packages/PKG-20260708-permission-gating.md` —
    tier: developer — apply can() per the page map (depends login-ui).
  - **Wave 5:** 7. `handoffs/packages/PKG-20260708-profile-availability.md` —
    tier: developer — profile/org form fields + workday-aware availability
    (depends gating).

- **Gates:** `npx tsc --noEmit` + `npm test` + `npm run build` green after every
  package (dev server already running on 5173 — nobody starts a second one);
  Codex review + reviewer verdict after waves complete; final human browser
  walkthrough (budget clamp, merge animation incl. reduced-motion, login/roles
  matrix per role, availability math with seeded Ola Mon–Thu, collapsed sidebar
  circles) before merge.
- **Parallel input:** a Codex browser UX audit of the current app runs
  alongside this run; its findings go to the REVIEWER for adjudication — no
  worker should wait on it.
- **Open questions:** none blocking. Post-merge doc note for the human:
  CLAUDE.md needs a refresh after this run (budget/merge invariants, one-bin-row
  rule, v5 person model + roles + login, permission matrix pointer,
  availability semantics, manual-checklist additions) — on top of the
  carried-over doc refresh above; intentionally NOT a worker package.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-08 · developer (opus) · `PKG-20260708-budget-store`

- **Changed:**
  - `src/store/selectors.ts` — added `binEntryForTaskPerson`, `binHoursForTaskPerson`, `taskBudget`, `growAllowanceHours` (pure budget/bin selectors).
  - `src/store/AppStore.tsx` — `setBlockTime`: budget-capped grow (bin-first then headroom, reject past allowance), shrink now merges freed hours into the existing (task,person) bin row, exact-adjacent same-task same-person block merge with `pobrano z zasobnika` / `połączono sąsiednie bloki` activity suffixes; one-bin-row enforcement in `moveBlockToBin` (fold into existing row), `splitBlock` (parts collapse to one bin row; bin entries now no-op), `saveTask` `newUnassigned` (per-person merge into one/passed-through row), `reassignEntry` (bin→person merges into target's same-task row); added `toQuarters` helper.
  - `src/store/storage.ts` — `ensureStartMinutes` bin groups now merge duplicate per-task rows (lowest-sortIndex survivor, hours summed) before renumbering; still idempotent, DATA_VERSION stays 4.
  - `src/types.ts` — documented the two new WorkloadEntry invariants.
  - Tests adapted mechanically (see below) in `blockActions.test.ts` and `storage.test.ts`.
- **Existing-test edits (mechanical, each with reason):**
  1. `blockActions` MOVE_BLOCK_TO_BIN "appends after an existing bin entry" — pointed the existing bin row at a different task (`t2`) so the one-bin-row merge doesn't fold the moved block in; preserves the append/reindex assertion.
  2. `blockActions` SPLIT "quarters a 1.25h block" — now expects ONE 0.75h bin row (split-off parts collapse) instead of three 0.25h rows.
  3. `blockActions` SPLIT "splits a bin entry within the bin" → renamed to assert a no-op (`toBe(state)`): splitting a bin block into two same-pair bin rows is illegal under the invariant.
  4. `blockActions` SAVE_TASK `newUnassigned` — now expects ONE merged 11.25h bin row (10h + 1.25h) instead of two rows.
  5. `blockActions` REASSIGN "moving a bin entry ... appends" → rewritten to assert the merge into the target's existing same-task bin row (moved id dropped, target 3h, single row).
  6. `storage` three bin tests ("garbage startMinutes+gappy sortIndex", "idempotent already-clean", "does NOT stack from 08:00") — gave the two entries distinct tasks (`t1`/`t2`) so the new per-task merge doesn't fire, preserving each test's original startMinutes/sortIndex assertion.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest 68/68 passed (4 files), build OK.
- **Still broken:** nothing in scope.
- **Deviations / notes for reviewer & package 2:**
  - `SPLIT_BLOCK` on a BIN entry now no-ops (was previously allowed). WeekView still renders "Podziel na pół / na ćwiartki" for bin blocks (`WeekView.tsx` ~L766-793, shown for all entries) — those buttons are now dead for bin blocks. **Package 2 (budget-week-ui) should hide/disable split on bin entries.** Reducer change is correct per the one-bin-row invariant; flagging so the UI matches.
  - No new test files added (new coverage is deferred to PKG-20260708-store-tests per this package's scope). Only broken existing tests were adapted.
- **Next:** ready for wave 2 (`PKG-20260708-budget-week-ui`, `PKG-20260708-auth-data`) and reviewer.

#### 2026-07-08 · developer (opus) · `PKG-20260708-budget-week-ui`

- **Changed:**
  - `src/components/WeekView.tsx` — `TimedBlock`: DragState gains `maxHours`/`atCap`/`willMergeWithId`/`willMergeEdge`; `begin()` captures `growAllowanceHours` once (null ⇒ Infinity ⇒ free grow); `onPointerMove` clamps resize `projHours` at `maxHours` (top mode re-derives `projStart` to keep the end fixed) and detects exact-adjacent same-task/same-person/same-date merge neighbor (mirrors the reducer predicate, false while colliding/overBin); `finish()` remembers the earlier-starting block's id as the fuse survivor before dispatch; `at-cap` title = "Limit czasu zadania — brak godzin w zasobniku". WeekView-level `mergeTargetId` + `fusedId` state (with 400ms timeout fallback) plumbed to blocks; classes `at-cap`/`will-merge`/`will-merge-target`/`merge-top`/`merge-bottom`/`fused`; `onAnimationEnd` clears `fusedId`.
  - `src/components/WeekView.tsx` (context menu) — "Podziel na pół / na ćwiartki" moved inside the `!isBinEntry` branch so split is hidden for bin entries (matches wave-1 reducer no-op). Folded in per launch instruction despite package's "context menu out of scope" note.
  - `src/styles.css` — `.week-block.at-cap` (warning outline), `.will-merge`/`.will-merge-target` (lavender glow), `.will-merge::after` connecting blob (radial pill, top/bottom edge variants), `week-block-fuse` 280ms keyframe; `.sidebar-collapsed .app-nav-link` now a fixed 44px 1:1 circle (border-radius 999px, margin-inline auto). Global `prefers-reduced-motion` override neutralizes the keyframe (no JS motion path).
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest 68/68 (4 files), build OK. No new unit tests (interaction-only per package scope).
- **Deviations:** (1) split-button hide is outside the package's stated scope but explicitly requested by the launching agent to match the wave-1 reducer change. (2) Blob rendered on the dragged block only (per decision 3) with glow on both blocks — satisfies the acceptance line "glow + blob on both blocks" via decision 3's authoritative detail.
- **Not CLI-verifiable (defer to human walkthrough):** live cap outline + Polish title while resizing to budget; unbudgeted (`estimatedHours: null`) task still grows freely; will-merge glow/blob appears on exact adjacency and clears on move-away / during collision / over bin; fuse animation plays once (~280ms) on merge drop; reduced-motion kills the fuse/blob but the merge still happens; collapsed-sidebar 44px circles centered in the 80px rail with visible active/hover; console clean.
- **Still broken:** nothing in scope.
- **Next:** ready for reviewer; wave 2 sibling `PKG-20260708-auth-data` unaffected (disjoint files).

#### 2026-07-08 · developer (opus) · `PKG-20260708-auth-data`

- **Changed:**
  - `src/types.ts` — `Person`: removed `isAdmin`, added `accessRole` (new `AccessRole` union), `phone`, `passwordHash`, `workDays`, `workStartMinutes`, `workEndMinutes`, `supervisorId` (all documented).
  - `src/utils/password.ts` (new) — `hashPassword`/`verifyPassword` (SHA-256 hex via WebCrypto) with the mandated "cosmetic client-side gating only" comment block.
  - `src/store/permissions.ts` (new) — `PermAction` union, per-role `MATRIX`, `can(user, action, {peopleCount})` (setup-mode = zero people → all allowed), `ROLE_LABELS`.
  - `src/store/storage.ts` — `DATA_VERSION = 5`; new `migratePerson`/`migrateV4toV5`; exported `WORKDAY_START_MIN`, `DEFAULT_WORKDAYS`, `defaultWorkEndMinutes`, `sanitizeWorkDays`; `migrateV1` people now built through `migratePerson`; `loadData` chain: v1 → `ensureStartMinutes(migrateV4toV5(localize(migrateV1)))`, v2–4 → localize (now runs for v4 too since DATA_VERSION=5) then `migrateV4toV5` when `version < 5`.
  - `src/store/selectors.ts` — `isAdminUser` reimplemented on `accessRole === 'administrator'` (same name/signature, zero-people rule kept); new pure `wouldCreateSupervisorCycle`; availability selectors `isPersonWorkday`/`availableHoursOnDate`/`availableHoursInRange` (JS getDay 0=Sun → ISO 7).
  - `src/store/AppStore.tsx` — `PersonDraft` swaps `isAdmin` for `accessRole` + adds `phone`/`workDays`/`workStartMinutes`/`workEndMinutes`/`supervisorId` (NOT `passwordHash`); `personFromDraft` returns `Omit<Person,'id'|'passwordHash'>` and sanitizes workDays; `ADD_PERSON` seeds `passwordHash: ''` + defensive cycle guard; `UPDATE_PERSON` drops cycle-forming `supervisorId`; new `SET_PASSWORD` (verbatim hash, no activity row) and `LOGOUT` (clears `currentUserId`).
  - `src/store/seed.ts` — Kasia `administrator` / Ola `pm` / Marek `pracownik`; all `passwordHash: ''`; sample phones; Ola `workDays [1,2,3,4]` (others Mon–Fri); Marek & Ola `supervisorId → Kasia`; work hours 8:00–16:00. Kasia declared first (supervisor ref); people array order `[ola, marek, kasia]` unchanged (stable colours). Over-capacity Wed and all other content intact.
  - `src/App.tsx` — acting-as suffix now from `accessRole === 'administrator'`.
  - `src/pages/PeoplePage.tsx` / `src/pages/PersonProfilePage.tsx` — `isAdmin` checkbox → `Uprawnienia` select (4 roles via `ROLE_LABELS`); `admin-tag` shown for administrators; draft literals extended with the new-field defaults (no new form controls yet).
- **Existing-test edits (mechanical):** `blockActions.test.ts` and `selectors.test.ts` `makePerson` fixtures — replaced `isAdmin: false` with `accessRole: 'pracownik'`, `phone: ''`, `passwordHash: ''`, `workDays: [1,2,3,4,5]`, `workStartMinutes: 480`, `workEndMinutes: 960`, `supervisorId: ''`. No assertions changed.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest 68/68 (4 files), build OK. Verified `sha256('a')` hex equals the acceptance value.
- **Deviations:** none. New migration/permission/availability tests intentionally deferred to `PKG-20260708-store-tests` (out of scope). `can()` is the single entry point (callers pass `peopleCount`); no `canIn` wrapper added.
- **Notes for reviewer:** (1) `localizeLegacyData` now runs for v4 payloads (DATA_VERSION rose to 5) — it's a no-op on already-Polish data (English→Polish maps don't match Polish values); rebuilds references only. (2) `migrateV1` calls `migratePerson`, so the v1 branch's later `migrateV4toV5` is idempotent by design.
- **Not CLI-verifiable (defer to human walkthrough):** roles select replaces the checkbox in People + profile; admin gate open for Kasia, blocked for Marek; browser behaves as before.
- **Next:** ready for reviewer; wave-3 `PKG-20260708-store-tests` (depends on this) and `PKG-20260708-auth-login-ui` can proceed.

#### 2026-07-08 · test-writer (sonnet) · `PKG-20260708-store-tests`

- **Changed (test files only — no implementation file touched):**
  - `src/store/blockActions.test.ts` — +20 tests: `SET_BLOCK_TIME` budget-capped
    grow (reject-at-estimate, drain-bin-then-headroom, pure-bin-draw,
    `estimatedHours: null` free grow, no cross-person/cross-task bin
    consumption, move-only never rejected), shrink→existing-bin-row merge,
    adjacency merge (simple + 3-way cascade + non-merge: different task /
    different person / 15-min gap), one extra `SPLIT_BLOCK` case (merge into a
    pre-existing bin row) and one extra `MOVE_BLOCK_TO_BIN` case (fold into an
    existing row, id survives), supervisor-cycle guard on `UPDATE_PERSON`
    (self, A→B→A, valid chain), `SET_PASSWORD`/`UPDATE_PERSON`-preserves-hash/
    `LOGOUT`.
  - `src/store/storage.test.ts` — +3 tests: `ensureStartMinutes` duplicate
    per-task bin-row merge (lowest-sortIndex survivor, summed hours, renumbered,
    idempotent, distinct-task row untouched); `loadData` v4→v5 migration
    (isAdmin true/false → accessRole, defaults incl. the 1440-minute
    `workEndMinutes` cap, no `isAdmin` key, version 5) via a small in-memory
    `localStorage` stub (not previously present in this file — `STORAGE_KEY` is
    duplicated as a literal since storage.ts doesn't export it); v5-payload
    reload idempotence.
  - `src/store/selectors.test.ts` — +5 tests: `growAllowanceHours` (null
    estimate, bin+headroom sum, headroom floored at 0 for an over-budget
    legacy task), `isPersonWorkday`/`availableHoursOnDate` (Mon–Thu worker: 0 on
    Friday, capacity on Wednesday), `availableHoursInRange` over a full
    Mon–Sun week.
  - `src/store/permissions.test.ts` (new) — 53 tests: the full 4-role ×
    12-action permission matrix from PKG-20260708-auth-data decision 7 via
    `it.each` (48 cases), zero-people setup mode allows everything, an
    undefined user (people present) is denied every action, `ROLE_LABELS`,
    `hashPassword('a')` matches the documented digest, `verifyPassword`
    round-trip.
- **Tests:** `npx tsc --noEmit && npm test` → tsc clean; vitest 149/149 passing
  across 5 files (was 68/68 across 4 files before this package — permissions.test.ts
  is new). `npm run build` intentionally not run (test-only package; dev server
  already on 5173 per package instructions — reviewer re-runs build).
- **Spec/implementation mismatches found:** none. Every case in the package's
  19 groups matched the shipped reducer/selector/migration/permission behavior
  on the first correctly-specified attempt (one test of mine had a self-inflicted
  bug — a free-grow-to-20h fixture that itself exceeded the 24:00 day boundary —
  fixed to 10h; not a product bug).
- **Skipped/deferred:** none of the 19 in-scope case groups were skipped.
  Out-of-scope per the package: no v1→v5 end-to-end migration test (only
  v4→v5, per the package's explicit scope — v1 coverage is `PKG-20260708-auth-data`'s
  acceptance criterion, not listed as an in-scope case here); no UI/browser tests.
- **Verified no implementation file modified:** `git status --short` shows only
  `src/store/blockActions.test.ts`, `src/store/storage.test.ts`,
  `src/store/selectors.test.ts` modified and `src/store/permissions.test.ts`
  added by this package; all other modified/untracked files (AppStore.tsx,
  selectors.ts, storage.ts, permissions.ts, types.ts, password.ts, WeekView.tsx,
  App.tsx, seed.ts, PeoplePage.tsx, PersonProfilePage.tsx, styles.css, package
  files, reviews/, automation/) predate this package (waves 1–2's output) and
  were left untouched.
- **Next:** ready for reviewer alongside waves 1–2.

#### 2026-07-08 · developer (opus) · `PKG-20260708-auth-login-ui`

- **Changed:**
  - `src/pages/LoginPage.tsx` (new) — full-viewport brand login card; person
    list (Avatar + name + `ROLE_LABELS`); passwordless row = one-click login;
    password row expands inline `Hasło` field + `Zaloguj się`, async
    `verifyPassword`, inline `Nieprawidłowe hasło`, Enter submits, button
    disabled while verifying; navigates to `/dashboard` on success.
  - `src/App.tsx` — session gate `needsLogin = people.length > 0 && !currentUser`
    returns `<LoginPage />` before the shell/routes (TaskModal + GlobalSearch stay
    gated); "Występuj jako" select now wrapped in
    `can(currentUser, 'users.impersonate', …)` (admins only); universal
    `Wyloguj` button dispatching `LOGOUT`.
  - `src/pages/PersonProfilePage.tsx` — new `PasswordSection` (own profile OR
    `can(user, 'people.manage')`): `Nowe hasło` + `Powtórz hasło`,
    `Ustaw/Zmień hasło` with min-4 + match inline errors, hashed before dispatch;
    admin `Usuń hasło` behind `window.confirm`.
  - `src/styles.css` — `.logout-btn`; `.login-*` classes (dark glass card, person
    rows, inline password panel; 760px padding tweak). Reused existing tokens.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest
  149/149 (5 files), build OK. No new unit tests (per package scope — store-level
  auth already covered by PKG-20260708-store-tests).
- **Deviation (one, minor):** Decision 3 describes a passwordless person as a
  two-step "pick → `Zaloguj się` button". I implemented the row click itself as
  the login action for passwordless people, because acceptance criterion
  "Passwordless person: one-click login lands on /dashboard" is the stronger,
  testable requirement and the two would otherwise conflict. Password-protected
  rows still expand to the `Zaloguj się` password form exactly as specified.
- **Not CLI-verifiable (defer to human walkthrough on :5173):** logged-out gate
  hides sidebar/routes and makes Ctrl/Cmd+K inert; one-click login per seeded
  person; set a password on Kasia → logout → wrong (`Nieprawidłowe hasło`) then
  right password; reload stays logged in; `Wyloguj` returns to login and persists
  through reload; impersonate select admin-only, `Wyloguj` for everyone; admin
  `Usuń hasło` confirm then passwordless login; zero-people fresh state shows NO
  login screen (setup/sample flow intact); ≤760px layout; console clean.
- **Still broken:** nothing in scope.
- **Next:** ready for reviewer; unblocks wave 4 `PKG-20260708-permission-gating`.

#### 2026-07-08 · developer (opus) · `PKG-20260708-permission-gating`

- **Changed:**
  - `src/store/useCan.ts` (new) — `useCan()` hook: reads the store once, returns a
    `can(action)` bound to the current user + `peopleCount` (setup-mode/undefined-user
    rules come for free).
  - `src/store/permissions.ts` — exported shared `NO_PERM_TITLE = 'Brak uprawnień'`.
  - `src/App.tsx` — nav hides `/admin` without `admin.panel`; `/admin` route redirects
    to `/dashboard` for non-admins (satisfies "direct URL redirects").
  - `src/pages/ProjectsPage.tsx` — "Nowy projekt" button+form hidden without
    `projects.manage`; per-card "+ Zadanie" hidden without `tasks.manage`.
  - `src/pages/ProjectDetailPage.tsx` — edit inputs/selects/textarea disabled +
    `Brak uprawnień` title, delete + milestone-add + milestone-delete hidden, milestone
    date input disabled → all `projects.manage`; both coins static without `projects.paid`;
    "+ Nowe zadanie" hidden without `tasks.manage`.
  - `src/pages/KanbanPage.tsx` — `isAdminUser`→`useCan`; card `draggable`+drop dispatch
    gated by `projects.manage`; quick-create box now `admin.panel`.
  - `src/pages/TimelinePage.tsx` — `Bar`/`MilestoneMark` gain `editable`; project bars +
    milestones → `projects.manage`, task bars → `tasks.manage`; non-editable render static
    (no pointer handlers, `pointer` cursor, click still opens).
  - `src/pages/TasksPage.tsx` — both "Nowe zadanie" buttons + per-row "Usuń" hidden without
    `tasks.manage`; row click still opens the (read-only) modal.
  - `src/components/TaskModal.tsx` — without `tasks.manage`: all detail/period/assignee
    inputs disabled, bin-add controls hidden, `AllocationGrid` read-only, save button + delete
    hidden, "Anuluj"→"Zamknij"; comments tab stays writable.
  - `src/components/AllocationGrid.tsx` — new `readOnly` prop (inputs disabled + title,
    fill/clear buttons hidden).
  - `src/components/WeekView.tsx` — `TimedBlock`/`BinCard` gain `editable`; enabled when
    `blocks.editAny` OR (`blocks.editOwn` AND `entry.personId === currentUserId`); non-editable
    blocks drop all pointer/context handlers (custom insert menu inherits the same rule),
    read-only title, `pointer` cursor; plain click still opens the task.
  - `src/pages/WorkloadPage.tsx` — reassign control gated by `workload.reassign`; "Przesuń
    całe zadanie" (MOVE_TASK) gated by `tasks.manage` (see deviation).
  - `src/pages/PeoplePage.tsx` — add form + per-row "Usuń" hidden without `people.manage`;
    list stays viewable.
  - `src/pages/PersonProfilePage.tsx` — edit button+form gated to `people.manage` OR self;
    when self-only (no `people.manage`), `Uprawnienia` select + capacity input disabled +
    title. Password section rule unchanged.
  - `src/styles.css` — `.readonly`/`.static` cursor rules for non-editable blocks/bars.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest 149/149
  (5 files), build OK. No unit-test changes (page wiring is walkthrough territory per package).
- **Deviations (2):**
  1. WorkloadPage "Przesuń całe zadanie" buttons: the per-page map only names the reassign
     control, but leaving MOVE_TASK open would let pracownik/handlowiec mutate tasks and break
     the "read-only everywhere except own blocks" acceptance criterion. Gated by `tasks.manage`
     (the natural action for a task move). Reassign itself still gated by `workload.reassign`.
  2. ProjectsPage per-card "+ Zadanie" quick-create: not explicitly in the map, but it opens a
     task-creation form, so gated by `tasks.manage` to honor "no creation forms" for pracownik.
- **Decision note:** `/admin` uses BOTH a route-level redirect (App.tsx) and AdminPage's existing
  `isAdminUser` gate; both resolve off `accessRole === 'administrator'`, so one rule effectively
  decides (redirect fires first; the in-page gate is now defensive/unreachable for non-admins).
- **Not CLI-verifiable (defer to human role walkthrough on :5173, log in as each):**
  administrator = pre-gating parity; PM (Ola) create/edit projects+tasks, drag kanban/timeline,
  any calendar block, workload reassign, but no coin/people/clients/admin/quick-switch; handlowiec
  (set one via People form) projects+coin, TaskModal read-only w/ working comments, own-blocks-only
  drag, no reassign/admin; pracownik (Marek) read-only everywhere except own calendar blocks,
  others' blocks inert, no creation forms, `/admin` link hidden + URL redirect; comments postable
  by every role; disabled controls show `Brak uprawnień`; zero-people setup unrestricted; console clean.
- **Still broken:** nothing in scope.
- **Next:** ready for reviewer; unblocks wave 5 `PKG-20260708-profile-availability`.

#### 2026-07-08 · developer (opus) · `PKG-20260708-profile-availability`

- **Changed:**
  - `src/components/personFields.ts` (new) — pure UI helpers shared by both forms:
    `WEEKDAY_CHIPS` (ISO 1–7 Pn→Nd), `START_MINUTE_OPTIONS` (0:00–23:45),
    `END_MINUTE_OPTIONS` (0:15–24:00), `toggleWorkDay`, `formatWorkDays`
    (compact `Pn–Cz` range / single / comma list). No store/selector logic.
  - `src/pages/PeoplePage.tsx` — add form gains Telefon input, Dni robocze chips,
    Praca od/do selects (15-min steps via `formatMinutes`), Przełożony select
    (all people; a brand-new person can't form a cycle), the
    `Limit dzienny liczony jest z pola dostępności` hint, and `Do > Od` submit
    validation (`Koniec pracy musi być po początku`).
  - `src/pages/PersonProfilePage.tsx` — edit form gains the same five controls;
    Dni robocze/hours/Przełożony disabled with `Brak uprawnień` for self-editors
    without `people.manage` (matches existing accessRole/capacity gating);
    supervisor options exclude self + `wouldCreateSupervisorCycle` candidates;
    inline hours validation. New read-only `ProfileFacts` card (telefon, dni
    robocze, godziny pracy, przełożony link, podwładni links — row omitted when
    empty). Week summary `available` now `availableHoursInRange(state, id, week)`.
  - `src/pages/WorkloadPage.tsx` — per-person `available =
    availableHoursInRange(state, p.id, days)`; day cells additionally tinted with
    the `weekend` class on the person's non-workdays; footer text updated to
    `Dostępne = dzienna dostępność × dni robocze osoby.`; removed the now-unused
    `workdays` const. Overload rule (`h > capacity`) untouched.
  - `src/styles.css` — `.weekday-chips`/`.weekday-chip` (accessible real
    checkboxes styled as chips, focus-visible ring, disabled dimming via
    `:has`), `.profile-facts`/`.profile-fact`/`.profile-link`, `.people-form-hint`.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean, vitest
  149/149 (5 files), build OK. No test-file edits (per package scope).
- **Deviations (1, minor):** created a new shared module
  `src/components/personFields.ts` rather than inlining the identical chip/option
  helpers into both pages. It is presentational-only (no store/selector touch),
  so it stays inside the package's out-of-scope guard; chosen over duplicating
  ~40 lines across two forms. Time-select range decision resolved per the
  package's "pick one": Od `0:00–23:45`, Do `0:15–24:00` (`24:00` = 1440).
- **Browser-verified logic (against seed; needs human :5173 confirm):** Ola
  (workDays [1,2,3,4], capacity 8) → Workload `Dostępne` = 32h and her Friday
  cell carries the weekend tint; Kasia's supervisor select offers only `—`
  (Ola/Marek excluded as cycle-forming); Kasia's profile Podwładni = Ola + Marek,
  Ola's Przełożony = Kasia.
- **Not CLI-verifiable (defer to human walkthrough on :5173):** both forms
  round-trip all new fields (save→reopen identical); inline Polish validation on
  `Do ≤ Od`; supervisor/subordinate links navigate; self-editing without
  `people.manage` shows the three org fields disabled with `Brak uprawnień`;
  weekday chips keyboard-focusable; ≤760px layout; console clean.
- **Still broken:** nothing in scope.
- **Next:** ready for reviewer — final package of the run (wave 5).

#### 2026-07-08 · developer (opus) · Fix round (reviewer changes 1–3, store layer)

- **Changed:**
  - `src/store/AppStore.tsx` — `ADD_PERSON`: first person into an empty people
    list is forced to `accessRole: 'administrator'` (fresh-setup lockout guard).
    `UPDATE_PERSON`: refuses to demote the only remaining administrator (returns
    `state` unchanged — reject-by-same-ref). `DELETE_PERSON`: now a block that
    refuses to delete the only remaining administrator (guard applied BEFORE the
    cascade), else delegates to `deletePerson`. `deletePerson`: additionally
    clears `supervisorId` on remaining people where it equals the deleted id
    (invariant-5 cascade).
  - `src/store/storage.ts` — `loadData`: person normalization (`migrateV4toV5`
    → `migratePerson`) now runs on EVERY load, not only `version < 5`, mirroring
    `ensureStartMinutes`. Fixes the permanent login-screen lockout for a
    v5-stamped payload whose people were never actually migrated.
- **Tests added:**
  - `src/store/blockActions.test.ts` — +7: ADD_PERSON first-person→admin (and
    respects role for later people); UPDATE_PERSON reject demote-last-admin +
    allow when another admin exists; DELETE_PERSON reject delete-last-admin +
    allow when another admin exists + dangling-supervisorId cleanup (unrelated
    supervisorId left intact).
  - `src/store/storage.test.ts` — +1: v5-stamped payload with un-migrated people
    (isAdmin present, no accessRole) loads with correct roles/defaults, no
    `isAdmin` key, and is idempotent on reload.
- **Tests:** `npx tsc --noEmit` clean · `npm test` 157/157 (5 files, was 149) ·
  `npm run build` OK (pre-existing chunk-size warning only).
- **Deviations:** none. Reviewer changes 4–5 (WeekView insert picker, TaskModal/
  AllocationGrid workday fill) are UI-only and out of this store-layer package's
  scope — not touched.
- **Next:** ready for reviewer (delta re-review of changes 1–3); changes 4–5
  still open for a UI developer.

#### 2026-07-08 · developer (opus) · Fix round (reviewer changes 4–5, UI layer)

- **Changed:**
  - `src/components/WeekView.tsx` — right-click "Dodaj przed/po" insert form: the
    `Zadanie` picker now maps over a new `insertTaskOptions` list instead of raw
    `state.tasks`. When the user has `tasks.manage` (via existing `useCan`) the
    full task list is offered; otherwise options are restricted to tasks the
    block's person is already assigned to (`taskIdsOfPerson`), which always
    includes the clicked block's own task (kept as default). Closes the
    `blocks.editOwn` self-assign-to-any-task hole (INSERT_BLOCK auto-assigns).
    Added `taskIdsOfPerson` to the selectors import.
  - `src/components/TaskModal.tsx` — `fillWeekdays` now iterates the period and
    fills each day with `availableHoursOnDate(state, personId, d)` (capacity on a
    person's workday, 0 otherwise), only writing cells where hours > 0 — replaces
    the hardcoded Mon–Fri (`isWeekdayDate`) + 8h. Added `availableHoursOnDate`
    import; dropped the now-unused `isWeekdayDate` import.
  - `src/components/AllocationGrid.tsx` — "Wypełnij dni robocze" button tooltip
    changed from "Ustaw 8h we wszystkie dni robocze" to "Wypełnij dni robocze
    osoby jej dzienną dostępnością" (no longer names 8h/Mon–Fri). Removed the
    now-dead exported `isWeekdayDate` helper (only caller was TaskModal) and its
    now-unused `parseDate` import.
- **Tests:** `npx tsc --noEmit` clean · `npm test` 157/157 (5 files) ·
  `npm run build` OK (pre-existing chunk-size warning only). No test-file edits
  (both changes are UI-behavior only; store selectors already covered).
- **Deviations:** none. Kept the fill's overwrite-workdays contract (current code
  overwrote every weekday, not empty-only) — now overwrites every person-workday
  with capacity. Polish UI strings preserved.
- **Not CLI-verifiable (defer to human walkthrough on :5173):** as pracownik/
  handlowiec, right-click own block → Dodaj po → picker shows only own assigned
  tasks (defaults to clicked task); as PM/admin the full list; "Wypełnij dni
  robocze" for seeded Ola (Mon–Thu) skips Friday and fills 8h Mon–Thu.
- **Next:** ready for reviewer (delta re-review of changes 4–5) — all 5 required
  changes now landed.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-08 · reviewer · verdict for run "Hour budget + block merging · accounts/roles/permissions · sidebar icon fix"

- **Status: CHANGES-REQUIRED** (core work is solid and approved in substance;
  5 targeted fixes before merge, none architectural).
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean · `npm test` 149/149
  (5 files) · `npm run build` OK (pre-existing chunk-size warning only).
- **Live browser verification (orchestrator input, recorded):** budget clamp at
  estimate headroom, shrink→single bin row, exact-adjacency fuse (+animation),
  30-min gap no-merge, clean v4→v5 migration (idempotent), login gate + one-click
  passwordless login, pracownik gating, collapsed-sidebar circles — all pass.

**Required changes (numbered):**

1. **P1 · `src/store/AppStore.tsx` (ADD_PERSON ~L1304, UPDATE_PERSON ~L1317,
   deletePerson ~L1085) · developer (+ test-writer):** Fresh-setup lockout
   (Codex #1, confirmed). In setup mode the add-person form defaults to
   `pracownik`, ADD_PERSON preserves it and does not set `currentUserId`; once
   one person exists the login gate activates with zero administrators and no
   recovery except editing localStorage. Fix: force `accessRole: 'administrator'`
   for the first person created into an empty people list (and preferably log
   them in); additionally guard demoting (UPDATE_PERSON) and deleting
   (DELETE_PERSON) the LAST administrator — reducer refuses, UI disables with a
   Polish title. Add reducer tests.
2. **P2 · `src/store/storage.ts` (loadData ~L532-535) · developer (+ test-writer):**
   A payload stamped `version: 5` whose people were never migrated (observed
   mid-dev via HMR) stays broken forever: `migrateV4toV5` only runs when
   `version < 5`, and a missing `accessRole` makes `MATRIX[undefined]` deny every
   action → permanent, unrecoverable lockout at the login screen. `migratePerson`
   is idempotent — run the person-normalization pass unconditionally on every
   load, exactly like `ensureStartMinutes`. Add a load test with a v5-stamped
   payload containing a pre-v5 person.
3. **P2 · `src/store/AppStore.tsx` (deletePerson ~L1085-1093) · developer
   (+ test-writer):** DELETE_PERSON leaves dangling `supervisorId` references
   (Codex #2, confirmed — people are filtered, supervisors never cleared),
   violating the cascade-delete pattern (CLAUDE.md invariant 5). Map remaining
   people and clear `supervisorId === deleted id`; add a reducer test.
4. **P2 · `src/components/WeekView.tsx` (insert form task select ~L966-982) ·
   developer:** A `blocks.editOwn`-only user (pracownik/handlowiec) can
   right-click an own block → Dodaj przed/po → pick ANY task in the system;
   `INSERT_BLOCK` auto-assigns, bypassing `tasks.manage` (Codex #3, confirmed).
   The gating package's acceptance explicitly allows the context menu on own
   blocks — the gap is the unrestricted picker. Restrict the `Zadanie` options
   to tasks the person is already assigned to (or just the clicked block's task)
   unless `can('tasks.manage')`.
5. **P2 (minor) · `src/components/TaskModal.tsx` L394-399 +
   `src/components/AllocationGrid.tsx` L187-191 · developer:** "Wypełnij dni
   robocze" hardcodes Mon–Fri + 8h (Codex #4, confirmed). Pre-existing code, but
   this run shipped per-person `Dni robocze` under the same name — for seeded
   Ola (Mon–Thu) the button now fills her Friday, directly contradicting the new
   model. Use `isPersonWorkday` + `personCapacity` per person.

**Codex findings adjudicated:** #1 (P1) accepted → change 1. #2 (P2) accepted →
change 3. #3 (P2) accepted → change 4 (noting the context menu itself is
sanctioned for own blocks; only the picker breadth is wrong). #4 (P2) accepted,
severity kept but scoped as minor/coherence → change 5. #5 (P3, `workDays: []`
+ assigned hours renders 0% instead of overload — WorkloadPage.tsx L288)
accepted as backlog nit (per-day overload flags still fire; summary % only).
Nothing dismissed; Codex raised no false positives.

**UX audit adjudicated:** both P1s confirmed REAL in code but PRE-EXISTING and
not worsened by this run → backlog, out of run scope: (a) `insertBlock`
end-of-day clamp (AppStore.tsx L561) can pull the new block back over the ref
block / let a pushed block overlap — the sweep only pushes blocks after the
insert point (clamp logic predates the run; overlaps render side-by-side, no
data corruption); (b) archiving an in-use status hides projects from Kanban
(design gap since the kanban run). P2/P3 friction items → backlog as listed in
the audit.

**Worker deviations (all 7 packages) — verified and ACCEPTED:** bin-entry split
no-op + UI hide (confirmed at WeekView L899 `!isBinEntry` branch); merge blob on
dragged block only (per decision 3); auth-data none; one-click passwordless
login (matches the stronger acceptance criterion); MOVE_TASK gated by
`tasks.manage` + "+ Zadanie" gated (both close real holes in the per-page map);
shared `personFields.ts` module (presentational only, within scope guard).

**Convention check: PASS.** Polish UI strings throughout; localStorage only via
storage.ts; reads via pure selectors; `yyyy-MM-dd` dates untouched; no new
dependencies; `prefers-reduced-motion` honored (CSS-only fuse animation);
personColor untouched. One placement nit: `toQuarters` lives in AppStore.tsx —
CLAUDE.md points hour-step math at `src/utils/time.ts` (move alongside
`HOURS_STEP` when convenient).

**Test coverage: ADEQUATE** (68 → 149; budget/merge/one-bin-row, migration
v4→v5 + idempotence, supervisor cycles, password/logout, full 4×12 permission
matrix — assertions are behavioral, not tautological). Gaps (fold into fixes
1–3): last-admin guard, first-person-admin, defensive v5 normalization,
DELETE_PERSON supervisor cleanup. Deliberate, accepted gap: no v1→v5
end-to-end test.

**Nits / backlog (non-blocking):** Codex #5 (0% vs overload display); UX-audit
pre-existing P1s (a)+(b) above; unsnapped `estimatedHours` (TaskModal saves
`Number(raw)` raw → off-grid estimate makes the UI's `maxHours` clamp off-grid
and the at-cap resize dispatch gets grid-rejected and reverts — snap the
estimate on save per invariant 4); `toQuarters` placement; CLAUDE.md refresh
(now must also cover login/roles/permissions/budget/bin invariants — human
task, already logged); carried-over commit hygiene incl. new untracked files.

**Routing:** changes 1–3 → developer with a test-writer follow-up (or one
combined store package); changes 4–5 → developer (UI-only). Re-review can be
delta-only.

#### 2026-07-08 · reviewer · delta re-review of the fix round — FINAL VERDICT

- **Status: APPROVE.** All 5 required changes verified in source; gates re-run
  by the reviewer: `npx tsc --noEmit` clean · `npm test` 157/157 (5 files) ·
  `npm run build` OK (pre-existing chunk-size warning only).

**Per-change verification:**

1. **Fresh-setup lockout — FIXED.** `ADD_PERSON` (AppStore.tsx ~L1316-1319)
   forces `accessRole: 'administrator'` when `state.people.length === 0`;
   `UPDATE_PERSON` (~L1327-1337) rejects demoting the only administrator
   (same-ref return); `DELETE_PERSON` (~L1353-1362) rejects deleting the only
   administrator BEFORE the cascade. Tests cover all six paths (force/respect,
   reject/allow demote, reject/allow delete). The optional "log the first
   person in" suggestion was not taken — acceptable: the login screen offers
   one-click passwordless login for the new administrator, so no lockout.
2. **v5-stamped unmigrated payload — FIXED.** `loadData` (storage.ts ~L533-541)
   now runs `migrateV4toV5` unconditionally on every load, mirroring
   `ensureStartMinutes`, with an accurate explanatory comment. New storage test
   loads a `version: 5` payload carrying pre-v5 people (isAdmin, no accessRole)
   and asserts roles/defaults/idempotence.
3. **Dangling supervisorId — FIXED.** `deletePerson` (AppStore.tsx ~L1090-1092)
   clears `supervisorId === deleted id` on remaining people inside the cascade;
   test asserts cleanup and that unrelated supervisor links survive.
4. **Insert-picker self-assign hole — FIXED.** WeekView.tsx ~L708-713:
   `insertTaskOptions` = full `state.tasks` only with `can('tasks.manage')`,
   else filtered to `taskIdsOfPerson(state, menu.entry.personId)` (which always
   contains the clicked block's task, preserved as default). Read via the
   existing selector — no new read path.
5. **Workday-aware fill — FIXED.** TaskModal `fillWeekdays` now writes
   `availableHoursOnDate(state, personId, d)` per day (>0 only), replacing
   hardcoded Mon–Fri/8h; AllocationGrid tooltip updated ("Wypełnij dni robocze
   osoby jej dzienną dostępnością"); dead `isWeekdayDate` helper + unused
   import removed (tsc confirms no stragglers).

**New backlog item found during delta review (non-blocking, defense in depth):**
a v4 payload whose people ALL have `isAdmin: false` migrates to a non-empty,
zero-administrator people set — login still works (passwordless) but nobody can
reach people.manage/admin.panel, and the new ADD_PERSON guard doesn't apply
(people already exist). Unlikely in practice (v1→v2 made the first person
admin), but consider promoting the first person in `migrateV4toV5` when a
non-empty people set has zero administrators — one line, idempotent.

**Carried nits/backlog (unchanged from the main verdict):** Codex #5 workDays
[] 0% display; pre-existing UX-audit P1s (insertBlock end-of-day clamp, status
archive vs Kanban); unsnapped `estimatedHours` vs the UI maxHours clamp;
`toQuarters` placement (utils/time.ts); CLAUDE.md refresh + commit hygiene
(human tasks). Remaining human step before merge: the role-matrix browser
walkthrough items each worker listed as not-CLI-verifiable, plus the two new
UI fixes (restricted picker as pracownik; Ola's Friday skipped by the fill).
