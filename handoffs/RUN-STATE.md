# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 "Unassigned bin + block split + sidebar collapse";
> 2026-07-08 "Walkthrough fixes"; 2026-07-08 "Hour budget + block merging ·
> accounts/roles/permissions · sidebar icon fix" — APPROVED, committed as
> ff4fd8a) are archived in the git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of the
> approved runs' interactive criteria (role matrix per role, budget clamp +
> merge animation, availability math, restricted insert picker, workday fill);
> (b) commit hygiene — untracked `automation/`, modified `.gitignore`;
> (c) CLAUDE.md refresh (login/roles/permissions, budget/bin invariants,
> availability semantics, week-view panes) — human task, not a worker package.
> **Carried backlog (non-blocking):** Codex #5 `workDays: []` 0%-vs-overload
> display; pre-existing `insertBlock` end-of-day clamp overlap; status archive
> hides projects from Kanban; `toQuarters` placement (→ utils/time.ts); v4
> payload with zero administrators (promote-first-person idea). The "unsnapped
> `estimatedHours`" backlog item is FIXED by this run (PKG-…-b2-calendar-ui).

---

## Run: 2026-07-08 — Bug-fix round 2: budget minting holes · bin drag ghost · impersonation trap

### Plan (architect)

- **Goal:** Fix three user-reported, orchestrator-verified bugs. (1) Hours can
  still be minted past the task budget through every non-drag path
  (AllocationGrid/SAVE_TASK, "Wypełnij dni robocze", "Dodaj do zasobnika",
  INSERT_BLOCK) and unlimited drag-grow on `estimatedHours: null` tasks —
  calendar-side paths must never create hours; TaskModal becomes the sole,
  warned, deliberate over-planning surface. (2) Dragging a card out of the bin
  pane renders it invisible (overflow clipping of the translated card) — the
  drag ghost must escape the pane. (3) "Występuj jako" is a self-demotion
  trap: an admin who picks a non-admin loses the switcher itself — separate the
  logged-in identity from the acted-as identity with a persistent return
  banner.

- **Key decisions (pre-resolved — details in the packages, no open questions):**
  - **Unified budget allowance** for a (task, person):
    `bin hours + (estimate === null ? 0 : headroom)` — `growAllowanceHours`
    never returns null anymore; `estimatedHours: null` tasks get bin-conserving
    drag-grow (bin only, nothing minted). `INSERT_BLOCK` enforces the same
    allowance with bin-first draw (mirrors `SET_BLOCK_TIME`). Moves and
    shrinks are never budget-checked.
  - **TaskModal stays uncapped at the store level** (SAVE_TASK/newUnassigned):
    it is the deliberate re-planning surface — instead it gets a live,
    non-blocking `Przekroczono szacunek o X` banner + danger-tinted totals,
    and the insert form gets a live warning + disabled `Wstaw` past the
    allowance. Estimate now snaps to 0.25 on save (closes a reviewer backlog
    item; no 24h clamp).
  - **Bin drag ghost**: `position: fixed` portal to `document.body` following
    the pointer (grab-offset preserved), `pointer-events: none`, keeps the
    colliding danger tint; the in-pane source card stays mounted (pointer
    capture intact) and dims. Drop math unchanged.
  - **Impersonation**: additive `AppData.impersonatorId: string` ('' = not
    impersonating; NO version bump — defaulted + sanitized on every load like
    `ensureStartMinutes`). New `IMPERSONATE`/`STOP_IMPERSONATION` actions;
    login/LOGOUT clear it; chained switches preserve the original real user;
    DELETE_PERSON interplay handled. Permissions are a TRUE PREVIEW (follow
    the acted-as identity; comments keep signing as acted-as); ONLY the
    switcher visibility and the return banner key off the real user
    (`realUserId` selector). Switcher loses the `—` option; persistent
    warning banner `Występujesz jako … — Wróć do …` above SampleBanner.

- **Packages** (sequential — 2 and 3 both touch styles.css; 4 needs 1+3):
  1. `handoffs/packages/PKG-20260708-b2-budget-store.md` — tier: developer —
     reducer/selector budget enforcement (`taskGrowAllowance`,
     null-estimate grow cap, INSERT_BLOCK draw/reject) + mechanical
     existing-test adaptations.
  2. `handoffs/packages/PKG-20260708-b2-calendar-ui.md` — tier: developer —
     insert-form warning/disable, TaskModal over-budget banner + estimate
     snap, bin drag ghost portal (depends 1).
  3. `handoffs/packages/PKG-20260708-b2-impersonation.md` — tier: developer —
     impersonatorId model + actions + selectors + switcher/banner UI
     (depends 2 for styles.css ordering only).
  4. `handoffs/packages/PKG-20260708-b2-tests.md` — tier: test-writer —
     20 case groups across blockActions/selectors/storage tests
     (depends 1 + 3; test files only).

- **Gates:** `npx tsc --noEmit` + `npm test` + `npm run build` green after
  every package (baseline 157/157; dev server already running on 5173 — nobody
  starts a second one). Reviewer verdict after all packages; human browser
  walkthrough items collected from worker reports.
- **Open questions:** none. Post-run human note: CLAUDE.md refresh must now
  also cover the no-mint budget rule, impersonatorId session model, and the
  banner (folds into carried-over item c).

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-08 · developer · `PKG-20260708-b2-budget-store`

- **Changed:**
  - `src/store/selectors.ts` — added exported `taskGrowAllowance(state, taskId, personId): number` (bin hours + headroom, headroom 0 for null-estimate); rewrote `growAllowanceHours` to delegate and return `number` (dropped `| null`, updated JSDoc).
  - `src/store/AppStore.tsx` `setBlockTime` — grow enforcement now applies to ALL tasks (removed `estimatedHours !== null` gate); null-estimate ⇒ `headroomQ = 0`, so grow is bin-only. Bin-first draw and activity suffixes unchanged.
  - `src/store/AppStore.tsx` `insertBlock` — added no-mint budget check for `(payload.taskId, ref.personId)` after the hours snap; rejects (same state ref) when snapped hours > bin+headroom; drains the same-task bin row bin-first (delete at 0) on the `shifted` array, adds `dayKey(ref.personId, BIN_DATE)` to the reindex set, and appends `; pobrano z zasobnika: …` to the activity message when drawn.
  - `src/components/WeekView.tsx` (~L163) — mechanical: `growAllowanceHours` no longer returns null; `maxHours = baseHours + growAllowanceHours(...)`, stale null comment fixed. No other WeekView changes (belong to calendar-ui pkg).
  - `src/store/blockActions.test.ts` — gave the 5 INSERT_BLOCK fixtures (~L221-311) an `estimatedHours: 10` on `t2` so the no-mint rule draws from headroom instead of rejecting (preserves ripple/push, auto-assign, gap, other-people intent); rewrote the `estimatedHours: null grows freely…` regression (~L854) to the new contract (grow succeeds up to the 3h bin drained/deleted, rejected at +3.25h). INSERT_BLOCK bin-reject test (L700) and cross-task/person merge tests (L1001+) untouched (early-return / move paths, unaffected).
  - `src/store/selectors.test.ts` — rewrote the null-estimate `growAllowanceHours` case to expect `0` (a number, not null); added a companion case: null-estimate with a 3h bin row ⇒ allowance `3`.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean; vitest **158 passed** (was 157; +1 from the added null-estimate-with-bin selector case); build OK (pre-existing >500 kB chunk warning only).
- **Still broken:** nothing.
- **Next:** ready for `PKG-20260708-b2-calendar-ui` (WeekView insert-form warning/disable, TaskModal banner, bin drag ghost) — this package left WeekView otherwise untouched as specified.

#### 2026-07-08 · developer · `PKG-20260708-b2-calendar-ui`

- **Changed:**
  - `src/components/WeekView.tsx` — insert form: added `insertAllowance`/`overAllowance` (via `taskGrowAllowance(state, insertTaskId||menu.entry.taskId, menu.entry.personId)`, recomputes on task-select change), second `context-warning` line (0-allowance vs "najwyżej {allowance}" variants), and `overAllowance` folded into the `Wstaw` disable + a matching guard in `confirmInsert` (blocks Enter past budget). BinCard rewritten to a fixed-position drag ghost: `BinDragState` now tracks `clientX/clientY`, grab offset (`grabX/grabY`) and captured `width`; the in-pane original keeps all handlers + pointer capture and gets a `drag-source` (dimmed) class, while a `createPortal(..., document.body)` ghost (`week-bin-ghost`, `pointer-events:none`, keeps `colliding` tint) follows the pointer. Old `dx/dy` transform removed. Added `react-dom` `createPortal` + `taskGrowAllowance` imports.
  - `src/components/TaskModal.tsx` — estimate now snaps on save (`snapHours`, no clamp; empty/invalid/≤0 ⇒ null). Added `draftTotal`/`overBudget` (plannedTotalAll + binTotal vs parsed estimate); live non-blocking `estimate-over` banner under `.estimate-compare` + `over-budget` class on the "zaplanowano" strong. Saving stays allowed. Added `snapHours` import.
  - `src/styles.css` — `.estimate-compare strong.over-budget` (danger text), `.estimate-over` (danger-soft banner), `.week-bin-block.drag-source` (0.35 opacity), `.week-bin-ghost` (fixed, z-index 1000, pointer-events none, transition none, violet shadow).
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean; vitest **158 passed** (no test changes — interaction-only pkg); build OK (pre-existing >500 kB chunk warning only).
- **Still broken:** nothing.
- **Deviations:** none from the package. Added a `confirmInsert` budget guard (not explicitly listed) so the Enter-key path matches the disabled `Wstaw` button; harmless (reducer already rejects).
- **Needs human/browser walkthrough** (not CLI-verifiable): (1) insert form warning text + disabled Wstaw at/over allowance incl. 0-allowance variant, and task-select recompute; (2) TaskModal over-budget banner + danger total appears/clears live as grid/bin/fill change, save still works; snapped estimate persists (40.1→40); (3) bin card ghost stays visible across the whole viewport (grid/header/axis), shows danger tint over a colliding slot, drops as before, snaps home on Escape/invalid, source card dims, plain click still opens the task; console clean.
- **Next:** ready for `PKG-20260708-b2-impersonation` (depends on this for styles.css ordering).

#### 2026-07-08 · developer · `PKG-20260708-b2-impersonation`

- **Changed:**
  - `src/types.ts` — `AppData.impersonatorId: string` field ('' = not impersonating; the real user's id while `currentUserId` is impersonated) + doc comment. No version bump.
  - `src/store/storage.ts` — `emptyData()` and `migrateV1`'s return include `impersonatorId: ''`; new exported `sanitizeImpersonator(data)` (clears to '' when dangling or === currentUserId) applied on BOTH `loadData` return paths (v1-migration + same-version), after ensureStartMinutes. Idempotent, disjoint fields.
  - `src/store/AppStore.tsx` — Action union gains `IMPERSONATE { personId }` and `STOP_IMPERSONATION`; cases per decision 2 (no-op on missing/self; picking impersonator's own row = return; chained switches preserve the ORIGINAL real user via `impersonatorId || currentUserId`; STOP no-op at ''). `SET_CURRENT_USER` and `LOGOUT` both clear `impersonatorId` to '' (LOGOUT clears both ids). `deletePerson` interplay (decision 3): deleting the impersonated person returns session to impersonator; deleting the impersonator clears bookkeeping, keeps acted-as. No activity rows.
  - `src/store/selectors.ts` — exported `realUserId`, `realUser`, `isImpersonating` (pure, JSDoc).
  - `src/App.tsx` — switcher gated on `can(actualUser=realUser, 'users.impersonate', …)` so it never vanishes for the admin; `onChange` dispatches `IMPERSONATE`; removed the `"—"` empty option; `value={state.currentUserId}` unchanged. New warning-toned `impersonation-banner` above `<SampleBanner />`, rendered only when `isImpersonating && currentUser && actualUser`, with `Wróć do {realUser.name}` → `STOP_IMPERSONATION`.
  - `src/store/seed.ts` — sample object literal gains `impersonatorId: ''` (tsc).
  - `src/styles.css` — `.impersonation-banner` (+ `-text`, button) with `--n2-warning` tokens and a ≤760px stacked layout.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean; vitest **158 passed** (no test changes needed — `makeState` spreads `emptyData()`, and storage.test's v4Payload is a `Record<string, unknown>`; new coverage belongs to PKG-…-b2-tests); build OK (pre-existing >500 kB chunk warning only).
- **Still broken:** nothing.
- **Deviations:** none. (Banner text uses the gender-neutral variant `— aktywne są uprawnienia tej osoby.` per decision 7's option.)
- **Needs human/browser walkthrough** (not CLI-verifiable): (1) admin picks Marek → nav/admin gate + block gating collapse to Marek, switcher STAYS visible, banner shows, `Wróć do {admin}` restores in one click; (2) chained admin→Marek→Ola returns to the ORIGINAL admin; (3) comment posted while impersonating is signed by the impersonated person; (4) reload mid-impersonation restores both identities; a dangling/self impersonatorId clears on load; (5) LOGOUT lands on login and clears both ids, re-login never impersonated; (6) delete the impersonated person → session returns to impersonator; delete the impersonator → bookkeeping clears; (7) non-admin never sees the switcher; (8) no `—` option; banner usable ≤760px.
- **Next:** ready for `PKG-20260708-b2-tests` (test-writer) and the reviewer verdict.

#### 2026-07-08 · test-writer · `PKG-20260708-b2-tests`

- **Changed (test files only, no implementation touched):**
  - `src/store/blockActions.test.ts` — added: 5 `it`s for `SET_BLOCK_TIME` grow on unbudgeted (`estimatedHours: null`) tasks (partial/full bin drain + `pobrano z zasobnika`, reject past bin with no headroom, reject cross-task/cross-person bin rows, move-only never rejected, shrink creates/merges a bin row); 5 `it`s for `INSERT_BLOCK` budget (headroom-only within/past, bin-first draw with headroom remainder, exact-allowance boundary ±0.25h, unbudgeted insert ≤/>bin, picker task ≠ ref task uses the selected task's allowance); 5 `it`s for the impersonation reducer (`IMPERSONATE` set/no-op-missing/no-op-self, chained-impersonation preserves the original + return-via-own-row, `STOP_IMPERSONATION` restore/no-op, `SET_CURRENT_USER`+`LOGOUT` both clear `impersonatorId`, `DELETE_PERSON` of the impersonated person vs. the impersonator).
  - `src/store/selectors.test.ts` — added `taskGrowAllowance` import + 4 `it`s (null-estimate bin-only, estimate sums bin+headroom, over-planned floors headroom at 0 while bin still counts, no entries ⇒ 0); `growAllowanceHours` number-contract 2 `it`s (typeof number, missing entry id ⇒ 0); `realUserId`/`realUser`/`isImpersonating` imports + 2 `it`s (not impersonating ⇒ self/false, impersonating ⇒ impersonator id/true).
  - `src/store/storage.test.ts` — added an `impersonatorId persistence` describe with a local `v5Payload` builder + 5 `it`s: missing field defaults to `''`, valid id round-trips, dangling id sanitized to `''`, id === currentUserId sanitized to `''`, idempotent reload.
- **Tests:** `npx tsc --noEmit && npm test` → tsc clean; vitest **186 passed** (was 158 baseline; +28 new tests, 0 removed/modified existing assertions). `git status --short` confirms only the three test files changed by this package (the pre-existing implementation-file diffs are from the three developer packages already landed).
- **Bugs found:** none — every new assertion passed against the shipped `AppStore.tsx`/`selectors.ts`/`storage.ts` behavior once the fixtures were corrected (see below); no spec-vs-implementation mismatch to report.
- **Self-corrections during authoring** (test math errors, not implementation bugs): (1) an `INSERT_BLOCK` "exact allowance" fixture first assumed `allowance = estimate + bin`, forgetting `taskBudget.totalAll` already includes the bin row's hours — headroom nets the bin out, so `allowance` for a task with no *other* planned hours simply equals the estimate; rebuilt the fixture with a second person's dated entry so bin+headroom compose to a value below the estimate, matching the package's intent. (2) a `taskGrowAllowance` "no entries at all ⇒ 0" case initially used `estimatedHours: 10`, which correctly yields `headroom = 10` (not 0) — changed to `estimatedHours: null` to match the stated expected value.
- **Skipped/stubbed:** none — all 20 case groups implemented with behavioral assertions.
- **Next:** ready for reviewer verdict (all 4 packages of this run now closed).

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

## Reviewer verdict (bug-fix round 2)

- **Status:** CHANGES-REQUIRED (one low-severity blocker; everything else clean — re-review can be a fast delta check)
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean · vitest **186/186** · `npm run build` OK (pre-existing >500 kB chunk warning only).

### Blockers

1. **[P2 · developer tier · `src/components/TaskModal.tsx:481-485`]** Estimate
   normalization checks `estRaw <= 0` BEFORE snapping, so positive inputs in
   (0, 0.125) — e.g. `0.1` — persist as `estimatedHours: 0` instead of `null`,
   contradicting the code's own comment ("non-positive input clears it back to
   null"). A 0-estimate task has `taskGrowAllowance = bin only` ⇒ all calendar
   inserts/grows blocked and the over-budget banner shows permanently — the
   exact trap class this run exists to close. Fix (one line, snap-then-clear):
   `const snapped = snapHours(estRaw); estimatedHours = empty || NaN || snapped <= 0 ? null : snapped;`
   and reuse the normalized value for the live comparison (see nit 1). Note:
   the worker was FAITHFUL to the package's literal formula — the spec carried
   the bug; route as a micro-fix to the developer, no design decision needed.

### Nits (non-blocking; recommend folding into the same fix pass)

1. `TaskModal.tsx:519,541` — `overBudget` compares `draftTotal` against the RAW
   `estNum` while save persists the snapped value: typing `1.13` with `1.25`
   planned shows a false over-budget banner that vanishes after save. Derive
   one normalized estimate used for save, display, and `overBudget`.
2. `WeekView.tsx:704,761-771` — the insert form checks raw `hoursRaw` against
   the allowance before reducer-equivalent snapping: `1.01` is blocked though
   the reducer would snap to `1.0` and accept. Verified over-strict ONLY —
   `snapHours` is monotone and the allowance is always a quarter multiple, so
   the form can never let through what the reducer rejects. UX polish, not a
   safety hole.

### Codex findings (reviews/2026-07-08-215302-codex-review.md) — adjudicated

- **#1 (P2, TaskModal estimate 0.1→0):** ACCEPTED → blocker 1. Verified in code.
- **#2 (P3, banner vs snapped estimate):** ACCEPTED → nit 1. Verified.
- **#3 (P3, insert form raw-hours check):** ACCEPTED → nit 2. Verified, and
  confirmed the mismatch is one-directional (over-strict), so no reject-path bypass.
- Nothing dismissed; Codex missed nothing material in the store/impersonation diff.

### PopChild console warning — root-caused, DISMISSED as a this-round defect

The dev-mode warning "PopChild: `ref` is not a prop" is NOT from the new bin
drag ghost: the ghost is a plain portaled `<div>` with zero motion/
AnimatePresence involvement. Root cause is framer-motion 12 internals —
`PresenceChild` always wraps AnimatePresence children in `PopChild`, whose
React-19 compat shim reads `children.props?.ref` (PopChild.mjs:61), which
React 18.3 dev mode warns about whenever a direct AnimatePresence child
carries a `ref`. The trigger here is the context menu's
`<motion.div ref={menuRef}>` (WeekView), present at the ff4fd8a baseline
(line 897) — pre-existing, dev-only, zero prod impact. → **Backlog:** bump
`motion` when a fixed release lands, or move `menuRef` to an inner wrapper.
The orchestrator's attribution to the ghost path is corrected.

### Convention check — PASS

Polish UI strings throughout; localStorage stays confined to `storage.ts`
(`sanitizeImpersonator` follows the `ensureStartMinutes` every-load pattern,
additive field, no version bump per plan); budget math in integer quarters
(`toQuarters`); activity rows appended in-action (`pobrano z zasobnika`
suffix on INSERT_BLOCK); `--n2-warning`/`--n2-danger` tokens; ≤760px banner
layout; ghost has `transition: none` + `pointer-events: none` (reduced-motion
safe); week grid `user-select: none` untouched; no new dependencies
(`createPortal` from existing react-dom).

### Test coverage — ADEQUATE

All 20 planned case groups landed as behavioral assertions (reject paths use
same-reference `toBe(state)`; bin drain values, activity suffixes, chained
impersonation, DELETE_PERSON interplay, storage sanitize + idempotence).
Accepted gaps: component-level UI (insert-form warning, TaskModal banner/snap,
ghost, impersonation banner) — verified live by the orchestrator and listed
for the human walkthrough, consistent with repo practice. Blocker 1's fix
needs no new unit test (component layer), but the fixed formula should keep
the "empty/invalid/≤0 ⇒ null" contract stated in its comment.

### Faithfulness

All 4 packages match the architect's decisions; the single declared deviation
(`confirmInsert` Enter-path budget guard) is harmless and correct. Live
orchestrator verification of budget warning/disable, ghost visibility/drop,
and impersonation banner/return accepted as input; the two scripted-pointer
quirks are consistent with synthetic-event artifacts given the code reads
(pointer-capture + real `clientX/Y` driven state).

### Fix round (post-review, bug-fix round 2)

#### 2026-07-08 · developer · review-fix (P2 blocker + 2 P3 nits)

- **Changed:**
  - `src/components/TaskModal.tsx` — **P2**: replaced the snap-after-check estimate
    normalization with a single component-scope `normalizedEstimate` (snap FIRST
    via `snapHours`, then clear to null when empty/invalid/`<= 0` after snapping),
    so inputs in (0, 0.125) — e.g. 0.1 → snaps to 0 → null instead of persisting a
    0-budget task. **P3 nit 1**: removed the raw `estNum` and routed save
    (`draft.estimatedHours`), the `overBudget` comparison, the `vs szacunek`
    display, and the over-budget banner delta all through `normalizedEstimate` —
    banner/display/save can no longer disagree (no transient false banner).
  - `src/components/WeekView.tsx` — **P3 nit 2**: added `snapHours` import; the
    insert form now computes `parsedHours = snapHours(Math.min(24, rawHours))`
    once (reducer-equivalent) and reuses it for `projectedTotal`/`wouldOverload`,
    `overAllowance`, the `Wstaw` disabled state, and `confirmInsert` (which now
    reuses `parsedHours`/`overAllowance` instead of re-reading raw `hoursRaw`), so
    e.g. 1.01 snaps to 1.0 and is accepted like the reducer would.
- **Tests:** `npx tsc --noEmit && npm test && npm run build` → tsc clean; vitest
  **186 passed** (baseline unchanged); build OK (pre-existing >500 kB chunk
  warning only). No new tests: the snap-then-clear rule lives inline in the
  component (UI-only), and the insert-form snap mirrors the already-tested
  reducer path — no pure function was added, per package note.
- **Deviations:** none.
- **Needs human/browser walkthrough** (not CLI-verifiable): (1) TaskModal — type
  `0.1` into Szacowane godziny, save, reopen → estimate is empty (null), calendar
  inserts/grows for that task are NOT blocked; (2) type `1.13` with 1.25h planned
  → over-budget banner does NOT appear (normalized to 1.25 == planned); (3) insert
  form — `1.01` against a 1.0 allowance → `Wstaw` enabled and Enter inserts (snaps
  to 1.0), while `1.5` against 1.0 stays disabled with the allowance warning.
- **Next:** ready for reviewer delta re-check.

### Reviewer verdict — delta re-check (bug-fix round 2, final)

- **Status:** APPROVE (blocker + both nits resolved; run is done pending the
  human walkthrough items already collected above)
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean · vitest **186/186** ·
  `npm run build` OK (pre-existing >500 kB chunk warning only).
- **Delta verified in code:**
  - Blocker 1 FIXED — `TaskModal.tsx:470-472` derives `normalizedEstimate`
    snap-first (`snapHours` then clear to null when NaN/`<= 0`), so `0.1` →
    snap `0` → `null` (no more persisted 0-budget task); negative input also
    lands on null.
  - Nit 1 FIXED — `normalizedEstimate` is the single source for save (:496),
    `overBudget` (:542), the `szacunek` display (:665-667), and the banner
    delta (:676); raw `estNum` removed — no transient false banner possible.
  - Nit 2 FIXED — `WeekView.tsx:765-766` computes
    `parsedHours = snapHours(Math.min(24, rawHours))` once, reused by the
    overload preview (:768), `overAllowance` (:775-776), the `Wstaw` disable
    (:1085), and `confirmInsert` (:708-716), which now dispatches the snapped
    `parsedHours` — form and reducer can no longer disagree in either direction.
- **Scope check:** diff limited to the two components; no store/selector/test
  changes; no new deps; Polish strings intact. No new tests required (UI-only,
  reducer path already covered) — agreed.
- **Carried backlog (unchanged):** framer-motion PopChild dev-only ref warning
  (library-internal, pre-existing — bump `motion` or move `menuRef` inward);
  plus the previously listed carried items.
- **Human walkthrough additions from the fix round:** TaskModal `0.1` estimate
  → reopens empty (null), task not insert-blocked; `1.13` vs 1.25h planned →
  no banner; insert form `1.01` vs 1.0 allowance → enabled and inserts 1.0,
  `1.5` vs 1.0 → disabled with warning.
