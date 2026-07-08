# Handoff: Vitest setup + unit tests for time math and block reducer actions

- **Package ID:** PKG-20260708-time-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260708-timed-blocks-core (tests its exports). Can run in parallel with PKG-20260708-week-timed-ui (disjoint files except `package.json` — this package owns `package.json` edits).
- **Blast radius:** low — adds a devDependency (vitest) + test files; no app code changes.

## Goal
First automated tests in the repo: install vitest, add `npm test`, and cover the pure time module (`src/utils/time.ts`) and the collision/ripple behavior of the reducer (`SET_BLOCK_TIME`, `INSERT_BLOCK`) with focused unit tests.

## Context the worker needs
- Relevant files: `package.json` (add `"test": "vitest run"` script + `vitest` devDependency; do not touch existing scripts), `vitest.config.ts` (NEW — see notes), `src/utils/time.ts` (module under test — read it for exact signatures; specified in PKG-20260708-timed-blocks-core), `src/store/AppStore.tsx` (exports `reducer`), `src/types.ts` (`AppData`, `WorkloadEntry`), `src/store/storage.ts` (`emptyData()` for state fixtures).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. Repo is Vite 5 + TS strict, `"type": "module"`.
- Prior decisions (architect — do NOT revisit):
  - Test runner: **vitest** (pairs with Vite, zero-config TS). `environment: 'node'` — no jsdom, no React rendering, no localStorage access in tests (the reducer and time utils are pure; `AppStoreProvider` is NOT under test).
  - Time rules under test: 15-min grid (`MINUTE_STEP = 15`), hours multiples of 0.25 in [0.25, 24], block must fit 0–1440, overlap is strict (`aStart < bEnd && bStart < aEnd` — touching edges is NOT a collision), workday stacking starts at 480.
  - Build fixture states by hand from `emptyData()` + literal tasks/people/assignments/workload (ids can be plain strings like `'t1'`, `'p1'` — the reducer never validates id format). `crypto.randomUUID` exists in Node ≥ 19; if the CI Node lacks it, add a tiny polyfill in a vitest `setupFiles` — only if actually needed.

## Scope
### In scope
1. `package.json` — devDependency `vitest` (current 1.x/2.x fine), script `"test": "vitest run"`.
2. `vitest.config.ts` — `test: { environment: 'node', include: ['src/**/*.test.ts'] }`.
3. `src/utils/time.test.ts` — cover at minimum:
   - `snapToStep`: rounds to nearest 15 (e.g. 487→480, 488→495 boundary behavior per implementation — assert the implemented rule, 0 and 1440 edges).
   - `formatMinutes`: 0→`0:00`, 480→`8:00`, 825→`13:45`, 1439→`23:59`.
   - `rangesOverlap` / `hasCollision`: overlapping, disjoint, touching-edges (no collision), `excludeId` skips the block itself.
   - `stackStartTimes`: [6h, 4h] → [480, 840]; clamping when a stack passes 24:00.
   - `nextFreeStart`: empty day → 480; after blocks → max end snapped up; clamped so end ≤ 1440.
   - `packDayBlocks`: non-overlapping blocks → all `cols === 1`; two overlapping → cols 2 with distinct `col`; a chain A∩B, B∩C, A∦C → same cluster width per implementation; empty input → [].
4. `src/store/blockActions.test.ts` — reducer tests via `reducer(state, action)`:
   - `SET_BLOCK_TIME` happy path (same-day move): startMinutes updated, sortIndex re-ranked by time, exactly one activity row appended.
   - Cross-day move: date updated, both days' sortIndex contiguous, task period extended when the new date is outside it.
   - Rejections return the SAME state object or deep-equal state: same-person overlap; off-grid startMinutes (e.g. 490); hours not multiple of 0.25; block past 24:00; unknown entryId.
   - Another person occupying the same range does NOT cause rejection.
   - `INSERT_BLOCK` "przed": new block at ref start, ref pushed later; "po": at ref end; a later block separated by a large gap does not move; other people's entries untouched; new entry's person auto-assigned to the task if not already.
### Out of scope
- No component/DOM tests, no WeekView tests, no snapshot tests.
- No changes to any `src/` app file — if a function is untestable as shipped, STOP and report instead of refactoring app code.
- No CI config.

## Implementation notes
- Read `src/utils/time.ts` first and assert against its actual exported names/behaviors; if an exported helper named in this package is missing, report it as a core-package gap rather than writing the helper yourself.
- Keep a small `makeState(overrides)` fixture helper in each test file (or a shared `src/testUtils.ts` — either is fine).
- Reducer tests: import `{ reducer }` from `../store/AppStore` — module has no side effects at import beyond React context creation, which works under node.

## Acceptance criteria
- [ ] `npm test` runs vitest and all tests pass.
- [ ] `npx tsc --noEmit` and `npm run build` still pass (test files must not break the build — if `tsc` picks up test files and complains about vitest globals, use explicit `import { describe, it, expect } from 'vitest'` — do NOT enable `globals`).
- [ ] Every bullet in "In scope" 3 and 4 has at least one assertion.
- [ ] No app source files modified.

## Tests
- Command: `npm test && npx tsc --noEmit && npm run build`
- Expected: all green.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md` (test counts, any core-package gaps found). No raw logs.
