# Handoff: Unit tests for the derived task planning status

- **Package ID:** PKG-20260709d-planning-status-tests
- **Status:** done
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260709d-planning-status-core
- **Blast radius:** none — test file only; no source (non-test) file may change.

## Goal

Add focused unit tests for `planningStatusForTotals` (pure core) and `taskPlanningStatus` (state selector) in `src/store/selectors.test.ts`, locking in the decided 6-rule precedence and its edge cases.

## Context the worker needs

- Relevant files:
  - `src/store/selectors.ts` — the two functions under test plus `PLANNING_STATUSES` (added by the core package). Read their JSDoc: it restates the semantics below.
  - `src/store/selectors.test.ts` — extend this file. Reuse the existing fixture builders already defined there: `makeState`, `makeTask`, `makePerson`, `makeEntry`, `makeAssignment`, `makeStatus`, and the `BIN_DATE` import from `../utils/time` (bin entry = `date: BIN_DATE` i.e. `''`).
- Semantics under test (final; `est` = estimate, `dated` = Σ dated-entry hours, `bin` = Σ bin-entry hours, `total = dated + bin`, `EPS = 1e-9`; first match wins):
  1. `total <= EPS` → `'nie rozplanowano'`
  2. `est != null && total > est + EPS` → `'przekroczono'`
  3. `bin > EPS` → `'częściowo'`
  4. `est == null` → `'rozplanowano'`
  5. `dated >= est - EPS` → `'rozplanowano'`
  6. otherwise → `'częściowo'`
- Prior decisions: the four status strings are exact lowercase Polish literals; the status is derived only (never stored); `taskPlanningStatus` on a missing task behaves as estimate-null.

## Scope

### In scope

Two new `describe` blocks in `src/store/selectors.test.ts`, ≥ 14 tests total:

**`describe('planningStatusForTotals')`** — pure-function table, at minimum:
- (null, 0, 0) → 'nie rozplanowano'; (8, 0, 0) → 'nie rozplanowano' (estimate alone plans nothing).
- (null, 0, 3) → 'częściowo' (bin-only, no estimate); (8, 0, 3) → 'częściowo' (bin-only under estimate).
- (null, 5, 0) → 'rozplanowano' (no target, all hours dated).
- (8, 8, 0) → 'rozplanowano' (exactly on target); boundary: (8, 8 + 1e-12, 0) still 'rozplanowano' (EPS absorbs float drift) and (8, 8.25, 0) → 'przekroczono' (one 0.25 step over).
- (8, 5, 0) → 'częściowo' (under target, empty bin).
- (8, 5, 3) → 'częściowo' (total == est but bin pending — rule 3 beats rule 5).
- (8, 8, 1) → 'przekroczono' (excess sits in the bin); (8, 9, 0) → 'przekroczono' (excess dated); (null, 9, 4) → 'częściowo' (no estimate ⇒ przekroczono impossible; bin forces częściowo).
- (0, 2, 0) → 'przekroczono' (defensive zero-budget behavior — no special case).

**`describe('taskPlanningStatus')`** — selector wiring against `makeState`, at minimum:
- Task with only dated entries matching its estimate → 'rozplanowano'.
- Task with a bin entry (`date: BIN_DATE`) plus dated entries within estimate → 'częściowo' (proves bin/dated split uses `isBinEntry`).
- Task whose dated + bin sum exceeds its estimate → 'przekroczono'.
- Task with `estimatedHours: null` and zero workload rows → 'nie rozplanowano'.
- Entries of OTHER tasks must not leak into the computation (two tasks in one state; each reports its own status).
- Unknown taskId → behaves as estimate-null with no entries → 'nie rozplanowano'.

### Out of scope

- Do NOT modify any file except `src/store/selectors.test.ts`. If a test reveals a genuine bug in the selectors, STOP and report it in `handoffs/RUN-STATE.md` instead of patching source.
- No component/DOM tests (badge/filter UI is covered by the human walkthrough, per repo convention).
- No snapshot tests, no new fixture frameworks, no new dependencies.
- No commit — the orchestrator commits after review.

## Implementation notes

- Follow the file's existing style: `describe`/`it` from vitest, fixture builders, plain `expect(...).toBe(...)` on the literal strings.
- Bin entries in fixtures: `makeEntry({ taskId, personId, date: BIN_DATE, plannedHours, sortIndex })` — check the builder's actual signature/defaults before use.
- Environment gotchas: the RTK hook may block rewritten read commands — use Read/Grep/Glob tools; run tests with `npm test`.

## Acceptance criteria

- [ ] ≥ 14 new tests across the two describe blocks, covering every bullet above (each rule of the precedence hit at least once, including both EPS boundary directions).
- [ ] Only `src/store/selectors.test.ts` changed.
- [ ] `npx tsc --noEmit` clean; `npm test` fully green: previous count (≥ 211 plus the core package's baseline, i.e. whatever `npm test` reported after PKG-20260709d-planning-status-core) + the new tests, zero failures.

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: all suites green; new tests visibly listed under the two new describe blocks; no existing test modified or broken.

## Report back

Synthesized summary (test count added, pass counts, any selector bug found — do not fix it) appended to `handoffs/RUN-STATE.md` under the run's Worker log. No raw logs.
