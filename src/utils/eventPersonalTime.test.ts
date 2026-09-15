import { describe, expect, it } from 'vitest';
import {
  baseOccurrenceTimes,
  isValidPersonalWindow,
  normalizeEventPersonalTimes,
  personMayPersonalize,
  personalTimeFor,
  samePersonalTimes,
} from './eventPersonalTime';

const MON = '2026-07-06';
const WED = '2026-07-08';
const RULE = { daysOfWeek: [1, 3], startMinutes: 600, durationMinutes: 60 };

const oneOff = { date: MON, startMinutes: 600, durationMinutes: 60, attendeeIds: ['p1', 'p2'] };
const series = { ...oneOff, recurrence: RULE };
const companyWide = { ...oneOff, attendeeIds: [] };

describe('isValidPersonalWindow', () => {
  it('siatka 15 min, w dobie, dodatnia długość', () => {
    expect(isValidPersonalWindow(600, 15)).toBe(true);
    expect(isValidPersonalWindow(0, 1440)).toBe(true);
    expect(isValidPersonalWindow(605, 15)).toBe(false);
    expect(isValidPersonalWindow(600, 0)).toBe(false);
    expect(isValidPersonalWindow(1430, 30)).toBe(false);
    expect(isValidPersonalWindow('600', 15)).toBe(false);
  });
});

describe('baseOccurrenceTimes', () => {
  it('jednorazowe: tylko w swoim dniu; seria: dzień reguły z jej overrides; nieobecność: nigdy', () => {
    expect(baseOccurrenceTimes(oneOff, MON)).toEqual({ startMinutes: 600, durationMinutes: 60 });
    expect(baseOccurrenceTimes(oneOff, WED)).toBeNull();
    expect(baseOccurrenceTimes(series, WED)).toEqual({ startMinutes: 600, durationMinutes: 60 });
    expect(baseOccurrenceTimes(series, '2026-07-07')).toBeNull();
    const shifted = { ...series, recurrence: { ...RULE, overrides: [{ date: WED, startMinutes: 720, durationMinutes: 30 }] } };
    expect(baseOccurrenceTimes(shifted, WED)).toEqual({ startMinutes: 720, durationMinutes: 30 });
    expect(baseOccurrenceTimes({ ...oneOff, kind: 'urlop' }, MON)).toBeNull();
  });
});

describe('personMayPersonalize', () => {
  it('uczestnik imienny albo każdy przy ogólnofirmowym; pusta osoba nigdy', () => {
    expect(personMayPersonalize(oneOff, 'p1')).toBe(true);
    expect(personMayPersonalize(oneOff, 'p9')).toBe(false);
    expect(personMayPersonalize(companyWide, 'p9')).toBe(true);
    expect(personMayPersonalize(companyWide, '')).toBe(false);
  });
});

describe('normalizeEventPersonalTimes', () => {
  it('zostawia tylko poprawne wpisy: dzień wystąpienia, uczestnik, okno 15 min RÓŻNE od bazowego; dedup + sort', () => {
    const out = normalizeEventPersonalTimes(
      [
        { date: WED, personId: 'p2', startMinutes: 600, durationMinutes: 15 },
        { date: MON, personId: 'p1', startMinutes: 630, durationMinutes: 30 },
        { date: MON, personId: 'p1', startMinutes: 645, durationMinutes: 15 }, // duplikat — przegrywa
        { date: MON, personId: 'p2', startMinutes: 600, durationMinutes: 60 }, // równe bazowemu — znika
        { date: '2026-07-07', personId: 'p1', startMinutes: 600, durationMinutes: 15 }, // wtorek poza regułą
        { date: MON, personId: 'p9', startMinutes: 600, durationMinutes: 15 }, // nie-uczestnik
        { date: MON, personId: 'p1', startMinutes: 607, durationMinutes: 15 }, // poza siatką (i tak duplikat)
        { date: WED, personId: '', startMinutes: 600, durationMinutes: 15 },
        'śmieć',
        null,
      ],
      series,
    );
    expect(out).toEqual([
      { date: MON, personId: 'p1', startMinutes: 630, durationMinutes: 30 },
      { date: WED, personId: 'p2', startMinutes: 600, durationMinutes: 15 },
    ]);
  });

  it('pusto / nie-tablica / nieobecność => undefined; `personOk` odrzuca nieznane osoby', () => {
    expect(normalizeEventPersonalTimes([], series)).toBeUndefined();
    expect(normalizeEventPersonalTimes('x', series)).toBeUndefined();
    expect(
      normalizeEventPersonalTimes([{ date: MON, personId: 'p1', startMinutes: 600, durationMinutes: 15 }], {
        ...oneOff,
        kind: 'nieobecnosc',
      }),
    ).toBeUndefined();
    expect(
      normalizeEventPersonalTimes(
        [{ date: MON, personId: 'p1', startMinutes: 600, durationMinutes: 15 }],
        oneOff,
        (id) => id !== 'p1',
      ),
    ).toBeUndefined();
  });

  it('jest idempotentne po wartości', () => {
    const once = normalizeEventPersonalTimes(
      [{ date: WED, personId: 'p1', startMinutes: 600, durationMinutes: 15 }],
      series,
    );
    expect(normalizeEventPersonalTimes(once, series)).toEqual(once);
    expect(samePersonalTimes(once, normalizeEventPersonalTimes(once, series))).toBe(true);
    expect(samePersonalTimes(once, undefined)).toBe(false);
    expect(samePersonalTimes(undefined, undefined)).toBe(true);
  });

  it('personalTimeFor czyta wpis po (dzień, osoba)', () => {
    const event = { personalTimes: [{ date: WED, personId: 'p1', startMinutes: 600, durationMinutes: 15 }] };
    expect(personalTimeFor(event, WED, 'p1')).toEqual({ date: WED, personId: 'p1', startMinutes: 600, durationMinutes: 15 });
    expect(personalTimeFor(event, MON, 'p1')).toBeUndefined();
    expect(personalTimeFor(event, WED, '')).toBeUndefined();
    expect(personalTimeFor({}, WED, 'p1')).toBeUndefined();
  });
});
