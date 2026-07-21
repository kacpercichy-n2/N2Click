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
import { pl } from 'date-fns/locale/pl';
import type { DateStr } from '../types';

export const DATE_FMT = 'yyyy-MM-dd';
const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday

/** Canonical cap on a task's inclusive period length (days). The block-time and
 *  task-editor write paths reject anything longer; this is the single home. */
export const MAX_TASK_PERIOD_DAYS = 92;

/**
 * Strict validity for a calendar-date string. True ONLY for a real
 * 'yyyy-MM-dd' date that round-trips through date-fns unchanged — so
 * `'2026-02-31'`, `'2026-13-01'`, `'2026-2-3'`, `''`, and any garbage are
 * rejected. Never throws on any string input (guards `format` behind the
 * validity check, since `format(Invalid Date)` throws a RangeError).
 */
export function isValidDateStr(d: string): boolean {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = parse(d, DATE_FMT, new Date());
  if (Number.isNaN(parsed.getTime())) return false;
  return format(parsed, DATE_FMT) === d;
}

/** Distinct ways a [start, end] period can be invalid (null = valid). */
export type PeriodError =
  | 'missing-start'
  | 'invalid-start'
  | 'missing-end'
  | 'invalid-end'
  | 'reversed'
  | 'too-long';

/**
 * Validate a date period. Checked in order: empty start → `missing-start`;
 * non-empty invalid start → `invalid-start`; same for end; both valid and
 * `end < start` (plain string compare is safe once both are valid) →
 * `reversed`; `opts.maxDays` given and the inclusive day count exceeds it →
 * `too-long`; else `null`. Never throws — `inclusiveDayCount` is only reached
 * once both endpoints are known-valid.
 */
export function periodError(
  start: string,
  end: string,
  opts?: { maxDays?: number },
): PeriodError | null {
  if (start === '') return 'missing-start';
  if (!isValidDateStr(start)) return 'invalid-start';
  if (end === '') return 'missing-end';
  if (!isValidDateStr(end)) return 'invalid-end';
  if (end < start) return 'reversed';
  if (opts?.maxDays !== undefined && inclusiveDayCount(start, end) > opts.maxDays) {
    return 'too-long';
  }
  return null;
}

/** Polish inline-error copy for each PeriodError (UI forms consume this). */
export const PERIOD_ERROR_LABELS: Record<PeriodError, string> = {
  'missing-start': 'Podaj datę startu.',
  'invalid-start': 'Data startu jest nieprawidłowa.',
  'missing-end': 'Podaj datę końca.',
  'invalid-end': 'Data końca jest nieprawidłowa.',
  reversed: 'Data końca musi być taka sama jak data startu albo późniejsza.',
  'too-long': `Okres zadania nie może przekraczać ${MAX_TASK_PERIOD_DAYS} dni.`,
};

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
  return format(parseDate(d), 'd MMM', { locale: pl });
}

/** Short label with the Polish weekday suffix, like "26 paź (pon)". Used on
 *  every task/project planning surface so a date always carries its weekday. */
export function formatShortWithWeekday(d: DateStr): string {
  const parsed = parseDate(d);
  return `${format(parsed, 'd MMM', { locale: pl })} (${format(parsed, 'EEEEEE', { locale: pl })})`;
}

/**
 * Etykieta daty urodzenia jak „14 marca 1988". Puste albo niepoprawne wejście
 * => '' (nigdy nie rzuca — chroni `format` przed Invalid Date).
 */
export function formatBirthday(birthDate: string): string {
  if (!isValidDateStr(birthDate)) return '';
  return format(parseDate(birthDate), 'd MMMM yyyy', { locale: pl });
}

/** Timestamp label like "3 Aug 2026, 14:05" from an ISO string. */
export function formatTimestamp(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm', { locale: pl });
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

/**
 * Czy `birthDate` (data urodzenia, 'yyyy-MM-dd') wypada w kalendarzu na dniu
 * `day` — porównanie WYŁĄCZNIE miesiąca i dnia (rok urodzenia jest bez
 * znaczenia dla rocznicy). Puste albo niepoprawne `birthDate` => `false`, więc
 * nigdy nie rzuca. 29 lutego dopasowuje się tylko w latach przestępnych — nie
 * przenosimy go sztucznie na 28 lutego (świadoma, prosta reguła).
 */
export function isBirthdayOn(birthDate: string, day: DateStr): boolean {
  if (!isValidDateStr(birthDate)) return false;
  // Oba są poprawnymi 'yyyy-MM-dd', więc segmenty MM-DD porównujemy jako string.
  return birthDate.slice(5) === day.slice(5);
}

export function isTodayStr(d: DateStr): boolean {
  return dfIsSameDay(parseDate(d), new Date());
}

/** Row label like "Mon 03.08". */
export function formatRowLabel(d: DateStr): string {
  return format(parseDate(d), 'EEE dd.MM', { locale: pl });
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
    return `${format(start, 'd')}–${format(end, 'd MMM yyyy', { locale: pl })}`;
  }
  if (sameYear) {
    return `${format(start, 'd MMM', { locale: pl })}–${format(end, 'd MMM yyyy', { locale: pl })}`;
  }
  return `${format(start, 'd MMM yyyy', { locale: pl })}–${format(end, 'd MMM yyyy', { locale: pl })}`;
}

// ---- Month helpers (Monday start grid) ----

export function shiftMonth(d: DateStr, delta: number): DateStr {
  return toDateStr(addMonths(parseDate(d), delta));
}

export function monthLabel(d: DateStr): string {
  return format(parseDate(d), 'LLLL yyyy', { locale: pl });
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
  return format(parseDate(d), 'EEE', { locale: pl });
}

export const WEEKDAY_LABELS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
