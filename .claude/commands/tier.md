---
description: Run a task through the tiered model workflow (architect → developer/test-writer → reviewer)
---

Run the task below through the tiered agent workflow documented in
`docs/workflow/TIERED-AGENTS.md`. Do NOT do the planning or implementation
yourself in this top-level session — delegate each phase to the matching
subagent so the work runs under the correct pinned model:

1. Use the **architect** subagent (Fable) to restate the goal, explore the
   relevant code read-only, decompose the work, and write self-contained
   handoff packages to `handoffs/packages/` following
   `docs/workflow/HANDOFF-TEMPLATE.md`. Each package must pass its Definition of
   Ready (files named, criteria testable, scope bounded, NO open questions)
   before it's routed — an ambiguous package makes the cheaper worker wander and
   wastes the savings. The architect also resets `handoffs/RUN-STATE.md` to a
   fresh run section.
2. For each ready package, invoke the assigned worker:
   - `tier: developer` → the **developer** subagent (Opus)
   - `tier: test-writer` → the **test-writer** subagent (Sonnet)
   - `tier: codex-implementer` → run
     `bash scripts/codex-implement.sh <package-path>`. This is an occasional
     external implementation worker, pinned to **GPT-5.6 Terra** with reasoning
     effort **high**; use it only for a bounded, Definition-of-Ready package.
   Each worker first pre-flights its package and STOPS if it's ambiguous rather
   than guessing. Workers own the build/fix/test loop, append their results to
   `handoffs/RUN-STATE.md` (what changed / tests + result / still broken / next),
   and report back synthesized results (no raw log dumps). If a worker gets stuck,
   it may consult **Codex** via `codex exec` for troubleshooting.
3. Review in two passes:
   a. Run `bash scripts/codex-review.sh` for **Codex's** independent second
      opinion, pinned to **GPT-5.6 Sol** with reasoning effort **high** (the
      script skips cleanly if the codex CLI isn't installed).
   b. Use the **reviewer** subagent (Fable) to read `handoffs/RUN-STATE.md` and
      the diff plus Codex's findings, adjudicate them against the project's
      conventions, and return a structured verdict. Record that verdict into
      `handoffs/RUN-STATE.md`.
4. Route any required changes back to the right worker, then stop for my
   go-ahead before committing.

Respect all repo conventions. If the task is small enough that the ceremony
isn't worth it, say so and recommend just using the developer subagent directly.

## Task

$ARGUMENTS
