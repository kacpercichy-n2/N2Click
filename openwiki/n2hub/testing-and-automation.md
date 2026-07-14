# Tests and automation

## Verification layers

1. Workers run focused unit tests for the changed store or utility area.
2. The scheduler runs `npm run test:scheduler`, `npm test` and `npm run build`
   once before commit, stopping on the first failure.
3. Run only the relevant browser check for the changed interaction. The release
   verification bundle owns the broad all-browser sweep.

## Scheduler contract

- Each active prompt must contain risk/routing, wiki, concrete touchpoints,
  invariants, scope/out-of-scope, acceptance and verification sections.
- A prompt covers one cohesive technical slice. Split unrelated state, navigation
  and audit work into ordered prompts.
- High-risk prompts require a successful independent Codex review. A failed
  Claude, required review or verification run is not committed or marked complete.
- For required review, the scheduler process runs the hash-bound Codex script
  after implementation Claude exits and before a separate read-only reviewer.
- Gate script/dependency hashes and the Fable reviewer system prompt are captured
  before workers run; changed gate files block review, and reviewer uses safe mode.
- A conditional reviewer may return one machine-captured `codex-requested`
  result with a reason; the scheduler passes it to Codex and the second reviewer.
- `codexReview.requested: true` is persisted in the run result and requires a
  passed hash-bound artifact; it cannot be downgraded to a reasoned skip.
- Unattended Claude loads project settings only and uses `dontAsk`. Codex is not
  in worker/reviewer permissions; executable runners are narrowed to focused
  Vitest, typecheck and named local verification scripts.
- Worker environment prepends blocking Codex/Claude shims, isolates `CODEX_HOME`,
  clears OpenAI credentials and forces offline npx. This is an operational
  token-usage guard, not an adversarial-code sandbox. Reviewer has no Bash, reads a
  scheduler-written canonical diff and is rejected if that hash changes.
- Reviewer receives an explicit built-in tool set without Bash/Write/Edit. An
  atomic scheduler lock prevents duplicate queues from invoking models together.
- The scheduler invalidates old run approval at start and writes `blocked` after
  any implementation, review, Codex or verification failure.
- Durable approval is written only after all verification and the final hash
  gate. Stale scheduler locks require operator acknowledgement, never auto-retry.
- Active child process groups are terminated and confirmed before releasing the
  lock; archive or commit failure atomically replaces approval with `blocked`.
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
