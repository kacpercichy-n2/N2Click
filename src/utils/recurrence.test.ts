// Pure RRULE-lite recurrence math (PKG-20260721-recurrence-core).
// Weekday mapping, window expansion, overrides, canonicalization + idempotency.
import { describe, expect, it } from 'vitest';
import {
  INTERVAL_WEEKS_OPTIONS,
  expandOccurrences,
  intervalWeeksLabel,
  isOccurrenceDate,
  isoWeekday,
  normalizeRecurrence,
  normalizeRecurrenceRule,
} from './recurrence';
import type { TaskRecurrence } from '../types';

// Reference weekdays: 2026-07-06 Mon(1), 07 Tue(2), 08 Wed(3), 11 Sat(6),
// 12 Sun(7), 13 Mon(1), 20 Mon(1).
const ANCHOR = '2026-07-06'; // Monday

describe('isoWeekday', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekday('2026-07-06')).toBe(1); // Mon
    expect(isoWeekday('2026-07-07')).toBe(2); // Tue
    expect(isoWeekday('2026-07-11')).toBe(6); // Sat
    expect(isoWeekday('2026-07-12')).toBe(7); // Sun
  });
});

// Odmiana etykiety interwału ma JEDEN dom (`intervalWeeksLabel`) — czytają ją
// oba edytory i badge „Cykliczne" na stronie Wydarzeń.
describe('intervalWeeksLabel', () => {
  it('odmienia „tydzień/tygodnie/tygodni” zgodnie z liczbą', () => {
    expect(intervalWeeksLabel(1)).toBe('co tydzień');
    expect(intervalWeeksLabel(2)).toBe('co 2 tygodnie');
    expect(intervalWeeksLabel(4)).toBe('co 4 tygodnie');
    expect(intervalWeeksLabel(5)).toBe('co 5 tygodni');
    expect(intervalWeeksLabel(8)).toBe('co 8 tygodni');
  });

  it('daje selectowi dokładnie osiem opcji 1..8', () => {
    expect([...INTERVAL_WEEKS_OPTIONS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('normalizeRecurrenceRule', () => {
  it('dedupes and ascending-sorts daysOfWeek', () => {
    const rule = normalizeRecurrenceRule(
      { daysOfWeek: [3, 1, 1, 5], startMinutes: 540, durationMinutes: 60 },
      ANCHOR,
    );
    expect(rule).not.toBeNull();
    expect(rule!.daysOfWeek).toEqual([1, 3, 5]);
    expect('overrides' in rule!).toBe(false);
  });

  it('rejects empty or out-of-range daysOfWeek', () => {
    expect(normalizeRecurrenceRule({ daysOfWeek: [], startMinutes: 540, durationMinutes: 60 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [0], startMinutes: 540, durationMinutes: 60 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [8], startMinutes: 540, durationMinutes: 60 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1.5], startMinutes: 540, durationMinutes: 60 }, ANCHOR)).toBeNull();
  });

  it('rejects off-grid or non-finite times, tiny duration and overflow', () => {
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 541, durationMinutes: 60 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 10 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 0 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: Number.NaN, durationMinutes: 60 }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 1425, durationMinutes: 30 }, ANCHOR)).toBeNull(); // 1455 > 1440
  });

  it('accepts a full-day block up to 1440', () => {
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 0, durationMinutes: 1440 }, ANCHOR)).not.toBeNull();
  });

  it('keeps a valid until >= anchor, drops absent/empty, rejects invalid or < anchor', () => {
    const withUntil = normalizeRecurrenceRule(
      { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: '2026-08-01' },
      ANCHOR,
    );
    expect(withUntil!.until).toBe('2026-08-01');
    const openEnded = normalizeRecurrenceRule(
      { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: '' },
      ANCHOR,
    );
    expect('until' in openEnded!).toBe(false);
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: '2026-07-05' }, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: 'garbage' }, ANCHOR)).toBeNull();
  });

  // ---- Interwał tygodniowy „co X tygodni" (PKG-20260803-interval-weeks) ----

  it('keeps an integer intervalWeeks 2..8 and drops the key for 1', () => {
    const every3 = normalizeRecurrenceRule(
      { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, intervalWeeks: 3 },
      ANCHOR,
    );
    expect(every3!.intervalWeeks).toBe(3);
    const weekly = normalizeRecurrenceRule(
      { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, intervalWeeks: 1 },
      ANCHOR,
    );
    expect('intervalWeeks' in weekly!).toBe(false);
    const max = normalizeRecurrenceRule(
      { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, intervalWeeks: 8 },
      ANCHOR,
    );
    expect(max!.intervalWeeks).toBe(8);
  });

  it('NEVER rejects the rule over a bad intervalWeeks — it collapses to weekly', () => {
    for (const bad of [0, 9, 1.5, '2', null, Number.NaN, -2, true, {}]) {
      const rule = normalizeRecurrenceRule(
        { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, intervalWeeks: bad },
        ANCHOR,
      );
      expect(rule).not.toBeNull();
      expect('intervalWeeks' in rule!).toBe(false);
    }
  });

  it('rejects when the anchor is not a real date', () => {
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 }, '')).toBeNull();
    expect(normalizeRecurrenceRule({ daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 }, 'nope')).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(normalizeRecurrenceRule(null, ANCHOR)).toBeNull();
    expect(normalizeRecurrenceRule(42, ANCHOR)).toBeNull();
  });
});

describe('normalizeRecurrence canonicalization + idempotency', () => {
  const base = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 };

  it('is draft-agnostic on raw input (no isDraft coupling in the util)', () => {
    // The util canonicalizes the rule regardless — draft-dropping lives in the
    // reducer / storage repair, not here.
    expect(normalizeRecurrence(base, ANCHOR)).toEqual(base);
  });

  it('drops stale (non-occurrence) override dates', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-07', skip: true }] }, // Tue, not a Monday occurrence
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
  });

  it('drops an override before the anchor', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-06-29', skip: true }] }, // Monday before anchor
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
  });

  it('drops a time-shift override equal to the base rule', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-13', startMinutes: 540, durationMinutes: 60 }] },
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
  });

  it('keeps a real time-shift and a skip, sorted by date, first duplicate wins', () => {
    const value = normalizeRecurrence(
      {
        ...base,
        overrides: [
          { date: '2026-07-20', skip: true },
          { date: '2026-07-13', startMinutes: 600, durationMinutes: 30 },
          { date: '2026-07-13', skip: true }, // duplicate date — dropped
        ],
      },
      ANCHOR,
    );
    expect(value!.overrides).toEqual([
      { date: '2026-07-13', startMinutes: 600, durationMinutes: 30 },
      { date: '2026-07-20', skip: true },
    ]);
  });

  it('drops off-grid / garbage overrides', () => {
    const value = normalizeRecurrence(
      {
        ...base,
        overrides: [
          { date: '2026-07-13', startMinutes: 605, durationMinutes: 30 }, // off-grid start
          { date: 42 },
          'nope',
          { date: '2026-07-20', durationMinutes: 30 }, // missing startMinutes
        ],
      },
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
  });

  it('is idempotent by value', () => {
    const once = normalizeRecurrence(
      {
        daysOfWeek: [5, 1, 1],
        startMinutes: 540,
        durationMinutes: 60,
        until: '2026-08-31',
        overrides: [
          { date: '2026-07-20', skip: true },
          { date: '2026-07-13', startMinutes: 600, durationMinutes: 30 },
        ],
      },
      ANCHOR,
    );
    const twice = normalizeRecurrence(once, ANCHOR);
    expect(twice).toEqual(once);
  });

  // ---- Per-occurrence done (PKG-20260727-recurring-occurrence-done) ----

  it('keeps a done-only override and round-trips it unchanged (idempotence)', () => {
    const once = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-13', done: true }] },
      ANCHOR,
    );
    expect(once!.overrides).toEqual([{ date: '2026-07-13', done: true }]);
    expect(normalizeRecurrence(once, ANCHOR)).toEqual(once);
  });

  it('keeps all FOUR canonical override shapes, sorted by date', () => {
    const once = normalizeRecurrence(
      {
        ...base,
        overrides: [
          { date: '2026-07-27', done: true, startMinutes: 600, durationMinutes: 30 },
          { date: '2026-07-06', skip: true },
          { date: '2026-07-20', startMinutes: 660, durationMinutes: 45 },
          { date: '2026-07-13', done: true },
        ],
      },
      ANCHOR,
    );
    expect(once!.overrides).toEqual([
      { date: '2026-07-06', skip: true },
      { date: '2026-07-13', done: true },
      { date: '2026-07-20', startMinutes: 660, durationMinutes: 45 },
      { date: '2026-07-27', done: true, startMinutes: 600, durationMinutes: 30 },
    ]);
    expect(normalizeRecurrence(once, ANCHOR)).toEqual(once); // idempotent by value
  });

  it('drops done: false / garbage done without invalidating the rest of the override', () => {
    const value = normalizeRecurrence(
      {
        ...base,
        overrides: [
          { date: '2026-07-13', done: false }, // nothing left => dropped
          { date: '2026-07-20', done: 'tak', startMinutes: 600, durationMinutes: 30 }, // shift survives
          { date: '2026-07-27', done: 1 }, // nothing left => dropped
        ],
      },
      ANCHOR,
    );
    expect(value!.overrides).toEqual([
      { date: '2026-07-20', startMinutes: 600, durationMinutes: 30 },
    ]);
  });

  it('skip wins over done (a skipped day has no occurrence)', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-13', skip: true, done: true }] },
      ANCHOR,
    );
    expect(value!.overrides).toEqual([{ date: '2026-07-13', skip: true }]);
  });

  it('a time-shift equal to the rule collapses to a done-only override', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-13', done: true, startMinutes: 540, durationMinutes: 60 }] },
      ANCHOR,
    );
    expect(value!.overrides).toEqual([{ date: '2026-07-13', done: true }]);
  });

  it('an invalid/off-grid time pair does not nuke a valid done flag', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-13', done: true, startMinutes: 605, durationMinutes: 30 }] },
      ANCHOR,
    );
    expect(value!.overrides).toEqual([{ date: '2026-07-13', done: true }]);
  });

  it('a done override on a non-occurrence date is still dropped', () => {
    const value = normalizeRecurrence(
      { ...base, overrides: [{ date: '2026-07-07', done: true }] }, // Tuesday
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
  });

  // ---- Interwał tygodniowy „co X tygodni" (PKG-20260803-interval-weeks) ----

  it('round-trips intervalWeeks and stays idempotent by value', () => {
    const once = normalizeRecurrence(
      {
        ...base,
        intervalWeeks: 2,
        overrides: [{ date: '2026-07-20', skip: true }],
      },
      ANCHOR,
    );
    expect(once).toEqual({ ...base, intervalWeeks: 2, overrides: [{ date: '2026-07-20', skip: true }] });
    expect(normalizeRecurrence(once, ANCHOR)).toEqual(once);
  });

  it('drops an override that fell into a dead week of the interval', () => {
    const value = normalizeRecurrence(
      // 2026-07-13 is a Monday in the SKIPPED week of a 2-week rule anchored 07-06.
      { ...base, intervalWeeks: 2, overrides: [{ date: '2026-07-13', skip: true }] },
      ANCHOR,
    );
    expect(value!.overrides).toBeUndefined();
    // The same override survives on an ACTIVE week.
    const kept = normalizeRecurrence(
      { ...base, intervalWeeks: 2, overrides: [{ date: '2026-07-20', skip: true }] },
      ANCHOR,
    );
    expect(kept!.overrides).toEqual([{ date: '2026-07-20', skip: true }]);
  });

  it('returns undefined when the rule is invalid', () => {
    expect(normalizeRecurrence({ daysOfWeek: [], startMinutes: 540, durationMinutes: 60 }, ANCHOR)).toBeUndefined();
  });
});

describe('isOccurrenceDate', () => {
  const rule: TaskRecurrence = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: '2026-07-20' };

  it('is true only on pattern days within [anchor, until]', () => {
    expect(isOccurrenceDate(rule, ANCHOR, '2026-07-06')).toBe(true); // Mon, anchor
    expect(isOccurrenceDate(rule, ANCHOR, '2026-07-13')).toBe(true); // Mon
    expect(isOccurrenceDate(rule, ANCHOR, '2026-07-20')).toBe(true); // Mon, == until
    expect(isOccurrenceDate(rule, ANCHOR, '2026-07-07')).toBe(false); // Tue
    expect(isOccurrenceDate(rule, ANCHOR, '2026-06-29')).toBe(false); // before anchor
    expect(isOccurrenceDate(rule, ANCHOR, '2026-07-27')).toBe(false); // after until
    expect(isOccurrenceDate(rule, ANCHOR, 'garbage')).toBe(false);
  });

  it('honours the weekly interval (dead weeks are not occurrence dates)', () => {
    const biweekly: TaskRecurrence = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, intervalWeeks: 2 };
    expect(isOccurrenceDate(biweekly, ANCHOR, '2026-07-06')).toBe(true); // week 0
    expect(isOccurrenceDate(biweekly, ANCHOR, '2026-07-13')).toBe(false); // week 1 (dead)
    expect(isOccurrenceDate(biweekly, ANCHOR, '2026-07-20')).toBe(true); // week 2
    expect(isOccurrenceDate(biweekly, ANCHOR, '2026-07-27')).toBe(false); // week 3 (dead)
  });
});

describe('expandOccurrences', () => {
  const rule: TaskRecurrence = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 };

  it('expands only within [from, to] inclusive with the anchor lower bound', () => {
    const occ = expandOccurrences(rule, ANCHOR, '2026-07-01', '2026-07-14');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-13']);
    expect(occ[0]).toEqual({ date: '2026-07-06', startMinutes: 540, durationMinutes: 60, overridden: false, done: false });
  });

  it('respects an inclusive until upper bound', () => {
    const bounded: TaskRecurrence = { ...rule, until: '2026-07-13' };
    const occ = expandOccurrences(bounded, ANCHOR, '2026-07-01', '2026-08-01');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-13']);
  });

  it('is open-ended when no until', () => {
    const occ = expandOccurrences(rule, ANCHOR, '2026-07-06', '2026-07-27');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);
  });

  it('returns [] when from > to', () => {
    expect(expandOccurrences(rule, ANCHOR, '2026-07-20', '2026-07-06')).toEqual([]);
  });

  it('selects multiple weekdays', () => {
    const multi: TaskRecurrence = { daysOfWeek: [1, 3], startMinutes: 540, durationMinutes: 60 };
    const occ = expandOccurrences(multi, ANCHOR, '2026-07-06', '2026-07-09');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-08']); // Mon, Wed
  });

  it('applies a skip override', () => {
    const skipped: TaskRecurrence = { ...rule, overrides: [{ date: '2026-07-13', skip: true }] };
    const occ = expandOccurrences(skipped, ANCHOR, '2026-07-06', '2026-07-20');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-20']);
  });

  it('applies a time-shift override and marks overridden', () => {
    const shifted: TaskRecurrence = {
      ...rule,
      overrides: [{ date: '2026-07-13', startMinutes: 600, durationMinutes: 30 }],
    };
    const occ = expandOccurrences(shifted, ANCHOR, '2026-07-06', '2026-07-13');
    expect(occ[1]).toEqual({ date: '2026-07-13', startMinutes: 600, durationMinutes: 30, overridden: true, done: false });
    expect(occ[0].overridden).toBe(false);
  });

  // ---- Per-occurrence done (PKG-20260727-recurring-occurrence-done) ----

  it('marks done ONLY on the flagged date, other occurrences stay un-done', () => {
    const withDone: TaskRecurrence = {
      ...rule,
      overrides: [{ date: '2026-07-13', done: true }],
    };
    const occ = expandOccurrences(withDone, ANCHOR, '2026-07-06', '2026-07-20');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-13', '2026-07-20']);
    expect(occ.map((o) => o.done)).toEqual([false, true, false]);
    // Done-only override keeps the rule's times and is NOT a time-shift.
    expect(occ[1]).toEqual({
      date: '2026-07-13', startMinutes: 540, durationMinutes: 60, overridden: false, done: true,
    });
  });

  it('a shifted + done occurrence carries BOTH flags', () => {
    const both: TaskRecurrence = {
      ...rule,
      overrides: [{ date: '2026-07-13', done: true, startMinutes: 600, durationMinutes: 30 }],
    };
    const occ = expandOccurrences(both, ANCHOR, '2026-07-06', '2026-07-13');
    expect(occ[1]).toEqual({
      date: '2026-07-13', startMinutes: 600, durationMinutes: 30, overridden: true, done: true,
    });
    expect(occ[0].done).toBe(false);
  });

  it('a skipped day never yields a done occurrence', () => {
    const skipped: TaskRecurrence = { ...rule, overrides: [{ date: '2026-07-13', skip: true }] };
    const occ = expandOccurrences(skipped, ANCHOR, '2026-07-06', '2026-07-20');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-20']);
    expect(occ.every((o) => o.done === false)).toBe(true);
  });

  // ---- Interwał tygodniowy „co X tygodni" (PKG-20260803-interval-weeks) ----

  it('expands every week when the key is absent (backward compatibility)', () => {
    const occ = expandOccurrences(rule, ANCHOR, '2026-07-06', '2026-08-03');
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
    ]);
    // intervalWeeks: 1 must be byte-identical to the absent key.
    const weekly: TaskRecurrence = { ...rule, intervalWeeks: 1 };
    expect(expandOccurrences(weekly, ANCHOR, '2026-07-06', '2026-08-03')).toEqual(occ);
  });

  it('skips dead weeks for a 2-week interval', () => {
    const biweekly: TaskRecurrence = { ...rule, intervalWeeks: 2 };
    const occ = expandOccurrences(biweekly, ANCHOR, '2026-07-06', '2026-08-03');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-20', '2026-08-03']);
  });

  it('skips dead weeks for a 4-week interval', () => {
    const monthly: TaskRecurrence = { ...rule, intervalWeeks: 4 };
    const occ = expandOccurrences(monthly, ANCHOR, '2026-07-06', '2026-09-01');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-08-03', '2026-08-31']);
  });

  it('counts the interval from the ANCHOR week, not from the window start', () => {
    const biweekly: TaskRecurrence = { ...rule, intervalWeeks: 2 };
    // Window opens INSIDE a dead week (2026-07-13 is the skipped Monday).
    const occ = expandOccurrences(biweekly, ANCHOR, '2026-07-13', '2026-08-03');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-20', '2026-08-03']);
  });

  it('anchors mid-week: a weekday BEFORE the anchor waits for the next active week', () => {
    // Anchor 2026-07-09 is a Thursday; the rule also fires on Mondays. The Monday
    // of the anchor's ISO week (07-06) is before the anchor, and the next Monday
    // (07-13) sits in the dead week — so the first Monday is 07-20.
    const thursdayAnchor = '2026-07-09';
    const biweekly: TaskRecurrence = {
      daysOfWeek: [1, 4],
      startMinutes: 540,
      durationMinutes: 60,
      intervalWeeks: 2,
    };
    const occ = expandOccurrences(biweekly, thursdayAnchor, '2026-07-01', '2026-08-06');
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-09', // Thu, anchor week (active)
      '2026-07-20', // Mon, week +2
      '2026-07-23', // Thu, week +2
      '2026-08-03', // Mon, week +4
      '2026-08-06', // Thu, week +4
    ]);
  });

  it('clamps a window longer than 400 days from `from`', () => {
    // Daily rule; a 2000-day window would otherwise expand ~2000 rows.
    const daily: TaskRecurrence = { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startMinutes: 0, durationMinutes: 15 };
    const occ = expandOccurrences(daily, ANCHOR, ANCHOR, '2032-01-01');
    // From 2026-07-06 + 400 days inclusive => 401 occurrences.
    expect(occ.length).toBe(401);
    expect(occ[0].date).toBe(ANCHOR);
    expect(occ[occ.length - 1].date).toBe('2027-08-10'); // ANCHOR + 400 days
  });
});
