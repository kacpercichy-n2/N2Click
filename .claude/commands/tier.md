---
description: Route a bounded task through the smallest safe model-tier workflow
---

Follow the prompt's `## Risk and routing` section. The top-level session is an
orchestrator: it does not implement production changes itself.

## Routes

- `developer → reviewer`: ready, single-boundary implementation.
- `test-writer → reviewer`: mechanical tests, fixtures or documentation sync.
- `architect → developer → reviewer`: ambiguous decomposition risk, multiple
  boundaries or multiple dependent packages.
- `architect → reviewer`: architecture/decision deliverable with no code.

Use one worker when tests are inseparable from the implementation. Add a
test-writer only for a separate, mechanical package. The architect follows
`docs/workflow/HANDOFF-TEMPLATE.md`; unresolved decisions block routing.

## Review

- `Codex review: required`: after the implementation Claude process exits, the
  scheduler runs `bash scripts/codex-review.sh --run-id <scheduler-run-id>` and
  only then starts a separate read-only reviewer process. Failure stops the run.
- `conditional`: the separate reviewer may return one machine-captured
  `codex-requested` verdict for an undeclared boundary expansion or unresolved
  uncertainty; the scheduler then runs Codex and invokes reviewer once more.
- `skip`: record the prompt's supplied rationale without another ceremony pass.

The scheduler-owned reviewer reads the package or prompt, declared wiki context,
local `automation/claude-scheduler/state/current-work.json` and structural diff.
It owns the final verdict and the
single `wiki updated` / `wiki unchanged` decision. An architect performs another
final evaluation only when multiple dependent packages need integration review.
The scheduler, not an agent, writes `handoffs/RUN-RESULT.json` from the captured
reviewer verdict and Codex metadata; blocked work is never marked approved.

Workers run focused checks while iterating. The scheduler owns the one final
`npm run test:scheduler && npm test && npm run build` gate, prompt archive and
commit. Agents never commit, push, merge, rebase or switch branches.

## Task

$ARGUMENTS
