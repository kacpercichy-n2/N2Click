# Run state — 2026-07-15 prompt scheduler rebuild

## Goal

Replace the scheduler removed in dbaa72c with a simple reset-anchored,
usage-chained unattended prompt scheduler plus a zero-dependency local
monitoring app, fully under `automation/claude-scheduler/`.

## Packages

- [PKG-20260715-prompt-scheduler](packages/PKG-20260715-prompt-scheduler.md)
  — Tier: developer (Opus), Risk: medium, Codex: conditional. Status: ready.

## Changed boundaries (planned)

- New `automation/claude-scheduler/` tree (run-queue.mjs, monitor.mjs, lib/,
  test/, prompts/, archive/, state/, logs/).
- `package.json`: new scripts `test:scheduler` (node --test) and
  `scheduler:monitor`. Zero new dependencies.
- `openwiki/n2hub/testing-and-automation.md` `## Automation status` section
  becomes stale on completion; package includes the sync.
- No product code (`src/`) changes.

## Verification

- Focused: `npm run test:scheduler` (pure modules: schedule, usage parsing,
  runlog). Isolation check: `npm test && npm run build` unaffected.
- Browser: none — no product UI change.
- Final gate is interactive/operator-owned (old scheduler gate removed).

## Settled decisions

Snapshot commit per run (incl. crashes) on `review/claude-auto-*`, never push;
crash retries wait for the next reset window, park after 3 consecutive crashes;
empty queue idles with 5-min re-scan; cache fallback fresh <= 10 min; monitor
is a localhost-only Node HTTP page with Polish labels.

## Developer result (2026-07-15)

Built full `automation/claude-scheduler/` tree + scripts + wiki. `test:scheduler`
18/18 pass; `npm test` 509 pass (no scheduler files); `npm run build` green;
monitor smoke degrades gracefully. Deviations: script uses `test/*.test.mjs`
glob (Node 22.18 rejects bare dir arg); trimmed root `.gitignore` so tracked
runs.jsonl/logs match package intent.

## Reviewer fixes (2026-07-15)

run-queue.mjs: added 30s running-phase heartbeat + async runVerify (was
spawnSync); stdin EPIPE handler; commit SHA only on successful commit else
null; non-parked crash now waits for next reset via waitForNextReset even when
usage unknown. Re-ran: test:scheduler 18/18, npm test 509, build green.

## Open questions

- `docs/workflow/TIERED-AGENTS.md` and `HANDOFF-TEMPLATE.md` still describe
  the removed scheduler as owning the final `npm test` gate; the new scheduler
  records verification without gating. Reviewer/operator to decide whether to
  refresh those two workflow docs (not in package scope).

## Test-writer doc sync (2026-07-15)

Fixed stale "scheduler owns final gate" wording in `TIERED-AGENTS.md` and
`HANDOFF-TEMPLATE.md` (now operator-owned `npm test && npm run build`, per
source `run-queue.mjs`); added missing `permissions.test.ts` to
`state-and-persistence.md`. Reviewer blocker: removed the stale
`RUN-RESULT.json`/`runId`/SHA-256 gate paragraph from `TIERED-AGENTS.md`
(dbaa72c deleted that machinery; `.claude/commands/tier.md` left untouched,
routed to a follow-up package). `check-openwiki-links.mjs` passes.

## Three-defect fix (2026-07-15)

Boundaries: selectors.test.ts (+3 sel-01 cases: 480/780→4, single, zero),
OnboardingRoot.tsx (shouldShowHint gains `!impersonating` guard). selectors.ts
sel-01 filter+reduce and LoginPage `landingPathForRole` already in tree; verified
single-source-of-truth with HomeRedirect. sel-01 has no production callers.
vitest 106 pass; tsc clean.

## TaskModal three-defect fix (2026-07-15)

Boundary: only `src/components/TaskModal.tsx`. taskmodal-01: `toggleAssignee`
resets stale `binPersonId`, `addBinHours` guards assignee membership. taskmodal-02:
new `plannedCells` memo (in-period + assigned) feeds header total + save, killing
divergence. taskmodal-03: `snapHours` in `setCell` and `addBinHours`. tsc clean,
saveTaskWorkload 14 pass. No new tests (no component harness).

## storage-01 collection coercion (2026-07-15)

Boundary: storage.ts + storage.test.ts only. Same-version load now coerces
each collection via `coerceArray(x, default)` before repair passes, so a
non-array aux collection (e.g. `statuses:null`) repairs in isolation instead
of the catch discarding everything. statuses→default pipeline, others→[].
tasks/people/workload stay fail-closed via looksLikeData. vitest full 599 pass.

## UI layering + sidebar fold (styles.css only)

Fix1: `.persistence-banner` gets `position:relative; z-index:1050` so
conflict/failure actions clear the task modal (viewport z-index 1001) yet stay
below onboarding (1090/1100). Fix2: `.app-nav` `min-height:0; overflow-y:auto`
+ thin scrollbar pins the identity/logout block, unchanged at exact-fit/tall.
tsc clean. Browser pass pending (orchestrator).

## WeekView drag lifecycle (WeekView.tsx only)

F1: TimedBlock gains BinCard-style interruption recovery — `buttons===0`
pointermove guard (type-gated so finish's pointerup still commits) + window
blur/visibilitychange cancel via shared cancelDrag (revert, no dispatch).
F3: Escape effect now gated on `dragging` boolean, not per-frame drag.
Framer: menuRef moved to inner div; motion.div ref removed.
tsc clean; time+blockActions 154 pass. Browser pending (orchestrator).

## Reducer-boundary defects (AppStore.tsx + 3 store tests)

RENAME_{CLIENT,DEPARTMENT,SERVICE_TYPE,WORK_CATEGORY}: trim+reject empty/unknown
id (same ref). SET_TASK_STATUS: same-status no-op. insertBlock: reject insert
whose start lies inside an earlier same-person block spanning the point.
personFromDraft: clamp capacity to [1,24]. npx vitest run src/store/ 526 pass.
AdminPage per-keystroke rename now sticky-on-empty — follow-up (out of scope).

## AdminPage rename follow-up (AdminPage.tsx only)

Sticky-on-empty fixed: SimpleList now renders SimpleListRow with a local draft,
committing trimmed name to the store on blur/Enter only (no per-keystroke
dispatch); empty commit reverts to store name. Rows keyed `id:name` so external
renames remount and reseed. tsc: no AdminPage errors; src/store vitest 526 pass.

## storage-01 follow-up: dangling statusId (2026-07-15)

Coercion regenerating statuses gave new UUIDs so task/project statusIds dangled,
silently failing every SAVE_TASK. Added `repairStatusReferences` (runs after
normalizeStatusFlags, both load branches): remaps any dangling task/project
statusId to first non-done active status (mirrors TaskModal `activeStatuses[0]`).
Sets needsWriteback; no-op when refs resolve or pipeline empty. vitest 619 pass.

## Samouczek content refresh (catalog.ts + AdminPage anchor)

Boundary: catalog.ts (edits) + AdminPage.tsx (one `data-tour="admin.dictionaries"`
on Klienci section). Reflected: role landing + other-tab banner (shell.main),
new tasks step (0.25h snap, Zasobnik→assigned, period-shrink), bin "Zaplanuj część",
24h/day cap (people.capacity), new admin dictionaries step. No new module ids.
build green; npm test 619 pass. wiki unchanged.

## Supabase client foundation (dormant, unwired) (2026-07-15)

New boundary: src/supabase/{config.ts,client.ts} + config.test.ts, src/vite-env.d.ts,
.env.example, .gitignore (+.env). Pure resolveSupabaseConfig validates VITE_SUPABASE_*,
rejects secret/service_role keys; getSupabaseClient lazy singleton (no import-time
validation). Nothing imports it; storage/AppStore untouched. npm test 635 pass, build green.
wiki unchanged (localStorage still sole active boundary).

## Supabase RLS migrations (dormant, not applied) (2026-07-15)

New boundary: supabase/migrations/{20260715210000_core_schema,20260715210500_rls_policies}.sql
+ supabase/README.md + src/supabase/migrations.test.ts + .gitignore (supabase/.temp).
Core tables (profiles/departments/projects/project_members/tasks/task_assignments,
RLS enabled at creation, anon revoked), non-recursive security-definer helpers in
schema `app`, role model administrator/manager/worker, privilege-escalation +
task-relocation triggers, private `avatars` bucket with owner_id-type DO-block
validation before storage policies. Static SQL-convention vitest (17 tests).
Nothing applied to hosted project; localStorage flow untouched. npm test 652
pass, build green. wiki unchanged.

## Supabase Auth session gate (real login) (2026-07-15)

New boundary: src/auth/{session.ts (pure state machine + error mapping),
profile.ts (email-only association), mode.ts, SessionProvider.tsx, AuthScreens.tsx,
session.test.ts}. main.tsx wraps router in SessionProvider; App.tsx adds Supabase
gate (loading/login/blocked/shell) + handleLogout (auth.signOut + LOGOUT). Local
mode unchanged (person-picker fallback, no client created). Role/dept from local
Person only — never JWT/metadata. npm test 678 pass (+26), build green. wiki:
ui-navigation Boundaries note added.
