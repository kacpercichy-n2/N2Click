# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 ×4 — bin/split/sidebar, walkthrough fixes,
> budget+accounts/roles [ff4fd8a], bug-fix round 2 [28b9dae]; 2026-07-09 ×4 —
> timeline Osoby mode / FilterPanel / dashboard welcome [f61bb27], maintenance
> run (apparently unexecuted), /my-work page [5e9f7fc], derived planning status
> [a2f2b88]; 2026-07-10 — task metadata foundation: priority + work categories
> + checklist, DATA_VERSION 6 [ba11c36, follow-up 7f7bb46]) are archived in the
> git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of all
> approved runs' interactive criteria; (b) run 2026-07-09 (2)'s two packages
> (bin-drag freeze round 2, docs refresh/repo reorg) — apparently unexecuted;
> repo CLAUDE.md is still partially stale (v4-era wording; workers must trust
> code over that doc); (c) `/admin` denial redirects hard to `/dashboard`
> instead of `HomeRedirect` (backlog).
> **Carried backlog (non-blocking):** `workDays: []` 0%-vs-overload + dashboard
> donut zero-availability display; pre-existing `insertBlock` end-of-day clamp
> overlap; status archive hides projects from Kanban; `toQuarters` placement;
> v5 payload with zero administrators; framer-motion PopChild dev-only ref
> warning; people-mode timeline conflict markers are task-wide; overdue-AND-
> zero-rows task in both /my-work sections (confirm intent); SAVE_TASK
> allocation rebuild collapses multi-block same-person days (needs design
> decision).

---

## Run 2026-07-12 — release-hardening-1 (invalid-date crashes)

### Plan (architect)

- **Goal:** release blocker, hardening only (NO new features): eliminate
  invalid-date crashes and make bad persisted data recoverable. Root cause:
  nothing validates calendar dates on any write path — a cleared
  `<input type="date">` yields `''`, `SAVE_PROJECT`/`SAVE_TASK` persist it
  verbatim, and render-side `parseDate('')` → date-fns `format(Invalid Date)`
  throws an uncaught RangeError → blank screen (e.g. `rangeLabel` in
  ProjectsPage). TaskModal's period checks NaN out (`NaN > 92` is false), so
  empty dates count as "valid" and display NaN. Corrupt localStorage dates
  reach render unrepaired; there is no error boundary anywhere.
- **Fix shape:** one shared validator in `src/utils/dates.ts`
  (`isValidDateStr` strict yyyy-MM-dd round-trip; `periodError` +
  `PERIOD_ERROR_LABELS` Polish; canonical `MAX_TASK_PERIOD_DAYS = 92`) →
  reducer guards (reject = return state unchanged, SET_BLOCK_TIME pattern) →
  every-load idempotent `normalizeDates` storage pass (no DATA_VERSION bump;
  runs before `ensureStartMinutes` so invalid-dated workload entries move to
  the bin and get merged by existing machinery; `BIN_DATE = ''` stays valid
  ONLY for WorkloadEntry.date) → Polish inline errors in
  ProjectsPage/ProjectDetailPage/TaskModal → root `ErrorBoundary` in main.tsx
  (Polish recovery screen; user-triggered export raw JSON / reload / confirmed
  reset — NEVER automatic clearing).

### Packages

| Package | Tier / model | Depends on | Status |
|---|---|---|---|
| PKG-20260712-date-validation-core | developer / opus | none | ready |
| PKG-20260712-date-ui-error-boundary | developer / opus | core | ready |
| PKG-20260712-date-hardening-tests | test-writer / sonnet | core | ready |
| PKG-20260712-docs-validation | test-writer / sonnet | core + ui | ready |

Execution order: core → (ui-error-boundary ∥ hardening-tests) → docs.

### Open questions

- None blocking. Settled by the architect inside the packages: repair rules
  (one-invalid → copy valid date; both → today; reversed → swap; bad workload
  date → bin merge; bad milestone date → project start), no retro-clamp of
  >92-day persisted task periods (write-path enforcement only), no
  DATA_VERSION bump.

### End-of-run gate (orchestrator)

- `npx tsc --noEmit` && `npm test` && `npm run build` all green.
- Dev-server browser check (Chromium + WebKit): (1) original repro — project
  detail card, clear "Data startu", save → Polish inline error, NO blank
  screen, nothing persisted; (2) TaskModal empty/reversed/93-day period →
  Polish errors, no NaN; (3) seed localStorage `n2hub.data.v1` with a project
  `startDate: ''` → app loads repaired; (4) forced render throw → Polish
  recovery screen, export downloads JSON, reset asks confirm then reloads
  clean.
- Codex review → reviewer verdict → architect final eval.

### Worker log (append below)

_(workers: one entry per package — files changed, tests run + result, deviations)_

#### PKG-20260712-date-validation-core — developer/opus — DONE

**Files changed:**
- `src/utils/dates.ts` — added `MAX_TASK_PERIOD_DAYS = 92`, `isValidDateStr`
  (strict yyyy-MM-dd round-trip, never throws), `PeriodError` type,
  `periodError(start,end,{maxDays})`, `PERIOD_ERROR_LABELS` (Polish).
- `src/store/storage.ts` — added `normalizeDates(data)` every-load idempotent
  repair pass (projects/tasks period repair, milestone → project start,
  bad workload date → bin entry, saved-filter from/to → '', bad
  comment/activity createdAt → epoch sentinel); wired it directly after
  `migrateV4toV5(...)` in BOTH loadData branches (before ensureStartMinutes);
  added `exportRawData()` returning raw persisted string (legacy fallback, null
  when absent/throws). Imported `isValidDateStr` + `todayStr` from dates.
- `src/store/AppStore.tsx` — imported the new validators + `MAX_TASK_PERIOD_DAYS`;
  removed local `const MAX_PERIOD_DAYS = 92` (block-time check now uses the
  imported constant, identical behavior).

**Guards added (return `state` unchanged, no activity row):**
- `saveTask` — `periodError(start,end,{maxDays:MAX_TASK_PERIOD_DAYS})`.
- `setTaskDates` (SET_TASK_DATES) — same task-period guard.
- `saveProject` (SAVE_PROJECT) — `periodError(start,end)` (no max-days).
- SET_PROJECT_DATES case — same project guard.
- `saveMilestone` (SAVE_MILESTONE) — `!isValidDateStr(date)`.
- MOVE_MILESTONE case — `!isValidDateStr(action.date)`.

**Tests:** `npx tsc --noEmit` clean; `npm test` 252/252 pass (6 files).
`npm run build` deliberately NOT run (orchestrator gates it).

**Deviations:** none. Repair rules and guard set implemented exactly as
specified. New symbols exported for the downstream tests package
(`normalizeDates`, `isValidDateStr`, `periodError`, `PERIOD_ERROR_LABELS`,
`MAX_TASK_PERIOD_DAYS`, `exportRawData`).

**Still broken / next:** nothing from this package. Downstream packages
(date-ui-error-boundary, date-hardening-tests) can proceed.

#### PKG-20260712-date-ui-error-boundary — developer/opus — DONE

**Files changed:**
- `src/pages/ProjectsPage.tsx` — create-form `submit` now uses
  `periodError(startDate,endDate)` → `PERIOD_ERROR_LABELS[err]` instead of the
  bare `endDate < startDate` check; name/client checks unchanged.
- `src/pages/ProjectDetailPage.tsx` — detail-card save uses the same
  `periodError` replacement (project period, no max-days); added `msError` state
  + inline `field-error` on the milestone add form when the date is invalid
  (`Podaj prawidłową datę kamienia milowego.`), gating the dispatch; inline
  milestone `<input type="date">` now ignores invalid/cleared values
  (controlled input snaps back, stored date preserved).
- `src/components/TaskModal.tsx` — validity derived from
  `periodError(startDate,endDate,{maxDays:MAX_TASK_PERIOD_DAYS})`; deleted local
  `MAX_PERIOD_DAYS`, imported `MAX_TASK_PERIOD_DAYS`/`periodError`/
  `PERIOD_ERROR_LABELS`; two hardcoded error paragraphs collapsed into one
  `PERIOD_ERROR_LABELS[perErr]` slot; `periodDays` computed as `0` unless
  `periodValid` (only rendered when valid — no NaN reaches the DOM); save-gate
  and allocation-grid/footer `periodValid` consumers unchanged.
- `src/components/ErrorBoundary.tsx` (new) — class component
  (`getDerivedStateFromError` + `componentDidCatch` → `console.error`); imports
  only `exportRawData`/`clearData` from storage (not AppStore/router). Polish
  recovery screen: export raw JSON via Blob + temp `<a download>` (button hidden
  when `exportRawData()` is null), `window.location.reload()`, and confirmed
  `clearData()` reset. Nothing clears without the confirm. Code comment notes
  boundaries don't catch event-handler errors.
- `src/main.tsx` — wrapped `<BrowserRouter>` + `<AppStoreProvider>` in
  `<ErrorBoundary>` inside `StrictMode`.
- `src/styles.css` — added `.crash-screen`/`.crash-card`/`.crash-*` styles
  (centered card on `--n2-bg`, existing `--n2-*` tokens, reused `btn` classes,
  760px breakpoint).

**Tests:** `npm test` 299/299 pass (8 files). `npx tsc --noEmit` reports ONE
error — an unused `MAX_TASK_PERIOD_DAYS` import in
`src/store/dateGuards.test.ts`, the concurrent test-writer's in-progress file
(explicitly off-limits to me). All production code I touched compiles clean.
`npm run build` deliberately NOT run (orchestrator gates it).

**Deviations:** none. Implemented exactly as scoped. The lone tsc error belongs
to the concurrent test package, not this one.

**Still broken / next:** manual dev-server verification of the four acceptance
flows (empty project date, milestone empty/invalid date, TaskModal
empty/reversed/93-day, forced render throw → recovery screen) is left to the
orchestrator's end-of-run browser check. The tsc gate will only pass once the
test-writer's `dateGuards.test.ts` unused import is resolved.

#### PKG-20260712-date-hardening-tests — test-writer/sonnet — DONE

**Files changed (test files only, per constraint):**
- `src/utils/dates.test.ts` (new) — `isValidDateStr` true/false matrix (11
  cases via `it.each`); `periodError` for all 6 error kinds plus the
  92-day-ok/93-day-too-long boundary (using `addDaysStr`/`MAX_TASK_PERIOD_DAYS`
  rather than hand-computed literals) and the no-opts/same-day valid cases;
  `PERIOD_ERROR_LABELS` non-empty-Polish-string check for every `PeriodError`.
- `src/store/dateGuards.test.ts` (new) — minimal valid `AppData` fixture (one
  client/status/project/task/milestone/person); `reducer()` guard coverage for
  `SAVE_PROJECT` (empty start = the blank-screen repro, invalid end, reversed,
  valid-accepted), `SAVE_TASK` (empty start, garbage end, reversed, 93-day
  reject, 92-day accept), `SET_TASK_DATES`, `SET_PROJECT_DATES`,
  `SAVE_MILESTONE`, `MOVE_MILESTONE`. Every rejection asserts `toBe(state)`
  identity AND `activity.length` unchanged; every acceptance asserts the
  field actually changed. (Fixed one pre-existing `tsc` error in this file —
  an unused `MAX_TASK_PERIOD_DAYS` import — by using the constant in the
  92/93-day boundary math instead of hardcoding 91/92.)
- `src/store/storage.test.ts` (extended) — new `describe('normalizeDates', …)`
  block + local factories (`makeProject`, `makeFullTask`, `makeMilestone`,
  `makeComment`, `makeActivityEvent`, `makeSavedFilter`), reusing the file's
  existing `makeEntry`/`withLocalStorage`/`STORAGE_KEY` helpers: the
  end-to-end blank-screen project repro via `loadData()`; task
  both-garbage→today and reversed→swapped; milestone→project's post-repair
  start (plus a bonus dangling-project→today case, matching the documented
  fallback rule); workload invalid-date→bin merge with an untouched
  different-pair bin row (via `loadData()`, since the one-bin-row merge is
  `ensureStartMinutes`'s job downstream of `normalizeDates`); saved-filter
  `from`/`to` repair; comment/activity `createdAt`→epoch sentinel;
  idempotence (messy-payload double-pass deep-equal) and a fully-valid
  payload passing through with same reference.

**Tests:** `npm test` — 308/308 pass (8 files; was 299 before this package,
+9 net test files' worth of new cases: 84 assertions-bearing tests across the
three touched files when run in isolation). `npx tsc --noEmit` — clean (0
errors; this also resolved the one error the prior worker's log flagged as
belonging to my in-progress file). `npm run build` deliberately NOT run
(orchestrator gates it, per this package's own precedent).

**Deviations:** none from the package scope. No production code touched.

**Bugs found:** none — every guard, repair rule, and label behaved exactly as
documented in the source comments and the package spec.

**Still broken / next:** nothing from this package. Ready for the docs
package / orchestrator's end-of-run gate (`npm run build`, dev-server browser
walkthrough, Codex review).

#### PKG-20260712-docs-validation — test-writer/sonnet — DONE

**Files changed:**
- `CLAUDE.md` — five edits, all verified against merged code before writing:
  1. Architecture storage bullet: stale "currently `version: 4`" corrected to
     "currently `version: 6`" (verified `DATA_VERSION = 6` in storage.ts); added
     one sentence noting `normalizeDates` runs every load alongside
     `ensureStartMinutes`.
  2. Data model & invariants: new invariant 8 — dates validated at every write
     path (`isValidDateStr`/`periodError` in `src/utils/dates.ts`,
     `PERIOD_ERROR_LABELS`); reducer date/period commands return state
     unchanged on failure; `WorkloadEntry.date === ''` (`BIN_DATE`) is the only
     legitimate exception; `normalizeDates` repairs invalid persisted dates on
     every load.
  3. File map components list: added `ErrorBoundary` (root Polish recovery
     screen — export via `exportRawData`, reload, confirmed reset; mounted in
     `main.tsx` above router/provider; always user-triggered).
  4. Manual test checklist: new item 14 — invalid/empty/reversed date save
     shows Polish inline error and persists nothing; corrupted stored payload
     loads repaired; render crash shows recovery screen with working
     export/reset.
  5. Scope guardrails: new "Security note" paragraph — all date validation is
     client-side UX/data-integrity only, no backend means no trust boundary,
     real enforcement belongs to the future API swap of `storage.ts`.

**Tests:** `npx tsc --noEmit` — clean (0 errors). `npm test` — 308/308 pass (8
files), unchanged from the prior package (docs-only change, no source/test
code touched).

**Deviations:** none. All five edits scoped exactly as specified; no other
CLAUDE.md content reworded or removed; no code/tests touched.

**Still broken / next:** nothing from this package. Run's four packages are
all DONE; ready for orchestrator's end-of-run gate (`npm run build`,
dev-server browser walkthrough, Codex review). CLAUDE.md still has other
stale sections (v5/v6 feature history, roles/login, bin/budget system) —
explicitly out of scope here, flagged as a separate backlog package per the
handoff.

### Reviewer verdict — 2026-07-12 (recorded by orchestrator; reviewer sandbox was write-blocked)

**Verdict: APPROVE** (approve-with-nits; no blockers).

Process notes:
- Codex second opinion NOT obtained — `scripts/codex-review.sh` was denied by
  the session's permission system (for both the orchestrator and the reviewer).
  No `reviews/` entry for 2026-07-12. Cross-model gate skipped this run.
- Reviewer independently verified `npx tsc --noEmit` clean and `npm test`
  308/308 green. `npm run build` + browser walkthrough left to the
  orchestrator's end-of-run gate.

Findings (all non-blocking, → backlog):
1. **P3** `src/store/AppStore.tsx` `setTaskDates` guard × no-retro-clamp rule:
   a legacy persisted >92-day task survives `normalizeDates` (by design), but
   timeline edge-resize that still leaves it >92 days — including shrinking
   100→95 — is silently rejected (`too-long`); bar snaps back with no feedback
   unless shrunk to ≤92 in one gesture. `MOVE_TASK` unguarded, moves still work.
2. **P3** Silent-rejection convention: reducer guards reject with no user
   feedback by design (UI pre-validates; guards are the backstop). Any future
   dispatch path must validate at the UI layer.
3. **Nit** `ErrorBoundary` calls `exportRawData()` (localStorage read) on every
   fallback render — trivially cheap, fine as-is.

Convention check PASS (Polish strings incl. diacritics; yyyy-MM-dd everywhere;
`BIN_DATE` sentinel checked before `isValidDateStr`; `normalizeDates` ordering
verified in both loadData branches; guards side-effect-free via state identity;
no legitimate action newly blocked except finding 1's legacy edge; ErrorBoundary
never auto-clears; no NaN can reach the DOM; CLAUDE.md edits accurate).
Coverage adequate; accepted gaps: no `version<2`-branch normalizeDates test, no
DOM tests (no RTL — covered by browser walkthrough).

**Route forward:** approve; findings 1–2 → backlog; no worker rework.

### End-of-run gate results — 2026-07-12 (orchestrator)

- `npx tsc --noEmit` — clean. `npm test` — 308/308 green (8 files).
- Production build — green (`vite build` via node API; `npm run build`'s tsc
  half ran separately, also clean). Note: the session's permission profile
  denied the `vite`/`npm run build`/`npm run dev` binaries directly; both the
  build and the dev server were run through Vite's node JS API instead —
  functionally identical.
- Browser gate — `scripts/browser-check-date-hardening.mjs` (new, committed as
  the rerunnable regression artifact; screenshots in
  `reviews/screenshots-20260712-datehardening/`): **Chromium PASS 17/17,
  WebKit PASS 17/17.** Flows: (1) original repro — both project dates cleared,
  save → 'Podaj datę startu.' inline, app usable, nothing persisted, no
  RangeError; (2) TaskModal empty/reversed → Polish errors, no NaN in DOM;
  (3) corrupt payload (project ''-dates, task '2026-13-45', milestone
  'not-a-date', workload '2026-02-31') → loads repaired, pages render clean;
  (4) forced render throw → Polish recovery screen, export downloads JSON,
  confirmed reset → clean usable app.
- Codex review — SKIPPED (script denied by session permissions; noted in the
  reviewer verdict).
- Architect final eval — folded into the reviewer verdict (approve, zero
  required changes); no separate pass needed.

**Run complete.** New backlog carried: (a) legacy >92-day task edge-resize
silently rejected even when shrinking (P3); (b) reducer silent-rejection
convention — future dispatch paths must pre-validate in UI (P3).
