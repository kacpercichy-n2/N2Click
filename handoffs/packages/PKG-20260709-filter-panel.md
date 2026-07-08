# Handoff: Replace filter bars with a filter button + panel + chips

- **Package ID:** PKG-20260709-filter-panel
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260709-timeline-people-view (styles.css ordering only)
- **Blast radius:** low-medium — four pages + one new shared component + CSS; no data-model or reducer changes

## Goal

Replace the "bar under bar of raw `<select>`s" filtering on Projects, Tasks,
Kanban and Workload with an e-commerce-style filter feature: a `Filtry` button
with an active-count badge that opens a popover panel of option groups, plus
removable applied-filter chips and a clear-all. Saved presets (FilterPresets)
keep working unchanged.

## Context the worker needs

- Relevant files:
  - NEW `src/components/FilterPanel.tsx` — the shared component.
  - `src/pages/ProjectsPage.tsx` — filters: paid (`PaidFilterToggle`), client,
    status, from/to (~L87–140, toolbar ~L279–305). NOTE: it exports
    `PaidFilterToggle`, consumed by KanbanPage.
  - `src/pages/TasksPage.tsx` — filters: client, status, person, from/to
    (~L139–200).
  - `src/pages/KanbanPage.tsx` — filters: paid + client (~L40–94).
  - `src/pages/WorkloadPage.tsx` — filters: department, client, service type
    (~L138–240).
  - `src/components/FilterPresets.tsx` — stays as-is (`DEFAULT_CRITERIA`,
    `isCriteriaActive`, preset chips). Presets exist only on Projects/Tasks.
  - `src/components/icons.ts` — lucide re-exports; add the `Filter` icon.
  - `src/components/WeekView.tsx` L674–688 — the outside-mousedown + Escape
    close pattern to mirror for the popover.
  - `src/styles.css` — tokens `--n2-*`; breakpoints 1180px/760px.
- Conventions: CLAUDE.md. Polish UI. Plain CSS. No new dependencies. Page
  filter STATE stays local `useState` in each page exactly as today — the
  panel is a controlled presentation layer.

## Pinned decisions (do not reopen)

1. **Single-select semantics stay.** Option groups are radio-style (one value
   per criterion: client, status, person, paid, department, service type) +
   two date inputs. This keeps `SavedFilterCriteria` and stored presets 100%
   compatible — NO storage/type changes.
2. **Live apply.** Choosing an option updates the page immediately; there is
   no "Zastosuj" button. Panel footer has one `Wyczyść wszystko` button
   (clears every criterion of that page).
3. **Anatomy.** Toolbar shows: `[Filtry (n)]` button (Filter icon; badge n =
   number of non-default criteria, hidden at 0) + one chip per active
   criterion (`{label}: {value}` with an ✕ that clears just that criterion) +
   the existing result count on Projects/Tasks (`X z Y …`). The FilterPresets
   row renders below, unchanged.
4. **Popover behavior.** Opens anchored under the button (absolute position
   within a relative wrapper); closes on outside `mousedown`, Escape, or the
   button again. ≤760px it renders full-width under the toolbar (static flow,
   not fixed). Keyboard: the button is a `<button aria-expanded>`; groups are
   `<fieldset><legend>`-or-equivalent labeled groups with native inputs —
   don't hand-roll listbox semantics.
5. **API shape** (keep it dumb): `FilterPanel` receives
   `groups: Array<{ key, label, options: Array<{value,label}>, value, onChange }>`,
   `dates?: { from, to, onFrom, onTo }`, `activeCount`, `onClearAll`,
   `chips: Array<{ key, label, onRemove }>`. Pages build these from their
   existing state. First option of every group = the neutral `'' / 'all'`
   ("Wszyscy klienci", "Wszystkie statusy", …) mirroring today's `<option>`s.
6. **Per page**:
   - Projects: groups paid (`Wszystkie / Opłacone / Nieopłacone`), klient,
     status; dates from/to. The `?client=` deep-link sync effect stays.
   - Tasks: groups klient, status, osoba; dates from/to.
   - Kanban: groups paid, klient (no dates).
   - Workload: groups dział, klient, rodzaj usługi (no dates).
7. **PaidFilterToggle is retired**: once Projects and Kanban both use the
   panel, delete the component + export from ProjectsPage and its import in
   KanbanPage (verify no other usage with a grep first).
8. **PersonFilter chips (Calendar, Timeline, Workload person rows) are NOT
   touched** — they are already a chip pattern, not a select bar.
9. Polish labels: button `Filtry`, groups `Płatność` / `Klient` / `Status` /
   `Osoba` / `Dział` / `Rodzaj usługi`, dates `Od` / `Do`, footer
   `Wyczyść wszystko`, chip removal aria-label `Usuń filtr {label}`.

## Scope

### In scope
- The new component, the four page integrations, icon export, CSS (panel,
  badge, chips, mobile layout), removal of the retired toggle.

### Out of scope
- No multi-select, no changes to `SavedFilterCriteria`/storage/reducer, no
  changes to FilterPresets internals, no filter additions/removals (same
  criteria as today), no Calendar/Timeline/People page changes.

## Implementation notes

- Follow the WeekView context-menu close pattern (window `mousedown` +
  `contains` check + Escape) — do NOT add a scrim that blocks the page.
- Filtering LOGIC in each page (the `useMemo` predicates) must not change —
  this is a presentation swap; verify by leaving the memo bodies untouched.
- Chip labels resolve ids to names via existing selectors
  (`getClient`/`getStatus`/`getPerson` or the page's lists).

## Acceptance criteria

- [ ] On all four pages the old inline `<select>` toolbar is gone; the
      `Filtry` button + panel + chips replace it; result counts still render
      on Projects/Tasks.
- [ ] Badge shows the exact number of active criteria; chips appear one per
      active criterion; chip ✕ clears only its criterion; `Wyczyść wszystko`
      resets everything (and disappears/zeroes the badge).
- [ ] Filtering results are IDENTICAL to before for the same selections
      (paid/client/status/person/dates on their respective pages).
- [ ] Presets on Projects/Tasks: applying a saved preset updates panel state,
      badge and chips; saving a preset from panel-set filters round-trips.
- [ ] `?client=` deep-link into Projects still pre-filters and shows its chip.
- [ ] Panel closes on outside click/Escape/toggle; usable at ≤760px.
- [ ] `PaidFilterToggle` fully removed; `rg PaidFilterToggle src` → no hits.
- [ ] All strings Polish; console clean.
- [ ] Gates: `npx tsc --noEmit` clean; `npm test` green; `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: suite stays green (no pure-logic change). Browser walkthrough
  items listed in the report.

## Report back

Files changed one-line each, test pass/fail, walkthrough items, deviations.
No raw logs.
