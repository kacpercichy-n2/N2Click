// Date helpers. All persisted dates are 'yyyy-MM-dd' calendar strings.
// We parse them at LOCAL noon to avoid any timezone/DST edge cases, and format
// back with date-fns. Week math is Monday-start throughout.
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval as dfEachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay as dfIsSameDay,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { DateStr } from '../types';

export const DATE_FMT = 'yyyy-MM-dd';
const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday

/** Parse a 'yyyy-MM-dd' string into a local Date (at noon to dodge DST). */
export function parseDate(d: DateStr): Date {
  const parsed = parse(d, DATE_FMT, new Date());
  parsed.setHours(12, 0, 0, 0);
  return parsed;
}

/** Format a Date back into a 'yyyy-MM-dd' string. */
export function toDateStr(d: Date): DateStr {
  return format(d, DATE_FMT);
}

export function todayStr(): DateStr {
  return toDateStr(new Date());
}

/** Shift a 'yyyy-MM-dd' string by whole days. */
export function addDaysStr(d: DateStr, delta: number): DateStr {
  return toDateStr(addDays(parseDate(d), delta));
}

/** Whole-day difference b - a for 'yyyy-MM-dd' strings. */
export function diffDays(a: DateStr, b: DateStr): number {
  return differenceInCalendarDays(parseDate(b), parseDate(a));
}

/** Short label like "3 Aug". */
export function formatShort(d: DateStr): string {
  return format(parseDate(d), 'd MMM');
}

/** Timestamp label like "3 Aug 2026, 14:05" from an ISO string. */
export function formatTimestamp(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm');
}

/** Inclusive list of 'yyyy-MM-dd' between start and end (start<=end assumed). */
export function eachDayInclusive(start: DateStr, end: DateStr): DateStr[] {
  const s = parseDate(start);
  const e = parseDate(end);
  if (e < s) return [];
  return dfEachDayOfInterval({ start: s, end: e }).map(toDateStr);
}

/** Number of days in [start, end] inclusive. */
export function inclusiveDayCount(start: DateStr, end: DateStr): number {
  return differenceInCalendarDays(parseDate(end), parseDate(start)) + 1;
}

export function isWeekend(d: DateStr): boolean {
  const day = parseDate(d).getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

export function isSameDayStr(a: DateStr, b: DateStr): boolean {
  return a === b;
}

export function isTodayStr(d: DateStr): boolean {
  return dfIsSameDay(parseDate(d), new Date());
}

/** Row label like "Mon 03.08". */
export function formatRowLabel(d: DateStr): string {
  return format(parseDate(d), 'EEE dd.MM');
}

// ---- Week helpers (Monday start) ----

export function weekStart(d: DateStr): DateStr {
  return toDateStr(startOfWeek(parseDate(d), WEEK_OPTS));
}

export function weekEnd(d: DateStr): DateStr {
  return toDateStr(endOfWeek(parseDate(d), WEEK_OPTS));
}

/** The 7 day-strings of the week containing d (Mon..Sun). */
export function weekDays(d: DateStr): DateStr[] {
  const start = startOfWeek(parseDate(d), WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(start, i)));
}

export function shiftWeek(d: DateStr, delta: number): DateStr {
  return toDateStr(addWeeks(parseDate(d), delta));
}

/** Range label like "4–10 Aug 2026". */
export function weekRangeLabel(d: DateStr): string {
  const start = startOfWeek(parseDate(d), WEEK_OPTS);
  const end = endOfWeek(parseDate(d), WEEK_OPTS);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth && sameYear) {
    return `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`;
  }
  if (sameYear) {
    return `${format(start, 'd MMM')}–${format(end, 'd MMM yyyy')}`;
  }
  return `${format(start, 'd MMM yyyy')}–${format(end, 'd MMM yyyy')}`;
}

// ---- Month helpers (Monday start grid) ----

export function shiftMonth(d: DateStr, delta: number): DateStr {
  return toDateStr(addMonths(parseDate(d), delta));
}

export function monthLabel(d: DateStr): string {
  return format(parseDate(d), 'MMMM yyyy');
}

export function monthKey(d: DateStr): string {
  return format(parseDate(d), 'yyyy-MM');
}

/** All day-strings for a Monday-start month grid (6 weeks = 42 cells). */
export function monthGridDays(d: DateStr): DateStr[] {
  const first = startOfMonth(parseDate(d));
  const last = endOfMonth(parseDate(d));
  const gridStart = startOfWeek(first, WEEK_OPTS);
  const gridEnd = endOfWeek(last, WEEK_OPTS);
  return dfEachDayOfInterval({ start: gridStart, end: gridEnd }).map(toDateStr);
}

export function isInMonth(d: DateStr, monthAnchor: DateStr): boolean {
  return parseDate(d).getMonth() === parseDate(monthAnchor).getMonth();
}

export function dayNumber(d: DateStr): number {
  return parseDate(d).getDate();
}

export function weekdayHeader(d: DateStr): string {
  return format(parseDate(d), 'EEE');
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
