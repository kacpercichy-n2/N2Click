# Handoff: Unit tests for the new dashboard selectors

- **Package ID:** PKG-20260709-dashboard-selector-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260709-dashboard-welcome
- **Blast radius:** none — test files only

## Goal

Behavioral unit tests for the two selectors added by the dashboard package:
`todayAgendaForPerson` and `weekBlocksForPerson` in `src/store/selectors.ts`.

## Context the worker needs

- Relevant files:
  - `src/store/selectors.test.ts` — add the cases here; follow the file's
    existing fixture style (it builds `AppData` states by spreading
    `emptyData()` from `src/store/storage.ts`).
  - `src/store/selectors.ts` — the selectors under test (read their JSDoc; the
    contract is pinned in PKG-20260709-dashboard-welcome).
  - `src/utils/time.ts` — `BIN_DATE` ('' sentinel).
- Test files only. Do NOT modify any implementation file — if an assertion
  fails against the shipped behavior, report the mismatch instead of adapting
  the implementation.

## Scope

### In scope — case groups

`todayAgendaForPerson(state, personId, date)`:
1. Timed group: entries of the person on `date` returned sorted by
   `startMinutes` (fixture with out-of-order `startMinutes`); other people's
   and other days' entries excluded.
2. Bin entries (`date === ''`) never appear in `timed`.
3. Dateless group: an assigned task whose period covers `date` with NO entry
   that day appears; the same task WITH an entry that day does not.
4. Dateless excludes: task not covering `date` (before/after period); task
   assigned to someone else; task in the done status (last active status).
5. Dateless ordering: ascending `endDate`, tie broken by title.
6. Empty results: person with no assignments/entries → both arrays empty.

`weekBlocksForPerson(state, personId, dates)`:
7. Returns one key per requested date; each list sorted by `startMinutes`;
   days without entries → empty list (verify the selector's actual contract:
   missing key vs empty array — assert whichever the JSDoc states).
8. Excludes other people's entries and bin entries; a 7-day Monday-start week
   fixture with entries on 3 of the days.

### Out of scope
- No component tests, no changes to existing tests, no implementation edits.

## Acceptance criteria

- [ ] All case groups above implemented as behavioral assertions (real
      fixtures, no snapshot dumps).
- [ ] `git status --short` shows only `src/store/selectors.test.ts` changed.
- [ ] `npx tsc --noEmit` clean; `npm test` green (baseline + new tests, zero
      removed).

## Tests

- Command: `npx tsc --noEmit && npm test`
- Expected: all green; report the new test count.

## Report back

New test count per group, any spec-vs-implementation mismatches found (do not
fix them), confirmation only the test file changed. No raw logs.
