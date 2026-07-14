# Handoff package template

Use a package only when an architect must decompose the scheduler prompt. A
ready prompt routed directly to one worker does not need a second copy as a
handoff.

## Definition of Ready

- Minimum wiki pages and concrete source touchpoints are named.
- Invariants and out-of-scope boundaries are explicit.
- Acceptance criteria are observable and testable.
- Focused verification is named; scheduler-owned full checks are not repeated.
- No product or architecture decision is unresolved.

If any item fails, use `Status: blocked-needs-decision` and stop.

```markdown
# Handoff: <imperative title>

- Package ID: PKG-<yyyymmdd>-<slug>
- Status: ready | blocked-needs-decision
- Tier: developer | test-writer | architect-docs
- Depends on: <package IDs or none>
- Risk: low | medium | high
- Codex review: required | conditional | skip — <reason>

## Goal
<one technical result>

## Wiki context
- `openwiki/n2hub/<area>.md`

## Expected touchpoints
- `path/to/file`
- `new: path/to/planned-file` # parent directory must already exist

## Invariants
- <behavior that must not regress>

## Scope
- <exact work>

## Out of scope
- <explicit exclusions>

## Acceptance
- [ ] <observable criterion>

## Verification
- Worker: `<focused command>`
- Browser: `<script + engines>` | none — <reason>
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions
- <settled decisions only>
```

Report back only changed boundaries, exact focused results, context expansions,
deviations and blockers. Link evidence; do not paste raw logs. The final
reviewer/orchestrator owns the single wiki decision.
