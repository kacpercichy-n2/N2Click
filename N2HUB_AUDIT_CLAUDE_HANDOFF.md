# N2Hub audit — Claude handoff

Audit date: 2026-07-15  
Repository: N2Hub / N2click  
Reviewed baseline: `e9ab6e5` on `review/claude-auto-20260714-1216`

## Instructions for Claude

Start by reading `CLAUDE.md` and follow its repository rules. Use only the
OpenWiki pages listed under **Context used** unless a concrete dependency
requires an expansion. Record every expansion. Preserve unrelated worktree
changes and do not add a backend, authentication, cloud sync, or other
out-of-scope infrastructure.

The comprehensive audit has already been performed. Treat the fixed items below
as regression-sensitive. Begin future work with the remaining prioritized risks,
then run focused tests before the full verification gate.

## Executive summary

The app has a sound local-first architecture: all mutations pass through one
reducer, selectors own derived reads, and one storage module owns the versioned
localStorage envelope. Calendar collision handling, bin splitting, cross-tab
conflicts, and reducer/browser test coverage are strong.

The audit confirmed 13 defects. All 13 were fixed. The most important were:

- malformed stored JSON silently becoming empty data and later being overwritten;
- migrations and repairs not being written back, causing generated IDs to change;
- invalid stored workload hours violating quarter-hour/day-fit invariants;
- onboarding claiming that tutorials never change data even though the advanced
  calendar exercise modifies and saves the real plan;
- incomplete reducer numeric validation;
- incorrect multi-block derived totals;
- inconsistent worker landing routes;
- inaccessible mobile drawer and incomplete Space-key activation;
- React Router bypassing the app's recovery screen for route-render failures.

No critical defect was found. The highest-priority unresolved issue is imported
task periods longer than the documented 92-day maximum.

## Architecture and invariants

- `src/store/AppStore.tsx` is the sole mutation/reducer boundary.
- `src/store/selectors.ts` owns derived reads and totals.
- `src/store/storage.ts` is the only localStorage boundary.
- `src/components/WeekView.tsx` owns calendar-grid and bin-card interactions.
- `src/utils/time.ts` owns snapping, collision, packing, and free-slot math.
- Persisted dates are `yyyy-MM-dd`; bin workload uses `date: ''`.
- Planned hours live only in `WorkloadEntry`.
- Hours use 0.25-hour steps; starts use 15-minute steps.
- A dated block must fit within one day.
- A task period must not exceed 92 inclusive days.
- Same-person collision blocks calendar drag/resize and automatic placement.
- Deliberate TaskModal allocations may overlap.
- One bin row exists per `(taskId, personId)`; partial scheduling is atomic and
  preserves the surviving row identity.
- Completion comes from `Status.isDone`, never status order.
- Invalid reducer commands must return the original state reference.
- Failed persistence must never report `Zapisano`; same-browser conflicts remain
  explicit.

## Fixed findings

### High severity

1. **Fail-closed storage recovery**
   - Files: `src/store/storage.ts`, `src/store/AppStore.tsx`, `src/main.tsx`.
   - `loadDataResult()` now distinguishes missing storage from unavailable,
     malformed, and invalid storage.
   - Malformed raw data remains byte-identical and exportable until explicit reset.
   - A route-local error boundary ensures React Router does not replace N2Hub's
     export/reset recovery screen.

2. **Stable migration and repair writeback**
   - Files: `src/store/storage.ts`, `src/store/AppStore.tsx`.
   - Successful migrations/repairs return `needsWriteback` and persist once.
   - Clean version-7 loads do not echo-write.
   - StrictMode effect replay does not duplicate the repair write.

3. **Stored workload-hour integrity**
   - File: `src/store/storage.ts`.
   - Positive off-grid hours snap to 0.25-hour increments.
   - Original dated rows above 24 hours move to the bin without truncating hours.
   - Existing bin identity is preserved during the subsequent merge.
   - Null, non-finite, non-positive, or structurally invalid values fail closed.

4. **Honest advanced onboarding**
   - Files: `src/onboarding/OnboardingRoot.tsx`,
     `src/onboarding/catalog.ts`.
   - The tutorial centre discloses that the advanced calendar exercise changes
     the live plan.
   - Starting it requires explicit confirmation.

### Medium and low severity

5. `INSERT_BLOCK` rejects non-finite hours atomically.
6. `MOVE_TASK` requires a finite, non-zero integer day delta.
7. `findFreeStart` rejects non-finite, non-positive, off-grid, fractional, and
   over-day durations before the empty-day fast path.
8. `hoursForTaskPersonOnDate` sums all matching blocks instead of returning the
   first block.
9. Global search validates real calendar dates, not only `YYYY-MM-DD` shape.
10. Workers consistently land on `/my-work`; other roles use `/dashboard`.
11. The closed mobile drawer is inert/hidden from assistive technology; the open
    drawer contains focus, closes on Escape, and restores focus to its trigger.
12. Timed calendar blocks and bin cards activate with Enter and Space.
13. Route-render failures reach N2Hub's recovery boundary.

## Remaining prioritized work

### R-01 — imported task periods over 92 days

Severity: medium  
Type: confirmed data-integrity defect  
Area: `src/store/storage.ts`

Reproduction:

1. Seed a valid task with `startDate: 2026-01-01` and
   `endDate: 2026-12-31`.
2. Call `loadData()` or reload the app.
3. Observe that `normalizeDates` deliberately preserves the overlong period.

This contradicts the hard invariant in `CLAUDE.md` and the scheduling wiki.
Before implementing, choose a non-destructive policy:

- fail closed and offer export/reset; or
- clamp to 92 inclusive days and atomically move workload outside the repaired
  period to the bin.

Required coverage: exact 92/93-day boundaries, repair idempotence, workload-hour
preservation, bin identity, and browser recovery/import behavior.

### R-02 — whole-task shift collision policy

Severity: medium  
Type: regression risk  
Area: `moveTask` in `src/store/AppStore.tsx`

Whole-task timeline shifts move all dated workload without the same-person
collision preflight used by calendar placement. Decide whether this is deliberate
overlap or should be an atomic rejection. Document the decision and test every
shifted block as one transaction.

### R-03 — blank admin inline renames

Severity: medium  
Type: confirmed bug  
Files: `src/pages/AdminPage.tsx`, `src/store/AppStore.tsx`

Existing clients, departments, service types, and work categories can be renamed
to an empty string. Add paths already reject blanks. Recommended behavior:

- keep a local edit draft;
- commit trimmed non-empty values on blur/Enter;
- restore on Escape or invalid empty commit;
- retain reducer-level blank/stale-ID rejection with the same state reference.

Add reducer validation and keyboard browser coverage.

### Other bounded risks

- Timeline drag needs explicit pointercancel, blur, Escape, visibility, and
  out-of-range-drop verification before lifecycle changes.
- WeekView scheduling popup may clip on short mobile viewports.
- Audit focus containment for modal/dialog surfaces beyond the mobile drawer.
- TaskModal is dense; improve hierarchy without changing save/allocation behavior.
- Add contextual empty-state actions and accessible live error announcements.
- Consolidate duplicated date-range formatting and Timeline reductions into
  shared date helpers/selectors with equivalence tests.
- Production build reports a 657.59 kB minified JS chunk; profile route-level
  dynamic imports before changing bundling.

## UX test results

### Experienced daily users

- Worker role landing was inconsistent and is fixed.
- Global task search, dashboard workload, overload warnings, placement, bin
  splitting, and cross-tab conflict recovery were predictable.
- TaskModal remains visually dense for frequent edits.

### New users

- Tutorial mutation disclosure was misleading and is fixed.
- Closed/open mobile drawer focus behavior was broken and is fixed.
- Role labels, Polish introduction, and role-filtered tutorials were clear.
- Contextual empty-state actions and broader modal focus handling need improvement.

### Destructive/chaotic users

- Invalid reducer numbers, impossible dates, malformed storage, oversized and
  off-grid workload, no-fit scheduling, failed saves, and rapid keyboard actions
  were exercised.
- Placement/collision/bin operations remained atomic across Chromium and WebKit.
- Browser input `1e309` was sanitized to empty by Chromium, so an Infinity save
  through that exact UI path was not confirmed. Reducer/storage finite guards
  still defend imported data and non-UI callers.

## Verification completed

- Focused storage/reducer/selector/time tests: **316 passed**.
- Full `npm test`: **14 files, 538 tests passed**.
- `npm run build`: passed TypeScript and Vite production build.
- `npm run check:openwiki`: **6 wiki files validated**.
- Chromium and WebKit passed:
  - `browser-check-date-hardening.mjs` — 5 flows;
  - `browser-check-onboarding.mjs` — 20 checks;
  - `browser-check-ui-keyboard.mjs` — 19 checks;
  - `browser-check-tab-sync.mjs`;
  - `browser-check-savetask-multiblock.mjs`;
  - `browser-check-placement.mjs`;
  - `browser-check-bin-drag.mjs`;
  - `browser-check-bin-split.mjs`.

## Context used

Read only these OpenWiki pages in addition to `CLAUDE.md`:

- `openwiki/n2hub/INDEX.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/testing-and-automation.md`

No historic handoffs, generated wiki narratives, or unrelated repository areas
were scanned.

## Wiki status

Updated and validated:

- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/testing-and-automation.md`

These changes document fail-closed recovery, one-time repair writeback, workload
normalization, live onboarding disclosure, role landing, mobile drawer behavior,
keyboard activation, and the new targeted browser check.
