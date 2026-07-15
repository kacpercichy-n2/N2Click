# Tests and automation

## Verification layers

1. Workers run focused unit tests for the changed store or utility area.
2. The operator runs `npm test` and `npm run build` once before commit,
   stopping on the first failure.
3. Run only the relevant browser check for the changed interaction. The release
   verification bundle owns the broad all-browser sweep.

## Automation status

The unattended prompt scheduler lives at `automation/claude-scheduler/`. It runs
the `prompts/*.md` queue in lexical order, reset-anchored and usage-chained
(`< 50%` chains, `>= 50%` waits for the reset `+ 1 min`), records each run in
`state/runs.jsonl`, and takes a per-run snapshot commit on a `review/claude-auto-*`
branch — it never pushes. Recorded `npm test` / `npm run build` results are
informational, not a gate. Start it with `node automation/claude-scheduler/run-queue.mjs`,
watch it via `npm run scheduler:monitor` (read-only page on `127.0.0.1:4599`,
Europe/Warsaw times), and test its pure modules with `npm run test:scheduler`
(`node --test`, kept out of the vitest `src/**` scope). The tiered agent workflow
(architect → developer → reviewer, `docs/workflow/`) remains and is run
interactively. The operator still owns the final gate, commit and push.

## Browser checks

- Calendar/bin: `browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`,
  `browser-check-placement.mjs`.
- Persistence: `browser-check-tab-sync.mjs`.
- Onboarding: `browser-check-onboarding.mjs` (including the live-plan disclosure
  and confirmation).

Run a check in Chromium and WebKit only when its covered behavior changes or a
release verification prompt explicitly requests the full matrix.

The release bundle is `npm run check:browser-release`
(`scripts/run-browser-regression.mjs`): it builds once, owns its own preview
server on port 5173, and runs all five checks in Chromium and WebKit.

### Targeted checks outside the release bundle

Four more real browser checks exist but are intentionally excluded from the
release matrix (`run-browser-regression.mjs`). Run each on demand (Chromium and
WebKit) only when its covered behavior changes:

- `browser-check-date-hardening.mjs`: invalid/corrupt-date handling — inline
  Polish errors, no blank screen or uncaught `RangeError`, malformed JSON stays
  byte-identical and exportable until reset, repairable payloads load repaired,
  and the render-throw recovery screen resets cleanly.
- `browser-check-ui-keyboard.mjs`: worker role landing, mobile drawer
  inertness/focus containment and Space activation for week blocks and bin cards.
- `browser-check-savetask-multiblock.mjs`: `SAVE_TASK` reconciles per-person/day
  allocation-grid cells by delta — an unchanged save leaves multi-block days
  byte-identical, and cell edits touch only the blocks their new total implies.
- `browser-check-status-semantics.mjs`: completion is the stored `Status.isDone`
  flag (not pipeline order or archival), and the admin UI pre-validates the
  only-active/only-done reducer guards.
