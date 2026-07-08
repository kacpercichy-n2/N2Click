# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

---

## Run: 2026-07-08 — Unassigned bin + block split + sidebar collapse

### Plan (architect)

- **Goal:** (1) Per-person "Zasobnik" (bin) of dateless workload entries,
  rendered as an 8th column in the calendar week grid behind horizontal scroll
  (Mon–Fri fill the visible width, weekend + bin scroll in from the right);
  bin blocks drag onto the grid (assign date+time) and grid blocks drag into
  the bin; the task editor can add hours to the bin. (2) Context-menu split
  (halves/quarters — split-off parts become bin entries) and calendar-resize
  shrink returns the freed hours to the bin. (3) Sidebar collapse to ~80px
  (icon-only) with a persisted, device-local preference.
- **Key decisions (pre-resolved, no open questions):**
  - **Sentinel, no migration:** `WorkloadEntry.date === ''` (`BIN_DATE`) means
    unassigned. `DATA_VERSION` stays 4 — the JSON shape is unchanged and no v4
    payload contains `''`; the idempotent `ensureStartMinutes` pass is extended
    instead (bin entries → `startMinutes: 0`, contiguous per-bin `sortIndex`;
    bin groups excluded from the 08:00 stacking rule).
  - Bin invariants: `startMinutes: 0`; `sortIndex` contiguous per
    `(personId, '')` (invariant 7 extends naturally — `dayKey(person, '')`
    already works in `reindexDays`/`nextSortIndex`). Bin hours count in
    task/project/person TOTALS but never in any per-date total or overload
    (all day math filters by exact date equality — audited: selectors,
    AllocationGrid, Dashboard/Workload/PersonProfile pages all safe untouched).
  - Actions: `MOVE_BLOCK_TO_BIN {entryId}`; `SPLIT_BLOCK {entryId, parts: 2|4}`
    (quarter-unit distribution, largest part stays scheduled on the original
    entry: 1.25h halved → 0.75 stays + 0.5 to bin; min 0.25h/part else reject);
    `DELETE_BLOCK {entryId}` (bin entries only, behind confirm in the UI);
    `SET_BLOCK_TIME` gains shrink-to-bin (hours reduced ⇒ delta becomes a bin
    entry — this makes "return to bin" calendar-resize-only by construction;
    editor edits via SAVE_TASK never create bin entries; growing never consumes
    bin hours) and already handles bin→grid drops (period extension + 92-day
    cap apply). `SaveTaskPayload.newUnassigned` appends bin entries; SAVE_TASK's
    rebuild passes existing bin entries through untouched (drops them only when
    the person is unassigned) — this also means bin entries are exempt from the
    known pre-existing `personId|date` collapse issue, which stays unfixed.
  - Guards: MOVE_TASK skips bin entries; SET_TASK_DATES keeps them;
    INSERT_BLOCK rejects a bin ref; REASSIGN_ENTRY appends to the target bin.
  - Week grid: 52px axis + 8 equal columns; grid width
    `calc((100% - 52px)/5*8 + 52px)` inside a horizontally scrollable wrapper;
    axis sticky-left. Bin column = stacked per-person cards (not
    time-positioned), week-independent. Context menu is one component, mode by
    `isBinEntry`. Polish strings fixed in the packages ("Zasobnik",
    "Podziel na pół", "Podziel na ćwiartki", "Usuń blok",
    "Dodaj do zasobnika", activity: "…do zasobnika" / "…z zasobnika").
  - Sidebar pref: new `src/utils/uiPrefs.ts` wrapping localStorage key
    `n2hub.ui.v1` — an explicit, architect-approved exception to the
    storage.ts-only rule (UI prefs are device-local and must not migrate to
    the future API). Collapsed styles scoped to `@media (min-width: 1181px)`
    so the 1180px strip and 760px drawer are untouched; GlobalSearch stays
    mounted (Ctrl/Cmd+K keeps working), its trigger CSS-hidden when collapsed.
  - Seed gains one 3h bin block (Ola, task 1) so the bin is visible in sample
    data and browser QA.
- **Packages** (execution order; waves are parallel-safe by disjoint files):
  - Wave 1 (parallel):
    1. `handoffs/packages/PKG-20260708-bin-core.md` — sentinel + normalize +
       selectors + all reducer changes + seed — tier: developer
    2. `handoffs/packages/PKG-20260708-sidebar-collapse.md` — uiPrefs module,
       App.tsx, sidebar CSS, icons — tier: developer (touches styles.css:
       must NOT run concurrently with bin-week-ui)
  - Wave 2 (parallel, after bin-core):
    3. `handoffs/packages/PKG-20260708-bin-week-ui.md` — WeekView 8-col layout,
       bin column + two-way drag, split/delete context menu, TaskModal bin
       section, week-cal CSS — tier: developer (depends: bin-core)
    4. `handoffs/packages/PKG-20260708-bin-tests.md` — reducer + storage tests
       for all bin behavior — tier: test-writer (depends: bin-core; test files
       only)
- **Gates:** `npm run dev` walkthrough + `npx tsc --noEmit` + `npm test` +
  `npm run build` all green before review; interactive drag criteria need a
  human/dev-server browser pass (flag anything unverified in worker logs).
- **Open questions:** none blocking. Post-merge doc note for the human:
  CLAUDE.md needs refreshing after this lands (WorkloadEntry `''` sentinel,
  bin description in the Calendar section, new actions, `n2hub.ui.v1` key,
  sidebar collapse, manual-checklist additions) — intentionally NOT part of
  any worker package.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-08 · developer · `PKG-20260708-sidebar-collapse`

- **Changed:**
  - `src/utils/uiPrefs.ts` (new) — device-local UI prefs behind localStorage key
    `n2hub.ui.v1`; `loadUiPrefs`/`saveUiPrefs`, both try/catch-safe. Does not
    touch storage.ts.
  - `src/components/icons.ts` — added `ChevronsLeft` / `ChevronsRight` exports.
  - `src/App.tsx` — `collapsed` state seeded from `loadUiPrefs()`, persisted in
    the toggle handler (no effect); root class gains ` sidebar-collapsed`;
    brand row now holds a `.sidebar-toggle` (Zwiń/Rozwiń menu); nav labels
    wrapped in `<span className="nav-label">` + unconditional `title={label}`;
    acting-as block gains a collapsed avatar shortcut (Avatar / Users fallback)
    that expands the sidebar.
  - `src/styles.css` — base styles for `.app-brand-row`, `.sidebar-toggle`,
    `.acting-as-wrap`, `.acting-as-collapsed`; toggle+avatar hidden ≤1180px;
    new `@media (min-width: 1181px)` block with all `.sidebar-collapsed` rules
    (80px grid col, centered brand mark, hidden brand name, icon-only nav,
    hidden search trigger, select→avatar swap, grid-col transition).
- **Tests:** `npx tsc --noEmit` → clean; `npm test` → 37 passed (3 files).
  Skipped `npm run build` per launcher instruction (reviewer owns it;
  concurrent store edits could fail an unrelated build).
- **Deviation:** Decision 4 suggested conditional JSX on `collapsed` for the
  acting-as block. Used CSS-only visibility toggle instead (both the avatar
  button and the select are always rendered, gated by the min-width:1181px
  scope). Reason: conditional JSX would swap the control at ≤1180px too when
  the collapsed pref is set, violating the "≤1180px identical with the pref set
  either way" acceptance criterion. CSS scoping keeps the strip/drawer
  pixel-identical. All other decisions followed verbatim.
- **Still broken:** nothing.
- **Next:** ready for review. Interactive/responsive criteria (collapse at
  >1180px, Ctrl/Cmd+K while collapsed, avatar-click expand, reload persistence,
  ≤1180px + ≤760px parity) need a dev-server browser pass — not verifiable from
  CLI here.

#### 2026-07-08 · developer · `PKG-20260708-bin-core`

- **Changed:**
  - `src/utils/time.ts` — added `BIN_DATE = ''` sentinel + `isBinEntry()`.
  - `src/types.ts` — documented the `''` bin sentinel on `WorkloadEntry`
    (date / startMinutes:0 / sortIndex ordering). No field added or removed.
  - `src/store/storage.ts` — `ensureStartMinutes` now excludes bin groups from
    08:00 stacking; normalizes bin entries to `startMinutes:0` + contiguous
    per-bin `sortIndex`; still idempotent + same-reference on no change.
  - `src/store/AppStore.tsx` — `SaveTaskPayload.newUnassigned`; `saveTask`
    passes bin entries through (kept if person still assigned, dropped if not)
    and appends `newUnassigned` bin hours; new actions `MOVE_BLOCK_TO_BIN`,
    `SPLIT_BLOCK` (2|4, quarter-unit split, largest part stays), `DELETE_BLOCK`
    (bin-only); `SET_BLOCK_TIME` shrink-to-bin + dedicated bin→grid activity
    string; guards on `moveTask`/`setTaskDates`/`insertBlock`/`reassignEntry`.
    All new activity strings verbatim from the package.
  - `src/store/selectors.ts` — `binEntriesForPerson`, `binEntriesForTask`,
    `binTotalForPerson`.
  - `src/store/seed.ts` — `addBinWork` helper; one 3h bin block for Ola on t1.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 37/37 pass (unchanged);
  `npm run build` → success (package listed build in its Tests command).
- **Deviations:** none. Left the existing `REASSIGN_ENTRY` activity string as-is
  (package specifies no new string for it; for a bin entry it renders `()` for
  the empty date — cosmetic, unchanged by design). Did not touch App.tsx /
  styles.css / uiPrefs.ts (concurrent sidebar package).
- **Still broken:** nothing.
- **Next:** ready for Wave 2 — `PKG-20260708-bin-week-ui` (UI) and
  `PKG-20260708-bin-tests` (test-writer) can build on these actions/selectors.

#### 2026-07-08 · test-writer · `PKG-20260708-bin-tests`

- **Changed:**
  - `src/store/blockActions.test.ts` — added 20 `it`s across 8 new `describe`
    blocks covering all bin-core reducer changes: `MOVE_BLOCK_TO_BIN` (bin
    move + reindex + activity; no-op on already-bin/unknown id), `SPLIT_BLOCK`
    (even halves, odd-quarter halves, quarters, splitting a bin entry,
    too-small/unknown-id rejections), `DELETE_BLOCK` (delete + reindex; reject
    dated/unknown), `SET_BLOCK_TIME` bin behavior (shrink-to-bin activity
    string, plain move creates no bin entry, bin→grid drop with period
    extension + reindex, bin→grid collision rejection), `SAVE_TASK` bin
    behavior (existing bin entries survive/drop by assignment,
    `newUnassigned` creates+snaps+skips), `MOVE_TASK`/`SET_TASK_DATES` bin
    guards, `INSERT_BLOCK` bin-ref rejection.
  - `src/store/storage.test.ts` — added 3 `it`s in a new
    `ensureStartMinutes — bin normalization` describe: garbage
    startMinutes/gappy sortIndex → `0`/contiguous, idempotence + same-reference
    on a clean bin group, and proof the bin is excluded from 08:00 stacking
    (contrasted against the existing dated-group stacking test).
- **Tests:** `npm test` → 60/60 passed (37 existing + 23 new, 3 files);
  `npx tsc --noEmit` → clean; `npm run build` → succeeds. (One transient tsc
  run mid-session showed 5 unused-var errors in `WeekView.tsx` — the
  concurrent `bin-week-ui` developer's in-progress edit at that moment, not
  caused by these test files; a re-run after their next save was clean. Not
  investigated further per the "don't touch WeekView.tsx" instruction.)
- **Deviations/gaps found in bin-core:** none. Implementation in
  `src/store/AppStore.tsx` matches PKG-20260708-bin-core's spec exactly on
  every case in scope: split rounding (largest part stays), shrink-to-bin
  delta + Polish activity suffix, bin→grid activity string, all four guards
  (`moveTask`/`setTaskDates`/`insertBlock`/`reassignEntry` — `reassignEntry`
  not covered here, out of this package's scope list), and
  `ensureStartMinutes`'s bin exclusion from 08:00 stacking. No implementation
  files modified.
- **Skipped/not written:** none of the 19 in-scope cases were skipped; wrote
  20 `it`s for the 16 blockActions.test.ts cases (some cases split into 2
  `it`s for clarity, e.g. SET_BLOCK_TIME bin→grid happy-path vs its collision
  rejection) and 3 for the 3 storage.test.ts cases.
- **Next:** ready for review alongside `PKG-20260708-bin-week-ui`.

#### 2026-07-08 · developer · `PKG-20260708-bin-week-ui`

- **Changed:**
  - `src/components/WeekView.tsx` — 8-column layout (`GRID_COLS=8`,
    `BIN_COL_INDEX=7`, inline grid template `52px repeat(8, …)`); `TimedBlock`
    day projection now clamps 0..7 (`colWidth` `/7`→`/8`), index 7 = bin →
    `to-bin` tint + `MOVE_BLOCK_TO_BIN` on drop (collision check skipped there);
    new `BinCard` component (pointer-drag a dateless block onto a day column via
    `gridRef`+`bodyRef` geometry → `SET_BLOCK_TIME`, live `blockCollides` tint,
    Escape/cancel/revert, click opens task); new bin header + bin body column
    (per-person stacked groups, filtered, `Brak bloków bez terminu` empty state,
    week-independent); context menu extended — one menu, mode by `isBinEntry`:
    dated blocks get `Dodaj przed/po` + separator + `Podziel na pół`/`na ćwiartki`
    (disabled <0.5h / <1h with the Polish title), bin cards get the two split
    items + `Usuń blok` (danger, confirm). `bodyRef` attached to first day column.
  - `src/components/TaskModal.tsx` — new `Zasobnik (bez terminu)` section between
    assignees and the allocation grid: read-only existing-bin chips grouped per
    still-assigned person + hint, add-row (assignee select + 0.25-step hours +
    `Dodaj do zasobnika`) feeding `pendingUnassigned` rendered as removable chips
    (remove aria-label `Usuń`); `handleSave` passes `newUnassigned`;
    `serializeDraft` includes `pendingUnassigned` (dirty tracking); estimate line
    now `zaplanowano {dated}h (+ {bin}h w zasobniku)`.
  - `src/styles.css` — week-cal: `.week-cal-scroll { overflow-x:auto }`,
    `.week-cal-grid` width `calc((100% - 52px)/5*8 + 52px)`, sticky-left hour axis
    + sticky corner, `.week-block.to-bin`, full `.week-bin-*` block; context-menu
    separator/disabled/danger; task-modal `.bin-*` chip/add-row styles; 760px
    query `min-width` 720px→820px. `user-select:none` on the grid kept.
- **Key decisions (within package bounds):**
  - Necessary in-scope correctness fix in TaskModal: the allocations-seeding loop
    now excludes bin entries (`!isBinEntry(w)`) — otherwise bin entries (date `''`)
    leaked into the allocation map via `allocKey(personId, '')`, inflating
    `plannedTotalAll`/`outOfRangeCount`. No store change; TaskModal is in-scope.
  - Bin-card drop geometry: x from `gridRef` rect (colWidth `/8`, valid day cols
    0..6 only), y (0:00 origin) from the first day column's rect (`bodyRef`), so
    it stays correct under vertical scroll. Dragged card floats via `transform`.
  - Sticky-axis z-index: hour axis `z:5` (covers resting blocks `z:0`; a dragged
    block `z:30`/bin card `z:40` still floats above), corner `z:9` highest.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 60/60 pass (includes the
  test-writer's bin tests); `npm run build` → success. The >500kB chunk warning
  is pre-existing, not introduced here.
- **Deviations:** none beyond the TaskModal seeding fix noted above. Did not
  touch any store/selector/util/*.test.ts/sidebar files.
- **Still broken:** nothing.
- **Reviewer should look closely at (interactive — needs a browser pass, not
  CLI-verifiable):**
  - Horizontal scroll: Mon–Fri fill width, Sat/Sun/Zasobnik scroll in from the
    right; hour axis stays pinned; vertical auto-scroll to ~7:00 still fires.
  - Bin→grid drag (seeded Ola 3h on t1): drop onto a free slot assigns date/time;
    drop onto same-person block shows danger + reverts; drop on axis/header/bin
    reverts. Grid→bin drag shows `to-bin` lavender tint and empties the day.
  - Context menu split/delete on both dated and bin entries; disabled titles;
    `Dodaj przed/po` still works on dated blocks only.
  - Bottom-resize shrink returning hours to the bin re-renders the bin column.
  - TaskModal: add-to-bin → chip + dirty; save carries `newUnassigned`; reopen
    shows existing bin chips; estimate `(+ {n}h w zasobniku)`.
  - ≤760px: all 8 columns ≥~96px, no overlap, no console errors/warnings.
- **Next:** ready for review.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-08 · reviewer · verdict

- **Status:** CHANGES-REQUIRED
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean; `npm test` 60/60;
  `npm run build` success (500kB chunk warning pre-existing).
- **Blockers:**
  1. **[bin-core / developer] [P1]** `src/store/selectors.ts:312-321`
     (`conflictDatesForTask`) iterates bin entries: for a bin entry it calls
     `hoursForPersonOnDate(person, '')`, which sums the person's ENTIRE bin
     (date `'' === ''`), and when that exceeds capacity it adds `''` as a
     conflict date. `src/pages/TimelinePage.tsx:273` then computes
     `diffDays(t.startDate, '')` → NaN marker offsets + false overload
     warnings. Violates the architect decision "bin hours never in any
     per-date total or overload". Fix: skip `isBinEntry(w)` in
     `conflictDatesForTask`. Test-writer: add a selector test (bin hours >
     capacity must NOT create a conflict date).
  2. **[bin-week-ui / developer] [P2]** `src/components/TaskModal.tsx:412-434`
     (`toggleAssignee`): the unassign confirm counts only dated allocation
     hours. A person whose hours sit only in the bin is unassigned with NO
     confirm, and their bin entries are silently dropped by `saveTask`
     (invariant 5: destructive drops go behind confirm). Fix: include
     existing bin hours (+ pending chips) in the confirm text, and clear
     `pendingUnassigned` rows (and `binPersonId` if pointing at) for the
     unassigned person.
  3. **[bin-week-ui / developer] [P2]** `src/components/WeekView.tsx:365-393`
     (`BinCard`): drop validation is x-only (`colIndex 0..6`). A drop with
     the pointer over the sticky header (relY < 0 → clamped to 0:00) or over
     the sticky hour axis while horizontally scrolled (relX computed against
     the overflowing grid rect) still dispatches `SET_BLOCK_TIME`. The
     package requires "invalid target → revert". Fix: also require the
     pointer inside the day-body bounds (y within `bodyRect` top/bottom) and
     not over the visible sticky axis (`e.clientX` ≥ scroll-container left +
     AXIS_W).
- **Codex findings (reviews/2026-07-08-150949-codex-review.md), adjudicated:**
  - Finding 1 (conflictDatesForTask) — CONFIRMED → blocker 1.
  - Finding 2 (unassign drops bin hours without warning) — CONFIRMED → blocker 2.
  - Finding 3 (bin-card drop hit-testing) — CONFIRMED → blocker 3.
  - Finding 4 (uiPrefs.ts "missing") — REJECTED as a code bug: the file exists,
    is correct (try/catch-safe, `n2hub.ui.v1` only), and tsc/build pass. It is
    merely untracked, so the review script's committed-diff omitted it. NOTED
    for whoever commits: `git add src/utils/uiPrefs.ts` (and the handoff/review
    files) or the commit breaks the build exactly as Codex warned.
- **Convention check:** PASS otherwise. Polish strings verbatim from the
  packages; dates stay `yyyy-MM-dd` + documented `''` sentinel; no direct
  localStorage outside storage.ts except the architect-sanctioned uiPrefs.ts;
  all collapsed-sidebar CSS scoped to `@media (min-width: 1181px)`; 1180/760
  breakpoints and `prefers-reduced-motion` override intact; week grid keeps
  `user-select: none`; `reindexDays` used with bin keys everywhere sortIndex
  can change; `withActivity` inside every new mutation; rejections return the
  same state reference. Audited per-date consumers (WeekView `dayTotal`,
  MonthView, WorkloadPage, DashboardPage, PersonProfilePage, AllocationGrid):
  all filter by real-date equality — `conflictDatesForTask` was the single
  miss (blocker 1).
- **Test coverage:** adequate for the store layer (23 new tests: all new
  actions, SAVE_TASK bin rules, guards, ensureStartMinutes bin normalization;
  assertions are real, rejections use reference equality). Gaps: (a) no test
  for `conflictDatesForTask` bin exclusion — add with blocker 1; (b)
  REASSIGN_ENTRY's bin path (append to target bin, startMinutes 0) untested;
  (c) interactive criteria (drag both directions, sticky axis, collapse
  toggle, ≤1180/≤760 parity) still need the human browser walkthrough — no
  worker or reviewer ran a dev-server pass this run.
- **Nits (non-blocking):**
  - TaskModal `addBinHours` doesn't snap to 0.25 client-side (reducer snaps on
    save, but a typed `1.3` renders as a 1.3h chip until then).
  - `setBlockTime` doesn't reject `date === BIN_DATE` input; only
    MOVE_BLOCK_TO_BIN is the sanctioned bin path today, but a defensive guard
    would keep a future caller from corrupting `task.startDate` to `''`.
  - REASSIGN_ENTRY activity renders `()` for a bin entry's date — accepted by
    the plan, fine to leave.
- **Routing:** blocker 1 → bin-core developer (+ test-writer for the selector
  test); blockers 2–3 → bin-week-ui developer. Re-run all four gates after
  fixes; then the human browser checklist (week-view items + sidebar items)
  before merge. CLAUDE.md refresh stays a post-merge human task per the plan.

#### 2026-07-08 · developer · `PKG-20260708-bin-core` (fix pass)

- **Blocker 1 (P1) — FIXED:** `src/store/selectors.ts` `conflictDatesForTask`
  now skips bin entries (`w.taskId !== taskId || isBinEntry(w)`), so a bin total
  over capacity can no longer add `''` as a conflict date → no more
  `diffDays(start, '')` NaN in TimelinePage / false overload warnings. Restores
  the "bin hours never in any per-date overload" invariant.
- **Reviewer nit — applied (cheap, no test disturbance):**
  `src/store/AppStore.tsx` `setBlockTime` now defensively rejects
  `date === BIN_DATE` (returns state unchanged) so a future caller can't corrupt
  `task.startDate` to `''`. MOVE_BLOCK_TO_BIN remains the only sanctioned
  grid→bin path.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 60/60 pass (unchanged count;
  test-writer's selector regression test lands separately).
- **Deviations:** none. Did not touch test files or the concurrent
  WeekView/TaskModal/sidebar files.
- **Still broken:** nothing in bin-core. Blockers 2–3 remain with the
  bin-week-ui developer.
- **Next:** ready for re-review; test-writer to add the `conflictDatesForTask`
  bin-exclusion selector test.

#### 2026-07-08 · developer · `PKG-20260708-bin-week-ui` (fix pass)

- **Blocker 2 (P2) — FIXED:** `src/components/TaskModal.tsx` `toggleAssignee`
  now, on unassign, counts dated allocation hours PLUS this person's existing
  bin hours (`binEntriesForTask`) PLUS their queued `pendingUnassigned` hours.
  The confirm fires whenever that combined total > 0 and its Polish text appends
  ` (w tym {n}h w zasobniku)` when any bin hours are involved; on confirm it also
  drops that person's `pendingUnassigned` chips (so saveTask can't silently
  discard queued bin hours). Restores invariant 5 (destructive drops behind
  confirm).
- **Blocker 3 (P2) — FIXED:** `src/components/WeekView.tsx` `BinCard`
  `onPointerMove` now hit-tests the VISIBLE day body, not just `colIndex`. Using
  the scroll container rect (`gridRef.parentElement`) it requires the pointer
  below the sticky header (`scrollRect.top + headerH`, `headerH = bodyRect.top -
  gridRect.top` — stable under scroll), above the body's 24:00 line
  (`bodyRect.bottom`), right of the sticky hour axis
  (`scrollRect.left + AXIS_W`) and left of the visible right edge. A drop over a
  header/axis or outside the body now reverts, consistent with collision-revert.
  `finish` already gates on `!valid` → no dispatch.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 60/60 pass.
- **Deviations:** none. Touched only TaskModal.tsx and WeekView.tsx (no CSS class
  needed); no store/test files touched.
- **Still broken:** nothing. Interactive re-verification of the reverted-drop
  cases (drop over day header, drop over the axis while scrolled right) and the
  bin-only-person unassign confirm still needs a human browser pass.
- **Next:** ready for re-review.

#### 2026-07-08 · test-writer · follow-up on reviewer CHANGES-REQUIRED (`conflictDatesForTask` regression + REASSIGN_ENTRY bin gap)

- **Context:** reviewer's blocker 1 (P1, `conflictDatesForTask` counting bin
  hours as a `''`/BIN_DATE conflict date) was already fixed by the bin-core
  developer before this task started (`src/store/selectors.ts:315`); this
  entry adds the regression test the reviewer asked for, plus the noted
  coverage gap on `REASSIGN_ENTRY`'s bin path. No implementation changed here.
- **Changed:**
  - `src/store/selectors.test.ts` (new file) — 2 `it`s in
    `conflictDatesForTask — bin exclusion (regression)`: a person whose ONLY
    entry is a 20h bin block (over an 8h capacity) yields `[]` and the result
    never contains `''`/BIN_DATE; a mixed fixture (huge bin total + one
    under-capacity dated day + one over-capacity dated day) yields exactly the
    genuine dated conflict date, proving real overload is still reported while
    the bin stays excluded.
  - `src/store/blockActions.test.ts` — added a `makePerson` fixture helper +
    2 `it`s in a new `REASSIGN_ENTRY bin behavior` describe: reassigning a bin
    entry to a person with an existing bin entry keeps `date`/`startMinutes`
    at bin values (`BIN_DATE`/`0`) and appends at the next contiguous bin
    `sortIndex` (verified against `reassignEntry`'s actual behavior — it skips
    `nextFreeStart` for bin entries and computes `sortIndex` via
    `nextSortIndex(without, toPersonId, date)` with `date` still `BIN_DATE`);
    a second case checks an empty target bin lands at `sortIndex: 0` and that
    an already-assigned target person doesn't get a duplicate assignment row.
- **Tests:** `npm test` → 64/64 passed (60 prior + 4 new, 4 files);
  `npx tsc --noEmit` → clean.
- **Deviations/gaps:** none. Did not touch `WeekView.tsx`/`TaskModal.tsx`
  (concurrent developer edits) or any other implementation file.
- **Next:** ready for re-review.

#### 2026-07-08 · reviewer · final verdict (re-review after fix pass)

- **Status:** APPROVE (with nits)
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean; `npm test` 64/64
  (4 files); `npm run build` success (500kB chunk warning pre-existing).
- **Blocker verification:**
  1. FIXED — `src/store/selectors.ts:315` now skips `isBinEntry(w)` in
     `conflictDatesForTask`; bin hours can no longer surface `''` as a
     conflict date (no NaN offsets in TimelinePage). Covered by 2 regression
     tests in the new `src/store/selectors.test.ts` (bin-only overload → `[]`;
     mixed fixture still reports the genuine dated conflict). Bonus: the
     defensive nit was applied — `setBlockTime` rejects `date === BIN_DATE`
     early (`src/store/AppStore.tsx:672-674`), keeping MOVE_BLOCK_TO_BIN the
     only grid→bin path.
  2. FIXED — `src/components/TaskModal.tsx:412-454` `toggleAssignee` now sums
     dated + existing-bin + pending-bin hours, fires the confirm whenever the
     combined total > 0 with the Polish suffix
     ` (w tym {n}h w zasobniku)`, and clears the person's `pendingUnassigned`
     chips on confirm. No more silent bin-hour loss on unassign.
  3. FIXED — `src/components/WeekView.tsx:369-380` `BinCard.onPointerMove`
     hit-tests the visible day body against the scroll container rect:
     below the sticky header (`scrollRect.top + headerH`, headerH derived from
     `bodyRect.top - gridRect.top` so it's scroll-stable), above
     `bodyRect.bottom`, right of the sticky axis (`scrollRect.left + AXIS_W`),
     left of the visible right edge; `finish` still gates on `!valid` → drops
     over header/axis/outside revert. Math checks out under both scroll axes.
- **New tests:** 4, all meaningful — 2 selector regressions (above) + 2
  REASSIGN_ENTRY bin-path tests in `blockActions.test.ts` (bin values kept,
  contiguous target-bin sortIndex, empty-bin lands at 0, no duplicate
  assignment). Closes coverage gaps (a) and (b) from the first verdict.
- **Remaining nits (non-blocking, note for a future pass):**
  - `TaskModal` `binPersonId` is not reset when the person it points at is
    unassigned: the add-row select then shows the first assignee while
    `addBinHours` (line 536) still uses the stale id — the resulting chip is
    excluded from totals and skipped by the reducer on save, so no data risk,
    just a confusing chip. One-line fix whenever TaskModal is next touched.
  - `addBinHours` still doesn't snap to 0.25 client-side (reducer snaps).
  - REASSIGN_ENTRY activity renders `()` for a bin date — accepted by plan.
- **Human browser walkthrough still required before merge** (code approved;
  these are the interactive criteria no agent could verify from CLI):
  1. Week grid: Mon–Fri fill the width; Sat/Sun/Zasobnik scroll in from the
     right; hour axis + corner stay pinned; auto-scroll to ~7:00.
  2. Bin→grid drag (seeded Ola 3h): drop on a free slot schedules; drop on the
     same person's block shows danger + reverts; drop on the sticky header,
     on the hour axis while scrolled right, and outside the grid ALL revert
     (blocker-3 regression check).
  3. Grid→bin drag: `to-bin` lavender tint on hover, day empties on drop.
  4. Context menu: split pół/ćwiartki on dated + bin blocks; disabled titles
     on 0.25h; `Usuń blok` confirm on bin cards; `Dodaj przed/po` unchanged.
  5. Bottom-resize shrink returns hours to the bin and the bin column
     re-renders; two consecutive drags on one block both register.
  6. TaskModal: add-to-bin chip + dirty; save round-trips; estimate shows
     `(+ {n}h w zasobniku)`; unassigning a bin-only person now confirms with
     the `(w tym …h w zasobniku)` text (blocker-2 regression check).
  7. Sidebar: collapse to 80px >1180px, tooltips, Ctrl/Cmd+K while collapsed,
     avatar click expands, pref survives reload; ≤1180px strip and ≤760px
     drawer pixel-identical with the pref set either way.
  8. Console free of errors/warnings throughout.
- **Commit hygiene:** remember to `git add` the untracked files —
  `src/utils/uiPrefs.ts` (build breaks without it), `src/store/selectors.test.ts`,
  the four `handoffs/packages/PKG-20260708-*.md`, and the review artifacts.
  CLAUDE.md's in-tree diff is the PREVIOUS run's doc refresh; the bin/sidebar
  doc update remains a post-merge human task per the plan.

---

## Run: 2026-07-08 — Walkthrough fixes: fixed hour axis, bin beside grid, duration format

### Plan (architect)

- **Context:** the previous run was APPROVED, but the human browser
  walkthrough surfaced three defects: (1) the sticky-left hour axis is
  translucent and overlaps day headers/blocks during horizontal scroll;
  (2) the Zasobnik is the 8th in-grid column and only visible after scrolling
  past Sunday — it must sit BESIDE the calendar, always visible; (3) durations
  render inconsistently (clock ranges + decimal `2.75h` in the calendar vs
  `0.25h` elsewhere).
- **Goal:** restructure the week view to
  [fixed hour axis][h-scrollable 7-day grid, Mon–Fri primary][always-visible
  Zasobnik panel], with no translucent overlap in any scroll position and both
  drag directions intact; unify every read-only duration display behind one
  `formatDuration(hours)` helper ("2h 45m" / "45m" / "8h").
- **Key decisions (pre-resolved, no open questions):**
  - **Week view structure (replaces ALL sticky positioning):** a non-scrolling
    header row (`52px corner | overflow-hidden day-header track | 200px bin
    header`) above a flex main row of three panes: `.week-axis-pane` (52px,
    overflow hidden), `.week-days-viewport` (flex:1, overflow auto BOTH axes —
    both scrollbars visible there; inner `.week-days-grid` 7 columns, width
    `max(calc(100%/5*7), 672px)`, height 1152px), `.week-bin-pane` (200px,
    own overflow-y). One viewport `onScroll` syncs `axisPane.scrollTop` and
    `headTrack.scrollLeft` by direct ref assignment; `scrollbar-gutter:
    stable` on viewport + head track prevents header/column misalignment with
    classic scrollbars. Auto-scroll-to-7:00 moves to the viewport.
  - **Drag geometry:** `gridRef` → `.week-days-grid` (colWidth = width/7, day
    clamp 0..6; `GRID_COLS`/`BIN_COL_INDEX`/AXIS_W offsets deleted); grid→bin
    detection becomes a `binRef` rect hit-test (replaces "column index 7");
    BinCard drop validation simplifies to grid-rect projection ∩ viewport
    client rect (supersedes the previous blocker-3 sticky-exclusion math —
    same reverted-drop guarantees must hold). No drag edge auto-scroll: to
    drop on Sat/Sun the user scrolls first (accepted gap, unchanged from the
    approved run).
  - ≤760px: grid min-width floor 672px (~96px/day), bin pane 160px.
  - **Duration format:** new pure `formatDuration(hours)` in
    `src/utils/time.ts` — round to whole minutes; `8h`, `2h 45m`, `45m`, `0h`;
    applied at EVERY read-only hours display (audited exhaustive list in the
    package: WeekView, AllocationGrid totals, TaskModal, MonthView,
    PersonChip, Workload, Dashboard, PersonProfile, People, Projects,
    ProjectDetail, Tasks, Kanban — TimelinePage/GlobalSearch show no duration
    numbers), including capacity (`8h/dzień` renders identically), tooltips
    and confirm texts. Numeric inputs stay decimal 0.25-step; clock ranges
    (`8:00–10:45`, `formatMinutes`) stay. AppStore activity templates also
    switch (future rows only; old persisted rows keep their wording —
    accepted). Helper unit tests ride in the same developer package (6
    assertions — a separate test-writer handoff would cost more than it
    saves); message-assertion updates in existing tests limited to number
    formatting and itemized.
- **Packages** (STRICTLY SEQUENTIAL — both edit WeekView.tsx; layout first):
  1. `handoffs/packages/PKG-20260708-week-layout-fix.md` — WeekView pane
     restructure + scroll sync + drag-geometry rework + week-cal CSS rewrite —
     tier: developer
  2. `handoffs/packages/PKG-20260708-duration-format.md` — `formatDuration` +
     repo-wide display sweep + activity templates + helper tests — tier:
     developer (depends: 1)
  - No test-writer package this run (per orchestrator; the only new unit
    surface is the 6-line formatter, folded into package 2).
- **Gates:** `npx tsc --noEmit` + `npm test` (64 + new formatter tests) +
  `npm run build` green after EACH package; dev-server walkthrough by the
  worker; final human browser pass focused on: axis overlap at every scroll
  position, bin visible without scrolling, both drags incl. reverted drops,
  header/column alignment, `2h 45m` formatting sweep, ≤760px.
- **Risks:** (a) scroll-sync via refs must not jitter or drift — direct
  property assignment in one handler, no state; (b) the drag rework
  supersedes the reviewed blocker-3 hit-test — its reverted-drop cases are
  explicit acceptance criteria again; (c) duration sweep may break
  activity-message assertions in `blockActions.test.ts` — allowed only as
  formatting-part edits, itemized; (d) both packages touch WeekView.tsx —
  never parallelize.
- **Open questions:** none. Post-merge doc note stands: CLAUDE.md week-view
  description + duration-format convention need a human refresh after this
  run.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->

#### 2026-07-08 · developer · `PKG-20260708-week-layout-fix`

- **Changed:**
  - `src/components/WeekView.tsx` — restructured the week view into a header row
    (`.week-head-row`: `.week-corner` 52px + `.week-head-track`→`.week-head-inner`
    7-col grid + `.week-bin-head` 200px) over `.week-main` three panes
    (`.week-axis-pane` 52px overflow-hidden with the 1152px `.week-axis` inside;
    `.week-days-viewport` the sole scroller — both axes — wrapping
    `.week-days-grid` 7-col; `.week-bin-pane` 200px, own vertical scroll). All
    sticky positioning removed. New refs `viewportRef/axisPaneRef/headTrackRef/
    binRef`; one `onViewportScroll` handler sets `axisPane.scrollTop` +
    `headTrack.scrollLeft` (direct assignment, no state). Auto-scroll-to-7:00
    effect repointed to `viewportRef`. Deleted `GRID_COLS`/`BIN_COL_INDEX`/
    `AXIS_W`/`bodyRef`/`scrollRef`; added `DAY_COLS=7`.
  - Drag geometry: `TimedBlock.colWidth = gridRect.width / 7`, day projection
    clamps 0..6; grid→bin is now a rect hit-test of `binRef` (`overBin` boolean
    in DragState, replaces `projDayIndex===7`) keeping the `to-bin` tint +
    `MOVE_BLOCK_TO_BIN` drop. `BinCard` targeting simplified: column/time off
    `.week-days-grid` rect (y-origin = `gridRect.top`, no header inside), valid
    iff the pointer is inside `viewportRef`'s client rect — that single clamp
    supersedes the old sticky-header/axis exclusion math (blocker-3 stays fixed:
    header row / axis pane / bin / outside-viewport all fall outside the rect →
    revert). Escape-cancel, pointer capture, `moved` click-guard, collision tint
    unchanged.
  - `src/styles.css` — week-cal section rewrite: `.week-cal` is now the bordered
    opaque frame; new `.week-head-row/.week-corner/.week-head-track/
    .week-head-inner`, `.week-main/.week-axis-pane/.week-days-viewport/
    .week-days-grid/.week-bin-pane`; header-inner and days-grid share
    `width: max(calc(100%/5*7), 672px)` so Mon–Fri fill and columns align;
    `scrollbar-gutter: stable` on both `.week-days-viewport` and
    `.week-head-track`. All surfaces opaque (`--card-bg`/`--card-bg-2`).
    `user-select: none` moved onto the three panes (not `.week-cal` root, so the
    context-menu select/input still work). ≤760px block: dropped the old
    `.week-cal-scroll/.week-cal-grid` rules (the 672px floor lives in the width
    rule) and narrowed `.week-bin-head/.week-bin-pane` to 160px. Kept
    day-column gradient lines, weekend/today tints, block/handle/bin-card styles,
    `.week-day-col { overflow: visible }`.
- **Decisions within package bounds:**
  - `.week-head-inner` uses the SAME `max(calc(100%/5*7), 672px)` as the days
    grid (package decision 1 wrote head-inner as plain `calc(100%/5*7)`); the
    identical form is required so headers stay column-aligned at the ≤760px
    672px floor — matches acceptance criterion "day headers stay perfectly
    column-aligned while scrolling". Minor, alignment-preserving.
- **Duration strings:** untouched — all `fmt(...)h` / `formatMinutes` byte-
  identical for the next package.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 64/64; `npm run build`
  success (pre-existing >500kB chunk warning only). No store/util/test files
  touched. Verified no stale `AXIS_W/GRID_COLS/BIN_COL_INDEX/bodyRef/scrollRef`
  or `.week-cal-scroll/.week-cal-grid/.week-axis-head` references remain.
- **Needs human browser pass (not CLI-verifiable):**
  - Axis opacity/overlap at every horizontal scroll position; Mon–Fri fill at
    scrollLeft 0; Sat/Sun on scroll; header↔column alignment (incl. macOS
    "always show scrollbars"); vertical axis/grid sync after fast scrolling +
    open at ~7:00; Zasobnik visible with no scroll at 1920px and ~1000px.
  - Both drag directions incl. the reverted-drop cases (drop over header row /
    axis pane / bin / outside viewport must revert; same-person collision
    danger+revert); grid→bin `to-bin` tint; Mon→Tue ±1h snap+persist; top/bottom
    resize; two consecutive drags on one block; context menu on dated + bin.
  - **Observation for the reviewer (not a spec deviation):** the mandated bin
    pane is `overflow-y:auto` (no `overflow:visible` as the old in-grid bin had),
    so while dragging a bin CARD out onto the grid its visual ghost is clipped at
    the pane's left edge. The DROP is rect-based and correct (block lands at the
    projected day/time); only the drag-ghost preview is clipped. If a floating
    ghost is wanted that's a follow-up (would need a portal/fixed-position ghost)
    — flagging so the human can judge during the walkthrough.
  - No horizontal-edge drag auto-scroll (accepted gap per decision 4): to drop on
    Sat/Sun the user scrolls first.
- **Next:** ready for `PKG-20260708-duration-format` (package 2, same files —
  strictly sequential) then review.

#### 2026-07-08 · developer · `PKG-20260708-duration-format`

- **Changed:**
  - `src/utils/time.ts` — new pure `formatDuration(hours)` → `8h` / `2h 45m` /
    `45m` / `0h` (rounds to whole minutes; no new imports).
  - `src/utils/time.test.ts` — new `describe('formatDuration')`: the six spec
    examples + a rounding case (7 assertions across 4 `it`s).
  - `src/components/WeekView.tsx` — deleted local `fmt`; block hours label +
    `title`, bin card hours + `title`, day-head totals, bin header/group totals,
    context-menu title, overload warning, delete-confirm all via
    `formatDuration`. Clock ranges (`formatMinutes`) untouched.
  - `src/components/AllocationGrid.tsx` — deleted local `fmt`; `Suma dnia`
    column, person totals, grand total, overload tooltip formatted. Cell inputs
    untouched.
  - `src/components/TaskModal.tsx` — deleted local `fmtHours`; estimate-compare
    line, `(+ … w zasobniku)` suffix, existing-bin chips, pending chips, and the
    unassign confirm (incl. `(w tym … w zasobniku)`) formatted. Inputs untouched.
  - `src/components/MonthView.tsx` — cell hours + cell `title`.
  - `src/components/PersonChip.tsx` — the `hours` suffix.
  - `src/pages/WorkloadPage.tsx` — deleted local `fmtHours`; block hours,
    reassign-option preview (`{name} — …/{cap} tego dnia`), table cells,
    assigned/available sums, overload tooltip + panel title all formatted;
    capacity now via `formatDuration`. `aria-label` percentages left as-is.
  - `src/pages/DashboardPage.tsx` — `Xh / Yh` load line (value + capacity).
  - `src/pages/PersonProfilePage.tsx` — deleted local `fmtHours`; week summary
    (assigned / available / `/dzień` / total), day cells, per-task hours.
  - `src/pages/PeoplePage.tsx` — deleted local `fmtHours`; `przypisano …`.
  - `src/pages/ProjectsPage.tsx` — deleted local `fmtHours`; `zaplanowano …`.
  - `src/pages/ProjectDetailPage.tsx` — deleted local `fmtHours`; project total +
    per-task totals.
  - `src/pages/TasksPage.tsx` — deleted local `fmtHours`; `zaplanowano … / szac.
    …`.
  - `src/pages/KanbanPage.tsx` — card `{planned}h` → `formatDuration(planned)`.
  - `src/store/AppStore.tsx` — activity templates switched to `formatDuration`:
    INSERT_BLOCK, REASSIGN_ENTRY, SET_BLOCK_TIME (all three variants + shrink
    suffix), MOVE_BLOCK_TO_BIN, SPLIT_BLOCK, DELETE_BLOCK. Clock ranges in the
    same-time-resize message stay `formatMinutes`.
- **Self-audit:** repo-wide `}h` / `h/dzień` / `fmtHours` / `fmt(` sweep over
  `src/**/*.{ts,tsx}` (excluding tests) leaves ONLY the two `${h}h` literals
  inside `formatDuration` itself. All local `fmt`/`fmtHours` helpers removed (no
  non-duration uses existed). Numeric `<input>`s (AllocationGrid cells, estimate,
  insert-hours, bin add-row), clock times, and `%`/counts untouched.
- **Assertion edits:** none. `blockActions.test.ts` only asserts non-numeric
  substrings of activity messages (`'wróciło do zasobnika'`, `'z zasobnika'`),
  so no formatting-part edits were required.
- **Tests:** `npx tsc --noEmit` clean; `npm test` → 68/68 (64 prior + 4 new
  formatDuration `it`s); `npm run build` success (pre-existing >500kB chunk
  warning only).
- **Deviations:** none. No layout/CSS/WeekView-structure changes; Polish strings
  otherwise byte-identical.
- **Next:** ready for review. Human browser pass should spot-check the sweep:
  a 2h 45m block shows `2h 45m` with `8:00–10:45` clock range intact; day totals
  like `12h 30m`; capacity renders `8h` / `8h/dzień` unchanged for whole hours;
  new activity rows read e.g. `podzielił(a) blok 1h 15m na 2 części (do
  zasobnika: 30m)`.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-08 · reviewer · verdict (walkthrough-fixes run)

- **Status:** APPROVE (with nits)
- **Gates (re-run by reviewer):** `npx tsc --noEmit` clean; `npm test` 68/68
  (4 files, incl. 4 new formatDuration tests); `npm run build` success
  (500kB chunk warning pre-existing).
- **PKG-20260708-week-layout-fix — verified against the package:**
  - Structure matches decision 1 exactly: `.week-head-row` (52px corner +
    overflow-hidden head track + 200px bin head) over `.week-main`
    (52px axis pane / days viewport / 200px bin pane); grep confirms zero
    sticky positioning left in the week-view CSS (remaining sticky rules are
    sidebar/alloc-grid/timeline/drawer — untouched) and zero stale
    `AXIS_W`/`GRID_COLS`/`BIN_COL_INDEX`/`bodyRef`/`scrollRef`/
    `.week-cal-scroll`/`.week-cal-grid` references.
  - Scroll sync is one `onScroll` handler with direct ref assignment
    (WeekView.tsx:477-482), no state/rAF; auto-scroll-to-7:00 repointed to
    the viewport; `scrollbar-gutter: stable` present on BOTH
    `.week-days-viewport` and `.week-head-track`; head-inner and days-grid
    share the identical `max(calc(100%/5*7), 672px)` width formula (the
    worker's in-bounds deviation — correct, required for the 672px floor).
  - **Blocker-3 regression stays fixed under the new geometry:** BinCard
    validity = pointer inside the days-viewport client rect AND column 0..6
    (WeekView.tsx:382-387), with `finish` gating on `!valid` — the viewport
    contains only the grid, so header row, axis pane, bin pane and
    outside-drops all fall outside the rect and revert. Grid→bin is a clean
    `binRef` rect hit-test with collision skipped and `to-bin` tint kept.
  - ≤760px: 672px grid floor lives in the width rule; bin head+pane both
    narrowed to 160px together (alignment preserved).
- **PKG-20260708-duration-format — verified:** `formatDuration` is pure,
  correct, documented as duration-not-clock (time.ts:60-67), 4 meaningful
  tests. Repo-wide audit re-run by me: the only `${…}h` literals left in
  non-test src are inside `formatDuration` itself; all local `fmt`/`fmtHours`
  helpers gone; all seven activity templates in AppStore.tsx use
  `formatDuration` while clock ranges keep `formatMinutes`; numeric inputs
  untouched; no store-logic change beyond message strings; existing
  activity-message assertions unaffected (they assert non-numeric substrings).
- **Codex finding (reviews/2026-07-08-161041-codex-review.md), adjudicated:**
  - P2 `.week-bin-head` wider than `.week-bin-pane` (content-box premise) —
    **REJECTED.** A universal `* { box-sizing: border-box; }` reset exists at
    styles.css:156-158 (pre-dates this run), so the 200px flex basis of
    `.week-bin-head` INCLUDES its 8px/10px padding and 1px border; head cell
    and pane are both exactly 200px outer (160px at ≤760px, narrowed as a
    pair). `.week-corner` (52px) matches `.week-axis-pane` (52px) the same
    way, and `scrollbar-gutter: stable` on both scroll-synced tracks guards
    the remaining misalignment vector Codex worried about. No fix needed;
    header/column alignment stays on the human walkthrough list regardless.
- **Worker-flagged gap, adjudicated:** bin-card drag ghost clipping at the
  bin pane's edge (`overflow-y: auto` pane) — **acceptable-deferred.** Drop
  targeting is pointer/rect-based and unaffected; only the preview visual
  clips. A proper fix needs a portal/fixed-position ghost — out of scope,
  fine as a follow-up if the human wants it.
- **Reviewer nits (non-blocking):**
  - BinCard's `inView` rect includes the viewport's scrollbar strips, so a
    drop on the few-pixel scrollbar area still schedules at a clamped time —
    same tolerance class as the previously approved geometry, negligible.
  - Dated-block (TimedBlock) drags released over the axis/header still clamp
    to a valid day/time — pre-existing behavior carried over unchanged from
    the approved run, not a regression.
  - `formatDuration` assumes non-negative input (no caller passes negative).
- **Convention check:** PASS — no store/selector changes in the layout
  package; Polish strings preserved; `user-select: none` correctly moved onto
  the three panes (context-menu inputs excluded); opaque pane backgrounds;
  reduced-motion untouched; no new localStorage.
- **Human walkthrough (required before merge; code approved):**
  1. Axis fully opaque + never overlaps at every horizontal/vertical scroll
     position; opens at ~7:00; no axis/grid drift after fast wheel scrolling.
  2. Mon–Fri fill at scrollLeft 0; Sat/Sun behind scroll; header↔column
     alignment while scrolling — INCLUDING with macOS "always show scroll
     bars" forced (the scrollbar-gutter path).
  3. Zasobnik + seeded Ola 3h card visible with NO scrolling at 1920px and
     ~1000px widths.
  4. Bin→grid: free-slot drop schedules; same-person collision danger+revert;
     drops over header row / axis pane / bin / outside viewport revert
     (blocker-3 regression cases under the new geometry).
  5. Grid→bin: `to-bin` tint over the pane, drop lands in the bin; Mon→Tue
     ±1h snap+persist; top/bottom resize; two consecutive drags register;
     context menu (przed/po, split, Usuń blok) on dated + bin.
  6. Duration sweep spot-checks: a 2.75h block shows `2h 45m` with
     `8:00–10:45` intact; day total like `12h 30m`; capacity `8h`/`8h/dzień`;
     new activity row e.g. `podzielił(a) blok 1h 15m na 2 części (do
     zasobnika: 30m)`; judge the clipped bin-card drag ghost (deferred item).
  7. ≤760px: 96px/day columns behind scroll, 160px bin, no overlap; month
     view untouched; console clean throughout.
- **Post-merge doc note stands:** CLAUDE.md week-view description + the new
  duration-format convention need the human refresh (per plan, not a worker
  task). Commit hygiene from the previous verdict still applies (untracked
  `src/utils/uiPrefs.ts`, `src/store/selectors.test.ts`, package/review files).
