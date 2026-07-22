// Pure zoom logic behind the Timeline page. No React, no store access — just the
// three fixed zoom levels and the range/nav math the page needs, so the JSX stays
// declarative and the rules are unit-testable (mirrors the dashboardPanels.ts
// pattern). All date math delegates to src/utils/dates.ts (Monday-start weeks,
// 'yyyy-MM-dd' strings) — never duplicated here.
import type { DateStr } from '../types';
import { diffDays, monthEnd, monthStart, shiftMonth, shiftWeek, weekStart } from '../utils/dates';

/** The three fixed zoom levels. Nothing wider than a calendar month. */
export type ZoomLevel = 'week' | 'twoWeeks' | 'month';

/** Ordered from most zoomed-OUT to most zoomed-IN. `zoomIn` steps toward the
 *  end (week), `zoomOut` toward the start (month). */
export const ZOOM_ORDER: readonly ZoomLevel[] = ['month', 'twoWeeks', 'week'];

/** Default level on load: the tightest, most zoomed-in view. */
export const DEFAULT_ZOOM_LEVEL: ZoomLevel = 'week';

// Per-level day width (px). Tuned so a task's start/end day stays clearly
// distinguishable at each level while nothing exceeds a month wide.
export const WEEK_DAY_W = 160;
export const TWO_WEEKS_DAY_W = 64;
export const MONTH_DAY_W = 30;

/** The computed visible range + geometry for a level anchored at a date. */
export interface ZoomView {
  /** First day rendered (inclusive), 'yyyy-MM-dd'. */
  rangeStart: DateStr;
  /** Number of days rendered. */
  totalDays: number;
  /** Pixels per day at this level. */
  dayW: number;
}

/**
 * Compute the visible range for a level anchored at `anchor`:
 * - `week`: 5 workdays, Mon–Fri of the anchor's week.
 * - `twoWeeks`: 14 days starting at the anchor's Monday.
 * - `month`: the whole calendar month containing the anchor (first→last day).
 */
export function zoomView(level: ZoomLevel, anchor: DateStr): ZoomView {
  switch (level) {
    case 'week':
      return { rangeStart: weekStart(anchor), totalDays: 5, dayW: WEEK_DAY_W };
    case 'twoWeeks':
      return { rangeStart: weekStart(anchor), totalDays: 14, dayW: TWO_WEEKS_DAY_W };
    case 'month': {
      const start = monthStart(anchor);
      return {
        rangeStart: start,
        totalDays: diffDays(start, monthEnd(anchor)) + 1,
        dayW: MONTH_DAY_W,
      };
    }
  }
}

/** Shift the anchor by the level's natural navigation step in `dir` (+1/-1):
 *  week → ±1 week, twoWeeks → ±2 weeks, month → ±1 month. */
export function shiftAnchor(level: ZoomLevel, anchor: DateStr, dir: 1 | -1): DateStr {
  switch (level) {
    case 'week':
      return shiftWeek(anchor, dir);
    case 'twoWeeks':
      return shiftWeek(anchor, dir * 2);
    case 'month':
      return shiftMonth(anchor, dir);
  }
}

/** Step one level toward zoom-in (week), clamped at the tightest level. */
export function zoomIn(level: ZoomLevel): ZoomLevel {
  const i = ZOOM_ORDER.indexOf(level);
  return ZOOM_ORDER[Math.min(i + 1, ZOOM_ORDER.length - 1)];
}

/** Step one level toward zoom-out (month), clamped at the widest level. */
export function zoomOut(level: ZoomLevel): ZoomLevel {
  const i = ZOOM_ORDER.indexOf(level);
  return ZOOM_ORDER[Math.max(i - 1, 0)];
}

/** True while a further zoom-in step is possible (not already at `week`). */
export function canZoomIn(level: ZoomLevel): boolean {
  return ZOOM_ORDER.indexOf(level) < ZOOM_ORDER.length - 1;
}

/** True while a further zoom-out step is possible (not already at `month`). */
export function canZoomOut(level: ZoomLevel): boolean {
  return ZOOM_ORDER.indexOf(level) > 0;
}
