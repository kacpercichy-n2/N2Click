// Unit tests for the date validation layer added by PKG-20260712-date-validation-core:
// isValidDateStr (strict 'yyyy-MM-dd' round-trip check), periodError (the shared
// [start,end] period validator consumed by both UI forms and reducer guards), and
// the PERIOD_ERROR_LABELS Polish copy map.
import { describe, expect, it } from 'vitest';
import {
  addDaysStr,
  isValidDateStr,
  MAX_TASK_PERIOD_DAYS,
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
