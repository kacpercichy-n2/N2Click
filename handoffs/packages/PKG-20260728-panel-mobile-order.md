# Handoff: Mobile Panel ordering + compact tiles (MO-18)

- Package ID: PKG-20260728-panel-mobile-order
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: conditional — review if the desktop DOM cannot be kept
  bit-identical while extracting tiles.

## Goal

Below 760 px the Panel (`/dashboard`) renders a purpose-ordered mobile stack —
Zadania na dziś first, then one compact workload LINE (instead of two donut
rings), Zasobnik, the week as seven pills, Zespół collapsed — and EMPTY tiles
do not render at all. Order and visibility come from a pure, tested model.
Desktop grid stays bit-identical.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (Panel/home section)

## Expected touchpoints

- `src/pages/dashboardPanels.ts` — pure additions
- `src/pages/dashboardPanels.test.ts` — extend (file exists)
- `src/pages/DashboardPage.tsx` — mobile branch via
  `useMediaQuery(MOBILE_NAV_QUERY)` (`src/utils/useMediaQuery.ts`; not
  imported there yet)
- `src/styles.css` — NEW `.dash-m-*` classes only (mobile stack, workload
  line, week pills, collapsed team)

## Invariants

- Desktop bit-identical: above 760 px the rendered DOM of
  `.dash-grid.dash-welcome-grid` and every existing `.dash-*` / `.donut*` /
  `.week-strip*` / `.chat-people` CSS rule (incl. the 1180 px media block at
  styles.css:4290) stay byte-identical. Conditional rendering, not CSS `order`,
  is the mechanism (EMPTY tiles must not exist in the mobile DOM at all).
- Keep `data-tour` anchors on every tile that renders: `home.today` (Zadania na
  dziś), `home.workload` (Zespół card — yes, it is on the TEAM card today),
  `home.bin` (Zasobnik), `home.alerts` (Alerty). `src/onboarding/catalog.ts`
  queries them.
- Read-only page: selectors only, no dispatch changes beyond what exists
  (notification actions keep working on mobile where their tile renders).
- Polish strings. No reducer changes (invariant 6). No new runtime deps.
  Retirement mode untouched.
- Hook order: `useMediaQuery` must be called before the `!me` early return.

## Scope

1. **Pure model in `dashboardPanels.ts`** (+ tests):
   - `export type DashTileId = 'today' | 'alerts' | 'notifications' | 'workload' | 'bin' | 'week' | 'team';`
   - `mobileDashboardOrder(flags: { hasToday: boolean; hasAlerts: boolean; hasNotifications: boolean; hasBin: boolean; hasCoworkers: boolean }): DashTileId[]`
     — canonical order `['today','alerts','notifications','workload','bin','week','team']`;
     drop `today`/`alerts`/`notifications`/`bin`/`team` when their flag is
     false; `workload` and `week` ALWAYS render (they never show an
     empty-state message — that is the emptiness rule: a tile whose content
     would be only an empty-state sentence does not render on mobile).
   - `workloadSummaryLine(today: { booked: number; available: number; over: boolean }, week: { booked: number; available: number; over: boolean }): string`
     — e.g. `„Dziś 4h / 8h · Ten tydzień 22h / 40h"` using the shared
     `formatDuration` (`src/utils/time.ts`); an over segment is prefixed
     `„⚠ "`. Callers compute `over` with the SAME danger semantics as the
     donuts: `booked > available || overbooked-dates nonempty || (percent null && booked > 0)`.
   - Tests: full flags → full order; all-empty → `['workload','week']`;
     single-flag combinations; summary line with/without ⚠ on each segment.
2. **DashboardPage**: compute flags from the selectors already in scope —
   `hasToday` via `todayAgendaForPerson(state, me.id, today).length > 0`
   (selector exists in `src/store/selectors.ts`; used by
   `src/components/TodayAgenda.tsx`), `hasAlerts = !noAlerts`,
   `hasNotifications = shownNotifications.length > 0`,
   `hasBin = binRows.length > 0`, `hasCoworkers = coworkers.length > 0`.
   - Desktop path: EXACTLY today's JSX (extracting tiles into local render
     functions is allowed only if the emitted DOM is unchanged).
   - Mobile path: a `.dash-m-stack` rendering tiles in `mobileDashboardOrder`:
     - `today`, `alerts`, `notifications`, `bin` — same tile content as
       desktop (cards reused), same `data-tour` anchors;
     - `workload` — a single `.dash-m-workload` card with the ONE summary line
       (no `WorkloadDonut` in the mobile DOM);
     - `week` — `.dash-m-week`: seven pills, one per `weekDays(today)` day:
       `weekdayHeader(d)` + `dayNumber(d)` + summed `plannedHours` of
       `weekMap.get(d)` formatted with `formatDuration` (omit when 0),
       `is-today` modifier on today; keep the „Otwórz kalendarz →" link in the
       card head; pills are presentational (no per-pill navigation);
     - `team` — collapsed by default: header button `Zespół (N)`
       (`teamHeaderLabel`) with `aria-expanded`, tap reveals the same
       `.chat-people` roster.
   - Greeting, changelog bar and `ChangelogModal` render on both branches
     unchanged.
3. **CSS**: additive `.dash-m-*` rules; comfortable tap targets; no rule may
   target existing desktop selectors.

## Out of scope

- Any selector/store change; TodayAgenda internals; notifications logic.
- Onboarding catalog edits.
- Reordering or restyling the DESKTOP grid in any way.

## Acceptance

- [ ] At 390 px the Panel stack order is: Zadania na dziś → Alerty →
      Powiadomienia → Obciążenie (one line) → Zasobnik → Tydzień (7 pills) →
      Zespół (collapsed); tiles whose flag is false are ABSENT from the DOM.
- [ ] No `WorkloadDonut` and no `.week-strip` columns in the mobile DOM; no
      empty-state sentences („Brak nowych powiadomień", „Zasobnik jest pusty",
      „Brak alertów", „Brak innych osób…") ever render on mobile.
- [ ] Zespół expands/collapses with `aria-expanded`; default collapsed.
- [ ] Desktop (>760 px) DOM is byte-identical to before the change.
- [ ] Extended `dashboardPanels.test.ts` green.

## Verification

- Worker: `npx vitest run src/pages/dashboardPanels.test.ts` then
  `npm run build`.
- Browser: none — layout-only change; release verification owns the matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Alerty and Powiadomienia (unlisted in the prompt's order) slot between
  „Zadania na dziś" and the workload line — they are attention tiles and only
  render when non-empty, so they cannot pad the top with empty states.
- Emptiness rule = "would render only an empty-state message"; Obciążenie and
  Tydzień are always meaningful and always render.
- Mechanism is conditional rendering (not CSS `order`), because EMPTY tiles
  must not exist in the mobile DOM.
