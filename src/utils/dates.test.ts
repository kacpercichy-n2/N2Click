// Unit tests for the date validation layer added by PKG-20260712-date-validation-core:
// isValidDateStr (strict 'yyyy-MM-dd' round-trip check), periodError (the shared
// [start,end] period validator consumed by both UI forms and reducer guards), and
// the PERIOD_ERROR_LABELS Polish copy map.
import { describe, expect, it } from 'vitest';
import {
  addDaysStr,
  formatBirthday,
  formatShortWithWeekday,
  isBirthdayOn,
  isValidDateStr,
  MAX_TASK_PERIOD_DAYS,
  monthEnd,
  monthStart,
  PERIOD_ERROR_LABELS,
  periodError,
  type PeriodError,
} from './dates';

describe('isValidDateStr', () => {
  it.each([
    ['2026-07-12', true],
    ['2028-02-29', true], // leap day
    ['1999-01-01', true],
    ['', false],
    ['2026-02-31', false], // Feb has no 31st
    ['2026-13-01', false], // month 13
    ['2026-00-10', false], // month 0
    ['2026-2-3', false], // not zero-padded
    ['abc', false],
    ['2026-07-12T00:00', false], // datetime, not a bare date
    ['2026/07/12', false], // wrong separator
  ])('isValidDateStr(%j) -> %s', (input, expected) => {
    expect(isValidDateStr(input)).toBe(expected);
  });
});

describe('periodError', () => {
  it("returns 'missing-start' for an empty start date", () => {
    expect(periodError('', '2026-07-12')).toBe('missing-start');
  });

  it("returns 'invalid-start' for a non-empty, invalid start date", () => {
    expect(periodError('2026-02-31', '2026-07-12')).toBe('invalid-start');
  });

  it("returns 'missing-end' for an empty end date (once start is valid)", () => {
    expect(periodError('2026-07-12', '')).toBe('missing-end');
  });

  it("returns 'invalid-end' for a non-empty, invalid end date (once start is valid)", () => {
    expect(periodError('2026-07-12', 'x')).toBe('invalid-end');
  });

  it("returns 'reversed' when the end date is before the start date", () => {
    expect(periodError('2026-07-12', '2026-07-11')).toBe('reversed');
  });

  it("returns 'too-long' for a 93-day span when maxDays is MAX_TASK_PERIOD_DAYS (92)", () => {
    const start = '2026-07-06';
    const end = addDaysStr(start, 92); // inclusive day count = 93
    expect(periodError(start, end, { maxDays: MAX_TASK_PERIOD_DAYS })).toBe('too-long');
  });

  it('returns null for a 92-day span (exactly at the cap) when maxDays is MAX_TASK_PERIOD_DAYS', () => {
    const start = '2026-07-06';
    const end = addDaysStr(start, 91); // inclusive day count = 92
    expect(periodError(start, end, { maxDays: MAX_TASK_PERIOD_DAYS })).toBeNull();
  });

  it('returns null for a valid, non-reversed pair with no opts (no cap applied)', () => {
    expect(periodError('2026-07-06', '2026-07-12')).toBeNull();
  });

  it('returns null when start === end (a single-day period)', () => {
    expect(periodError('2026-07-12', '2026-07-12')).toBeNull();
  });
});

describe('formatShortWithWeekday', () => {
  it('appends the abbreviated Polish weekday for a Monday', () => {
    // 2026-10-26 is a Monday.
    expect(formatShortWithWeekday('2026-10-26')).toBe('26 paź (pon)');
  });

  it('appends the abbreviated Polish weekday for a Sunday', () => {
    // 2026-11-01 is a Sunday.
    expect(formatShortWithWeekday('2026-11-01')).toBe('1 lis (nie)');
  });
});

describe('isBirthdayOn', () => {
  it('dopasowuje po miesiącu i dniu, ignorując rok urodzenia', () => {
    expect(isBirthdayOn('1988-03-14', '2026-03-14')).toBe(true);
    expect(isBirthdayOn('1988-03-14', '2030-03-14')).toBe(true);
  });

  it('nie dopasowuje innego dnia ani miesiąca', () => {
    expect(isBirthdayOn('1988-03-14', '2026-03-15')).toBe(false);
    expect(isBirthdayOn('1988-03-14', '2026-04-14')).toBe(false);
  });

  it('puste albo niepoprawne birthDate => false (nigdy nie rzuca)', () => {
    expect(isBirthdayOn('', '2026-03-14')).toBe(false);
    expect(isBirthdayOn('nonsens', '2026-03-14')).toBe(false);
    expect(isBirthdayOn('2026-13-40', '2026-03-14')).toBe(false);
  });

  it('29 lutego dopasowuje tylko rok przestępny (bez sztucznego przeniesienia)', () => {
    expect(isBirthdayOn('2000-02-29', '2028-02-29')).toBe(true); // 2028 przestępny
    expect(isBirthdayOn('2000-02-29', '2027-02-28')).toBe(false);
  });
});

describe('formatBirthday', () => {
  it('formatuje pełną datę po polsku', () => {
    expect(formatBirthday('1988-03-14')).toBe('14 marca 1988');
  });

  it('puste/niepoprawne => pusty string', () => {
    expect(formatBirthday('')).toBe('');
    expect(formatBirthday('2026-99-99')).toBe('');
  });
});

describe('PERIOD_ERROR_LABELS', () => {
  const allErrors: PeriodError[] = [
    'missing-start',
    'invalid-start',
    'missing-end',
    'invalid-end',
    'reversed',
    'too-long',
  ];

  it.each(allErrors)('has a non-empty Polish label for %s', (err) => {
    const label = PERIOD_ERROR_LABELS[err];
    expect(typeof label).toBe('string');
    expect(label.trim().length).toBeGreaterThan(0);
  });
});

describe('monthStart / monthEnd', () => {
  it('returns first and last day of a 31-day month', () => {
    expect(monthStart('2026-07-22')).toBe('2026-07-01');
    expect(monthEnd('2026-07-22')).toBe('2026-07-31');
  });

  it('returns the last day of a 30-day month', () => {
    expect(monthEnd('2026-06-15')).toBe('2026-06-30');
  });

  it('returns 28 for February in a non-leap year', () => {
    expect(monthStart('2026-02-10')).toBe('2026-02-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
  });

  it('returns 29 for February in a leap year', () => {
    expect(monthEnd('2024-02-10')).toBe('2024-02-29');
  });
});
