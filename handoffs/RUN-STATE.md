# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 ×4 — bin/split/sidebar, walkthrough fixes,
> budget+accounts/roles [ff4fd8a], bug-fix round 2 [28b9dae]; 2026-07-09 (1) —
> bin-drag freeze fix (pointer-capture, REGRESSED) · timeline Osoby mode ·
> FilterPanel · dashboard welcome page, approved-with-nits, committed f61bb27,
> 195/195 tests; 2026-07-09 (2) — maintenance run: bin-drag freeze round 2 +
> CLAUDE.md/docs refresh + repo reorg [PKG-20260709b-bin-drag-freeze-2,
> PKG-20260709b-docs-refresh] — NOTE: its worker log stayed empty and no
> matching commits are on this branch, so those packages appear NOT executed;
> 2026-07-09 (3) — MVP "Moja praca" /my-work page [PKG-20260709c-my-work-page,
> PKG-20260709c-my-work-selector-tests], approve-with-nits (nits fixed in
> follow-up), 211/211 tests, committed 5e9f7fc)
> are archived in the git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of all
> approved runs' interactive criteria (role matrix, budget clamp + merge
> animation, availability math, insert-form allowance warnings, TaskModal
> over-budget banner, impersonation banner/return, Osoby timeline mode,
> FilterPanel on 4 pages, dashboard sections + chat-persists-nothing check,
> /my-work sections + pracownik redirect); (b) run 2026-07-09 (2)'s two
> packages (bin-drag freeze round 2, docs refresh/repo reorg) — apparently
> unexecuted; repo CLAUDE.md is still v4-era stale (workers this run must
> trust code over that doc); (c) run 3 reviewer nit P3: `/admin` denial
> redirects hard to `/dashboard` instead of `HomeRedirect` (backlog).
> **Carried backlog (non-blocking):** Codex #5 `workDays: []` 0%-vs-overload
> display + dashboard donut zero-availability display (same class; suggested
> `over = booked > available`); pre-existing `insertBlock` end-of-day clamp
> overlap; status archive hides projects from Kanban; `toQuarters` placement
> (→ utils/time.ts); v4→v5 payload with zero administrators (promote-first-person
> idea); framer-motion PopChild dev-only ref warning; people-mode timeline
> conflict markers are task-wide, not per-person (needs
> `conflictDatesForTaskPerson` decision); overdue-AND-zero-rows task appears
> in both "Po terminie" and "Bez planu" on /my-work (reads intentional —
> confirm in walkthrough).

---

## Run: 2026-07-09 (4) — task planning status MVP

### Plan (architect)

- **Goal:** a fully derived (never stored) task "planning status" with four
  exact Polish values — `nie rozplanowano`, `częściowo`, `rozplanowano`,
  `przekroczono` — exposed as a pure core function
  (`planningStatusForTotals(estimate, datedHours, binHours)`) plus a selector
  (`taskPlanningStatus(state, taskId)`) in `src/store/selectors.ts`; rendered
  as a compact `PlanningBadge` chip (styled like `.status-badge`, semantic
  `--n2-*` tones) on TasksPage cards, TaskModal (live from DRAFT totals),
  ProjectDetailPage task rows, and MyWorkPage Zasobnik rows; plus a
  single-select "Planowanie" group in TasksPage's existing FilterPanel.
  Branch: `review/claude-auto-20260709-1602`; ONE commit scoped to this
  bundle, owned by the top-level orchestrator after review (no commit
  package).

- **Packages (sequential):**
  1. `handoffs/packages/PKG-20260709d-planning-status-core.md` —
     tier: developer (opus) — status: **done**.
  2. `handoffs/packages/PKG-20260709d-planning-status-tests.md` —
     tier: test-writer (sonnet), depends on 1 — status: **done** —
     ≥14 unit tests in `src/store/selectors.test.ts`, test file only.

- **Pinned decisions:** status precedence (EPS = 1e-9, matching TaskModal's
  overBudget): (1) total ≤ EPS → nie rozplanowano; (2) est ≠ null ∧ total >
  est+EPS → przekroczono (dated + bin, same condition as the TaskModal
  banner); (3) bin > EPS → częściowo (zasobnik hours are by definition
  "nierozplanowane" — a task with bin hours is never "rozplanowano");
  (4) est = null → rozplanowano; (5) dated ≥ est−EPS → rozplanowano;
  (6) else częściowo. Bin-only ⇒ częściowo (consistent with run 3's
  "bin rows count as planned" — NOT "nie rozplanowano"); est = 0 gets no
  special case (stored estimates are >0 or null). Fourth badge surface =
  **/my-work Zasobnik rows** (NOT the dashboard — TodayAgendaList is pinned
  frozen and shared). Filter: single-select radio group "Planowanie",
  values = the exact status strings, EXCLUDED from saved presets
  (`SavedFilterCriteria`/`FilterPresets`/`types.ts` untouched — no persisted
  shape may change; documented limitation). `PlanningStatus` type +
  `PLANNING_STATUSES` live in selectors.ts, not types.ts (derived, not
  stored). No DATA_VERSION/storage/AppStore change. CLAUDE.md: minimal
  targeted additions only (full refresh remains run 2's pending package).

- **Reviewer attention list:** exact precedence order in the pure fn (rule 3
  before 4/5 — total==est with bin>0 must be częściowo, not rozplanowano);
  TaskModal badge computed from DRAFT (`normalizedEstimate`,
  `plannedTotalAll`, `binTotal`), not saved state; TasksPage filtering
  useMemo dependency array gains `planningFilter`; no persisted shape
  touched; four exact lowercase Polish strings; CSS uses existing tokens
  only; DashboardPage/TodayAgenda untouched.

- **Environment notes for workers:** RTK hook may block rewritten read
  commands — use Read/Grep/Glob tools (`node -e '…'` as escape hatch); if
  `npm run build` is approval-gated, `node node_modules/vite/bin/vite.js
  build` worked last run; gates after every package: `npx tsc --noEmit` ·
  `npm test` (baseline 211) · production build.

- **Open questions:** none.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-09 21:14 · developer (opus) · `PKG-20260709d-planning-status-core`

- **Changed:**
  - `src/store/selectors.ts` — new `PlanningStatus` type + `PLANNING_STATUSES`, pure `planningStatusForTotals(est,dated,bin)` (6-rule precedence, full JSDoc), selector `taskPlanningStatus(state,taskId)` splitting entries via `isBinEntry`.
  - `src/components/PlanningBadge.tsx` — new compact pill component (tone class per status, no inline styles).
  - `src/styles.css` — `.planning-badge` base (copied from `.status-badge`) + 4 tone modifiers using existing `--n2-*` / `--text-muted` tokens.
  - `src/pages/TasksPage.tsx` — badge after StatusBadge on cards; single-select "Planowanie" filter (state, predicate + useMemo dep, FilterGroup, activeCount, clearFilters, chip); comment noting deliberate exclusion from saved presets.
  - `src/components/TaskModal.tsx` — third `.estimate-compare` segment: badge from live DRAFT totals (`normalizedEstimate`, `plannedTotalAll`, `binTotal`).
  - `src/pages/ProjectDetailPage.tsx` — badge after StatusBadge in each task row.
  - `src/pages/MyWorkPage.tsx` — badge in Zasobnik rows after `.agenda-meta`.
  - `CLAUDE.md` — two minimal additions (selectors bullet + Tasks description).
- **Tests:** `rtk tsc --noEmit` clean · `npx vitest run` → 211/211 (no test added/touched) · `npm run build` succeeds (pre-existing >500kB chunk warning only). Scratch `node -e` confirmed all 8 worked precedence edge cases.
- **Still broken:** nothing.
- **Next:** hand to test-writer for `PKG-20260709d-planning-status-tests` (≥14 unit tests). No commit (orchestrator commits after review).

#### 2026-07-09 21:16 · test-writer (sonnet) · `PKG-20260709d-planning-status-tests`

- **Changed:**
  - `src/store/selectors.test.ts` — added `planningStatusForTotals` and `taskPlanningStatus` to the import list; appended `describe('planningStatusForTotals')` (14 cases, every rule of the 6-rule precedence hit incl. both EPS boundary directions) and `describe('taskPlanningStatus')` (6 cases: dated-only match, bin+dated split via `isBinEntry`, over-estimate, null-estimate/zero-rows, cross-task isolation, unknown taskId) — 20 new tests total.
- **Tests:** `npx tsc --noEmit` clean · `npx vitest run` → 231/231 passed (211 baseline + 20 new), 0 failures.
- **Still broken:** nothing. No selector bug found — pre-flight check confirmed the package's semantics table matches `planningStatusForTotals`/`taskPlanningStatus` in `src/store/selectors.ts` exactly (rule order, EPS, bin/dated split), so no source file was touched.
- **Next:** ready for reviewer. Only `src/store/selectors.test.ts` changed; no commit made.
- **Addendum (post-review nit):** added rule 5 lower-boundary test `planningStatusForTotals(8, 8 - 1e-12, 0)` → 'rozplanowano' to `src/store/selectors.test.ts`; `npx vitest run` → 232/232 passed.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-09 21:22 · reviewer (opus) · run verdict

- **Verdict:** approve-with-nits
- **Independently verified gates:** `npx tsc --noEmit` clean · `npx vitest run` 231/231 (211 baseline + 20 new).
- **Semantics check (pass):** `planningStatusForTotals` in `src/store/selectors.ts` implements the pinned 6-rule precedence exactly (rule order matches the package verbatim; `PLANNING_EPS = 1e-9` matches TaskModal `overBudget`; bin-only → częściowo; null estimate + dated-only → rozplanowano; przekroczono only with a non-null estimate). `taskPlanningStatus` splits via `isBinEntry` over `entriesForTask`; missing task falls out as estimate-null. Both fully derived — nothing stored.
- **Surfaces check (pass):** badge after StatusBadge on TasksPage cards + ProjectDetailPage rows; TaskModal badge computed from DRAFT totals (`normalizedEstimate`, `plannedTotalAll`, `binTotal` — the exact same inputs as the `overBudget` banner at line ~544); MyWorkPage Zasobnik rows after `.agenda-meta`. DashboardPage / TodayAgenda untouched.
- **Filter check (pass):** single-select Planowanie group wired into predicate (+`planningFilter` in the useMemo dep array), activeCount, chips, clearFilters; deliberately absent from `criteria`/`applyPreset` with the required explanatory comment. `FilterPresets.tsx`, `SavedFilterCriteria`, `types.ts`, `storage.ts`, `AppStore.tsx` all untouched (verified via git status + diff).
- **Conventions (pass):** Polish lowercase labels are the union values; CSS uses only existing tokens (`--n2-type-xs`, `--n2-radius-pill`, warning/success/danger + `-soft`, `--text-muted` — all confirmed present); no new deps; no scope creep (changed set = exactly the 8 planned files + test file + handoff/review artifacts).
- **Tests (adequate, one gap):** 14 pure-fn cases hit every rule incl. (8, 8+1e-12, 0) drift absorption, (8, 8.25, 0) real excess, rule-3-beats-rule-5 (8,5,3), and defensive (0,2,0); 6 selector cases incl. a genuinely discriminating cross-task leak test (a leak would flip t1 to przekroczono) and unknown-taskId. Gap (nit): rule 5 lower boundary `(8, 8 - 1e-12, 0) → rozplanowano` (dated a hair BELOW estimate absorbed by −EPS) is untested.
- **Codex adjudication:** single P1 (untracked `src/components/PlanningBadge.tsx` imported by 4 tracked files) — **accepted as a procedural blocker on the commit step, not a code defect**: the file is correct and present; the orchestrator MUST stage it (`git add -A` per plan neutralizes it — verify `PlanningBadge.tsx` is in the commit before pushing). Committing `reviews/` + `handoffs/packages/` artifacts alongside matches prior-run practice (they are tracked historically, not gitignored). No other Codex findings; none dismissed.
- **Nits (non-blocking, may fold into a later run):**
  1. Missing rule-5 boundary test `(8, 8 - 1e-12, 0)` in `src/store/selectors.test.ts` (test-writer, one line).
  2. `PLANNING_STATUSES` doc comment says canonical order is an empty→over-budget spectrum, but rozplanowano sits between częściowo and przekroczono — harmless, purely cosmetic wording.
- **Routes back:** nothing to developer; nit 1 optionally to test-writer. Orchestrator: commit the full bundle including the untracked component, then run the human browser walkthrough items (badge tones on 4 surfaces, live TaskModal badge while editing, filter chip/clear behavior).
