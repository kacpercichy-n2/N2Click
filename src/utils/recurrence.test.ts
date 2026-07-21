// Pure RRULE-lite recurrence math (PKG-20260721-recurrence-core).
// Weekday mapping, window expansion, overrides, canonicalization + idempotency.
import { describe, expect, it } from 'vitest';
import {
  expandOccurrences,
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
});

describe('expandOccurrences', () => {
  const rule: TaskRecurrence = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 };

  it('expands only within [from, to] inclusive with the anchor lower bound', () => {
    const occ = expandOccurrences(rule, ANCHOR, '2026-07-01', '2026-07-14');
    expect(occ.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-13']);
    expect(occ[0]).toEqual({ date: '2026-07-06', startMinutes: 540, durationMinutes: 60, overridden: false });
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
    expect(occ[1]).toEqual({ date: '2026-07-13', startMinutes: 600, durationMinutes: 30, overridden: true });
    expect(occ[0].overridden).toBe(false);
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
