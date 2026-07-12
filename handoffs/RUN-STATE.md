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
> + checklist, DATA_VERSION 6 [ba11c36, follow-up 7f7bb46];
> 2026-07-12 — release-hardening-1: date validation, reducer date guards,
> every-load `normalizeDates`, Polish inline errors, root ErrorBoundary; 4/4
> DONE, reviewer APPROVE, gate green, Codex skipped (script denied);
> 2026-07-12 — release-hardening-2: SAVE_TASK multi-block loss fixed —
> identity-preserving per-(person,date) delta reconciliation, ×N cell badge,
> 3/3 packages DONE, reviewer APPROVE, gate green incl.
> `scripts/browser-check-savetask-multiblock.mjs` Chromium+WebKit 8/8 each,
> Codex skipped (denied); suite baseline now 9 files / 320 tests)
> are archived in the git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of all
> approved runs' interactive criteria; (b) run 2026-07-09 (2)'s two packages
> (bin-drag freeze round 2, docs refresh/repo reorg) — apparently unexecuted;
> repo CLAUDE.md is still partially stale (v4-era wording; workers must trust
> code over that doc); (c) `/admin` denial redirects hard to `/dashboard`
> instead of `HomeRedirect` (backlog).
> **Carried backlog (non-blocking):** `workDays: []` 0%-vs-overload + dashboard
> donut zero-availability display; pre-existing `insertBlock` end-of-day clamp
> overlap; `toQuarters` placement; v5 payload with zero administrators;
> framer-motion PopChild dev-only ref warning; people-mode timeline conflict
> markers are task-wide; overdue-AND-zero-rows task in both /my-work sections
> (confirm intent); legacy >92-day task: timeline edge-resize that still leaves
> it >92d is silently rejected even when shrinking (P3); reducer
> silent-rejection convention — any future dispatch path must pre-validate in
> the UI (P3); cascade/unassign deletions (`saveTask` unassign, `deleteTask`,
> `setTaskDates`) don't reindex surviving same-day rows of OTHER tasks —
> sortIndex can gap, still ordered (P3, pre-existing).
> _(Removed from backlog: "status archive hides projects from Kanban" — being
> fixed by this run.)_

---

## Run 2026-07-12 — release-hardening-3 (status semantics)

### Plan (architect)

- **Goal:** make task/project completion semantics stable and safe to
  administer. Today `doneStatusId` (src/store/selectors.ts:85) = LAST ACTIVE
  status, so reordering or archiving statuses rewrites historical meaning
  (completed tasks resurrect as overdue) and archiving a used status hides its
  projects from Kanban (columns = `activeStatuses` only). High severity.
- **Root-cause trace (verified in code):**
  1. `doneStatusId` = `activeStatuses(state).slice(-1)[0]?.id`; consumed by
     `todayAgendaForPerson` (:301), `overdueTasksForPerson` (:545),
     `unplannedTasksForPerson` (:577); `TimelinePage.tsx:261` re-derives the
     same rule locally. No other page re-derives doneness (audited by grep).
  2. `KanbanPage` renders columns only for `activeStatuses` → archived-status
     projects have no column and vanish from the board. `TaskModal` /
     `ProjectDetailPage` status selects list only active statuses → an entity
     in an archived status renders a phantom select value.
  3. Reducer guards: none on `SET_STATUS_ARCHIVED`; `DELETE_STATUS` only
     refuses referenced statuses. Nothing stops archiving/deleting ALL active
     statuses.
- **Design decisions (final — no open questions in packages):**
  1. New stored `Status.isDone: boolean`; multiple done statuses allowed;
     newly created statuses default `false`; `buildDefaultStatuses` marks
     `Gotowe`.
  2. **Archived done statuses still count as done** — the done-set
     (`doneStatusIds`) spans ALL statuses. This is what makes archival unable
     to revive completed work. `doneStatusId` is removed outright.
  3. Migration: DATA_VERSION 6 → 7 plus an every-load idempotent
     `normalizeStatusFlags` pass (house pattern, like `normalizeTaskMeta`):
     coerce `isDone` to boolean; if none is done and statuses exist, default
     the LAST ACTIVE by `order` (exactly what old `doneStatusId` returns →
     semantics preserved); all-archived → last overall by `order` (deliberate
     repair); zero statuses → nothing.
  4. Archival-safety choice: archiving referenced statuses stays ALLOWED
     (archive-first philosophy kept); Kanban compensates with a trailing,
     clearly-labeled `Zarchiwizowane` column (drag-out only, not a drop
     target, hidden when empty). Status selects show the entity's own archived
     status as `{name} (zarchiwizowany)`.
  5. Reducer guards (state unchanged on violation; admin UI pre-validates with
     fixed Polish titles): cannot archive/delete the only ACTIVE status;
     cannot archive/delete/untoggle the only `isDone` status; delete still
     refused while referenced. New action `SET_STATUS_DONE`.
  6. Out of scope by user decree: any formal/sales project-card status fields.

### Packages

| Package | Tier / model | Depends on | Status |
|---|---|---|---|
| PKG-20260712c-status-done-core | developer / opus | none | ready |
| PKG-20260712c-status-admin-ui | developer / opus | core | ready |
| PKG-20260712c-status-tests | test-writer / sonnet | core | ready |
| PKG-20260712c-status-browser-docs | test-writer / sonnet | core + admin-ui | ready |

Execution order: core → admin-ui, then tests (needs core only; may run in
parallel with admin-ui) → browser-docs last.

### Open questions

- None blocking. Settled by the architect inside the packages: done-set spans
  archived statuses; kanban extra column over archive-blocking; migration
  defaults incl. all-archived/zero-status edge cases; guard matrix; exact
  Polish copy for toggle + disabled titles + column header.

### End-of-run gate (orchestrator)

- `npx tsc --noEmit` && `npm test` && production build
  (`node -e "import('vite').then(v => v.build())"`) green.
- Browser regression `scripts/browser-check-status-semantics.mjs` — Chromium +
  WebKit all-PASS (reorder keeps doneness; archived used status lands in the
  `Zarchiwizowane` kanban column; archived done status doesn't revive overdue;
  guard titles in Polish). Screenshots in
  `reviews/screenshots-20260712-status/`.
- Codex review (`scripts/codex-review.sh`) — attempt; if denied again, note
  the skip. Reviewer verdict → architect final eval.
- Acceptance restated: reordering statuses never alters completion; archiving
  a used status neither hides records nor revives completed work; Polish UI
  explains every blocked action; v≤6 payloads migrate preserving current done
  semantics, idempotent on reload.

### Worker log (append below)

_(workers: one entry per package — files changed, tests run + result, deviations)_

#### PKG-20260712c-status-done-core — developer/opus — DONE

- **Files changed:**
  - `src/types.ts` — added `isDone: boolean` to `Status` (doc comment: stable
    completion semantics, independent of `order`/`archived`).
  - `src/store/storage.ts` — `DATA_VERSION` 6→7; `buildDefaultStatuses()` marks
    only `Gotowe` done; new exported idempotent every-load pass
    `normalizeStatusFlags` (coerce `isDone` to strict bool; default last-active-
    by-`order`, all-archived→last overall, zero-status→nothing); wired into
    `loadData()` both return branches alongside `normalizeTaskMeta`; added a
    localizeLegacyData doc note confirming it's idempotent on v6 Polish data.
  - `src/store/selectors.ts` — removed `doneStatusId`; added `doneStatusIds`
    (Set, archived included) + `isDoneStatus`; switched `todayAgendaForPerson`,
    `overdueTasksForPerson`, `unplannedTasksForPerson` to `!doneIds.has(...)`
    and fixed their doc comments.
  - `src/pages/TimelinePage.tsx` — overdue tint now uses `doneStatusIds` (once
    per render); dropped the local last-active derivation and the now-unused
    `activeStatuses` import.
  - `src/store/AppStore.tsx` — Action union gains `SET_STATUS_DONE`; new pure
    helpers `isOnlyActiveStatus`/`isOnlyDoneStatus`; `saveStatus` creates with
    `isDone:false` and preserves it on rename; new `setStatusDone` +
    `setStatusArchived` with decision-5 guards; `deleteStatus` refuses only-
    active/only-done; reducer cases wired (no activity-log rows, per spec).
  - Tests (mechanical): `selectors.test.ts` (import + `makeStatus` default
    `isDone:false`, `doneStatusId` describe→`doneStatusIds`, renamed a local),
    `dateGuards.test.ts` (Status literal gets `isDone`), `storage.test.ts`
    (three hardcoded version assertions 6→7).
- **Tests run:** `npx tsc --noEmit` → 0 errors; `npm test` → 9 files / 320
  tests, all green (baseline preserved).
- **Deviations:** none from decisions 1–6. Test-suite touch stayed mechanical:
  the old `doneStatusId` describe block (tested the removed last-active rule)
  was converted in place to exercise `doneStatusIds` (3 tests kept, count
  unchanged at 320); one intentional doc-comment mention of the old
  `doneStatusId` name remains in `storage.ts` explaining the migration default.
- **Still broken / next:** nothing broken. Downstream packages unblocked:
  admin-ui (SET_STATUS_DONE + guard pre-validation UI), status-tests (deep
  migration/selector/guard coverage), browser-docs.
- **Reviewer P3 follow-up (doc-only, no behavior/tests):** updated
  `todayAgendaForPerson` doc comment (selectors.ts:295) to the `isDone`/
  `doneStatusIds` wording, and the `KanbanPage` header comment (KanbanPage.tsx:1)
  to mention the trailing "Zarchiwizowane" column. `npx tsc --noEmit` clean.

#### PKG-20260712c-status-admin-ui — developer/opus — DONE

- **Files changed:**
  - `src/pages/AdminPage.tsx` — added sibling helpers `isOnlyActiveStatus`/
    `isOnlyDoneStatus` (mirror the reducer guards); per-status `Ukończenie`
    checkbox after `StatusBadge` (dispatches `SET_STATUS_DONE`, disabled +
    Polish title when it's the only done status, `aria-label`
    `Status „{name}” oznacza ukończenie`); archive button now disabled with the
    two exact Polish titles when only-active / only-done (restore never
    disabled); delete button keeps the referenced-disable and adds only-active/
    only-done in the order referenced → only-active → only-done; extended the
    section blurb with the `Znacznik „Ukończenie”…` sentence.
  - `src/pages/KanbanPage.tsx` — extracted card JSX into a `renderCard` helper
    (identical markup); added a trailing read-only `Zarchiwizowane` column
    (class `kanban-col archived-col`) rendered only when ≥1 filtered project has
    an archived `statusId` (`archivedIds` set + `archivedProjects`, respects
    paid/client filters); count in the header, column `title` tooltip; cards
    stay draggable OUT; NOT a drop target (no `onDragOver`/`onDrop`); hidden when
    empty.
  - `src/components/TaskModal.tsx` — imported `getStatus`; the status select now
    appends the edited task's own archived status (`pickableStatuses`), labeled
    `{name} (zarchiwizowany)`, so an archived current value isn't a phantom.
  - `src/styles.css` — `.kanban-col.archived-col` (muted bg, dashed border,
    dashed muted head, no drag-over rules) and `.admin-status-done` (inline
    muted label + checkbox cursor states). Reused existing `--n2-*`/`--text-*`
    tokens, no new animation.
- **Note:** `src/pages/ProjectDetailPage.tsx` already implemented scope item 4
  (archived-current-status via `pickableStatuses` with the exact
  ` (zarchiwizowany)` suffix) from a prior run — left as-is, no change needed.
- **Selectors/classnames for the browser check:** admin done checkbox
  `.admin-status-done input[type=checkbox]` with `aria-label`
  `Status „{name}” oznacza ukończenie`; exact disabled titles per the package;
  kanban archived column `.kanban-col.archived-col` with header text
  `Zarchiwizowane` and its `title` tooltip; select option text suffix
  ` (zarchiwizowany)`. No `data-testid` added (text/title hooks sufficed).
- **Tests run:** `npm test` → 9 files / 332 tests, all green. `npx tsc --noEmit`
  → 0 errors in all files I touched; the only 2 tsc errors reported are unused
  imports (`isDoneStatus`, `reducer`) in `src/store/selectors.test.ts`, which is
  the concurrent status-tests worker's in-progress file — not part of this
  package and expected to resolve when they finish.
- **Deviations:** none. Kept every Polish string verbatim per the package.
- **Still broken / next:** nothing broken by this package. Browser-docs package
  can run: DOM hooks (Polish titles + `Zarchiwizowane` header) are in place.

#### PKG-20260712c-status-tests — test-writer/sonnet — DONE

- **Files changed:**
  - `src/store/storage.test.ts` — new describe `normalizeStatusFlags / v6→v7
    done semantics` (9 tests): default-to-last-by-order (via `loadData()`),
    last-by-order-archived → last-active becomes done, all-archived → last
    overall becomes done, zero statuses loads without crashing, a pre-set
    `isDone:true` on a non-last status is preserved untouched (both active and
    archived), idempotence of `normalizeStatusFlags` plus a full
    save→load→load round-trip via `loadData()`, and non-boolean garbage
    (`'yes'`, `1`, `null`) coercing to `false` then triggering the no-done
    default. Added local `makeRawStatus`/`v6Payload`/`makeStatus` helpers and
    the `normalizeStatusFlags`/`Status` imports.
  - `src/store/selectors.test.ts` — extended the `doneStatusIds` describe with
    an `isDoneStatus`-agreement case; three new describes: reordering via
    dispatched `REORDER_STATUS` (moves the done status to the FIRST pipeline
    slot) leaves `doneStatusIds` unchanged and the task stays excluded from
    `overdueTasksForPerson`/`unplannedTasksForPerson`/`todayAgendaForPerson`'s
    `dateless`; a done-AND-archived status excludes a task from all three of
    those same selectors; and the old-rule-is-gone case — a non-done status in
    the LAST pipeline position with a past `endDate` IS overdue. Added
    `isDoneStatus` and `reducer` (from `./AppStore`) imports (these resolve the
    admin-ui worker's noted transient unused-import tsc errors from the
    concurrent edit — both are now used).
  - `src/store/statusActions.test.ts` (new file) — reducer guard tests:
    `SET_STATUS_ARCHIVED` refused on the only-active and only-done status,
    succeeds on a used-but-not-only status (referencing project/task keep their
    `statusId`); `DELETE_STATUS` refused when referenced (by project, by task),
    only-active, only-done, and succeeds removing an unused/non-only/archived/
    non-done status; `SET_STATUS_DONE` full sequence (refuse turning off the
    only done status → allow turning on a second → both done → allow
    un-toggling the first → archiving the sole remaining done status now
    refused); `SAVE_STATUS` create defaults `isDone:false`, rename/recolor of a
    done status preserves `isDone:true`.
- **Implementation read first, no mismatches found:** `storage.ts`
  (`normalizeStatusFlags`, `DATA_VERSION=7`, `buildDefaultStatuses`,
  `loadData`), `selectors.ts` (`doneStatusIds`, `isDoneStatus`,
  `todayAgendaForPerson`, `overdueTasksForPerson`, `unplannedTasksForPerson`),
  `AppStore.tsx` (`saveStatus`, `setStatusDone`, `setStatusArchived`,
  `reorderStatus`, `deleteStatus`, `isOnlyActiveStatus`/`isOnlyDoneStatus`) all
  match the package spec exactly — every case in Scope §1–3 was traced against
  real code before being asserted, not guessed.
- **Tests run:** `npx tsc --noEmit` → 0 errors. `npm test` → 10 files / 343
  tests, all green (baseline was 9 files / 320 tests; +23, inside the
  documented 18–25 range; no regressions in the other 320).
- **Deviations:** none from scope. No production file touched.
- **Skipped/stubbed:** none — every case in the package's in-scope list is a
  real assertion.
- **Next:** browser-docs (PKG-20260712c-status-browser-docs) can proceed;
  nothing blocking.

#### PKG-20260712c-status-browser-docs — test-writer/sonnet — DONE

- **Files changed:**
  - `scripts/browser-check-status-semantics.mjs` (new) — one continuous
    Playwright flow (mirrors `browser-check-savetask-multiblock.mjs`'s
    single-flow structure, since checks (a)-(d) build on the same seeded
    state; only check (e) explicitly resets per the package): (a) exactly one
    seeded status has `isDone:true` and it's `Gotowe`; (b) reorder safety — a
    past-due, Kasia-assigned, `Gotowe`-status task fixture stays out of
    `Po terminie` on `/my-work` both before and after moving `Gotowe` up twice
    in `/admin` (aria-label `Przesuń Gotowe wcześniej`), and
    `doneStatusIds`/`isDone` on `Gotowe` survives the reorder while the new
    last-by-`order` status (`Akceptacja`) is confirmed NOT done; (c) archiving
    the in-use `W trakcie` status (archive button pre-checked enabled) makes
    it and its project surface in a trailing `.kanban-col.archived-col`
    header-texted `Zarchiwizowane`, with the card-count vs header-count
    cross-checked; (d) marking `Akceptacja` done too, then archiving `Gotowe`
    via the admin UI (button pre-checked enabled), does not revive the
    step-b task under `Po terminie`; (e) on a freshly cleared+reseeded state,
    `Gotowe`'s `Ukończenie` checkbox and archive button are disabled with the
    two exact Polish guard titles from the package, then both re-enable after
    toggling `Akceptacja`'s `Ukończenie` checkbox on; (f) zero `pageerror`
    events across the whole flow. Scoped locators via
    `li.admin-status` filtered on the name input's
    `Nazwa statusu ${name}` aria-label (stable across DOM reorders); overdue
    check via `.my-work-alert-group` filtered on its `Po terminie` `h3`,
    tolerant of the group being absent entirely. 4 screenshots/engine in
    `reviews/screenshots-20260712-status/` (`b-admin-reorder`,
    `c-kanban-archived`, `d-mywork-no-revive`, `e-admin-guard`).
  - `CLAUDE.md` — Architecture bullet: "done" rule now describes
    `doneStatusIds`/`isDoneStatus` (archived-inclusive, order/archival-
    independent), dropped the `doneStatusId`/"last active status" wording.
    Storage bullet: `version: 6` → `version: 7`; added `normalizeStatusFlags`
    next to `normalizeDates`/`ensureStartMinutes`/task-meta normalization
    (worded to avoid the literal removed-rule phrase per the acceptance
    check, while still explaining the migration default). Data model:
    `Status` line gains `isDone`; new hard-invariant 9 (sole active + sole
    `isDone` status always exist; reducer refuses violating archive/delete/
    untoggle; admin UI pre-validates with Polish titles). Kanban bullet: notes
    the trailing `Zarchiwizowane` column (drag-out only, not a drop target,
    hidden when empty). Admin bullet: notes the `Ukończenie` toggle and
    guard-disabled controls with Polish titles. Manual checklist: extended
    item 6 (archived-in-use status surfaces in `Zarchiwizowane`) and item 10
    (reorder doesn't change completion; guard disable/re-enable; TaskModal/
    ProjectDetail `(zarchiwizowany)` suffix).
  - `handoffs/RUN-STATE.md` — this entry.
- **Read-before-write:** confirmed against real code, not guessed —
  `AdminPage.tsx` (`Ukończenie` checkbox aria-label + the two exact disabled
  titles, archive/delete buttons), `KanbanPage.tsx` (`archived-col`, header
  text, drag-out-only), `selectors.ts` (`doneStatusIds`/`isDoneStatus`,
  `overdueTasksForPerson`), `storage.ts` (`DATA_VERSION=7`,
  `normalizeStatusFlags`), `AppStore.tsx` reducer guards, `seed.ts` (Kasia is
  `people[0]`, passwordless, `accessRole:'administrator'`,
  `currentUserId: kasia.id` — so `LOAD_SAMPLE` signs her in directly, no
  login-screen hop needed in the happy path). Noted but out of scope: the
  existing local-login/access-role system (`LoginPage.tsx`, `permissions.ts`)
  predates this package and isn't mentioned by CLAUDE.md's "no auth" bullet —
  a pre-existing doc/code drift outside this package's scoped edit list, left
  untouched per "no rewriting unrelated CLAUDE.md sections."
- **Checks run:**
  - `node scripts/browser-check-status-semantics.mjs` (chromium) — 19/19 PASS.
  - `node scripts/browser-check-status-semantics.mjs webkit` — 19/19 PASS.
  - `npx tsc --noEmit` → 0 errors.
  - `npm test` → 10 files / 343 tests, all green (unchanged from baseline —
    no production or test file touched).
  - `grep -noi "doneStatusId([^s]|$)|last active status" CLAUDE.md` → no
    matches (confirms the acceptance-criteria grep is clean).
- **Deviations:** none from scope. Dev server was already running on :5173
  (reused, no in-process vite server needed). No production `src/` file
  touched.
- **Skipped/stubbed:** none.
- **Next:** nothing blocking. Orchestrator end-of-run gate (tsc + test +
  build + this browser script + Codex review) can proceed.

### Reviewer verdict — 2026-07-12 (recorded by orchestrator; reviewer has no Write)

**Status: APPROVE** (P3 nits only, none blocking)

**Codex second opinion:** SKIPPED — `scripts/codex-review.sh` denied by the
unattended session permission profile (same as release-hardening-1 and -2).
Verdict rests on the reviewer's own structural read of every changed file.

**Independently re-verified:** `npx tsc --noEmit` → 0 errors;
`npm test -- --run` → 10 files / 343 passed / 0 failed. 8 screenshots
(4 × chromium, 4 × webkit) present in `reviews/screenshots-20260712-status/`.
Playwright script not re-run by the reviewer (dev-server outside its
read-only allowance) — relied on the worker's 19/19 PASS × 2 engines plus a
read of the script's assertions.

**Acceptance criteria — all PASS (verified in code, not worker claims):**
1. Reorder cannot change completion — `reorderStatus` only permutes `order`;
   `doneStatusIds` reads only `isDone`; straggler grep for `doneStatusId[^s]` /
   `slice(-1)` / "last active" is clean of logic (doc comments only). The one
   remaining last-active computation is the deliberate migration default in
   `normalizeStatusFlags`, which reproduces the old rule exactly (incl.
   array-order tie-breaking).
2. Archiving neither hides nor revives — `doneStatusIds` spans archived
   statuses; Kanban `Zarchiwizowane` column is drag-out-only (no
   onDragOver/onDrop), hidden when empty; TaskModal/ProjectDetailPage append
   only the entity's own archived status with the exact ` (zarchiwizowany)`
   suffix.
3. Migration — DATA_VERSION 7; `normalizeStatusFlags` in both `loadData`
   branches; coercion-first then default; idempotent; zero-statuses /
   all-archived / garbage-value edges implemented and covered by real tests.
4. Guard ↔ UI parity — AdminPage disable predicates mirror the reducer
   refusal predicates exactly (archive, delete reason-order referenced →
   only-active → only-done, done-untoggle); no UI path dispatches a silently
   rejected action.
5. Polish strings verbatim per package and grammatical.
6. Conventions/invariants hold; no scope creep (no project-card formal/sales
   fields; SET_TASK_STATUS/SET_PROJECT_STATUS, seed, block model untouched).
7. Test coverage adequate — full guard matrix, the critical negative case
   (non-done last-position status IS overdue), every migration edge.

**Nits (P3):**
1. Stale doc comment `src/store/selectors.ts:296` ("the last active status")
   — ROUTED back to the core developer along with nit 4 (one-line fixes).
2. CLAUDE.md invariant 9 slightly overstates load-time guarantees: a
   hand-edited all-archived payload is repaired for `isDone` but not
   unarchived; on such a payload Kanban shows the empty state (archived
   column lives in the non-empty branch). Unreachable via UI → carried
   backlog.
3. The 6→7 bump makes `localizeLegacyData` run once more on v6 payloads — a
   custom status literally named `Done`/`To do` etc. would be renamed to
   Polish. Pre-existing pattern of every version bump, idempotent on Polish
   data → informational, no action.
4. `KanbanPage.tsx:1-3` header comment omits the archived column — ROUTED
   with nit 1.

**Routing:** nits 1+4 routed to the core developer (comment-only edits);
nits 2–3 → carried backlog. Standing carried-over item (human browser
walkthrough) extends to this run's checklist items 6 and 10 additions.

### End-of-run gate results — 2026-07-12 (orchestrator, fresh runs AFTER the nit fixes)

- `npx tsc --noEmit` — 0 errors.
- `npm test -- --run` — 10 files / 343 passed / 0 failed.
- Production build — green via `node -e "import('vite').then(v => v.build())"`
  (only the pre-existing >500 kB chunk-size warning).
- Browser gate — `scripts/browser-check-status-semantics.mjs`:
  **Chromium PASS 19/19, WebKit PASS 19/19** (done-set invariant; reorder
  keeps completion; archived used status surfaces in the `Zarchiwizowane`
  kanban column with matching counts; archiving a done status doesn't revive
  overdue work; only-done guards disable with the exact Polish titles and
  re-enable after a second done status; zero page errors). Screenshots (8) in
  `reviews/screenshots-20260712-status/`. Dev server on :5173 reused.
- Codex review — SKIPPED (`scripts/codex-review.sh` denied by the unattended
  permission profile; same as release-hardening-1 and -2).
- Reviewer verdict — APPROVE (above); routed nits 1+4 fixed by the core
  developer (comment-only, tsc re-verified clean) before this gate ran.
- Architect final eval — folded into the reviewer verdict (zero required
  changes); no separate pass needed.
- **Commit/push — BLOCKED:** all `git` commands are denied in this unattended
  session (verified again this run). Work left uncommitted on
  `review/claude-auto-20260712-1427`; committing + pushing is the next human
  (or git-enabled session) action.

**Run complete** (pending commit). New backlog carried: CLAUDE.md invariant 9
overstates load-time guarantees for hand-edited all-archived payloads (P3);
6→7 bump re-runs `localizeLegacyData` once on v6 payloads — English-named
custom statuses get localized (P3, informational, pre-existing pattern).
