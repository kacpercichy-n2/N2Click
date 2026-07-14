# Staged plan: localStorage → provider-neutral backend

- Date: 2026-07-15
- Status: proposed — NOT approved for implementation. Stage 0 gates everything.
- Companion decision record: `docs/decisions/backend-migration-boundary.md`
  (referenced below as "the boundary doc"; seam anchors and requirements
  R1-R9 and decisions D1-D12 live there).

Ground rules for the whole plan:

1. **Provider-neutral.** No stage names, selects or configures a provider,
   external service, credential or deployment. Where a stage needs "a backend",
   it means "whatever candidate passed the boundary doc's R1-R9 evaluation and
   was approved by the human owner".
2. **Zero behavior change until its stage explicitly says otherwise.** Current
   local workflows keep working through every stage; the localStorage adapter
   remains the default until Stage 8 cut-over.
3. **Client checks are never security.** Every stage that exposes data assumes
   server-side authorization is already enforced (Stage 2 precedes Stage 3 for
   exactly this reason). `permissions.ts`, reducer guards and `storage.ts`
   validation remain UX/data-integrity only.
4. **Every stage ships with prerequisites, exact scope, a rollback procedure
   and validation criteria.** A stage that cannot be rolled back cleanly is
   re-cut until it can.
5. Each stage becomes one or more handoff packages per
   `docs/workflow/HANDOFF-TEMPLATE.md`, each passing the Definition of Ready,
   each individually approved. This plan is not that approval.

---

## Stage 0 — Decision gate (no code)

**Prerequisites:** none.

**Scope:** the human owner answers D1-D12 in the boundary doc; answers are
recorded in a dated decision record under `docs/decisions/`. Candidate
backends are compared against R1-R9; the comparison outcome is recorded but
still selects nothing binding until the owner signs off.

**Rollback:** trivially none — documents only.

**Validation:**
- Every D1-D12 has a written answer with an owner and date.
- At least one candidate satisfies all pass/fail criteria in R1-R9, or the
  migration is explicitly parked.
- Reviewer confirms no answer contradicts a hard invariant in `CLAUDE.md`.

---

## Stage 1 — Client repository seam extraction (this repo, no backend)

**Prerequisites:** Stage 0 complete (D1 and D7 materially shape the interface:
document-vs-entity granularity and offline posture). Explicit package
approval.

**Scope (exact):**
- Define a `DataRepository` interface reproducing the `storage.ts` surface
  named in boundary doc §2.1: `loadData`, `saveData` (returning the existing
  `SaveResult` / `SaveFailureReason` contract), `subscribeExternalChanges`,
  `exportRawData`, `clearData`, `emptyData`, generalized to allow async
  implementations.
- Provide the localStorage adapter as the default and only implementation —
  a mechanical extraction of today's code, keeping `STORAGE_KEY`, the
  `DATA_VERSION = 7` migration pipeline, the revision envelope and
  `classifyStorageError` byte-for-byte in behavior.
- Route the four consumers through the interface: `AppStoreProvider`
  (AppStore.tsx:2174-2277 — the init load, the persist effect, the external
  subscription, `retryPersist`/`acceptExternal`/`keepLocal`);
  `src/components/PersistenceBanner.tsx` (imports `exportRawData` and the
  `SaveFailureReason` type at PersistenceBanner.tsx:11-12 and calls
  `exportRawData()` at :54 as the failed-save fallback download); the error
  boundary's `exportRawData` recovery export; and any test utilities.
- No new UI, no new persistence semantics, no network code.

**Rollback:** single revert of the package's commit(s); no data format change
is allowed in this stage, so stored payloads are untouched and older builds
read them unchanged.

**Validation:**
- `npm test` green, `src/store/storage.test.ts` unmodified and green
  (behavioral contract pinned by existing tests).
- A payload written before the change loads identically after it (fixture
  round-trip test).
- Failed-save and tab-conflict flows unchanged: a simulated quota error still
  surfaces `saveError`, never `Zapisano`; an external tab write still yields
  `refreshed`/`conflict` per dirtiness.
- PersistenceBanner's failed-save fallback export resolves through the
  repository interface, not a direct import of the concrete localStorage
  `exportRawData` — so post-cut-over the fallback download comes from the
  active adapter (server-backed once one exists) rather than a stale local
  copy. Same criterion for the error boundary's recovery export.
- Grep-level check with an explicit allowlist: no module outside the
  localStorage adapter touches `localStorage`, EXCEPT `src/utils/uiPrefs.ts`
  — device-local UI preferences on separate keys, self-documented at
  uiPrefs.ts:4-6 as deliberately excluded from the `storage.ts`→API move and
  as the only other module allowed to touch localStorage. uiPrefs stays
  local through every later stage.

---

## Stage 2 — Backend foundation: accounts, sessions, authorization skeleton

**Prerequisites:** Stage 0 (D3, D5, D10 answered); approved backend candidate;
a non-production environment; named operator (D9). Independent of Stage 1
(different repo/system) but both precede Stage 3.

**Scope (exact):**
- Provision the backend with NO application data yet: identity records for the
  current team (per D3), salted-KDF credential storage, session issuance with
  expiry and revocation, login rate limiting.
- Implement the authorization layer: the server-side action matrix per D10,
  deny-by-default, including ownership scoping for `blocks.editOwn` /
  `profile.editOwn` and admin-only impersonation with dual-identity sessions.
  No client-side setup-mode bypass exists server-side.
- Stand up the security baseline from the production checklist (below):
  headers, error-handling policy, secrets handling, audit of auth events.
- Legacy `passwordHash` values from the app are NOT imported (boundary doc
  §1/D5); initial credentials follow D5.

**Rollback:** decommission the environment; nothing references it — the app
still runs purely on localStorage. No client release depends on this stage.

**Validation:**
- Automated authorization test matrix: for each role × each protected action,
  assert allow/deny equals the D10 policy (including a `pracownik` attempting
  `people.manage`, and impersonation attempts by non-administrators → denied
  and audited).
- Unauthenticated requests to every endpoint → denied; expired/revoked session
  → denied.
- Login brute-force test hits the rate limit; lockout/backoff behaves per D2/R2.
- Security checklist items marked "Stage 2" (below) verified and recorded.

---

## Stage 3 — Data model migration and persistence API (shadow mode)

**Prerequisites:** Stages 1 and 2 complete. D1 (granularity) and D8 (which
local payload seeds the server) decided.

**Scope (exact):**
- Implement the server data model mapping `AppData` (types.ts:213-235) per
  R1: all 13 collections, UUID ids, `yyyy-MM-dd` strings, the `''` bin
  sentinel, grid constraints, `Status.isDone` semantics, and the invariants in
  `CLAUDE.md` (92-day task period, one bin row per `(taskId, personId)`,
  at least one active and one done status) enforced server-side as
  write-rejection rules mirroring the reducer's atomic-reject convention.
- Implement the persistence API at the D1 granularity, with revision/CAS
  conditional writes (R6) issuing server revisions that generalize
  `latestKnownRevision`.
- Build a one-shot import tool: takes an exported local payload
  (`exportRawData` output), runs it through the existing `DATA_VERSION`
  pipeline semantics, loads it server-side. Import is repeatable into a scratch
  workspace; NO production/real-data cut-over happens in this stage — imports
  target test data or disposable copies only.
- Implement the backend adapter for the Stage 1 `DataRepository` interface in
  a branch/flagged build. **Shadow mode:** the flag enables dual-write
  (localStorage remains authoritative; server write outcomes are logged, never
  surfaced as save status) or read-verify. Default build: flag off, adapter
  not shipped.

**Rollback:**
- Client: flag off (or revert the adapter package) → pure localStorage, no
  data loss possible because localStorage stayed authoritative.
- Server: drop imported scratch data; the import tool is re-runnable.

**Validation:**
- Round-trip property test: export local payload → import → read back through
  the adapter → deep-equal to the `loadData()` result locally.
- Invariant tests server-side: an over-92-day task write, a duplicate bin row,
  a delete of the last done status, and a reversed date period are each
  rejected atomically with no partial write.
- CAS test: two writers with the same base revision — exactly one wins, the
  loser gets a conflict rejection.
- Shadow-mode soak on test data: N sessions of normal use show zero divergence
  between local state and server copy.
- Authorization from Stage 2 verified against real data shapes (e.g. a
  `pracownik` session cannot modify another person's workload entry).

---

## Stage 4 — Revision, conflict and change-notification integration

**Prerequisites:** Stage 3 shadow mode validated. D2 (collaboration model)
decided.

**Scope (exact):**
- Generalize the client conflict lifecycle: `subscribeExternalChanges` gains a
  server-notification source (poll or push per the candidate's capability);
  server CAS rejections map onto the existing `ExternalDataStatus`
  `'conflict'` path and `saveError` stays the vehicle for transport failures —
  the failed-save rule ("never `Zapisano` on failure") extends verbatim to
  network failures.
- Same-browser tab conflicts remain explicit and locally detected (they are
  not replaced by server round-trips).
- Still behind the flag; localStorage still authoritative in default builds.

**Rollback:** flag off → Stage 1 behavior. No stored-format change.

**Validation:**
- Simulated offline/timeout during save → save status shows failure + retry
  works when connectivity returns; UI never claims success.
- Two clients editing: stale writer receives the explicit conflict choice
  (accept remote / keep mine), mirroring today's tab-conflict UX.
- Existing tab-conflict unit tests still green unmodified.

---

## Stage 5 — Password recovery

**Prerequisites:** Stage 2 in place; D4 (channel) decided; if email-based, the
delivery capability approved incl. its GDPR review (D12).

**Scope (exact):** implement the D4 flow with single-use, expiring,
server-generated tokens; both request and completion audited; rate-limited;
responses do not disclose whether an account exists.

**Rollback:** disable the recovery endpoint; admin-mediated reset (which must
exist regardless, as the fallback) continues to work.

**Validation:**
- Token single-use and expiry enforced (reuse and late use → rejected,
  audited).
- Enumeration test: request for existing vs non-existing account is
  indistinguishable in response and timing class.
- Recovery events appear in the audit log with actor and outcome.

---

## Stage 6 — Server-side audit log

**Prerequisites:** Stage 2 (auth events already captured); D11 (scope,
retention, access) decided.

**Scope (exact):** append-only audit per R5 — authentication, session
revocation, impersonation start/stop (real + acted-as identity), authorization
denials, destructive writes (deletes of projects/tasks/people, status
deletion), recovery events, exports. Client `ActivityEvent` (types.ts:180-191)
remains a separate UX log and is documented as such; it is never merged into
the audit trail.

**Rollback:** audit writes are additive; disabling reverts to Stage 2's
auth-event baseline. Never roll back below auth-event auditing while any real
user data is server-side.

**Validation:**
- Each audited event type produced by an integration test appears exactly once
  with correct identities.
- Audit entries are not mutable/deletable through any API surface.
- Retention job proven on synthetic aged entries per the D11 period.
- Access control: only the roles named in D11 can read the log; access is
  itself audited.

---

## Stage 7 — Backup and export

**Prerequisites:** Stage 3 model stable; D9 (RPO/RTO) and D12 (retention)
decided.

**Scope (exact):**
- Scheduled server backups meeting the D9 RPO; documented, rehearsed restore.
- Admin-triggered full workspace export (JSON, documented schema at parity
  with the local payload format) so the boundary doc's R9 exit guarantee
  holds.
- Per-person data export and erasure procedures (GDPR access/erasure), with
  erasure semantics defined for authored content (comments/activity
  attribution) per D12.
- Backups covered by the same retention and encryption policy as live data.

**Rollback:** backup tooling is additive; reverting removes automation but the
manual export path (adapter `exportRawData` parity) must remain from Stage 3
onward.

**Validation:**
- Restore rehearsal into a scratch environment produces a workspace that
  passes the Stage 3 round-trip validation.
- Timed restore meets the D9 RTO.
- A per-person export contains exactly that person's data; a test erasure
  leaves referential integrity intact (no dangling ids that break loads).

---

## Stage 8 — Pilot, cut-over and post-cut-over rollback window

**Prerequisites:** Stages 1-7 validated; D7 (offline posture) and D8 (seed
payload, machine inventory) decided; production security checklist (below)
fully signed off; human owner's explicit go decision.

**Scope (exact):**
1. **Pilot:** flag on for one named user/browser with a copy of real data in a
   staging workspace; localStorage remains authoritative on all other
   machines. Pilot duration and success criteria fixed in the package.
2. **Freeze + seed:** a short announced edit freeze; the D8-designated payload
   is exported, imported, verified (round-trip check), and the server becomes
   authoritative.
3. **Cut-over:** flagged builds for all users point at the backend adapter;
   local payloads on other machines are archived (exported to file), then the
   local key demotes to cache per D7. Login now uses server sessions (D5
   reset flow applies).
4. **Rollback window:** for a fixed period (set in the package, e.g. two
   weeks), the pre-cut-over local export and a flag-off build are kept ready.

**Rollback (explicit, tested before go):**
- During pilot: flag off on the pilot machine; staging workspace discarded.
- During freeze/seed: abort before the "server authoritative" switch — nothing
  changed for users.
- After cut-over, inside the window: announce, freeze, export the server
  workspace (Stage 7 export), ship the flag-off build, restore the exported
  payload into localStorage via the documented import path, resume local-only
  operation. Server data is snapshotted, then the environment is paused — not
  deleted — until the window closes.
- The rollback procedure itself is rehearsed on staging as a pilot exit
  criterion.

**Validation:**
- Pilot exit criteria met (zero data divergence, no save-status regressions,
  conflict UX verified with two real users).
- Post-cut-over smoke: login, task save, calendar drag, bin scheduling, admin
  status edit — all green for each role; authorization spot-checks per D10.
- A dated cut-over report records: seed payload hash, revision at switch,
  archived exports' locations, rollback-window end date.

---

## Production security checklist

Sign-off required before Stage 8 go. "Stage" marks when the item is first
implemented/verified.

### HTTP security headers (Stage 2, re-verified Stage 8)
- [ ] HTTPS only; HSTS enabled.
- [ ] Content-Security-Policy for the app origin (no `unsafe-inline` script
      allowances beyond what Vite's build genuinely requires; document any).
- [ ] `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` (or CSP
      equivalent), `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] CORS allowlist restricted to the app origin(s); no wildcard with
      credentials.
- [ ] Session cookies (if cookies per R2): `Secure`, `HttpOnly`, `SameSite`.

### Error handling and information leakage (Stage 2)
- [ ] API errors return generic messages; stack traces, queries and internal
      paths never reach the client.
- [ ] Auth failures are uniform (no user-enumeration via message or timing
      class); verified again for recovery in Stage 5.
- [ ] Server logs exclude credentials, tokens and full personal-data payloads;
      log access is restricted and documented.
- [ ] Client save-status honesty preserved end-to-end: any backend failure
      surfaces as a failed save, never `Zapisano` (Stage 4 validation).

### Audit log retention (Stage 6)
- [ ] Retention period set per D11 and implemented; expiry job verified.
- [ ] Append-only storage; read access restricted and itself audited.
- [ ] Audit entries classified as personal data in the GDPR register (they
      describe employee activity).

### Dependency management (Stage 2 onward, continuous)
- [ ] Lockfiles committed for client and server; builds reproducible.
- [ ] Automated vulnerability scanning on both; triage cadence and owner
      named (D9).
- [ ] Update policy documented; provider SDK (if any) confined to the adapter
      module so it can be replaced (boundary doc §3.1/R9).

### Secrets handling (Stage 2)
- [ ] No secret, API key or connection string in the repository, build output
      or client bundle — the frontend receives only public configuration.
- [ ] Secrets live in an environment/secret store with least-privilege access;
      rotation procedure documented and rehearsed once.
- [ ] Distinct credentials per environment (staging vs production).

### Privacy — GDPR/RODO (Stage 0 groundwork, enforced Stages 3-8)
- [ ] Controller/processor roles mapped and DPA signed (D12) before any real
      personal data leaves the browser (Stage 8 freeze, not earlier — Stage 3
      uses test/disposable data only).
- [ ] EU data residency confirmed for live data AND backups (R8).
- [ ] Records of processing updated: employee names, emails, phones, work
      schedules, activity/audit logs; lawful basis documented (D12).
- [ ] Data minimization reviewed: fields synced server-side are only those the
      planner needs (types.ts §2.5 model — no new personal fields ride along).
- [ ] Access/export and erasure procedures implemented and tested (Stage 7).
- [ ] Retention schedule for app data, audit logs and backups (D11/D12).
- [ ] Breach-notification runbook: who detects, who assesses, 72-hour UODO
      notification path, user communication owner.
- [ ] Team informed (privacy notice) before cut-over; Polish-language notice
      for staff (user-facing text is the one place Polish applies here).

---

## Explicitly out of scope for this plan

Choosing a provider; writing adapters/SDK integrations/headers as code;
creating credentials or environments; migrating real data; UI changes; browser
checks. Every stage above requires its own approved handoff package before any
of that starts.
