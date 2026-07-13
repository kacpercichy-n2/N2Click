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

- `Codex review: required`: run `bash scripts/codex-review.sh`. If it cannot run
  successfully, stop the high-risk run; do not downgrade it.
- `conditional`: reviewer runs it only for an undeclared boundary expansion or
  unresolved uncertainty and records the decision.
- `skip`: record the prompt's supplied rationale without another ceremony pass.

The reviewer reads the package or prompt, declared wiki context, compact
`handoffs/RUN-STATE.md` and structural diff. It owns the final verdict and the
single `wiki updated` / `wiki unchanged` decision. An architect performs another
final evaluation only when multiple dependent packages need integration review.
The orchestrator then writes the exact `handoffs/RUN-RESULT.json` requested by
the scheduler wrapper; blocked or changes-required work must never be marked approved.

Workers run focused checks while iterating. The scheduler owns the one final
`npm test && npm run build` gate, prompt archive and commit. Agents never commit,
push, merge, rebase or switch branches.

## Task

$ARGUMENTS
