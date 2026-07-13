# Handoff: Regression coverage for free-slot placement, ripple rejection, and the INSERT_BLOCK 92-day cap

- **Package ID:** PKG-20260713b-placement-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713b-placement-core
- **Blast radius:** none — test files only.

## Goal

Unit coverage for the two new pure helpers (`findFreeStart`, `planRippleInsert`) and the changed reducer paths (INSERT_BLOCK fit/cap rejection, REASSIGN_ENTRY free-slot/reject, SAVE_TASK new-pair free-slot-with-fallback), plus explicit regression proof that the already-fixed period guards stay intact. ADDITIONS ONLY — read the real implementation before asserting anything.

## Context the worker needs

- Relevant files (edit): `src/utils/time.test.ts`, `src/store/blockActions.test.ts`, `src/store/saveTaskWorkload.test.ts`.
- Relevant files (read first, never guess): `src/utils/time.ts` (final `findFreeStart`/`planRippleInsert` as shipped by core — signatures may differ in detail from this package's paraphrase; the CODE wins), `src/store/AppStore.tsx` (`insertBlock`, `reassignEntry`, `saveTask` new-pair branch, `setBlockTime` guards for reference), existing test helpers (`makeState`/`makeTask`/`makeEntry` in blockActions.test.ts, the fixtures in saveTaskWorkload.test.ts).
- ENVIRONMENT: unattended run. Bash allows `node`, `npm test`, `npx tsc --noEmit` ONLY. ALL git commands denied.
- Baseline before your change: 11 test files / 369 tests green. Capture it yourself with `npm test` before editing.
- House conventions: referential-equality asserts for reducer rejections (`expect(next).toBe(state)`); loop multiple invalid values inside ONE test rather than `it.each` when keeping counts tight; no `.skip`/`.todo`.

## Scope

### In scope

1. `src/utils/time.test.ts` — new describes for the two helpers (~8-10 tests):
   - `findFreeStart`: empty day → 480 (clamped for huge durations); normal append after last block equals `nextFreeStart`'s result; append would clamp but an earlier gap ≥ duration exists at/after 08:00 → that gap's start (snapped); only a pre-08:00 gap exists → night fallback (e.g. blocks 08:00-24:00 solid, 2h free at 00:00 → 0); day truly full for the duration → `null`; off-grid block ends snap candidates UP to the 15-min grid; returned start never collides (assert with `hasCollision`).
   - `planRippleInsert`: insert into a gap → empty move map, later far block untouched; insert pushing an overlapping chain → each pushed start correct and un-clamped; equal-start tie (insert at an existing block's exact start) → existing block is pushed (insert sorts first); insert or pushed chain crossing 24:00 → `null`; day that fits EXACTLY to 24:00 (touching) → succeeds.
   - Also: add one comment line to the existing `nextFreeStart` clamp test (:117-121) noting the raw helper deliberately keeps clamp semantics and collision-safe placement lives in `findFreeStart`. Do NOT change its assertions.
2. `src/store/blockActions.test.ts` — new tests (~10-14):
   - INSERT_BLOCK end-of-day: "po" on a ref ending near midnight where the insert can't fit → `toBe(state)`; insert whose RIPPLE (pushed later blocks) can't fit → `toBe(state)`; insert fitting exactly to 24:00 → succeeds, no same-person overlap anywhere (assert via `hasCollision` over the day's blocks pairwise or an overlap scan); the existing gap-absorb behavior still holds (don't touch the existing test — add a near-midnight variant).
   - INSERT_BLOCK 92-day cap: ref block on day D, picked task (via `payload.taskId` ≠ ref task) whose period would widen past `MAX_TASK_PERIOD_DAYS` when extended to D → `toBe(state)` (task dates AND workload unchanged); same setup within the cap → period extends and the entry lands (regression that the extension itself still works).
   - REASSIGN_ENTRY dated: normal target day → appended to end (same result as before core); target day where append would clamp but an earlier slot fits → lands in that free slot, zero overlap; target day with no fitting slot → `toBe(state)` (assignments unchanged too); bin-entry reassign still merges per the existing tests (do not modify them).
3. `src/store/saveTaskWorkload.test.ts` — new tests (~2-3), ADDITIONS ONLY:
   - New (person,day) cell where the person's day holds another task's 20:00-24:00 block → new row lands at 480 (08:00), no overlap.
   - New cell on a day with NO fitting gap → save still SUCCEEDS (never rejected) and falls back to the clamped placement (assert the row exists; document the deliberate invariant-3 fallback in a comment).
   - Existing tests — especially :207 (grow-path clamp) and :287 (empty-day 08:00) — MUST remain byte-identical and green.
4. Regression re-verification (no code, part of your report): confirm `dateGuards`-style coverage for SAVE_TASK/SET_TASK_DATES period rejection and `setBlockTime`'s cross-day cap still passes untouched (it lives in the existing suite; name the describes in your report).

### Out of scope

- Any production file. Any modification/deletion of existing tests (the ONLY permitted touch to an existing test is the single comment line in time.test.ts named above).
- Tests for TaskModal deliberate-edit overlap policy or `ensureStartMinutes` migration normalization (protected current policy — already covered elsewhere).
- Browser scripts, CLAUDE.md, RUN-STATE beyond your worker entry.

## Implementation notes

- Trace `insertBlock`'s post-core validation ORDER in the real code first (budget → ripple fit → cap, or as shipped) so rejection tests isolate the intended guard (e.g. give the picked task ample estimate headroom when testing the fit/cap guards).
- For the cap test remember `estimatedHours` budget: give the picked task `estimatedHours` ≥ hours or a same-person bin row so the budget guard doesn't mask the cap rejection.
- REASSIGN free-slot test fixture idea: target person has 22:00-24:00 occupied, moved block 2h → must land 08:00 (not clamped 20:00-22:00-adjacent... read `findFreeStart`'s actual preference order and assert exactly).
- Keep total additions roughly 20-27 tests.

## Tests

- Command: `npx tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors; 369 pre-existing tests still green + your additions all green; no `.skip`/`.todo`; production diff empty.

## Report back

Synthesized summary only: per-file test counts added, any implementation-vs-package mismatch found (report it, don't code around silently), final suite totals, the regression-describe names from scope item 4.
