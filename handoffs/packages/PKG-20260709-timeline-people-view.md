# Handoff: Add a "people" mode to the Timeline

- **Package ID:** PKG-20260709-timeline-people-view
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260709-bin-drop-freeze (ordering only — keep gates green run-wide; no code dependency)
- **Blast radius:** low — TimelinePage + styles.css only; read-only feature, no reducer changes

## Goal

The Timeline (Oś czasu) gains a second display mode: rows are PEOPLE (each
person's tasks along the same day axis) instead of client→project groups. A
toggle switches modes; the existing zoom/range/navigation infrastructure is
shared.

## Context the worker needs

- Relevant files:
  - `src/pages/TimelinePage.tsx` — the whole page. Reuse: `Bar` (has an
    `editable={false}` static mode and an `onOpen` click-through), `DayStripes`,
    `ZOOM_LEVELS`, `WEEK_PRESETS`, the range math (`rangeStart`, `days`,
    `dayIdx`), `PersonFilter` (`ownerFilter`), the client `<select>`.
  - `src/store/selectors.ts` — `assigneeIdsOfTask`, `taskIdsOfPerson`,
    `entriesForTaskPerson` (per-person planned total on a task),
    `conflictDatesForTask`, `getStatus`, `getProject`, `getClient`.
  - `src/utils/colors.ts` — `personColor(id)` for the person row header dot.
  - `src/styles.css` — timeline styles live around the `.timeline-*` classes.
- Conventions: CLAUDE.md. Polish UI strings. Weeks start Monday. No new deps.

## Pinned decisions (do not reopen)

1. **Toggle**: a `cal-view-toggle` button group in the page toolbar with two
   options: `Projekty` (default, current behavior unchanged) and `Osoby`.
   Plain `useState`, not persisted.
2. **People mode rows**: one group per person (in `state.people` list order),
   with a group header row (person dot in `personColor(id)` + name), then one
   `timeline-row` per task the person is involved in — "involved" = has a
   `TaskAssignment` OR at least one `WorkloadEntry` (dated or bin) for that
   task. Tasks sorted by `startDate` (tie: title).
3. **Bars are READ-ONLY in people mode**: render `Bar` with
   `editable={false}` and `resizable={false}` — moving a bar in one person's
   row would silently reschedule the task for every other assignee, which is
   ambiguous UX; drag stays a project-mode feature. Click (or Enter) opens the
   task via `openTask(t.id)` — the `Bar` static mode already supports this.
4. **Bar appearance**: status color (same as project mode), label = task
   title. Tooltip: `"{title}: {start} – {end} — {osoba}: {Xh} zaplanowane"`
   where X = the person's planned total on that task
   (`entriesForTaskPerson(...).reduce(...)` — the selector exists; use
   `formatDuration`). Reuse `conflictOffsets` exactly as project mode does.
5. **Filters in people mode**: `PersonFilter` narrows which person GROUPS
   render (empty selection = everyone); the client `<select>` narrows tasks to
   those whose project belongs to the client. A person with zero matching
   tasks in either filter is omitted entirely. Projects/milestones are NOT
   rendered in people mode.
6. **Empty state**: if no person has any matching task, show an
   `empty-state` card: title `Brak zadań do wyświetlenia`, hint
   `Przypisz osoby do zadań, aby zobaczyć oś czasu zespołu.`.
7. Zoom, week-range presets, prev/today/next navigation, weekend stripes and
   the today line behave identically in both modes.

## Scope

### In scope
- The mode toggle + the people-mode rendering described above.
- A `useMemo` view model for people mode (mirror the existing `view` memo
  pattern; depend on state slices + filters, not whole `state` if reasonably
  avoidable — follow the file's existing memo style).
- New CSS classes (e.g. `.timeline-person-row`, `.timeline-person-label`)
  using existing `--n2-*` tokens; keep ≤1180px/≤760px behavior consistent
  with the current timeline (horizontal scroll).

### Out of scope
- No drag/resize in people mode (pinned above), no reducer/selector-file
  changes beyond what exists, no changes to project mode, no per-day workload
  heat cells (that's Workload's job), no route/URL changes.

## Implementation notes

- Keep the two mode view-models separate; don't contort the existing `view`
  memo to serve both.
- The `Bar` component needs no changes — verify `editable={false}` +
  `onOpen` covers the click-through before adding anything.

## Acceptance criteria

- [ ] Toggle renders `Projekty`/`Osoby`; default is `Projekty` and project
      mode is pixel-identical to before.
- [ ] People mode: seed data shows each seeded person with their task bars at
      the correct day offsets/spans; status colors match; tooltips include the
      person's planned hours.
- [ ] Clicking a bar in people mode opens the TaskModal; bars are not
      draggable/resizable (no pointer handlers).
- [ ] PersonFilter + client filter narrow rows as pinned; empty state shows
      when nothing matches.
- [ ] Zoom in/out and range presets work in people mode; weekend stripes and
      today line align with the axis.
- [ ] All UI strings Polish; console clean.
- [ ] Gates: `npx tsc --noEmit` clean; `npm test` green; `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: existing suite stays green (this is a read-only view; no new pure
  logic worth a unit test — the view-model memo is exercised via the browser
  walkthrough).

## Report back

Files changed one-line each, test pass/fail, walkthrough items for the human,
deviations. No raw logs.
