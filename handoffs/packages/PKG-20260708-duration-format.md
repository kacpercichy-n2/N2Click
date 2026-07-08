# Handoff: Unify duration display — one formatDuration ("2h 45m") everywhere

- **Package ID:** PKG-20260708-duration-format
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-week-layout-fix (both edit WeekView.tsx —
  run strictly after it lands)
- **Blast radius:** low — display-only text changes across many files + one
  pure helper; no data, no layout, no inputs.

## Goal

Replace every read-only decimal-hours display (`2.75h`, `0.25h`) with one
shared human format via a single helper: `2h 45m` / `45m` / `8h`. Numeric
INPUT fields stay decimal 0.25-step. Clock time-of-day ranges (`8:00–10:45`)
stay — they are start–end times, not durations.

## Context the worker needs

- Relevant files: full list in "In scope" (audited by the architect — it is
  exhaustive as of this run; TimelinePage, GlobalSearch, Coin, StatusBadge,
  SampleBanner display NO duration numbers and are not in the list).
- Docs: `CLAUDE.md` (Polish UI; time math lives in `src/utils/time.ts`).
- Prior decisions (architect — binding):
  1. **Format spec.** `formatDuration(hours: number): string` in
     `src/utils/time.ts` (pure, no new imports):
     - `total = Math.round(hours * 60)`; `h = Math.floor(total/60)`;
       `m = total % 60`.
     - `m === 0` → `` `${h}h` `` (includes `0h` for total 0); `h === 0 && m > 0`
       → `` `${m}m` ``; else `` `${h}h ${m}m` ``.
     - Examples: 8 → `8h`, 2.75 → `2h 45m`, 0.25 → `15m`, 0.5 → `30m`,
       0 → `0h`, 10.25 → `10h 15m`. Callers pass ≥ 0 (no sign handling).
     - Unit suffixes stay `h`/`m` (already the app's convention), no space
       inside a unit, single space between parts.
  2. **Scope rule.** EVERY read-only rendering of an hours quantity goes
     through `formatDuration` — including day totals, per-person totals,
     capacity displays (`8h/dzień` → `${formatDuration(cap)}/dzień` — renders
     identically for whole numbers), tooltips (`title=`), `window.confirm`
     texts, and `aria-label`s containing hours. NOT converted: `<input
     type="number">` values/step/min/max (AllocationGrid cells, estimate
     field, insert-form hours, TaskModal bin add-row) and percentage/count
     displays.
  3. **Activity messages** in `src/store/AppStore.tsx` switch their `${x}h`
     interpolations to `${formatDuration(x)}` (future rows consistent;
     already-persisted rows keep their old wording — accepted). If existing
     tests assert those message substrings, update ONLY the number-format part
     of the assertion and list every such edit in your report.
  4. **Tests for the helper live in this package** (no separate test-writer
     handoff — it is a 6-line pure function): add a `describe('formatDuration')`
     to `src/utils/time.test.ts` covering at least the six examples above.
  5. Delete the now-unused local `fmt`/`fmtHours` helpers in each touched file
     (keep them only where still used for non-duration numbers — there are no
     such uses today; verify).

## Scope

### In scope (exhaustive display-site list)

1. `src/utils/time.ts` — add `formatDuration` (decision 1).
2. `src/utils/time.test.ts` — the new describe block (decision 4).
3. `src/components/WeekView.tsx` — block hours label + block `title`, bin card
   hours + `title`, day-head totals, bin header total, bin group totals,
   context-menu title, overload warning (`będzie mieć …h — powyżej dostępności
   …h/dzień`), delete-confirm text. Clock ranges via `formatMinutes` stay.
4. `src/components/AllocationGrid.tsx` — `Suma dnia` column, person totals,
   grand total, overload tooltip. Cell inputs untouched.
5. `src/components/TaskModal.tsx` — estimate-compare line (`zaplanowano …` /
   `szacunek …` / `(+ …h w zasobniku)` → `(+ {formatDuration} w zasobniku)`),
   existing-bin chips, pending chips, unassign confirm (incl. the
   `(w tym … w zasobniku)` suffix). Estimate + bin-hours inputs untouched.
6. `src/components/MonthView.tsx` — cell hours + cell `title`.
7. `src/components/PersonChip.tsx` — the `hours` suffix.
8. `src/pages/WorkloadPage.tsx` — drag-block hours, drop-preview banner
   (`{name} — …/{cap} tego dnia`), table cells, assigned/available sums,
   overload tooltip, `aria-label` percentages stay, reassign/move confirm
   texts.
9. `src/pages/DashboardPage.tsx` — `Xh / Yh` load line.
10. `src/pages/PersonProfilePage.tsx` — week summary (assigned / available /
    `h/dzień` / total), day cells, per-task hours.
11. `src/pages/PeoplePage.tsx` — `przypisano …h`.
12. `src/pages/ProjectsPage.tsx` — `zaplanowano …h`.
13. `src/pages/ProjectDetailPage.tsx` — project total, per-task totals.
14. `src/pages/TasksPage.tsx` — `zaplanowano …h / szac. …h`.
15. `src/pages/KanbanPage.tsx` — card `{planned}h · {team} …`.
16. `src/store/AppStore.tsx` — activity templates (decision 3): INSERT_BLOCK,
    REASSIGN_ENTRY, SET_BLOCK_TIME (all three variants + shrink suffix),
    MOVE_BLOCK_TO_BIN, SPLIT_BLOCK, DELETE_BLOCK.
17. `src/store/blockActions.test.ts` — ONLY if message-format assertions break
    (decision 3); no fixture/logic changes.

### Out of scope

- Any `<input>` behavior/step/value semantics; any stored data; selectors;
  storage; styles.css; WeekView layout (previous package); sidebar; CLAUDE.md;
  seed values; `package.json`.
- Do not reformat clock times (`formatMinutes`) or dates.
- Do not introduce locale APIs — plain string building like the rest of the
  codebase.

## Implementation notes

- Import `formatDuration` from `../utils/time` (components/pages) /
  `../utils/time` (store) — same module as `formatMinutes`.
- Watch the "value + h" pattern hiding in template literals and JSX pairs like
  `{fmtHours(h)}h` — the trailing `h` must be removed together with the
  helper call (`formatDuration(h)` carries its own units).
- After the sweep, self-audit: repo-wide search for `}h` / `` h` `` /
  `h/dzień` / `h<` in `src/**/*.tsx` — every remaining hit must be an input
  attribute, a clock time, or a non-duration word. Report the leftover list.
- `KanbanPage`/`MonthView`/`DashboardPage` render raw numbers without a local
  helper today — just wrap them.

## Acceptance criteria

- [ ] One shared `formatDuration` in `src/utils/time.ts` matching decision 1;
      unit tests for the six examples pass.
- [ ] Week view: a 2.75h block shows `2h 45m` (and `8:00–10:45` clock range
      unchanged); day total shows e.g. `12h 30m`; bin chips/totals formatted.
- [ ] TaskModal shows `zaplanowano 12h` / `15m` etc.; AllocationGrid inputs
      still accept/step decimal 0.25 while its totals row is formatted.
- [ ] Workload, Dashboard, PersonProfile, People, Projects, ProjectDetail,
      Tasks, Kanban, MonthView, PersonChip all show the new format — no
      decimal `Xh` display remains anywhere (self-audit list in report).
- [ ] Capacity renders `8h` / `8h/dzień` exactly as before for whole-hour
      capacities.
- [ ] New activity rows use the format (e.g. `podzielił(a) blok 1h 15m na 2
      części (do zasobnika: 30m)`); old persisted rows untouched.
- [ ] All Polish strings otherwise byte-identical; no layout/CSS changes.
- [ ] `npx tsc --noEmit` clean; full test suite green (any assertion edits
      limited to number formatting and itemized in the report); build OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: 64 existing tests + new formatDuration tests all green; if any of
  the 64 needed a formatting-only assertion update, each is listed in the
  report with before/after.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md` (run section
"Walkthrough fixes"). No raw logs.
