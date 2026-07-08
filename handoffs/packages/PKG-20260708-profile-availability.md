# Handoff: Full profile UI (phone, availability, supervisor) + workday-aware available hours

- **Package ID:** PKG-20260708-profile-availability
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-permission-gating (page-conflict ordering; also uses its gating on the new fields)
- **Blast radius:** medium — People/Profile forms + Workload/Profile availability math. Data model already shipped.

## Goal

Expose the v5 person fields in the UI — telefon, dni robocze, godziny pracy,
przełożony — and make "available hours" respect per-person work days instead of
the global Mon–Fri assumption.

## Context the worker needs

- Relevant files: `src/pages/PersonProfilePage.tsx` (profile card + edit form;
  `available = week.filter(!isWeekend).length * capacity` at line ~82),
  `src/pages/PeoplePage.tsx` (add/edit form), `src/pages/WorkloadPage.tsx`
  (`workdays = days.filter(!isWeekend)` line ~178, `available =
  workdays.length * capacity` line ~277, footer text line ~423),
  `src/store/selectors.ts` (`isPersonWorkday`, `availableHoursOnDate`,
  `availableHoursInRange`, `wouldCreateSupervisorCycle` — all shipped by
  PKG-20260708-auth-data), `src/store/AppStore.tsx` (`PersonDraft` — already
  extended), `src/utils/time.ts` (`formatMinutes`, `MINUTE_STEP`),
  `src/store/permissions.ts` (`people.manage`, `profile.editOwn`).
- Conventions: CLAUDE.md — Polish strings, `formatDuration` for durations,
  `formatMinutes` for clock times, existing form patterns/classes, weeks start
  Monday.
- Prior decisions (architect-settled):
  1. **Form fields** (both PeoplePage form and PersonProfilePage edit form):
     - `Telefon` — plain text input.
     - `Dni robocze` — seven weekday toggles `Pn Wt Śr Cz Pt So Nd`
       (checkbox-chips; ISO 1–7; default Mon–Fri pre-checked for new people).
     - `Godziny pracy` — two time selects (`Od` / `Do`) in 15-min steps
       rendered with `formatMinutes`; validation: `Do` > `Od` (inline
       `Koniec pracy musi być po początku`). Informational only — explicitly
       NOT coupled to capacity (keep the existing `Dostępność (h/dzień)` field
       as the overload threshold; a small hint under the hours:
       `Limit dzienny liczony jest z pola dostępności`).
     - `Przełożony` — select over other people (`—` = none), EXCLUDING options
       that would create a cycle (`wouldCreateSupervisorCycle`) and the person
       themselves; if the reducer ever nulls a cycle anyway, no crash.
  2. **Profile display card:** show telefon, dni robocze (compact `Pn–Pt` /
     listed chips), godziny pracy (`8:00–16:00`), przełożony (link to their
     profile), and `Podwładni` (people whose supervisorId points here — links;
     omit the row when empty).
  3. **Availability math:** replace the global Mon–Fri assumption in totals:
     - WorkloadPage: per person `available = availableHoursInRange(state, p.id,
       days)` (days = the visible week); the day CELL rendering keeps its
       weekend tint but additionally tints the person's non-workdays with the
       same `weekend` class (a non-workday for Ola looks like her weekend).
       Footer text updated to explain per-person work days
       (`Dostępne = dzienna dostępność × dni robocze osoby.`).
     - PersonProfilePage week summary: same selector swap.
     - **Unchanged on purpose:** the daily OVERLOAD rule stays
       `hours > capacity` regardless of workday (CLAUDE.md invariant 3) —
       flagging work scheduled on a non-workday is a future decision, not this
       package. Do not change WeekView/MonthView/Dashboard overload logic.
  4. **Field-level permissions:** editing another person requires
     `people.manage`. Editing OWN profile (`profile.editOwn`): contact fields +
     avatar allowed; `Uprawnienia` (accessRole), `Dostępność` (capacity),
     `Dni robocze`, `Godziny pracy` and `Przełożony` are admin-only — disabled
     with `Brak uprawnień` title for self-editors without `people.manage`.

## Scope

### In scope

- `src/pages/PersonProfilePage.tsx`, `src/pages/PeoplePage.tsx` (forms +
  display per decisions 1–2, 4).
- `src/pages/WorkloadPage.tsx` (decision 3) and the PersonProfilePage summary.
- `src/styles.css`: weekday chip styles + small profile-row additions only.

### Out of scope

- Any store/selector/migration change (all shipped upstream) — if a selector is
  missing or wrong, STOP and report instead of adding one here.
- Overload semantics, WeekView/MonthView/Dashboard.
- Org chart visualization (supervisor/subordinate links only).
- New unit tests (availability selectors covered by PKG-20260708-store-tests).

## Implementation notes

- Weekday chips: order Pn→Nd (ISO 1–7); keep them keyboard-accessible (real
  checkboxes styled as chips, existing pattern preferred over divs).
- Time selects: generate options 0:00–23:45 for `Od` and 0:15–24:00 for `Do`
  (24:00 = 1440 renders as `24:00` — or cap at 23:45/1440 consistently; pick
  one and keep `Do > Od` validation).
- Seed check: Ola is Mon–Thu — with the sample data the Workload page must show
  her lower availability and her Friday cell tinted.
- Verify on the running dev server (5173, already up): edit Marek's workdays to
  Mon–Wed → Workload available drops to `3 × capacity`; cycle attempt
  (Kasia → Marek → Kasia) impossible via the select.

## Acceptance criteria

- [ ] Both forms round-trip all new fields (save → reopen → identical);
      validation errors inline and in Polish.
- [ ] Supervisor select never offers a cycle-creating option; profile shows
      Przełożony/Podwładni links that navigate correctly.
- [ ] WorkloadPage available hours = Σ capacity over each person's OWN workdays
      in the visible week (Ola Mon–Thu: 4 × capacity); her non-workday cells
      carry the weekend-style tint; footer text updated.
- [ ] PersonProfilePage week summary uses the same math.
- [ ] Overload flags behave exactly as before (capacity threshold, any day).
- [ ] Self-editing without `people.manage`: contact fields editable; role,
      capacity, workdays, hours, supervisor disabled with `Brak uprawnień`.
- [ ] Console clean; ≤760px usable.
- [ ] `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green; no test-file edits expected. Browser-verify the
  Workload math with the seeded Ola (Mon–Thu) and report what you checked.

## Report back

Synthesized summary only (files changed one-line each, tests, deviations,
anything left for the human walkthrough). Append to `handoffs/RUN-STATE.md`
under the current run's Worker log.
