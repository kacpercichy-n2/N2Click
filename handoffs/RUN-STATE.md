# Current scheduler run state

This file is deliberately a compact current-run handoff. Historical reports,
screenshots and packages remain available in Git history and under
`handoffs/packages/`; do not rebuild history here.

## Baseline

- `main` includes release-hardening bundles 016–018: partial bin scheduling,
  collision-safe automatic placement and honest local persistence/tab safety.
- Latest integrated verification: `npm test` 413/413 and production build green.
- `openwiki/n2hub/` is the scoped context map. Scheduler prompts must declare
  wiki pages and expected touchpoints.

## Queue

1. `019a.md` — reducer command validation.
2. `019b.md` — dirty navigation protection.
3. `019c.md` — local audit attribution.
4. `020.md`–`022.md` — availability, release verification, backend boundary.

The prior combined 019 run failed off-main and was intentionally not integrated.
Start each new prompt from current `main`; do not reuse its partial validation
diff.

## Workflow rules

- Keep this file below 300 words; link evidence instead of pasting logs.
- At the end of a green run, record changed boundaries, test result, blocker/next
  step and `wiki updated` or `wiki unchanged` with a reason.
