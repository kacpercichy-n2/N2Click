# N2Hub prompt scheduler

Scheduler reads active Markdown prompts from `prompts/` in lexical order. Each
prompt is responsible for its own scoped wiki context, implementation and
verification.

For every prompt the scheduler does only this:

1. Reads Claude usage and starts only at `<= 50%`.
2. Sends the prompt to Claude without a scheduler-owned reviewer or test gate.
3. Moves the prompt to `archive/completed/`, commits the current result on a
   `review/claude-auto-*` branch and pushes it to `origin`.
4. Waits 5 hours and 1 minute before the next prompt.

If usage is above 50%, it waits until the reported reset. If the usage helper is
temporarily unavailable, it retries that check after five minutes.

Run it from the repository root:

```bash
caffeinate -dimsu node automation/claude-scheduler/run-queue.mjs
```

The branch is pushed for human audit and later merge into `main`. There are no
scheduler-owned Codex reviews, browser checks, final gates, retry loops or
prompt-contract blockers.
