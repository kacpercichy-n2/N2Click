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

## Release browser verification

Release browser verification is a separate, manual step the scheduler never
runs. From the repository root:

```bash
npm run check:browser-release
```

It builds the app, serves the production preview on port 5173, and runs the five
declared release-critical checks (bin drag, bin split, placement, tab sync,
onboarding) in Chromium and WebKit, then tears the server down. Playwright is
kept out of `package.json` to keep scheduler installs light, so on a clean
install run the prerequisite first:

```bash
npm install --no-save playwright@1.61.1 && npx playwright install chromium webkit
```
