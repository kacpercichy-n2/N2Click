# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 "Unassigned bin + block split + sidebar collapse";
> 2026-07-08 "Walkthrough fixes"; 2026-07-08 "Hour budget + block merging ·
> accounts/roles/permissions · sidebar icon fix" — committed as ff4fd8a;
> 2026-07-08 "Bug-fix round 2: budget minting holes · bin drag ghost ·
> impersonation trap" — APPROVED after delta re-check, committed as 28b9dae)
> are archived in the git history of this file.
> **Carried-over items still open:** (a) human browser walkthrough of the
> approved runs' interactive criteria (role matrix per role, budget clamp +
> merge animation, availability math, restricted insert picker, workday fill,
> round-2 items: insert-form allowance warnings, TaskModal over-budget banner +
> estimate snap, bin ghost visibility, impersonation banner/return);
> (b) commit hygiene — untracked `automation/`, modified `.gitignore`;
> (c) CLAUDE.md refresh (login/roles/permissions, budget/bin invariants +
> no-mint rule, impersonatorId session model + banner, availability semantics,
> week-view panes) — human task, not a worker package.
> **Carried backlog (non-blocking):** Codex #5 `workDays: []` 0%-vs-overload
> display; pre-existing `insertBlock` end-of-day clamp overlap; status archive
> hides projects from Kanban; `toQuarters` placement (→ utils/time.ts); v4
> payload with zero administrators (promote-first-person idea); framer-motion
> PopChild dev-only ref warning (bump `motion` when fixed or move `menuRef`
> to an inner wrapper).

---

## Run: 2026-07-09 — Bin-drag freeze fix · Timeline people mode · Filter panel UX · Dashboard welcome page

### Plan (architect)

- **Goal:** Four user asks. (1) BUG, highest priority: dragging a card from
  the Zasobnik onto the week grid freezes the site — root-cause and fix.
  (2) Timeline gains a people mode (rows = people with their task bars;
  read-only bars, click opens the task). (3) Replace the select-bar filtering
  on Projects/Tasks/Kanban/Workload with a `Filtry` button + popover panel +
  applied-filter chips + clear-all (presets keep working). (4) Rebuild the
  Panel as the worker's morning page: today's tasks, mock team chat with fake
  presence, SVG donut workload summary (today/week), week strip of the user's
  blocks.

- **Architect's freeze analysis (pre-resolved for the developer):** a full
  static pass found NO unconditional infinite loop in the drop path — the
  `setBlockTime` adjacency-merge `for (;;)` (AppStore ~L913) strictly removes
  one entry per iteration; all reducer/util loops are bounded; every mounted
  effect has deps; no rAF/interval/ResizeObserver. The freeze is therefore
  state- or environment-dependent: reproduce first, then instrument. Ranked
  hypotheses + instrumentation plan are in the package. One adjacent defect is
  CONFIRMED from code: a bin row with `plannedHours > 24` can never be dropped
  (reducer rejects >24h) and reverts with zero feedback — its UX fix is in
  scope of the bug package (danger-tint the ghost + Polish title hint;
  reducer unchanged).

- **Key decisions (pinned in the packages — no open questions):**
  - Timeline people mode: `Projekty | Osoby` toggle; person groups in list
    order; one row per involved task (assignment OR workload entry); bars
    STATIC (`editable={false}`) — no drag in people mode (dragging one
    person's bar would reschedule every assignee); click opens TaskModal;
    PersonFilter narrows people, client select narrows tasks.
  - Filter panel: single-select radio groups (SavedFilterCriteria and stored
    presets stay 100% compatible — no storage change); live apply, no
    "Zastosuj"; chips per active criterion + `Wyczyść wszystko`; pages:
    Projects, Tasks, Kanban, Workload; PersonFilter chip rows untouched;
    `PaidFilterToggle` retired once both users are migrated.
  - Dashboard: NO new priority field this run — ordering = today's blocks by
    `startMinutes`, then dateless in-period assigned tasks by nearest
    deadline; chat is an explicit mockup (deterministic fake presence,
    component-state-only messages + canned reply, `Wersja demonstracyjna`
    badge, nothing persisted); donuts are plain SVG; old dashboard cards
    removed entirely; two new pure selectors (`todayAgendaForPerson`,
    `weekBlocksForPerson`) so the page stays selector-only.

- **Packages** (sequential — 2/3/4 all touch styles.css; 5 needs 4):
  1. `handoffs/packages/PKG-20260709-bin-drop-freeze.md` — tier: developer —
     reproduce + root-cause + fix the freeze; >24h bin-drop UX; regression
     test if reducer-level.
  2. `handoffs/packages/PKG-20260709-timeline-people-view.md` — tier:
     developer — Osoby mode on the timeline (read-only bars, shared zoom/nav).
  3. `handoffs/packages/PKG-20260709-filter-panel.md` — tier: developer —
     shared FilterPanel component + 4 page integrations + chips/badge CSS.
  4. `handoffs/packages/PKG-20260709-dashboard-welcome.md` — tier: developer —
     Panel rewrite (4 sections) + 2 new selectors + ChatMock.
  5. `handoffs/packages/PKG-20260709-dashboard-selector-tests.md` — tier:
     test-writer — unit tests for the 2 new selectors (test file only).

- **Gates:** `npx tsc --noEmit` + `npm test` + `npm run build` green after
  every package (baseline 186/186; dev server already running on 5173 —
  nobody starts a second one). Console free of errors on the walked-through
  pages. Reviewer verdict after all packages; human walkthrough items
  collected from worker reports.
- **Open questions:** none. Post-run human note: CLAUDE.md refresh (carried
  item c) must additionally cover the timeline people mode, the FilterPanel
  pattern, the rebuilt Panel, and the bug's root cause once known.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-09 · developer (opus) · `PKG-20260709-bin-drop-freeze`

- **Root cause (H4 — confirmed, component-level, cross-checked with Codex):**
  `src/components/WeekView.tsx` `BinCard.begin` called
  `(e.target as HTMLElement).setPointerCapture(e.pointerId)`. `e.target` is the
  innermost node under the pointer — a child `<span>` of the card. On a valid
  bin→grid drop, `finish` dispatches `SET_BLOCK_TIME`; the entry stops being a
  bin entry, so React synchronously (discrete pointerup flush) UNMOUNTS the
  BinCard and the captured child span mid-event. The browser's implicit
  pointer-capture release never completes cleanly on a node detached during its
  own pointerup, wedging document-wide pointer delivery → the site "freezes"
  (no unconditional render/reducer loop — the `setBlockTime` merge `for(;;)`
  is strictly bounded, as the architect's static pass found). The portal ghost
  makes it reproduce reliably (visible drag target lives outside the captured
  subtree). `TimedBlock` used the same `e.target` capture but a same-grid move
  never unmounts it, so it never freezes — but its grid→bin drop
  (`MOVE_BLOCK_TO_BIN`) has the same latent risk, so it got the same fix.
- **Fix:** capture on the stable card/block root (`e.currentTarget`) instead of
  `e.target`, and explicitly `releasePointerCapture` (via a `captureRef`) BEFORE
  any state-changing dispatch and on the Escape / pointercancel paths, in both
  `BinCard` and `TimedBlock`.
- **Adjacent defect fixed (confirmed):** a bin row with `plannedHours > 24`
  (or off the 0.25h grid) can never be dropped — `setBlockTime` L789 rejects
  it. Previously it snapped home silently. Now `BinCard` flags it `unplaceable`:
  the drag reads as colliding the whole time (danger-tinted ghost, drop reverts
  with no doomed dispatch) and the card `title` explains why in Polish
  (`Blok jest dłuższy niż doba — podziel go, aby nadać termin.`). Reducer
  unchanged.
- **Changed:** `src/components/WeekView.tsx` — `BinCard` + `TimedBlock` capture
  on `currentTarget` + `releaseCapture()` before dispatch/on cancel/Escape;
  `BinCard` `unplaceable` danger-tint + Polish title hint for > 24h/off-grid
  rows; `src/store/blockActions.test.ts` — regression case asserting a > 24h bin
  drop returns the same state ref.
- **Tests:** `npx tsc --noEmit` clean · `npm test` → 187 passed (186 baseline +
  1 new) · `npm run build` → OK.
- **Still broken:** nothing found. The freeze root cause is component-level
  (pointer-capture/unmount) so it has no unit test — see manual walkthrough
  below.
- **Manual walkthrough (for the human/reviewer):** (a) drag a normal bin card
  onto a free grid slot → it lands with the target date + snapped startMinutes,
  the bin row disappears, day totals update, page stays responsive, console
  clean; (b) repeat several times in a row → no lockup; (c) a > 24h bin row
  (e.g. from repeated shrink/merge) shows the danger tint the whole drag, its
  drop reverts, and its tooltip explains why; (d) plain click on a bin card
  still opens the task; Escape mid-drag still cancels; a bin drop onto an
  occupied slot still reverts (collision).
- **Next:** ready for review; then next package `PKG-20260709-timeline-people-view`.

#### 2026-07-09 · developer (opus) · `PKG-20260709-timeline-people-view`

- **Changed:** `src/pages/TimelinePage.tsx` — added `Projekty | Osoby` mode
  toggle (`cal-view-toggle` button group, plain `useState`, not persisted);
  new `peopleView` useMemo (person groups in people-list order, narrowed by
  ownerFilter + client filter; involved task = assignment OR any workload entry
  dated/bin; sorted startDate then title; per-person planned total via
  `entriesForTaskPerson`); people-mode rendering reuses `Bar` with
  `editable={false}` + `resizable={false}` (click/Enter opens TaskModal), shared
  `DayStripes`/zoom/range/nav; mode-aware hint text + empty state
  (`Brak zadań do wyświetlenia`). `src/styles.css` — `.timeline-person-row`,
  `.timeline-person-label`, `.timeline-person-dot` (person color dot) using
  existing `--n2-*` tokens.
- **Decisions within bounds:** people-mode `Bar` gets a no-op `onCommit`
  (required prop; no pointer handlers fire because `editable`/`resizable` are
  false, verified in the `Bar` body — drag/resize handlers are gated on
  `editable`). Added a second `cal-view-toggle` group rather than merging with
  the week-range presets. peopleView memo depends on state slices
  (people/tasks/assignments/workload/projects) + filters, mirroring the `view`
  memo style — not whole `state`.
- **Tests:** `npx tsc --noEmit` clean · `npm test` → 187 passed (no new tests;
  read-only view, per package) · `npm run build` → OK.
- **Still broken:** nothing found.
- **Manual walkthrough (for the human/reviewer):** (a) Oś czasu defaults to
  `Projekty`; project mode unchanged (bars drag/resize, milestones, overdue
  tint); (b) switch to `Osoby` → one group per seeded person with their task
  bars at correct offsets/spans, status colors match, tooltip shows
  `{title}: {start} – {end} — {osoba}: {Xh} zaplanowane`; (c) click a bar →
  TaskModal opens; bars don't drag/resize; (d) PersonFilter narrows which
  person groups show, client select narrows tasks; person with no matching
  task is omitted; empty state appears when nothing matches; (e) zoom +
  week-range presets + prev/today/next + weekend stripes + today line all work
  in Osoby mode; console clean.
- **Next:** ready for review; then next package `PKG-20260709-filter-panel`.

#### 2026-07-09 · developer (opus) · `PKG-20260709-filter-panel`

- **Changed:** `src/components/FilterPanel.tsx` — NEW shared component: `Filtry`
  button + active-count badge, popover of radio option groups + optional
  date inputs (`<fieldset><legend>` + native inputs), applied-filter chips with
  per-chip ✕, footer `Wyczyść wszystko`; closes on outside mousedown / Escape /
  toggle (WeekView pattern, no scrim). `src/pages/ProjectsPage.tsx` — removed
  `PaidFilterToggle` component (kept `PaidFilter` type export); toolbar now
  renders `FilterPanel` (groups Płatność/Klient/Status + dates) + a result
  count. `src/pages/TasksPage.tsx` — replaced the `<select>` filter-controls with
  `FilterPanel` (Klient/Status/Osoba + dates); dropped now-unused `anyFilter`;
  kept the `X z Y zadań` count. `src/pages/KanbanPage.tsx` — `FilterPanel`
  (Płatność/Klient, no dates); import switched from `PaidFilterToggle` to
  `type PaidFilter`. `src/pages/WorkloadPage.tsx` — `FilterPanel`
  (Dział/Klient/Rodzaj usługi, no dates). `src/styles.css` — filter panel/badge/
  popover/group/option/chip styles + ≤760px full-width static popover.
- **Decisions within bounds:** (a) added a `X z Y projektów` result count to
  Projects (it had none) so the acceptance line "result counts still render on
  Projects/Tasks" holds; no filtering-logic change. (b) date criteria (`from`/
  `to`) each render as their own chip (`Od:`/`Do:` via `formatShort`) and count
  toward the badge — consistent with "one chip per active criterion". (c) date
  group legend labeled `Okres` (labels inside are `Od`/`Do` per pinned #9). (d)
  `PaidFilter` type export kept on ProjectsPage (Kanban still uses it); only the
  `PaidFilterToggle` component was deleted. Filtering `useMemo` predicates and
  `SavedFilterCriteria`/presets left untouched — presentation swap only.
- **Tests:** `npx tsc --noEmit` clean · `npm test` → 187 passed (no logic
  change, no new tests) · `npm run build` → OK · `rg PaidFilterToggle src` → no
  hits.
- **Still broken:** nothing found. (Dead `.filter-controls` CSS left in place —
  harmless, was Tasks-only; not removed to keep the diff tight.)
- **Manual walkthrough (for the human/reviewer):** (a) each of Projects/Tasks/
  Kanban/Workload shows a `Filtry` button; no inline `<select>` bar remains;
  (b) opening the panel shows radio groups (first option neutral) + date inputs
  where applicable; picking an option applies live and updates results, badge
  and chips; (c) badge count == number of active criteria; each chip ✕ clears
  only its criterion; `Wyczyść wszystko` resets all + hides badge; (d) panel
  closes on outside click / Escape / button re-click; usable full-width at
  ≤760px; (e) Projects `?client=` deep-link still pre-filters and shows its
  Klient chip; (f) Projects/Tasks presets: applying a saved preset updates panel
  state/badge/chips; saving a preset from panel-set filters round-trips; (g)
  console clean.
- **Next:** ready for review; then next package `PKG-20260709-dashboard-welcome`.

#### 2026-07-09 · developer (opus) · `PKG-20260709-dashboard-welcome`

- **Changed:** `src/pages/DashboardPage.tsx` — full rewrite into the worker's
  morning page: greeting header (`Dzień dobry, {firstName}` + `formatRowLabel`)
  and 4 motion-staggered cards — (a) `Zadania na dziś` (timed blocks then
  dateless in-period assigned tasks, rows open the TaskModal via `useOpenTask`),
  (b) `Zespół` mock chat card with `Wersja demonstracyjna` badge, (c)
  `Obciążenie` two SVG donuts (Dziś / Ten tydzień), (d) `Twój tydzień` 7-col Mon–Sun
  block strip; old pipeline/terminy/płatności/przeciążenia cards removed; setup
  empty-state (no resolvable current user) preserved verbatim.
  `src/components/ChatMock.tsx` — NEW: coworkers list + deterministic-per-day
  fake presence dots + bottom-right chat popup with component-state-only messages
  and a ~1s canned reply; nothing persisted. `src/store/selectors.ts` — NEW pure
  selectors `todayAgendaForPerson` (timed + dateless split per pinned rule) and
  `weekBlocksForPerson` (Map<DateStr, WorkloadEntry[]>). `src/styles.css` — new
  dashboard-welcome section: 2×2 grid ≥1180px / single-column ≤1180px, agenda
  rows, chat people/popup (full-width bottom sheet ≤760px), donuts, week strip
  (2-col ≤760px).
- **Decisions within bounds:** (a) `WorkloadDonut` is a local component in
  DashboardPage (plain SVG two-circle ring, `--n2-lavender` fill / `--n2-danger`
  when booked > available, guarded ratio/pct so 0 availability → empty ring +
  `0h / 0h`, 0%). (b) Row separators from pinned #2/#5 rendered as flex layout +
  a `→` between project and client rather than literal `·` glyphs, matching the
  existing `dash-row` style. (c) Presence hash lives inside ChatMock (pure, uses
  only `todayStr()`), not a selector — it is mock data, not app state. (d)
  Greeting date uses `text-transform: capitalize` since `formatRowLabel` is
  lowercase Polish weekday.
- **Tests:** `npx tsc --noEmit` clean · `npm test` → 187 passed (no new tests;
  selector unit tests are the follow-up test-writer package) · `npm run build`
  → OK.
- **Still broken:** nothing found.
- **Manual walkthrough (for the human/reviewer):** (a) `/dashboard` shows the
  greeting + exactly 4 sections; old cards gone; (b) as Kasia, `Zadania na dziś`
  lists today's blocks in start-time order with `H:MM–H:MM` ranges + project→client
  + StatusBadge, clicking opens the TaskModal; switching acting user re-renders
  (a)/(c)/(d); (c) chat: coworkers with presence dots, popup opens/closes, sending
  echoes + canned reply after ~1s, `n2hub.data.v1` byte-identical after chatting;
  (d) donuts show correct ratio, danger color when overloaded, no NaN with 0
  availability; (e) week strip Mon–Sun, today highlighted, weekend tinted,
  `+n więcej` past 4; (f) empty store → welcome empty-state + sample banner still
  works; console clean.
- **Next:** ready for review; then final package `PKG-20260709-dashboard-selector-tests` (test-writer).

#### 2026-07-09 · test-writer (sonnet) · `PKG-20260709-dashboard-selector-tests`

- **Changed:** `src/store/selectors.test.ts` — 8 new behavioral tests, test
  file only (`git diff --stat` confirms 211 insertions / 1 deletion in this
  file alone; no production file touched). `describe('todayAgendaForPerson')`
  (6 tests — one per case group in the package): timed sorted by
  `startMinutes` excluding other people/dates; a bin entry (`date===BIN_DATE`)
  never appears in `timed` for a real-date query; a dateless task with no
  same-day entry appears while the same task WITH a same-day entry doesn't
  (and shows up in `timed` instead); dateless excludes period-before, period-
  after, assigned-to-someone-else, and done-status (last active status)
  tasks all in one fixture; dateless ordering by ascending `endDate` then
  title tiebreak; empty assignments/entries → both arrays `[]`.
  `describe('weekBlocksForPerson')` (2 tests): a 7-day Mon-start week fixture
  asserts one key per requested date (`Array.from(map.keys())` order-equal to
  the input dates), each list sorted by `startMinutes`, and days with no
  entries map to an explicit empty array (verified `map.has(...)` true +
  `toEqual([])`, matching the JSDoc "days with no blocks map to an empty
  array" contract — no missing keys); a second test confirms other people's
  entries and bin entries (`date===BIN_DATE`) never leak into any date's list.
- **Tests:** `npx tsc --noEmit` → clean · `npm test` → 195 passed (187
  baseline + 8 new, 0 removed).
- **Spec-vs-implementation mismatches:** none found — both selectors matched
  their JSDoc/package contract on every case tried (no fix needed, none made).
- **Still broken:** nothing found.
- **Next:** ready for review — this was the last package in the 2026-07-09
  run.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-09 · reviewer · run verdict

- **Status: approve-with-nits.** No code blockers. One commit-hygiene action is
  required before committing (finding 1); nothing routes back to a worker.
- **Gates re-verified by the reviewer (not taken on faith):**
  `npx tsc --noEmit` clean · `npm test` 195/195 · `npm run build` OK
  (pre-existing chunk-size warning only).
- **Codex adjudication** (reviews/2026-07-09-012504-codex-review.md):
  1. **P1 untracked `ChatMock.tsx` / `FilterPanel.tsx` — ACCEPTED (required,
     commit hygiene).** Both files are imported by tracked pages; a commit made
     from tracked files alone won't compile. Action for the orchestrator/human:
     `git add src/components/ChatMock.tsx src/components/FilterPanel.tsx`
     alongside the rest of the change set. Not a worker code change.
  2. **P2 donut zero-availability — ACCEPTED as a non-blocking nit.**
     `src/pages/DashboardPage.tsx:61-62`: `over = available > 0 && booked >
     available` means available=0 with booked>0 renders "Xh / 0h", 0%,
     non-danger. The package's pinned rule "danger when booked > available" is
     unqualified, but its 0-availability clause only contemplated booked=0, and
     this is the same display class as the already-carried backlog item
     "Codex #5 `workDays: []` 0%-vs-overload". Suggested fix when picked up:
     `over = booked > available` (with a full danger ring + explicit state when
     `available <= 0 && booked > 0`). → folded into the carried backlog.
  3. **P2 people-mode conflict markers are task-wide — DISMISSED as a blocker;
     logged as a backlog candidate.** `src/pages/TimelinePage.tsx` (peopleView
     memo) uses `conflictDatesForTask(state, t.id)` because pinned decision #4
     of PKG-20260709-timeline-people-view says "Reuse `conflictOffsets` exactly
     as project mode does" — the worker implemented the spec. Codex's
     observation is a real UX nuance (a person's row can show ⚠ caused by a
     different assignee), but deviating needs an architect decision + a new
     selector (`conflictDatesForTaskPerson(taskId, personId)`). → architect
     backlog, optional.
- **Reviewer's own pass (nothing blocking found):**
  - Freeze fix verified line-by-line: capture moved to `currentTarget`,
    `releaseCapture()` runs BEFORE every state-changing dispatch and on
    Escape/pointercancel in BOTH `TimedBlock` and `BinCard`; the resize-handle
    capture path (`begin('top'|'bottom')` captures the handle span) is also
    safe because release always precedes any potentially-unmounting dispatch
    (e.g. an adjacency merge removing the entry). Symmetry requirement of the
    package met. The `unplaceable` >24h/off-grid guard avoids the doomed
    dispatch and keeps the reducer authoritative.
  - FilterPanel: filtering `useMemo` predicates untouched on all four pages
    (presentation swap only, as required); presets + `?client=` deep-link
    effect intact (ProjectsPage L68-71); `rg PaidFilterToggle src` → no hits;
    `PaidFilter` type export deliberately retained for KanbanPage — accepted
    deviation, documented in the worker log.
  - Dashboard/selectors: `todayAgendaForPerson` / `weekBlocksForPerson` are
    pure, match their JSDoc and the pinned ordering rules (done-status excluded
    from dateless only — per spec); ChatMock persists nothing (no
    localStorage/AppStore imports), timer cleaned up on unmount; page reads are
    selector-based; no reducer/storage changes anywhere in the run.
  - CSS: additions only (zero deleted lines in styles.css), every new class
    referenced by TSX exists, `--n2-*` tokens used, ≤1180px/≤760px handled.
    Dead `.filter-controls` rules left behind — harmless, worker documented it.
  - Convention check: **pass** — Polish UI strings throughout, plain CSS, no
    new dependencies (package.json untouched), 'yyyy-MM-dd' dates, Monday
    weeks, no direct localStorage, no scattered mutations.
  - Test coverage: **adequate** — 1 reducer regression (>24h bin drop returns
    same state ref) + 8 behavioral selector tests with real fixtures (no
    tautologies; empty-day map contract, bin exclusion, ordering and
    done/period/assignee exclusions all asserted). The pointer-capture fix
    itself is browser-only behavior → correctly deferred to the manual
    walkthrough.
- **Route-back:** none to workers. Before commit: stage the two untracked
  components (finding 1). Human walkthrough queue: the four workers' listed
  items (bin-drop drag/revert/Escape, Osoby mode, filter panel on 4 pages,
  dashboard sections + chat persistence check) plus the carried-over items
  from the 2026-07-08 runs.
