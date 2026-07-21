// Pure RRULE-lite recurrence math for tasks. Minutes-from-local-midnight for
// time-of-day, 'yyyy-MM-dd' for dates. No React / store / component imports —
// only date + time utilities — so a future events feature can reuse it as-is.
//
// A recurring task repeats on chosen ISO weekdays at a fixed time-of-day, from
// its anchor (`task.startDate`) until an optional inclusive `until` bound.
// Per-date OVERRIDES either skip the day or shift its time; overrides never move
// an occurrence to a different calendar day.
//
// INVARIANT 1: occurrences are NEVER materialized as `WorkloadEntry` rows and
// never feed totals/availability/overload/collision — they are presentational.
import type { DateStr, TaskRecurrence, RecurrenceOverride } from '../types';
import { addDaysStr, diffDays, eachDayInclusive, isValidDateStr, parseDate } from './dates';
import { DAY_MINUTES, MINUTE_STEP } from './time';

/** One concrete occurrence of a recurring task within an expansion window. */
export interface RecurrenceOccurrence {
  date: DateStr;
  startMinutes: number;
  durationMinutes: number;
  /** True when a time-shift override replaced the rule's start/duration. */
  overridden: boolean;
}

/** Defensive upper bound on how many days ahead expansion will ever iterate. */
const MAX_WINDOW_DAYS = 400;

/** ISO weekday 1..7 (Mon..Sun) of a 'yyyy-MM-dd' date (Sunday maps to 7). */
export function isoWeekday(date: DateStr): number {
  // parseDate lands at local noon (dodges DST); getDay(): 0=Sun..6=Sat.
  const day = parseDate(date).getDay();
  return day === 0 ? 7 : day;
}

/** True when `m` is a finite integer on the 15-minute grid within [0, 1440]. */
function isGridMinute(m: unknown): m is number {
  return typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= DAY_MINUTES && m % MINUTE_STEP === 0;
}

/**
 * Canonical recurrence RULE (no overrides) from untrusted input; `null` when
 * invalid. Rejects when: `anchorStart` is not a real date; `daysOfWeek` is
 * empty or holds a value outside integer 1..7; times are off-grid/non-finite;
 * duration < 15; start + duration > 1440; `until` is present but not a real
 * 'yyyy-MM-dd' >= `anchorStart`. An absent/empty `until` means open-ended.
 * Dedupes and ascending-sorts `daysOfWeek`.
 */
export function normalizeRecurrenceRule(
  raw: unknown,
  anchorStart: DateStr,
): Omit<TaskRecurrence, 'overrides'> | null {
  if (!isValidDateStr(anchorStart)) return null;
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;

  const rawDays = rec.daysOfWeek;
  if (!Array.isArray(rawDays) || rawDays.length === 0) return null;
  if (!rawDays.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)) {
    return null;
  }
  const daysOfWeek = [...new Set(rawDays as number[])].sort((a, b) => a - b);

  const { startMinutes, durationMinutes } = rec;
  if (!isGridMinute(startMinutes)) return null;
  if (!isGridMinute(durationMinutes) || (durationMinutes as number) < MINUTE_STEP) return null;
  if ((startMinutes as number) + (durationMinutes as number) > DAY_MINUTES) return null;

  const rule: Omit<TaskRecurrence, 'overrides'> = {
    daysOfWeek,
    startMinutes: startMinutes as number,
    durationMinutes: durationMinutes as number,
  };

  const rawUntil = rec.until;
  if (rawUntil !== undefined && rawUntil !== null && rawUntil !== '') {
    if (typeof rawUntil !== 'string' || !isValidDateStr(rawUntil) || rawUntil < anchorStart) {
      return null;
    }
    rule.until = rawUntil;
  }
  return rule;
}

/**
 * True when `date` lands on the rule's weekday pattern within its bounds —
 * ignores overrides and skips (a skipped day is still an occurrence date).
 */
export function isOccurrenceDate(
  rule: TaskRecurrence,
  anchorStart: DateStr,
  date: DateStr,
): boolean {
  if (!isValidDateStr(date) || !isValidDateStr(anchorStart)) return false;
  if (date < anchorStart) return false;
  if (rule.until !== undefined && date > rule.until) return false;
  return rule.daysOfWeek.includes(isoWeekday(date));
}

/**
 * Canonical override from untrusted input for a rule + anchor; `null` when it
 * should be dropped. `{ date, skip: true }` when `skip === true`; otherwise a
 * `{ date, startMinutes, durationMinutes }` time-shift when both times are on
 * the grid, duration >= 15, start + duration <= 1440 AND the pair DIFFERS from
 * the base rule (an override equal to the rule carries no information). The
 * `date` must be a real occurrence date of the rule.
 */
function normalizeOverride(
  raw: unknown,
  rule: Omit<TaskRecurrence, 'overrides'>,
  anchorStart: DateStr,
): RecurrenceOverride | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const date = rec.date;
  if (typeof date !== 'string') return null;
  // isOccurrenceDate needs a TaskRecurrence; the rule alone (no overrides) is a
  // structural superset, so cast is safe.
  if (!isOccurrenceDate(rule as TaskRecurrence, anchorStart, date)) return null;

  if (rec.skip === true) return { date, skip: true };

  const { startMinutes, durationMinutes } = rec;
  if (!isGridMinute(startMinutes)) return null;
  if (!isGridMinute(durationMinutes) || (durationMinutes as number) < MINUTE_STEP) return null;
  if ((startMinutes as number) + (durationMinutes as number) > DAY_MINUTES) return null;
  // An override equal to the base rule pair carries no information — drop it.
  if (startMinutes === rule.startMinutes && durationMinutes === rule.durationMinutes) return null;
  return { date, startMinutes: startMinutes as number, durationMinutes: durationMinutes as number };
}

/**
 * Full canonical recurrence value (rule + overrides) from untrusted input, or
 * `undefined` to drop the key. Shared by storage repair, cloud hydration and
 * the reducer. Idempotent by value: a valid canonical value round-trips
 * unchanged. Overrides are canonicalized against the rule (stale dates and
 * now-equal time shifts drop; duplicate dates: first wins), sorted by date asc.
 */
export function normalizeRecurrence(
  raw: unknown,
  anchorStart: DateStr,
): TaskRecurrence | undefined {
  const rule = normalizeRecurrenceRule(raw, anchorStart);
  if (rule === null) return undefined;

  const rawOverrides = (raw as Record<string, unknown>).overrides;
  const overrides: RecurrenceOverride[] = [];
  if (Array.isArray(rawOverrides)) {
    const seen = new Set<string>();
    for (const item of rawOverrides) {
      const ov = normalizeOverride(item, rule, anchorStart);
      if (ov === null) continue;
      if (seen.has(ov.date)) continue; // duplicate dates: first wins
      seen.add(ov.date);
      overrides.push(ov);
    }
    overrides.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  return overrides.length > 0 ? { ...rule, overrides } : rule;
}

/**
 * Expand a rule into concrete occurrences within [`from`..`to`] inclusive —
 * ONLY that window (occurrences are never materialized ahead). Applies
 * overrides: a skip removes the date, a time-shift replaces start/duration and
 * marks `overridden: true`. The iteration window is intersected with the anchor
 * (lower bound) and `until` (upper bound), and defensively clamped to at most
 * `MAX_WINDOW_DAYS` measured from `from`. `from > to`, or a window that falls
 * entirely outside the rule bounds, yields `[]`.
 */
export function expandOccurrences(
  rule: TaskRecurrence,
  anchorStart: DateStr,
  from: DateStr,
  to: DateStr,
): RecurrenceOccurrence[] {
  if (!isValidDateStr(from) || !isValidDateStr(to) || !isValidDateStr(anchorStart)) return [];
  if (from > to) return [];

  // Defensive cap: never iterate more than MAX_WINDOW_DAYS from `from`.
  let windowTo = to;
  if (diffDays(from, to) > MAX_WINDOW_DAYS) windowTo = addDaysStr(from, MAX_WINDOW_DAYS);

  const lower = from < anchorStart ? anchorStart : from;
  let upper = windowTo;
  if (rule.until !== undefined && rule.until < upper) upper = rule.until;
  if (lower > upper) return [];

  const skips = new Set<string>();
  const shifts = new Map<string, RecurrenceOverride>();
  for (const ov of rule.overrides ?? []) {
    if (ov.skip === true) skips.add(ov.date);
    else if (ov.startMinutes !== undefined && ov.durationMinutes !== undefined) shifts.set(ov.date, ov);
  }

  const days = rule.daysOfWeek;
  const out: RecurrenceOccurrence[] = [];
  for (const date of eachDayInclusive(lower, upper)) {
    if (!days.includes(isoWeekday(date))) continue;
    if (skips.has(date)) continue;
    const shift = shifts.get(date);
    if (shift) {
      out.push({
        date,
        startMinutes: shift.startMinutes as number,
        durationMinutes: shift.durationMinutes as number,
        overridden: true,
      });
    } else {
      out.push({
        date,
        startMinutes: rule.startMinutes,
        durationMinutes: rule.durationMinutes,
        overridden: false,
      });
    }
  }
  return out;
}
