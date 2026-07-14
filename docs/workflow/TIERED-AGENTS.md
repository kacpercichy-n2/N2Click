# Tiered agent workflow

The workflow routes each bounded task through the smallest safe set of clean
contexts. The executable contract is `.claude/commands/tier.md`; this page
explains the roles and risk policy without duplicating their full prompts.

## Roles

| Role | Model | Responsibility |
| --- | --- | --- |
| `architect` | Fable | Read-only exploration, decomposition and architecture/decision deliverables. |
| `developer` | Opus | Production implementation and focused build/fix/test loop. |
| `test-writer` | Sonnet | Mechanical tests, fixtures, smoke checks and bounded documentation sync. |
| `reviewer` | Fable | Structural diff review, convention/test check and final verdict. |
| Codex | GPT-5.6 Sol | Independent read-only review when the prompt requires or conditionally triggers it. |

## Minimal routing

- Ready single-boundary code: `developer → reviewer`.
- Mechanical tests/docs: `test-writer → reviewer`.
- Cross-boundary or multi-package work: `architect → developer → reviewer`.
- Architecture/decision document without code: `architect → reviewer`.

Do not add a separate test-writer when the developer can cover the bounded
change and its tests in one context. Do not repeat the architect's final
evaluation after a single-package reviewer verdict.

## Definition of Ready

A worker package must name its minimum wiki context, concrete touchpoints,
invariants, scope/out-of-scope, observable acceptance criteria and focused test
command. Open decisions use `Status: blocked-needs-decision` and do not route.
See `docs/workflow/HANDOFF-TEMPLATE.md`.

## Risk and independent review

- `high`: persisted schema/migrations, reducer identity/integrity, trust/auth,
  permissions, persistence conflicts, calendar pointer lifecycle or comparable
  data-loss risk. Codex review is required and fail-closed.
- `medium`: bounded cross-component behavior or test infrastructure. Codex is
  conditional on context expansion or reviewer uncertainty.
- `low`: focused docs, fixtures or routine local changes. Codex may be skipped
  with the rationale declared in the prompt.

The reviewer adjudicates Codex findings; it does not accept them blindly.
The orchestrator writes the machine-readable `handoffs/RUN-RESULT.json` only
after that verdict. The scheduler validates its current `runId`, approval and
fresh required-review artifact before running final checks.
Required review metadata binds the current `runId` to a SHA-256 of the canonical
diff; changes after review require a new review pass.

## Context and verification

Read `CLAUDE.md`, only the prompt's `openwiki/n2hub/` pages and named
touchpoints, then direct dependencies. Record every expansion. Workers run
focused checks during iteration; the scheduler runs one final
`npm run test:scheduler`, `npm test` and `npm run build`, stopping at the first
failure. Browser checks run only when the
prompt names the changed interaction or the release bundle owns the matrix.

`handoffs/RUN-STATE.md` is a compact current-run index, not history. Packages and
named check artifacts retain detailed evidence. The final reviewer/orchestrator
records one wiki decision after seeing the final diff.

## Git ownership

Agents never commit or push. The unattended scheduler verifies, moves the
completed prompt to `archive/completed/`, commits the green result and leaves
push as an explicit operator action.
