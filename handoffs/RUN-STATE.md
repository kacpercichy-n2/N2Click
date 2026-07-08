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
