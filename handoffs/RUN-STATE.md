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
