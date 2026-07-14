# Decision record: provider-neutral backend migration boundary

- Date: 2026-07-15
- Status: proposed (blocked-needs-decision — see "Human decisions required")
- Tier: architect-docs (documentation only; zero code or runtime changes)
- Scope: defines WHERE a backend would attach to the N2Hub frontend and WHAT
  any candidate backend must satisfy. Deliberately provider-neutral: no
  provider, SDK, credential, deployment or data migration is chosen here.
- Companion plan: `docs/plans/backend-migration-plan.md`

Line anchors below refer to the repository state at 2026-07-15 (branch
`review/claude-auto-20260714-1216`, after commit 88e36ac). Re-verify anchors
before cutting implementation packages.

---

## 1. Security statement (normative, non-negotiable)

Every client-side check in this codebase is **UX and data-integrity only. None
of it is, or can ever become, a security boundary.** The code says so itself:

- `src/store/permissions.ts:1-9` — "Enforcement is UI-level only until the API
  era (a determined user can edit localStorage directly)."
- `src/utils/password.ts:1-14` — "Cosmetic client-side password gating ONLY…
  Do NOT treat these hashes as protecting anything." Unsalted SHA-256, no KDF,
  no server verification.
- `src/types.ts:178-180` (`ActivityEvent`) — "localStorage is client-mutable,
  so this is NOT a security audit trail."
- `src/store/storage.ts` validation/repair passes protect against *rendering
  crashes and data corruption*, not against an adversary.

Consequences for any backend:

1. **Server-side authorization is mandatory** on every read and write from day
   one of the backend accepting app data. The client permission matrix
   (`MATRIX`, `permissions.ts:38-71`) is a UX mirror of the server policy,
   never the policy itself.
2. Client validation (reducer guards, `storage.ts` normalizers) must be
   **re-implemented or re-enforced server-side**; the server treats every
   client payload as untrusted.
3. The migration plan must never describe frontend checks or localStorage as
   protecting anything. Any package that does fails review.

---

## 2. Current architecture — the seams, exactly

### 2.1 Persistence seam — `src/store/storage.ts` (the primary cut line)

`storage.ts:1` already declares the intent: "Single persistence module. Wraps
localStorage so it can be swapped for an API later." The exported surface that
a repository/API adapter must reproduce:

| Symbol | Anchor | Role |
|---|---|---|
| `loadData(): AppData` | storage.ts:873 | Synchronous load + full migration/normalization pipeline; returns `emptyData()` on absence/corruption |
| `saveData(data): SaveResult` | storage.ts:951 | Whole-document write; returns `{ok:true, revision}` or `{ok:false, reason: SaveFailureReason}` — **never throws, never lies**; a failed save must never surface as `Zapisano` |
| `subscribeExternalChanges(cb): () => void` | storage.ts:862 | External-writer notification (today: same-browser `storage` events) |
| `exportRawData(): string \| null` | storage.ts:930 | Raw pre-normalization payload for the error-boundary recovery export and the PersistenceBanner failed-save fallback download |
| `clearData(): void` | storage.ts:968 | Full wipe |
| `emptyData(): AppData` | storage.ts:99 | Canonical empty document, `version: DATA_VERSION` |
| Types `SaveResult`, `SaveFailureReason` (`'quota'\|'unavailable'\|'serialization'\|'unknown'`), `ExternalChangeInfo` | storage.ts:789-792 | Save-outcome contract consumed by the UI |

Internal machinery an adapter must respect or generalize:

- **Storage keys**: `STORAGE_KEY = 'n2hub.data.v1'` (storage.ts:27), legacy
  fallbacks `LEGACY_STORAGE_KEYS = ['n2ub.data.v1', 'n2click.data.v1']`
  (storage.ts:28).
- **Data version**: `DATA_VERSION = 7` (storage.ts:29);
  `LOCALIZATION_MIGRATION_VERSION = 6` (storage.ts:30). `loadData` stamps every
  loaded payload to the current version.
- **Migration/normalization pipeline** (order matters; runs on EVERY load,
  idempotent by value): `migrateV1` (:190) → `localizeLegacyData` (:329) →
  `migrateV4toV5`/`migratePerson` (:175/:139) → `normalizeDates` (:595) →
  `ensureStartMinutes` (:467, includes the one-bin-row merge) →
  `normalizeTaskMeta` (:690) → `normalizeStatusFlags` (:747) →
  `sanitizeImpersonator` (:660). Composition sites: storage.ts:887-895 (v1
  payloads) and :916-919 (v2+).
- **Revision envelope** (same-browser tab safety, NOT sync): module-private
  monotonic counter `latestKnownRevision` (storage.ts:799), exposed via
  `getLatestKnownRevision` (:802); `readEnvelopeRevision` (:816) parses the
  envelope `revision` written by `saveData` (`{...data, revision}` at :955);
  `classifyStorageError` (:836) maps thrown storage errors to
  `SaveFailureReason`. The envelope is stripped before AppData reaches React
  state (:901).

### 2.2 Mutation seam — `src/store/AppStore.tsx`

- `Action` union (AppStore.tsx:154-209): the complete command vocabulary
  (~45 actions), from `SAVE_TASK`/`SAVE_PROJECT` through calendar-block
  commands (`SET_BLOCK_TIME`, `INSERT_BLOCK`, `SCHEDULE_BIN_PART`,
  `MOVE_BLOCK_TO_BIN`, `SPLIT_BLOCK`, `REASSIGN_ENTRY`), dictionary CRUD,
  session-flavored actions (`SET_CURRENT_USER`, `IMPERSONATE`,
  `STOP_IMPERSONATION`, `SET_PASSWORD`, `LOGOUT`), and non-user replacement
  actions (`LOAD_SAMPLE`, `RESET_ALL`, `REPLACE_FROM_STORAGE`).
- `reducer` (AppStore.tsx:1615) is exported and pure. House convention:
  **invalid commands return the prior state reference unchanged** (e.g. the
  `saveTask` guards at :304-334) — this is the atomicity contract a server API
  must mirror (reject whole commands, never partially apply).
- `AppStoreProvider` (AppStore.tsx:2174) is the ONLY place persistence meets
  React: `useReducer(reducer, undefined, loadData)` (:2175); a persist effect
  calling `saveData(state)` on every state change (:2204-2212); a mount-once
  `subscribeExternalChanges` effect implementing the refresh-vs-conflict
  choice (:2218-2234) — a clean tab silently refreshes via
  `REPLACE_FROM_STORAGE`, a dirty tab raises an explicit conflict.
- Persistence meta-state is a separate context: `PersistenceValue`
  (AppStore.tsx:2159-2170: `saveError`, `external`, `retryPersist`,
  `acceptExternal`, `keepLocal`, `dismissExternalNotice`) and
  `ExternalDataStatus = 'none' | 'refreshed' | 'conflict'` (:2157). Hooks:
  `useStore()` (:2279), `usePersistence()` (:2285).
- Activity rows are appended inside the same reducer action (`withActivity`,
  AppStore.tsx:226-245) so the local log cannot drift from the data. It
  carries `actorId` + `impersonatorId` — useful UX attribution, **not audit**.

### 2.3 Permission seam — `src/store/permissions.ts` + `src/store/useCan.ts`

- `can(user, action, opts)` (permissions.ts:78-86) — the single entry point.
  Setup-mode rule: `opts.peopleCount === 0` allows everything (no-lockout).
- `PermAction` union (permissions.ts:23-35) — 12 actions
  (`projects.manage`, `projects.paid`, `clients.manage`, `tasks.manage`,
  `blocks.editAny`, `blocks.editOwn`, `people.manage`, `profile.editOwn`,
  `workload.reassign`, `admin.panel`, `users.impersonate`, `comments.add`).
- `MATRIX: Record<AccessRole, ReadonlySet<PermAction>>` (permissions.ts:38-71)
  over `AccessRole = 'administrator' | 'pm' | 'handlowiec' | 'pracownik'`
  (types.ts:95).
- `useCan()` (useCan.ts:9-14) binds `can` to `currentUser(state)` +
  `peopleCount`; consumed across `src/pages/*` and `src/App.tsx`.

### 2.4 Identity/credential seam

- `Person.passwordHash` (types.ts:113) — unsalted SHA-256 hex; `''` = login
  without password (no-lockout rule).
- `src/utils/password.ts` — `hashPassword` (:17), `verifyPassword` (:26).
  The module header (:9-11) explicitly reserves this two-function surface as
  the swap point for real auth.
- Login flow: `src/pages/LoginPage.tsx:45` calls `verifyPassword`, then
  dispatches `SET_CURRENT_USER` (:24). Logout: `LOGOUT` dispatch in
  `src/App.tsx:272`. Impersonation: `IMPERSONATE`/`STOP_IMPERSONATION`
  actions; bookkeeping in `AppData.currentUserId`/`impersonatorId`
  (types.ts:228-232), sanitized on load (`sanitizeImpersonator`,
  storage.ts:660).

### 2.5 Data model seam — `src/types.ts`

`AppData` (types.ts:213-235) is the whole document: 13 entity collections
(`clients`, `departments`, `serviceTypes`, `workCategories`, `statuses`,
`projects`, `milestones`, `tasks`, `people`, `assignments`, `workload`,
`comments`, `activity`) plus session-ish scalars (`currentUserId`,
`impersonatorId`, `sampleBannerDismissed`, `savedFilters`, `version`).
Conventions any backend schema must map losslessly:

- All ids are `crypto.randomUUID()` strings (types.ts:2).
- Dates are `yyyy-MM-dd` strings (`DateStr`); `''` (`BIN_DATE`) is a valid
  sentinel ONLY on `WorkloadEntry.date` (types.ts:137-139).
- Time-of-day is `WorkloadEntry.startMinutes` (15-min grid); hours on a 0.25h
  grid (types.ts:140-155 documents the invariants, incl. one bin row per
  `(taskId, personId)`).
- `Status.isDone` owns completion, never order (types.ts:49-53).
- Timestamps (`createdAt`/`updatedAt`) are ISO strings.

---

## 3. The boundary decision

### 3.1 Where the repository/API abstraction sits

**Cut at the `storage.ts` function surface, behind a `DataRepository`
interface.** The interface reproduces the six-function contract of §2.1
(load, save, subscribe-external, export-raw, clear, plus save-outcome types),
with signatures generalized to async and to a provider-neutral conflict
signal. The production consumers of the storage surface today are:
`AppStoreProvider` (init load, persist effect, external subscription,
`retryPersist`/`acceptExternal`/`keepLocal` — §2.2);
`src/components/PersistenceBanner.tsx`, which imports `exportRawData` and the
`SaveFailureReason` type (PersistenceBanner.tsx:11-12) and calls
`exportRawData()` (PersistenceBanner.tsx:54) as the fallback download after a
failed save; and the error boundary's recovery export. All of these route
through the interface; the localStorage implementation becomes the default
adapter with byte-identical behavior. Any future backend is a second adapter
behind the same interface. Provider SDKs, HTTP clients and endpoint shapes
are confined to that adapter module — nothing else in `src/` may import them.

Why here and not deeper:

- It is the seam the codebase was built around (storage.ts:1, password.ts:9-11
  both name it explicitly).
- The reducer + whole-document persistence gives a natural first-stage
  server model (versioned document + revision CAS) that generalizes the
  existing `latestKnownRevision` envelope and the existing
  refresh/conflict UI (`ExternalDataStatus`) with no UX redesign.
- Per-entity/HTTP-verb APIs remain possible later WITHOUT moving the seam: the
  adapter can translate the `Action` vocabulary (§2.2) into entity calls,
  because every mutation already flows through `dispatch`.

### 3.2 What stays client-side (unchanged in role)

- The reducer, `Action` vocabulary and `src/store/selectors.ts` — optimistic
  local state and derived reads.
- `permissions.ts` / `useCan` — as a **UX mirror** of server policy (hide or
  disable controls); never authoritative.
- Render-safety normalization (`normalizeDates`, `ensureStartMinutes`, …) —
  the client must still never crash on odd data.
- `src/utils/dates.ts` / `src/utils/time.ts` grids and formats.
- The dirty-navigation and save-status UX (`src/utils/dirtyRegistry.ts`,
  `src/utils/useSaveStatus.ts`, persistence banners).
- `src/utils/uiPrefs.ts` — device-local UI preferences (sidebar state,
  onboarding progress) on separate localStorage keys. Self-documented at
  uiPrefs.ts:4-6 as deliberately excluded from the `storage.ts`→API move and
  as "the ONLY other module allowed to touch localStorage". It stays local
  after any migration and is the explicit allowlist entry for the plan's
  Stage 1 grep validation.

### 3.3 What moves server-side (authoritative from cut-over)

- **Persistence** — the server copy is the source of truth; localStorage
  demotes to cache/offline buffer (exact role is decision D7).
- **Authorization** — server-side evaluation of the `PermAction` matrix per
  authenticated identity, on every request.
- **Authentication and sessions** — salted-KDF credentials, server-verified
  sessions with expiry/revocation; `passwordHash` leaves the client data model
  (existing SHA-256 hashes are NOT imported as credentials — see plan Stage 3).
- **Password recovery** — out-of-band, server-mediated.
- **Audit** — an append-only server log of security-relevant events (login,
  logout, impersonation start/stop, permission denials, destructive writes),
  distinct from the client `ActivityEvent` UX log, which remains.
- **Revision/conflict arbitration** — server-issued monotonic revisions or
  ETags; `subscribeExternalChanges` generalizes from `window` storage events
  to server change notification.
- **Backup/export** — scheduled server backups; user-facing full export keeps
  parity with `exportRawData`.
- **Server-side validation** of the invariants currently guarded in the
  reducer and storage normalizers (untrusted-client rule, §1).

### 3.4 Explicitly NOT decided here

Provider, hosting, protocol (REST/RPC/realtime), database engine, session
token mechanics, email delivery mechanism, and rollout dates. Those follow
the human decisions below and a later, separately-approved implementation
package. This document plus the plan is the evaluation rubric, not a choice.

---

## 4. Provider-neutral requirements (evaluation criteria for ANY candidate)

A candidate backend/provider is evaluated against ALL of the following. These
are pass/fail criteria plus comparison axes — not a shortlist.

### R1. Data model mapping
- Losslessly stores the §2.5 model: string UUIDs, `yyyy-MM-dd` date strings,
  the `''` bin sentinel, 0.25h/15-min numeric grids, ISO timestamps, ordered
  collections (`Status.order`, `WorkloadEntry.sortIndex`).
- Supports BOTH candidate granularities pending D1: (a) a versioned JSON
  document with atomic compare-and-swap on a revision field; (b) per-entity
  records with transactions spanning multiple collections (a single `SAVE_TASK`
  atomically touches tasks, assignments, workload, activity — see
  AppStore.tsx:565-581).
- Server-side schema/constraint validation, or a place to run domain
  validation code, so reducer invariants are enforceable server-side.
- Carries a data-version field and supports forward migrations equivalent to
  the `DATA_VERSION` pipeline.

### R2. Sessions and authentication
- Server-verified sessions: expiry, idle timeout, explicit revocation
  (logout-everywhere), and rotation on privilege change.
- Credential storage with a memory-hard salted KDF (Argon2id/scrypt/bcrypt
  class); rate limiting and lockout/backoff on login attempts.
- Impersonation must be first-class and server-recorded: the session must
  carry both real identity and acted-as identity (mirroring
  `currentUserId`/`impersonatorId`), and be restricted to administrators
  server-side.
- No credential material ever persisted in client-readable storage.

### R3. Server-side authorization
- Enforces an action matrix at least as expressive as `PermAction` × 
  `AccessRole` (§2.3) on EVERY read and write, including ownership scoping
  (`blocks.editOwn` = `entry.personId === session person`; `profile.editOwn`).
- Deny-by-default; policy changes auditable; the client matrix demonstrably
  derivable from (or checked against) the server policy so the two cannot
  silently diverge.
- The setup-mode "zero people allows everything" rule (permissions.ts:83) must
  NOT exist server-side; server bootstrap uses an explicit provisioning step.

### R4. Password recovery
- Out-of-band recovery (email or admin-mediated reset per D4) with
  single-use, expiring, server-generated tokens; no security questions; no
  password disclosure; recovery events audited.

### R5. Audit
- Append-only, tamper-evident audit log written server-side (client cannot
  forge or delete entries) for authentication, impersonation, authorization
  denials and destructive operations; includes actor, acted-as identity,
  timestamp, and object; configurable retention (see D11 and the plan's
  security checklist).

### R6. Revisions and conflicts
- Atomic conditional writes (revision/ETag CAS) so a stale writer is rejected,
  never silently merged; the rejection is surfaced to the client in a way
  that maps onto the existing `ExternalDataStatus` conflict UX.
- Change notification (poll or push) to generalize
  `subscribeExternalChanges`; ordering guarantees at least per-document.
- The same-browser tab-conflict behavior must remain explicit after
  migration (CLAUDE.md invariant; storage wiki).

### R7. Backup and export
- Scheduled backups with documented RPO/RTO (targets set by D9); restore
  procedure testable in a non-production space.
- User/admin-triggered full JSON export at parity with `exportRawData`
  (recovery independence from the provider), plus per-person data export and
  erasure to satisfy GDPR requests.

### R8. Privacy, residency and terms (GDPR/RODO)
- EU data residency available; a signable DPA (data processing agreement);
  documented subprocessors; breach-notification commitments; deletion on
  contract end. (This is a Polish agency handling employee personal data:
  names, emails, phones, work schedules.)

### R9. Operational neutrality
- The client integration is confinable to the single adapter module (§3.1);
  exit cost is bounded: full data export in a documented format at any time.

---

## 5. Human decisions required BEFORE any implementation

No implementation package may be cut until each of these is answered by the
human owner. Each lists the information needed to decide.

- **D1. Concurrency granularity** — whole-document revision CAS (simplest,
  matches today's design; concurrent editors get explicit conflicts) vs
  per-entity API (finer merging, much larger server and client change).
  *Needs:* how many people edit simultaneously in practice; tolerance for
  "someone else saved first, reload" conflicts; appetite for a bigger build.
- **D2. Collaboration model** — last-writer-wins with explicit conflict
  surfacing (extends current UX) vs real-time multi-user sync.
  *Needs:* actual team workflow observation; whether two people edit the same
  week/task at the same time today.
- **D3. Identity model and provisioning** — self-managed accounts derived from
  the current `Person` list vs external identity (e.g. agency email SSO); who
  creates accounts; is a verified email mandatory per person.
  *Needs:* list of current users and whether all have work email; who plays
  admin.
- **D4. Password recovery channel** — email-based self-service (requires an
  email delivery capability and its GDPR review) vs administrator-mediated
  reset only (viable for a small team, no email dependency).
  *Needs:* team size, admin availability, email infrastructure ownership.
- **D5. Legacy credential policy** — existing `passwordHash` values are
  unsalted SHA-256 and MUST NOT become server credentials. Options: force
  password (re)set for everyone at first server login, or admin issues initial
  passwords. *Needs:* rollout communication preference. (That the hashes are
  discarded is already settled by §1; the decision is only the reset UX.)
- **D6. Tenancy** — single workspace for N2 Media only vs multi-workspace.
  *Needs:* any plan to run the tool for other teams/clients.
- **D7. Offline posture** — online-only after cut-over (simplest) vs
  local-first with background sync (keeps current resilience; hardest).
  *Needs:* how often the team works without connectivity; the value of the
  current "works with no server" property.
- **D8. Cut-over data ownership** — which browser's localStorage payload seeds
  the server (they may have diverged per machine), who reconciles, and what
  happens to stale local copies after cut-over.
  *Needs:* inventory of browsers/machines in active use.
- **D9. Operations ownership and targets** — who operates/pays for the
  backend; backup cadence; RPO/RTO targets; support expectations.
  *Needs:* budget range and named operator.
- **D10. Authorization semantics at the move** — does the server matrix mirror
  `MATRIX` exactly, or does the move tighten anything (e.g. should
  `users.impersonate` require re-authentication; should `pracownik` see all
  clients' data or only assigned work)? Today everyone can VIEW everything but
  /admin (permissions.ts:37).
  *Needs:* a walkthrough of the 12 `PermAction`s + read visibility with the
  owner.
- **D11. Audit scope and retention** — which events are audited beyond the R5
  minimum, retention period, and who may read the audit log.
  *Needs:* legal/HR input (audit logs of employee activity are themselves
  personal data under GDPR).
- **D12. GDPR roles and retention schedule** — controller/processor mapping,
  lawful basis for employee data, retention periods for app data and backups,
  and the erasure procedure. *Needs:* input from whoever owns RODO compliance
  at the agency.

---

## 6. Consequences

- Until D1-D12 are resolved: nothing changes; the app remains local-only.
- Stage 1 of the companion plan (client-side repository seam extraction) is
  the only stage that touches this repo without a provider decision, and even
  it requires explicit approval as its own package.
- The declared wiki page `openwiki/n2hub/state-and-persistence.md` remains
  accurate today; it becomes stale only when Stage 1 actually lands.
