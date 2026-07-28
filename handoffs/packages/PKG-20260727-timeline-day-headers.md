# Handoff: Per-day headers + day gridlines on the Timeline at close zoom

- Package ID: PKG-20260727-timeline-day-headers
- Status: ready
- Tier: developer
- Depends on: none
- Risk: low — presentation only; no zoom math, range math, drag or store change
- Codex review: skip — pure additive rendering + one pure helper, fully unit-tested,
  no reducer/persistence/pointer surface

## Goal

At the closest zoom levels the Timeline header reads as one continuous week.
Give each day its own header cell (day number + Polish weekday abbreviation,
weekend dimmed) and a vertical gridline between days, at `week` (160 px/day) and
`twoWeeks` (64 px/day). `month` (30 px/day) keeps today's week labels unchanged.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (Timeline page)

## Expected touchpoints

- `src/utils/dates.ts` — two tiny exported helpers (see Scope §1).
- `src/pages/timelineZoom.ts` — `showDayColumns`, `dayHeaders`,
  `TimelineDayHeader` (pure, unit-testable).
- `src/pages/TimelinePage.tsx` — header row (~lines 642–655) and `DayStripes`
  (~line 800).
- `src/styles.css` — additive rules near `.timeline-week-label` (~3347) and
  `.timeline-weekend` (~3384).
- `src/pages/timelineZoom.test.ts` — extend.
- `src/utils/dates.test.ts` — extend.

## Invariants

1. `zoomView`, `shiftAnchor`, `zoomIn/zoomOut`, `canZoomIn/canZoomOut`,
   `WEEK_DAY_W` / `TWO_WEEKS_DAY_W` / `MONTH_DAY_W`, `ZOOM_ORDER` and
   `DEFAULT_ZOOM_LEVEL` keep their exact current values and semantics.
2. `Bar` / `MilestoneMark` pointer handling, `useTouchDragGate` and the
   `Math.round(deltaX / dayW)` drag math are untouched (invariant 7).
3. Date math stays in `src/utils/dates.ts`; `timelineZoom.ts` never imports
   `date-fns` directly (existing file rule).
4. `formatShortWithWeekday` and `formatRowLabel` keep byte-identical output.
5. Weekend shading and the today line keep their current appearance.
6. No new runtime dependency; all strings Polish.

## Scope

### 1. `src/utils/dates.ts` (two additive exports)

```ts
/** Skrót dnia tygodnia po polsku, np. „pon". */
export function weekdayAbbr(d: DateStr): string;   // format(parseDate(d), 'EEEEEE', { locale: pl })

/** Numer dnia miesiąca bez zera wiodącego, np. „7". */
export function dayOfMonthLabel(d: DateStr): string; // format(parseDate(d), 'd', { locale: pl })
```

`formatShortWithWeekday` MAY be refactored to call `weekdayAbbr` (output must
stay identical); nothing else in the file changes.

### 2. `src/pages/timelineZoom.ts` (pure helper)

```ts
/** Jedna komórka nagłówka dnia przy bliskim zbliżeniu. */
export interface TimelineDayHeader {
  date: DateStr;
  /** Offset kolumny w dniach od `rangeStart` (mnożysz przez `dayW`). */
  index: number;
  dayLabel: string;     // „7"
  weekdayLabel: string; // „pon"
  weekend: boolean;
}

/** Czy poziom pokazuje kolumny dni (nagłówki + linie): week i twoWeeks. */
export function showDayColumns(level: ZoomLevel): boolean;

/** Nagłówki dni dla widocznego zakresu. Pusta tablica, gdy poziom ich nie
 *  pokazuje albo `totalDays <= 0`. */
export function dayHeaders(level: ZoomLevel, rangeStart: DateStr, totalDays: number): TimelineDayHeader[];
```

Uses `addDaysStr`, `isWeekend`, `weekdayAbbr`, `dayOfMonthLabel` from
`src/utils/dates.ts`. No React, no store, no `dayW` arithmetic inside (the page
multiplies by `dayW`).

### 3. `src/pages/TimelinePage.tsx`

Header row (`.timeline-row.timeline-head` → `.timeline-track`):

- when `showDayColumns(level)`: render one
  `<span className={weekend ? 'timeline-day-head weekend' : 'timeline-day-head'} style={{ left: index * dayW, width: dayW }}>`
  per header, containing `<span className="timeline-day-num">{dayLabel}</span>`
  and `<span className="timeline-day-dow">{weekdayLabel}</span>`;
- otherwise: the CURRENT week-label branch, unchanged.

Headers come from a `useMemo` over `dayHeaders(level, rangeStart, totalDays)`.

`DayStripes` gains one prop `columns: boolean` (passed as
`showDayColumns(level)` from all three existing call sites). When `true`, after
the weekend spans and before the today line, render
`<span className="timeline-daygrid" style={{ left: i * dayW }} aria-hidden />`
for `i = 1 … days.length - 1` (no line at index 0). When `false`, render exactly
what it renders today.

Nothing else on the page changes — no toolbar, filter, mode, memo-dependency or
bar-geometry edits.

### 4. `src/styles.css` (additive only)

Near `.timeline-week-label` (~3347) and `.timeline-weekend` (~3384) add:

- `.timeline-day-head` — absolutely positioned, `box-sizing: border-box`,
  centered column layout, small font, left hairline border, `pointer-events: none`;
- `.timeline-day-head.weekend` — muted color (reuse the existing muted token);
- `.timeline-day-num` — slightly larger / semibold;
- `.timeline-day-dow` — smaller, muted, lowercase;
- `.timeline-daygrid` — absolutely positioned 1 px full-height hairline,
  `pointer-events: none`, z-index BELOW `.timeline-bar` and below
  `.timeline-today` (match `.timeline-weekend`'s layer).

Do not modify existing rules. Raise `.timeline-head` height only if the two-line
header truly needs it — a single additive rule on `.timeline-head`, no other
row's height.

### 5. Tests

`src/pages/timelineZoom.test.ts` (extend):

- `showDayColumns`: `week` → true, `twoWeeks` → true, `month` → false;
- `dayHeaders('week', '2026-07-27', 5)` → 5 entries, `index` 0…4, dates
  consecutive from Monday, `dayLabel` `'27'…'31'`, `weekdayLabel` `'pon'…'pt'`
  (assert the actual `date-fns` pl output; adjust the literal if the locale
  emits a different abbreviation — the test must assert real output, not a guess),
  every `weekend === false`;
- `dayHeaders('twoWeeks', <monday>, 14)` → 14 entries, exactly indexes 5, 6, 12,
  13 have `weekend === true`;
- `dayHeaders('month', …)` → `[]`; `totalDays: 0` → `[]`;
- existing `zoomView` / `shiftAnchor` / clamp expectations stay untouched.

`src/utils/dates.test.ts` (extend): `weekdayAbbr` and `dayOfMonthLabel` on a
known Monday and a known Sunday, plus a day ≤ 9 (no leading zero).

## Out of scope

- Zoom levels, day widths, range/nav math, the `Dzisiaj` button.
- Bar/milestone drag, resize, touch gate, conflict markers.
- People mode / projects mode logic, filters, saved filters.
- Month zoom appearance.
- MonthView, WeekView, calendar pages.

## Acceptance

- [ ] At `week` zoom every column carries a day number + weekday abbreviation;
      weekends are visually dimmed.
- [ ] At `twoWeeks` the same headers appear; at `month` the header is unchanged
      from today.
- [ ] Vertical gridlines separate days at `week` and `twoWeeks`, sit behind bars
      and never intercept pointer events.
- [ ] Dragging/resizing a bar and dragging a milestone behave exactly as before.
- [ ] `dayHeaders` / `showDayColumns` are pure and unit-tested; no store access.
- [ ] `npx vitest run src/pages/timelineZoom.test.ts src/utils/dates.test.ts` green.

## Verification

- Worker: `npx vitest run src/pages/timelineZoom.test.ts src/utils/dates.test.ts`
- Browser: none — no covered browser-check interaction changes (bars, pointers
  and zoom math are untouched).
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Day columns show at `week` AND `twoWeeks` (64 px/day still fits „7" + „pon");
  `month` (30 px/day) keeps week labels — it would be unreadable.
- Gridlines are per-day absolutely positioned spans, matching the existing
  `.timeline-weekend` / `.timeline-today` pattern — no CSS custom property or
  `repeating-linear-gradient`, so no typed-style workaround is needed.
- Label content: day-of-month number + `EEEEEE` Polish abbreviation, stacked
  two lines, consistent with `formatShortWithWeekday`'s existing abbreviation.
- Header cell width is exactly `dayW` so a column can never drift from its bar.
