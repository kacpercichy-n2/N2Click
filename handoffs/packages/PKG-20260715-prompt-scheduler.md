# Handoff: Build reset-anchored unattended prompt scheduler and local monitor

- Package ID: PKG-20260715-prompt-scheduler
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: conditional — automation infrastructure only, no product code or persisted product data; run Codex only if the reviewer flags uncertainty in the time math or git behavior. The scheduler-owned machine-enforced gate scripts were removed in dbaa72c, so `required` cannot be enforced on this interactive tier run.

## Goal

A new simple unattended prompt scheduler under `automation/claude-scheduler/`
that runs Markdown prompts in lexical order, anchored to the Claude 5h usage
reset, with usage-aware chaining, append-only run logging, per-run snapshot
commits (never push), plus a zero-dependency local monitoring app — all covered
by `node --test` unit tests wired to `npm run test:scheduler`.

## Wiki context

- `openwiki/n2hub/testing-and-automation.md`
- `docs/workflow/TIERED-AGENTS.md` (read-only background on the removed scheduler's role)

## Expected touchpoints

The `automation/` tree does not exist; creating `automation/claude-scheduler/`
with the subdirectories below is explicitly in scope.

- `new: automation/claude-scheduler/run-queue.mjs` — entrypoint: lock, main loop, claude invocation, git snapshot
- `new: automation/claude-scheduler/monitor.mjs` — zero-dependency HTTP monitor
- `new: automation/claude-scheduler/lib/usage.mjs` — usage fetch + parsing (pure parse functions exported)
- `new: automation/claude-scheduler/lib/schedule.mjs` — next-run computation + chaining decision (pure)
- `new: automation/claude-scheduler/lib/runlog.mjs` — runs.jsonl append/read/crash-count (pure parse logic)
- `new: automation/claude-scheduler/lib/state.mjs` — atomic `status.json` writer (write temp + rename)
- `new: automation/claude-scheduler/test/schedule.test.mjs`
- `new: automation/claude-scheduler/test/usage.test.mjs`
- `new: automation/claude-scheduler/test/runlog.test.mjs`
- `new: automation/claude-scheduler/prompts/.gitkeep` (operator drops `NNN-name.md` files here)
- `new: automation/claude-scheduler/archive/completed/.gitkeep`
- `new: automation/claude-scheduler/archive/failed/.gitkeep`
- `new: automation/claude-scheduler/logs/.gitkeep`
- `new: automation/claude-scheduler/state/.gitkeep`
- `new: automation/claude-scheduler/.gitignore` — ignore `state/status.json` and `state/scheduler.lock` only (runs.jsonl, logs and archives stay tracked)
- `new: automation/claude-scheduler/README.md` — short operator doc (start/stop commands, folder layout)
- `package.json` — add scripts `"test:scheduler": "node --test automation/claude-scheduler/test/"` and `"scheduler:monitor": "node automation/claude-scheduler/monitor.mjs"` (no new dependencies)
- `openwiki/n2hub/testing-and-automation.md` — rewrite the `## Automation status` section (see Scope)

## Invariants

- Zero new npm dependencies; Node >= 22 built-ins only; ESM `.mjs`.
- No changes anywhere under `src/`; `npm test` and `npm run build` must remain
  green and unaffected (vitest `include` is `src/**/*.test.ts`, so scheduler
  tests must NOT be picked up by `npm test`).
- The scheduler NEVER pushes. Push remains an explicit operator action.
- All time arithmetic uses epoch/Date math on the UTC ISO `RESETS_AT` value —
  never local-time string math. Local timezone (Europe/Warsaw) is used only for
  display formatting in the monitor via `Intl.DateTimeFormat('pl-PL',
  { timeZone: 'Europe/Warsaw' })`.
- The monitor binds to `127.0.0.1` only and is read-only (no endpoint mutates
  scheduler state). It is an internal operator tool, not a security boundary.
- A crashed prompt is never moved to `archive/completed/`.
- `state/runs.jsonl` is append-only; the scheduler never rewrites past entries.

## Scope

### 1. Prompt queue

- Queue = files matching `*.md` in `automation/claude-scheduler/prompts/`,
  sorted by simple lexical (code-point) filename order. Re-scan the directory
  before every run and during long waits, so the operator can add/remove
  prompts while the scheduler is running.

### 2. Usage source (`lib/usage.mjs`)

- Live: spawn `swift ~/.claude/fetch-claude-usage.swift`. Exit 0 prints
  `UTILIZATION|RESETS_AT_ISO` (e.g. `75|2026-07-14T22:30:00Z`); exit 1 prints
  `ERROR:...`. Parse into `{ utilization: number, resetsAt: string|null,
  source: 'live' }`. Treat non-numeric utilization or unparseable output as
  unavailable.
- Cache fallback: on live failure, read `~/.claude/.statusline-usage-cache`
  with lines `UTILIZATION=75`, `RESETS_AT=<ISO>`, `TIMESTAMP=<unix seconds>`
  (ignore `WEEKLY_*` lines). Accept only if `now - TIMESTAMP*1000 <= 600_000`
  (10 min); result gets `source: 'cache'`. Otherwise usage is `unavailable`.
- Export pure functions `parseLiveOutput(stdout)` and
  `parseCacheFile(text, nowMs)` so tests need no processes or real files.

### 3. Scheduling algorithm (`lib/schedule.mjs` + `run-queue.mjs`)

Pure functions:

- `computeNextRunAt(resetsAtIso, nowMs)` → `resetsAt + 60_000` ms as epoch. If
  `resetsAtIso` is null/unparseable → `null`. If the computed time `<= nowMs`
  (stale reset already passed) → `nowMs` (run now; caller refetches usage once
  first).
- `chainDecision(usage)` → `'chain'` when `usage.utilization < 50`, `'wait'`
  when `>= 50`, `'retry-usage'` when usage unavailable. Boundary: exactly 50
  waits.

Main loop pseudocode (implement faithfully):

```
start:
  acquire state/scheduler.lock (see edge cases) or exit 1
  install SIGINT/SIGTERM handler: write phase 'stopped', remove lock, exit
loop forever:
  queue = scanPrompts()
  if queue is empty:
    writeStatus(phase 'idle', nextRunAt null); sleep 5 min; continue
  usage = getUsage()                      # live, then fresh cache
  switch chainDecision(usage):
    'retry-usage': writeStatus(phase 'waiting', lastError set); sleep 5 min; continue
    'chain':       runPrompt(queue[0])
    'wait':
      target = computeNextRunAt(usage.resetsAt, now)
      if target is null:                  # resetsAt missing while >= 50%
        writeStatus(phase 'waiting'); sleep 5 min; continue
        # safety valve: if resetsAt has been unavailable for > 5h05m since the
        # last run started, run anyway
      waitUntil(target)                   # sleep in <= 5 min chunks; refresh
                                          # heartbeat + queue each chunk
      runPrompt(head of re-scanned queue)
```

`runPrompt(promptFile)`:

```
runId = <yyyymmdd-HHmmss>-<prompt basename without .md>
writeStatus(phase 'running', currentPrompt, runId)
exitCode = spawn `claude --print --dangerously-skip-permissions`
           with prompt file content on stdin, cwd = repo root,
           stdout+stderr streamed to logs/<runId>.log
if exitCode == 0:
  verifyTest  = run `npm test`      (record exit code; NOT a gate)
  verifyBuild = run `npm run build` (record exit code; NOT a gate)
  move promptFile -> archive/completed/   # keep filename
  outcome = 'success'; attempt info resets
else:
  outcome = 'crash'; verify fields = null
  attempt = consecutiveCrashCount(runs.jsonl, promptFile) + 1
  if attempt >= 3: move promptFile -> archive/failed/  ('parked')
usageAfter = getUsage()
decision:
  crash, not parked -> 'wait' (retry same prompt at next reset + 1 min,
                       regardless of utilization)
  otherwise         -> chainDecision(usageAfter)  ('retry-usage' behaves as in loop)
gitSnapshot(runId, outcome)   # see Git behavior
append entry to state/runs.jsonl; writeStatus(lastRun, nextRunAt)
return to loop (loop re-derives wait/chain from the recorded decision)
```

Startup applies the same chaining rule: usage < 50% → run the first prompt
immediately; >= 50% → wait for `resetsAt + 1 min`; unavailable → retry every
5 minutes (cache fallback allowed when fresh).

### 4. Git behavior (settled decision — implement exactly)

- After EVERY run (success or crash), `git add -A && git commit` so each run's
  diff stays separable. Message: `auto: <runId> <success|crash exit N>
  [verify: pass|fail|skipped]`.
- Branch: if the current branch already matches `review/claude-auto-*`, commit
  on it; otherwise create `review/claude-auto-<yyyymmdd-HHmm>` from current
  HEAD and commit there.
- If there is nothing to commit, record `commit: null` in the run entry.
- NEVER push, never touch remotes.

### 5. Run log schema — `state/runs.jsonl` (one JSON object per line)

```json
{
  "runId": "20260715-003100-001-fix-x",
  "prompt": "001-fix-x.md",
  "startedAt": "2026-07-14T22:31:00.000Z",
  "endedAt": "2026-07-14T23:02:11.000Z",
  "exitCode": 0,
  "outcome": "success",            // "success" | "crash"
  "attempt": 1,                    // consecutive attempt number for this prompt
  "verify": { "test": 0, "build": 0 },   // exit codes; null when outcome=crash
  "usageAfter": { "utilization": 42, "resetsAt": "2026-07-15T03:30:00Z", "source": "live" }, // null if unavailable
  "decision": "chain",             // "chain" | "wait" | "parked" | "retry-usage"
  "nextRunAt": "2026-07-15T03:31:00.000Z",  // ISO or null
  "logFile": "logs/20260715-003100-001-fix-x.log",
  "commit": "abc1234"              // short SHA or null
}
```

`lib/runlog.mjs` exports `appendRun(entry)`, `readRuns(text)` (tolerates and
skips malformed lines) and `consecutiveCrashCount(entries, promptName)`
(counts trailing crash entries for that prompt, reset by any success).

### 6. Heartbeat schema — `state/status.json` (atomic rewrite, gitignored)

```json
{
  "pid": 12345,
  "phase": "waiting",              // "waiting" | "running" | "idle" | "stopped"
  "updatedAt": "2026-07-14T22:35:00.000Z",   // refreshed at least every 60s
  "nextRunAt": "2026-07-15T03:31:00.000Z",   // ISO or null
  "currentPrompt": null,           // filename while phase=running
  "queue": ["002-next.md", "003-later.md"],
  "lastRun": { /* same shape as a runs.jsonl entry, or null */ },
  "usage": { "utilization": 62, "resetsAt": "2026-07-15T03:30:00Z", "source": "cache", "fetchedAt": "..." },
  "lastError": null                // short string, e.g. usage-fetch failure
}
```

### 7. Edge cases (settled decisions — implement exactly)

- Empty prompts folder: stay alive, phase `idle`, re-scan every 5 minutes.
- Usage helper `ERROR` / unavailable and cache stale: phase `waiting`, set
  `lastError`, retry every 5 minutes indefinitely.
- `RESETS_AT` missing/null with utilization >= 50: retry usage every 5 minutes;
  safety valve — if still unknown 5h05m after the last prompt started, run.
- claude non-zero exit: log crash, do NOT archive, retry at the next reset
  window; after 3 consecutive crashes of the same prompt, move it to
  `archive/failed/` and continue with the next prompt under the normal rule.
- Already running: `state/scheduler.lock` contains the pid. On start, if the
  lock exists and `process.kill(pid, 0)` succeeds → print a message and exit 1;
  if the pid is dead → remove the stale lock and continue.

### 8. Monitor (`monitor.mjs`)

- `node:http` server on `127.0.0.1`, default port `4599`, overridable via
  `SCHEDULER_MONITOR_PORT`. No dependencies, no build step.
- `GET /status.json`: composes and returns JSON — `status.json` content;
  `schedulerAlive` (true when the lock pid answers `kill(pid, 0)` AND
  `updatedAt` is < 90s old); the last 20 entries of `runs.jsonl`; current usage
  parsed from `~/.claude/.statusline-usage-cache` with a freshness flag.
  Missing files must degrade gracefully (scheduler shown as not running), never
  crash the monitor.
- `GET /`: one self-contained inline HTML page (no external assets) that polls
  `/status.json` every 10s and shows: scheduler running yes/no, next run time
  formatted for Europe/Warsaw, current phase and prompt, queue contents, usage
  % with freshness, and the last runs with success/crash indicators.
- UI labels in Polish (e.g. "Harmonogram: działa / zatrzymany",
  "Następne uruchomienie", "Kolejka", "Ostatnie uruchomienia", "Zużycie").

### 9. Tests (Node built-in runner, no vitest)

`npm run test:scheduler` = `node --test automation/claude-scheduler/test/`.
Pure-module tests only — no child processes, no network, no real HOME files:

- `schedule.test.mjs`: `computeNextRunAt` adds exactly 60s to a UTC ISO reset;
  null/garbage input → null; past reset → now. `chainDecision`: 49 → chain,
  50 → wait, 51 → wait, unavailable → retry-usage.
- `usage.test.mjs`: `parseLiveOutput` on `75|2026-07-14T22:30:00Z`, `ERROR:...`,
  empty and garbage input; `parseCacheFile` fresh vs stale TIMESTAMP, missing
  keys, ignores `WEEKLY_*` lines.
- `runlog.test.mjs`: append/read round trip; malformed lines are skipped
  without throwing; `consecutiveCrashCount` — zero for unseen prompt, counts
  trailing crashes, resets after an interleaved success, ignores other prompts.

### 10. Wiki sync

Rewrite `## Automation status` in `openwiki/n2hub/testing-and-automation.md`:
scheduler lives at `automation/claude-scheduler/` (reset-anchored,
usage-chained, per-run snapshot commits on `review/claude-auto-*`, never
pushes); monitor via `npm run scheduler:monitor`; tests via
`npm run test:scheduler`; operator still owns push. Keep it to a short
paragraph in the existing style.

## Out of scope

- Anything under `src/` or the product UI.
- Codex gates, prompt contracts, permission checkers, reviewer orchestration or
  any other machinery removed in dbaa72c.
- launchd/cron/service installation, auto-start on boot.
- Weekly-limit logic (only the 5h window matters).
- Any auth or remote access for the monitor; any push/remote git operation.
- Gating commits on `npm test`/`npm run build` results — verification is
  recorded, not enforced.

## Acceptance

- [ ] `npm run test:scheduler` exists and passes; `npm test` and
      `npm run build` still pass and do not pick up scheduler files.
- [ ] All files listed under Expected touchpoints exist; no new npm
      dependencies in `package.json`.
- [ ] `lib/schedule.mjs`, `lib/usage.mjs`, `lib/runlog.mjs` export the named
      pure functions and match the specified behavior at the 49/50 boundary
      and the +60s anchor.
- [ ] `run-queue.mjs` implements the pseudocode: lock handling, lexical queue
      re-scan, startup chaining rule, crash retry with 3-attempt parking to
      `archive/failed/`, snapshot commit per run on a `review/claude-auto-*`
      branch, no push.
- [ ] `state/runs.jsonl` and `state/status.json` match the schemas above;
      `status.json` writes are atomic (temp file + rename) and gitignored.
- [ ] `monitor.mjs` serves `/` and `/status.json` on 127.0.0.1:4599, degrades
      gracefully when state files are missing, and shows Polish labels with
      Europe/Warsaw times.
- [ ] Wiki `## Automation status` section updated as specified.

## Verification

- Worker: `npm run test:scheduler` (then `npm test && npm run build` once to
  confirm isolation). Manual smoke: start `monitor.mjs`, curl `/status.json`
  with no state files present.
- Browser: none — no product UI change; the monitor is a raw local HTML page
  outside the browser-check matrix.
- Final gate is interactive: the operator runs
  `npm run test:scheduler && npm test && npm run build` before commit.

## Prior decisions

- Snapshot commit after every run including crashes (message encodes outcome)
  — keeps each unattended run's diff separable; push stays operator-owned.
- Verification (`npm test`, `npm run build`) runs after a successful claude
  exit and is recorded in the run entry, but never gates archive/commit/chain.
- Crash retry waits for the next reset window even if usage is under 50%
  (crash-loop damping); 3 consecutive crashes park the prompt in
  `archive/failed/`.
- Empty queue idles and keeps monitoring (re-scan every 5 minutes) rather than
  exiting.
- Usage staleness threshold for the cache fallback is 10 minutes.
- Scheduler tests use `node --test`, not vitest — vitest `include` is scoped to
  `src/**` and must stay that way.
- Monitor is Polish-labeled for consistency with the product app.
