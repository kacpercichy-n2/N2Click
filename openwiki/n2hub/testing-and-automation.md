# Tests and automation

## Verification layers

1. Workers run focused unit tests for the changed store or utility area.
2. The scheduler runs `npm test` and then `npm run build` once before commit,
   stopping on the first failure.
3. Run only the relevant browser check for the changed interaction. The release
   verification bundle owns the broad all-browser sweep.

## Scheduler contract

- Each active prompt must contain risk/routing, wiki, concrete touchpoints,
  invariants, scope/out-of-scope, acceptance and verification sections.
- A prompt covers one cohesive technical slice. Split unrelated state, navigation
  and audit work into ordered prompts.
- High-risk prompts require a successful independent Codex review. A failed
  Claude, required review or verification run is not committed or marked complete.
- Usage percentage is recorded for comparison but does not delay a scheduled
  run unless `CLAUDE_AUTO_USAGE_GATE=1` is explicitly set.
- `handoffs/RUN-STATE.md` is a compact current-run summary, not a permanent log.
  Put detailed evidence in a named handoff or browser-check output instead.
- Agents do not commit or push. After green verification the scheduler archives
  the prompt and commits; push remains an operator action.

## Browser checks

- Calendar/bin: `browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`,
  `browser-check-placement.mjs`.
- Persistence: `browser-check-tab-sync.mjs`.
- Onboarding: `browser-check-onboarding.mjs`.

Run a check in Chromium and WebKit only when its covered behavior changes or a
release verification prompt explicitly requests the full matrix.
