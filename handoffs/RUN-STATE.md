# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

---

## Run: 2026-07-08 — Timed week-view scheduling (Google-Calendar-style)

### Plan (architect)

- **Goal:** Add time-of-day scheduling to the calendar Week view: hour axis,
  blocks positioned/sized by start time + duration on a 15-min grid,
  pointer-drag to move (same day or cross-day) and edge-drag to resize, with
  same-person collision rejection (visual danger feedback, invalid drops
  revert). Capacity overload stays a warning, never a block.
- **Codebase note for reviewer:** CLAUDE.md remains partially stale — dark
  `--n2-*` restyle done, `TaskModal` replaced TaskEditorPage, UI is Polish,
  icons via `src/components/icons.ts`, `motion` is a dependency,
  `savedFilters`/`REASSIGN_ENTRY` exist. Packages reflect real code.
- **Key decisions (pre-resolved, no open questions):**
  - `WorkloadEntry.startMinutes: number` (minutes from midnight, multiple of
    15, block fits 0–1440). `DATA_VERSION` 3 → 4; idempotent
    `ensureStartMinutes` pass in `loadData` stacks legacy entries per
    (person, day) from 08:00 in `sortIndex` order.
  - `sortIndex` KEPT but derived from time order: `reindexDays` now sorts by
    `(startMinutes, sortIndex)` and renumbers — invariant 7 (contiguous per
    person/day) holds and equals time rank.
  - Hours granularity: ONE rule — multiples of 0.25 h in [0.25, 24]
    everywhere (AllocationGrid + insert form move from step 0.5 to 0.25).
  - One new action `SET_BLOCK_TIME { entryId, date, startMinutes, plannedHours }`
    handles move AND resize; reducer validates grid/range/collision/92-day
    task cap and returns state unchanged on rejection; activity via
    `withActivity`; UI also pre-checks via new `blockCollides` selector.
  - New-entry start times: append-to-end-of-day (`nextFreeStart`); SAVE_TASK
    keeps existing cells' startMinutes; INSERT_BLOCK becomes a ripple insert
    at ref start/end pushing only that person's later overlapping blocks;
    REASSIGN_ENTRY appends to the target's day end.
  - Non-calendar mutations MAY create same-person overlaps (task editor hour
    edits); the week grid renders overlaps side-by-side via a pure
    `packDayBlocks` packing helper. Only calendar drag/resize enforces
    no-overlap.
  - New pure module `src/utils/time.ts` (constants, snapping, formatting,
    collision, stacking, packing) — unit-testable; vitest introduced (node
    env, `npm test`) as the repo's first test setup.
- **Packages** (execution order):
  1. `PKG-20260708-timed-blocks-core` — types, v4 migration, utils/time.ts,
     selectors, reducer (`SET_BLOCK_TIME`, ripple INSERT_BLOCK, SAVE_TASK
     start rules, reindexDays), seed, step=0.25 inputs — tier: developer
  2. `PKG-20260708-week-timed-ui` — WeekView timed grid + drag/resize +
     collision feedback + context-menu preservation + CSS — tier: developer
     (depends: 1)
  3. `PKG-20260708-time-tests` — vitest setup + unit tests for utils/time.ts
     and SET_BLOCK_TIME/INSERT_BLOCK reducer behavior — tier: test-writer
     (depends: 1; parallel-safe with 2, owns package.json)
- **Open questions:** none blocking. Post-merge doc note for the human:
  CLAUDE.md invariant text ("0.5 steps", sortIndex wording, week-view
  description) needs refreshing once this lands — intentionally NOT part of
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

#### 2026-07-08 · developer · `PKG-20260708-timed-blocks-core`

- **Changed:**
  - `src/utils/time.ts` (NEW) — pure time math: constants, snap/clamp/format,
    `rangesOverlap`/`hasCollision`, `stackStartTimes`, `nextFreeStart`,
    `packDayBlocks`; no React/date-fns/state imports.
  - `src/types.ts` — `WorkloadEntry.startMinutes: number` (required) + invariant comment.
  - `src/store/storage.ts` — `DATA_VERSION = 4`; `ensureStartMinutes(data)` normalize
    pass wired into every `loadData` path (v1 + v<4 + valid); migrateV1 emits sentinel
    `startMinutes: -1` for restacking.
  - `src/store/seed.ts` — `addWork` stacks `startMinutes` from 08:00 per person/day
    via `nextFreeStart` (Marek Wed = 8:00–14:00 then 14:00–18:00).
  - `src/store/AppStore.tsx` — `reindexDays` sorts by `(startMinutes, sortIndex)`;
    `saveTask` keeps kept cells' start/sortIndex + appends new cells; `insertBlock`
    is now a ripple insert (ref start/end + forward sweep, reindex); `reassignEntry`
    appends to target day end; new `SET_BLOCK_TIME` action + handler (validation,
    collision reject, 92-day period extend, activity).
  - `src/store/selectors.ts` — `blockEnd(entry)`, `blockCollides(...)`; `blocksForPersonDate`
    still sorted by sortIndex (now == time order).
  - Step attrs → 0.25: `AllocationGrid` cell input, `WeekView` insert-form (`min`+`step`),
    `TaskModal` estimate input. (Capacity inputs in People pages left at 0.5 — not in
    package's file list, capacity is a distinct concept.)
- **Tests:** `npx tsc --noEmit` → No errors; `npm run build` → built OK, no new warnings.
  (Unit tests are PKG-20260708-time-tests.)
- **Still broken:** nothing.
- **Next:** ready for `PKG-20260708-week-timed-ui` (developer) + `PKG-20260708-time-tests`
  (test-writer); then reviewer.

#### 2026-07-08 · test-writer · `PKG-20260708-time-tests`

- **Changed:**
  - `package.json` — added devDependency `vitest@^4.1.10`; new script `"test": "vitest run"` (existing scripts untouched).
  - `package-lock.json` — updated by `npm install --save-dev vitest`.
  - `vitest.config.ts` (NEW) — `test: { environment: 'node', include: ['src/**/*.test.ts'] }`, no `globals`.
  - `src/utils/time.test.ts` (NEW) — 17 tests covering `snapToStep`, `formatMinutes`, `rangesOverlap`, `hasCollision` (incl. `excludeId`), `stackStartTimes` (incl. 24:00-clamp quirk), `nextFreeStart` (empty day / snap-up / end-clamp), `packDayBlocks` (empty / non-overlap / overlap-cols / transitive chain).
  - `src/store/blockActions.test.ts` (NEW) — 15 tests against `reducer` from `src/store/AppStore.tsx`: `SET_BLOCK_TIME` happy-path same-day move (sortIndex re-rank + 1 activity row), cross-day move (date update, contiguous sortIndex both days, task period extends), 5 rejection cases (same-person overlap, off-grid start, non-0.25 hours, past-24:00, unknown entryId — all assert `toBe(state)` reference equality), cross-person non-collision; `INSERT_BLOCK` przed/po placement + ref push, large-gap block untouched, other person's entry untouched (`toEqual` unchanged), auto-assign on insert.
- **Tests:** `npm test` → 2 files, **32/32 passed**. `npx tsc --noEmit` → no errors. `npm run build` → succeeds (492KB bundle, unchanged shape).
- **Core-package gaps found:** none — every exported name in `src/utils/time.ts` and both reducer actions matched the package's described signatures/behavior on first read; no app source files were touched.
- **Deviations/notes:** none from spec. One authoring mistake caught by the test run itself (an initial "happy path" fixture used a non-15-min-grid `startMinutes`, which the reducer correctly rejected) — fixed the fixture, not the assertion.
- **Still broken:** nothing.
- **Next:** ready for Codex review / reviewer, once `PKG-20260708-week-timed-ui` also lands.

#### 2026-07-08 · developer · `PKG-20260708-week-timed-ui`

- **Changed:**
  - `src/components/WeekView.tsx` — full rewrite of the grid + interactions. New
    `.week-cal` layout: sticky day headers (totals + ⚠ overload names kept), a
    52px left hour axis (0:00–23:00 labels), 7 day columns (1152px = 24×48px)
    inside a `max-height:70vh` scroll wrapper that auto-scrolls to 07:00 on mount.
    New `TimedBlock` component (pointer-capture drag, TimelinePage `Bar` pattern):
    move (vertical→time 15-min snap, horizontal→day column via grid rect),
    top-edge resize (start moves, end fixed), bottom-edge resize (hours only);
    live `blockCollides` check adds `.colliding` danger tint; drop dispatches ONE
    `SET_BLOCK_TIME`, reverts on collision, treats no-move as a click (opens task).
    Escape / `onPointerCancel` cancel the drag. Blocks pack side-by-side via
    `packDayBlocks`; show coin + title + `H:mm–H:mm` range + person dot/name/hours.
    Context menu (Dodaj przed/po, overload warning, INSERT_BLOCK) preserved
    verbatim; drag guarded to primary button so right-click still opens the menu.
  - `src/styles.css` — replaced the `.week-*` section (grid template
    `52px repeat(7,1fr)`, sticky headers, hour+half-hour lines via
    repeating-linear-gradient, absolute-positioned blocks, `.dragging`/`.colliding`,
    6px `ns-resize` handle strips, `touch-action:none`). 760px media query now
    horizontal-scrolls the grid (min-width 720px) instead of collapsing to 1 col.
  - `src/pages/CalendarPage.tsx` — unchanged (confirmed: `Props { state, anchor,
    filter }` kept identical).
- **Tests:** `npx tsc --noEmit` → No errors; `npm run build` → built OK (492KB
  JS / 52.6KB CSS, no new warnings). package.json NOT touched.
- **Could not verify without a browser:** the interactive acceptance items
  (drag/resize persistence + reload, side-by-side render on cross-person overlap,
  collision revert, scroll-to-7 on mount, overload ⚠ on resize). Logic follows the
  package decisions and the store/selectors are the source of truth for all drops.
- **Deviations:** blocks are now `div[role=button]` (was `<button>`) because the
  two resize handles are nested interactive elements — a button can't contain them.
- **Known gap (per package):** no keyboard-drag a11y — blocks stay
  click-to-open / Enter-to-open only.
- **Still broken:** nothing.
- **Next:** ready for Codex review / reviewer.
- **Follow-up (browser QA fix):** added `user-select: none` (+ `-webkit-`) to
  `.week-cal-grid` in `src/styles.css` — a drag across a block used to select its
  text and hijack the next drag into a native text-drag. `tsc` clean, `npm test`
  37/37, `npm run build` OK.

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->

#### 2026-07-08 · reviewer · verdict

- **Status:** approve-with-nits
- **Verified myself:** `npx tsc --noEmit` clean; `npm run build` OK (492.35KB JS /
  52.64KB CSS); `npm test` 32/32. Diff read structurally against all three
  packages + CLAUDE.md invariants.
- **Blockers:** none.
- **Nits / follow-ups (non-blocking):**
  1. [P1, PRE-EXISTING — route to ARCHITECT for a follow-up package]
     `src/components/TaskModal.tsx:297` + `src/store/AppStore.tsx:273` — the
     editor's allocation map and SAVE_TASK's `oldPos` are keyed `personId|date`,
     so two same-task/person/date blocks (creatable via the insert menu, whose
     task picker defaults to the ref block's task) collapse to one on task save
     — silent hours loss. Verified identical at HEAD, so NOT introduced by this
     run, but the timed view makes multi-block days more likely. Needs a design
     decision (support multiple cells vs. prevent duplicates) — not a mechanical
     dev fix.
  2. [P3 — route to DEVELOPER] Off-grid planned hours (typed, e.g. 1.3 —
     `step=0.25` is UI-only) persist via SAVE_TASK/INSERT_BLOCK
     (`src/components/WeekView.tsx:317-326`, `src/store/AppStore.tsx:474`) and
     then `SET_BLOCK_TIME` (`src/store/AppStore.tsx:615`) rejects every drag of
     that block silently. Suggested: snap/validate hours in the write paths.
     (`ensureStartMinutes` heals startMinutes on reload but not hours.)
  3. [P3 — route to TEST-WRITER] No unit test for `ensureStartMinutes`
     (`src/store/storage.ts`) — the architect's declared riskiest area. It's
     exported; cheap to cover (v3 payload without startMinutes, invalid-group
     restack, idempotency). Package didn't require it, so gap not a violation.
  4. Interactive acceptance items (drag/resize persistence, collision revert,
     scroll-to-7:00, side-by-side render) unverified by any tier — human browser
     pass of the week-timed-ui criteria recommended before commit.
- **Codex findings (script ran OK this time — 4 findings, adjudicated):**
  - #1 TaskModal collapse → ACCEPTED as nit 1 (pre-existing, architect follow-up).
  - #2 "untracked files won't be committed" → DISMISSED as a code finding;
    valid process note: `git add` must include `src/utils/time.ts`,
    `src/utils/time.test.ts`, `src/store/blockActions.test.ts`, `vitest.config.ts`.
  - #3 INSERT_BLOCK end-of-day clamp overlap → DISMISSED: explicitly accepted in
    the architect's decisions (clamp rule; overlaps allowed for non-calendar
    mutations, rendered side-by-side). Same for `stackStartTimes` 24:00-clamp
    (test-writer's flag) — migration-only pathological >16h days, accepted.
  - #4 step=0.25 not enforced → ACCEPTED as nit 2.
- **Convention check:** PASS — no localStorage outside storage.ts; every
  mutation one reducer action with `withActivity`; reads via selectors; dates
  stay yyyy-MM-dd; overload warns, never blocks; deletes/cascades untouched;
  `reindexDays` keeps sortIndex contiguous (== time rank); plain CSS with
  `--n2-*` tokens incl. `--n2-danger` for collision; pointer events, no drag
  lib; only new dep is vitest (dev). Deviations accepted: capacity inputs stay
  step 0.5 (capacity ≠ planned hours); block is `div[role=button]` (nested
  resize handles); known gap: no keyboard-drag a11y (per package).
- **Test coverage:** adequate for utils/time.ts + SET_BLOCK_TIME/INSERT_BLOCK
  (real assertions incl. reference-equality rejection checks); gaps: migration
  normalize pass (nit 3), no UI tests (out of scope by design).
- **Next:** architect final eval → commit (include untracked files). CLAUDE.md
  refresh (0.5→0.25 wording, week-view description) stays a post-merge human task.

#### 2026-07-08 · test-writer · follow-up (reviewer nit 3)

- **Changed:**
  - `src/store/storage.test.ts` (NEW) — 5 tests for `ensureStartMinutes`:
    (a) a group with an invalid/missing `startMinutes` (sentinel `-1`, matching
    `migrateV1`'s own convention) gets fully restacked from 08:00 in `sortIndex`
    order, including the case where only ONE entry in the group is invalid but
    the whole group still restacks; (b) a fully valid, on-grid group is left
    untouched — asserted via `toBe(state)` reference equality, and a second
    pass on the result is also a no-op (idempotence); (c) an off-grid but
    in-range value (487) is snapped to the grid (480) without restacking its
    valid sibling; (d) a pathological >24h restacked day clamps the second
    block's start below where the first ends (240 < 1080 end) — asserted as
    the implemented/accepted behavior per the reviewer's note, not treated as
    a bug.
- **Tests:** `npm test` → 3 files, **37/37 passed** (32 pre-existing + 5 new).
  `npx tsc --noEmit` → no errors. `npm run build` → succeeds, bundle shape
  unchanged.
- **Concurrent-edit check:** re-ran the full existing suite before and after
  adding the new file while `PKG-20260708-week-timed-ui`'s AppStore.tsx edits
  were landing; all 32 pre-existing tests still passed unchanged — no stale
  hours-snapping assertions found, nothing needed updating.
- **Still broken:** nothing.
- **Next:** ready for re-review / architect final eval.

#### 2026-07-08 · developer · follow-up (reviewer nit 2 — off-grid hours on write)

- **Changed:**
  - `src/utils/time.ts` — new `snapHours(h)` helper (rounds planned hours to the
    0.25h grid).
  - `src/store/AppStore.tsx` — `saveTask` and `insertBlock` snap `plannedHours`
    via `snapHours` before persisting (silent snap, no blocking error); the
    zero-guard now runs on the snapped value so a value rounding to 0 is dropped;
    INSERT_BLOCK activity message uses the snapped hours. Closes the loop where a
    typed off-grid value (e.g. 1.3) made every later `SET_BLOCK_TIME` drag reject
    silently. (Kept cells in SAVE_TASK still hold their existing start/sortIndex;
    only the persisted hours are now grid-safe.)
- **Tests:** `npx tsc --noEmit` → No errors; `npm test` → 3 files, **37/37 passed**;
  `npm run build` → built OK. Did NOT touch test files or package.json.
- **Still broken:** nothing. (Nit 1 = pre-existing architect decision; nit 3 now
  covered by test-writer above; nit 4 = human browser pass.)
- **Next:** ready for re-review / architect final eval.
