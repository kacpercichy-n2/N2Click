// Pure RRULE-lite recurrence math for tasks. Minutes-from-local-midnight for
// time-of-day, 'yyyy-MM-dd' for dates. No React / store / component imports —
// only date + time utilities — so a future events feature can reuse it as-is.
//
// A recurring task repeats on chosen ISO weekdays at a fixed time-of-day, from
// its anchor (`task.startDate`) until an optional inclusive `until` bound, every
// `intervalWeeks` weeks (absent = 1 = every week). The interval is counted from
// the ISO WEEK (Monday start) of the anchor, never from the expansion window.
// Per-date OVERRIDES either skip the day, shift its time or mark that single
// occurrence done; overrides never move an occurrence to a different calendar day.
//
// INVARIANT 1: occurrences are NEVER materialized as `WorkloadEntry` rows and
// never feed totals/availability/overload/collision — they are presentational.
import type { DateStr, EventRsvp, TaskRecurrence, RecurrenceOverride } from '../types';
import {
  addDaysStr,
  diffDays,
  eachDayInclusive,
  isValidDateStr,
  parseDate,
  weekStart,
} from './dates';
import { DAY_MINUTES, MINUTE_STEP } from './time';

/** One concrete occurrence of a recurring task within an expansion window. */
export interface RecurrenceOccurrence {
  date: DateStr;
  startMinutes: number;
  durationMinutes: number;
  /** True when a time-shift override replaced the rule's start/duration. */
  overridden: boolean;
  /**
   * True when THIS date's override carries `done: true` (per-occurrence
   * completion). Independent of `overridden` and of the task status — purely
   * presentational (invariant 1).
   */
  done: boolean;
}

/** Defensive upper bound on how many days ahead expansion will ever iterate. */
const MAX_WINDOW_DAYS = 400;

/** ISO weekday 1..7 (Mon..Sun) of a 'yyyy-MM-dd' date (Sunday maps to 7). */
export function isoWeekday(date: DateStr): number {
  // parseDate lands at local noon (dodges DST); getDay(): 0=Sun..6=Sat.
  const day = parseDate(date).getDay();
  return day === 0 ? 7 : day;
}

/** Najmniejszy i największy dozwolony interwał tygodniowy („co X tygodni"). */
export const MIN_INTERVAL_WEEKS = 1;
export const MAX_INTERVAL_WEEKS = 8;

/** Wartości selecta „Powtarzaj" w edytorach zadania i wydarzenia (1..8). */
export const INTERVAL_WEEKS_OPTIONS: readonly number[] = Array.from(
  { length: MAX_INTERVAL_WEEKS - MIN_INTERVAL_WEEKS + 1 },
  (_, i) => i + MIN_INTERVAL_WEEKS,
);

/**
 * Polska etykieta interwału z poprawną odmianą: 1 => „co tydzień”,
 * 2..4 => „co 2 tygodnie”, 5..8 => „co 5 tygodni”. JEDYNY dom tej odmiany —
 * oba edytory czytają stąd.
 */
export function intervalWeeksLabel(weeks: number): string {
  if (weeks === 1) return 'co tydzień';
  if (weeks >= 2 && weeks <= 4) return `co ${weeks} tygodnie`;
  return `co ${weeks} tygodni`;
}

/**
 * Interwał tygodniowy reguły. Forma kanoniczna trzyma klucz WYŁĄCZNIE dla
 * całkowitych 2..8, więc brak klucza i KAŻDA inna wartość (null, 1, ułamek,
 * string, 0, 9) czytają się jako 1 = co tydzień. Nigdy nie unieważnia reguły:
 * zły `intervalWeeks` z chmury/legacy nie może zabrać zadaniu cykliczności.
 */
function intervalWeeksOf(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= MIN_INTERVAL_WEEKS &&
    raw <= MAX_INTERVAL_WEEKS
  ) {
    return raw;
  }
  return 1;
}

/**
 * Czy `date` wypada w AKTYWNYM tygodniu reguły. Tydzień kotwiczenia to tydzień
 * ISO (poniedziałek jako start) daty `anchorStart`, więc parzystość liczy się od
 * KOTWICY, nie od początku okna rozwijania — okno może zacząć się w tygodniu
 * „martwym". Dzień tygodnia sprawdza wołający.
 */
function isActiveWeek(interval: number, anchorMonday: DateStr, date: DateStr): boolean {
  if (interval <= 1) return true;
  // Oba końce to poniedziałki albo `date >= anchorMonday`, więc dzielenie
  // całkowite nigdy nie schodzi poniżej zera dla realnego wystąpienia.
  const weekIndex = Math.floor(diffDays(anchorMonday, date) / 7);
  return weekIndex % interval === 0;
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
 * Dedupes and ascending-sorts `daysOfWeek`. `intervalWeeks` NEVER rejects the
 * rule: only an integer 2..8 is kept, anything else (absent, 1, 0, 9, 1.5,
 * '2', null) collapses to weekly and drops the key.
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

  // Interwał tygodniowy: klucz TYLKO dla 2..8; 1 i każda zła wartość spadają na
  // „co tydzień" i NIE odrzucają reguły (wymóg walidacji ładunku chmurowego).
  const intervalWeeks = intervalWeeksOf(rec.intervalWeeks);
  if (intervalWeeks > 1) rule.intervalWeeks = intervalWeeks;

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
 * True when `date` lands on the rule's weekday pattern AND in an active week of
 * its `intervalWeeks` cycle, within its bounds — ignores overrides and skips
 * (a skipped day is still an occurrence date).
 */
export function isOccurrenceDate(
  rule: TaskRecurrence,
  anchorStart: DateStr,
  date: DateStr,
): boolean {
  if (!isValidDateStr(date) || !isValidDateStr(anchorStart)) return false;
  if (date < anchorStart) return false;
  if (rule.until !== undefined && date > rule.until) return false;
  if (!rule.daysOfWeek.includes(isoWeekday(date))) return false;
  return isActiveWeek(intervalWeeksOf(rule.intervalWeeks), weekStart(anchorStart), date);
}

/**
 * Canonical override from untrusted input for a rule + anchor; `null` when it
 * should be dropped. The `date` must be a real occurrence date of the rule.
 * FOUR canonical shapes:
 * - `{ date, skip: true }` when `skip === true` — a skipped day has no
 *   occurrence, so `skip` wins and a `done` flag is DROPPED;
 * - `{ date, done: true }` — done-only (the rule's times stand);
 * - `{ date, startMinutes, durationMinutes }` — a time-shift, kept only when
 *   both times are on the grid, duration >= 15, start + duration <= 1440 AND
 *   the pair DIFFERS from the base rule (an override equal to the rule carries
 *   no information); an equal/invalid pair is simply omitted and must NOT nuke
 *   a valid `done`;
 * - `{ date, done: true, startMinutes, durationMinutes }` — both.
 * `done` is canonically only the literal `true`; any other value is dropped.
 * An override left with neither `done` nor a time-shift is dropped (`null`).
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

  const done = rec.done === true;

  const { startMinutes, durationMinutes } = rec;
  const timeShiftValid =
    isGridMinute(startMinutes) &&
    isGridMinute(durationMinutes) &&
    (durationMinutes as number) >= MINUTE_STEP &&
    (startMinutes as number) + (durationMinutes as number) <= DAY_MINUTES &&
    // An override equal to the base rule pair carries no information.
    !(startMinutes === rule.startMinutes && durationMinutes === rule.durationMinutes);

  if (!done && !timeShiftValid) return null;
  return {
    date,
    ...(done ? { done: true as const } : {}),
    ...(timeShiftValid
      ? { startMinutes: startMinutes as number, durationMinutes: durationMinutes as number }
      : {}),
  };
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
 * Kanoniczna lista odpowiedzi RSVP per (wystąpienie, osoba) wydarzenia
 * CYKLICZNEGO z niezaufanego wejścia. Wpis przeżywa, gdy: jest obiektem z
 * niepustym stringowym `personId`, `date` będącą realnym dniem wystąpienia
 * reguły (`isOccurrenceDate` — pominięty dzień nadal jest wystąpieniem) i
 * `status` ∈ {yes, no}; wpis LEGACY bez `status` (pierwsza wersja mechaniki:
 * gołe nieobecności) czyta się jako `no`. Dedup po (date, personId) —
 * pierwszy wygrywa; sort po dacie, potem osobie. Pusto => `undefined` (klucz
 * kanonicznie nieobecny). Współdzielone przez reduktor, repair storage i
 * hydrację chmury — idempotentne po wartości.
 */
export function normalizeEventRsvps(
  raw: unknown,
  rule: TaskRecurrence,
  anchorStart: DateStr,
): EventRsvp[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EventRsvp[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const date = rec.date;
    const personId = rec.personId;
    if (typeof date !== 'string' || typeof personId !== 'string' || personId === '') continue;
    const status = rec.status === undefined ? 'no' : rec.status;
    if (status !== 'yes' && status !== 'no') continue;
    if (!isOccurrenceDate(rule, anchorStart, date)) continue;
    const key = `${date} ${personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, personId, status });
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );
  return out;
}

/**
 * Expand a rule into concrete occurrences within [`from`..`to`] inclusive —
 * ONLY that window (occurrences are never materialized ahead). Applies
 * overrides: a skip removes the date, a time-shift replaces start/duration and
 * marks `overridden: true`, and a `done: true` override marks ONLY its own date
 * `done: true` (independently of the time-shift). The iteration window is
 * intersected with the anchor
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
  // Per-occurrence completion is INDEPENDENT of the time-shift branch below: a
  // done-only override carries no time fields, so it must be collected here.
  const doneDates = new Set<string>();
  for (const ov of rule.overrides ?? []) {
    if (ov.skip === true) {
      skips.add(ov.date);
      continue;
    }
    if (ov.done === true) doneDates.add(ov.date);
    if (ov.startMinutes !== undefined && ov.durationMinutes !== undefined) shifts.set(ov.date, ov);
  }

  const days = rule.daysOfWeek;
  // Interwał „co X tygodni" liczy się od tygodnia ISO KOTWICY, nie od `from` —
  // okno rozwijania może zaczynać się w tygodniu martwym.
  const interval = intervalWeeksOf(rule.intervalWeeks);
  const anchorMonday = weekStart(anchorStart);
  const out: RecurrenceOccurrence[] = [];
  for (const date of eachDayInclusive(lower, upper)) {
    if (!days.includes(isoWeekday(date))) continue;
    if (!isActiveWeek(interval, anchorMonday, date)) continue;
    if (skips.has(date)) continue;
    const shift = shifts.get(date);
    if (shift) {
      out.push({
        date,
        startMinutes: shift.startMinutes as number,
        durationMinutes: shift.durationMinutes as number,
        overridden: true,
        done: doneDates.has(date),
      });
    } else {
      out.push({
        date,
        startMinutes: rule.startMinutes,
        durationMinutes: rule.durationMinutes,
        overridden: false,
        done: doneDates.has(date),
      });
    }
  }
  return out;
}
