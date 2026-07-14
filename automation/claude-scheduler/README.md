# Claude prompt scheduler

Reset-anchored unattended prompt runner for this repo. It runs Markdown prompts
in lexical order, anchored to the Claude 5h usage reset, records every run and
snapshots the result as a commit on a `review/claude-auto-*` branch. It **never
pushes** — pushing stays an explicit operator action.

## Commands

```bash
# Start the scheduler (foreground; Ctrl-C to stop cleanly)
node automation/claude-scheduler/run-queue.mjs

# Start the local monitor (http://127.0.0.1:4599)
npm run scheduler:monitor

# Run the unit tests
npm run test:scheduler
```

Stop the scheduler with Ctrl-C (SIGINT) or SIGTERM. It writes phase `stopped`
and removes its lock on exit.

## How it runs

1. Scan `prompts/` for `*.md`, sorted by code-point order. Re-scanned before
   every run and during waits, so you can add/remove prompts while it runs.
2. Fetch usage (live `swift` helper, then a fresh cache fallback). Utilization
   `< 50%` chains immediately; `>= 50%` waits until the reset `+ 1 min`;
   unavailable retries every 5 min.
3. Run the head prompt via `claude --print --dangerously-skip-permissions`,
   streaming output to `logs/<runId>.log`.
4. On success: record `npm test` / `npm run build` exit codes (not a gate) and
   move the prompt to `archive/completed/`. On crash: keep the prompt and retry
   at the next reset window; after 3 consecutive crashes park it in
   `archive/failed/`.
5. `git add -A && git commit` a snapshot after every run (never push), append a
   line to `state/runs.jsonl`, and update `state/status.json`.

## Layout

```
prompts/            operator drops NNN-name.md files here (the queue)
archive/completed/  succeeded prompts
archive/failed/     prompts parked after 3 consecutive crashes
logs/               per-run claude + verification output (tracked)
state/runs.jsonl    append-only run log (tracked)
state/status.json   heartbeat for the monitor (gitignored)
state/scheduler.lock single-instance pid lock (gitignored)
```

## Monitor

`npm run scheduler:monitor` serves a read-only page on `127.0.0.1:4599`
(override with `SCHEDULER_MONITOR_PORT`). It shows whether the scheduler is
running, the next run time in Europe/Warsaw, the current phase and prompt, the
queue, usage, and recent runs. It never mutates scheduler state.
