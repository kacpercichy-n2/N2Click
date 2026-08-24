// Testy czystej logiki kafelka „Urlop" (konto). Pure — bez Reacta i store'u.
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  DEFAULT_VACATION_ALLOWANCE_DAYS,
  personVacationRanges,
  remainingVacationDays,
  upcomingVacationRanges,
  vacationWorkDaysInYear,
} from './accountHr';

const vacation = (
  id: string,
  personId: string,
  date: string,
  endDate?: string,
): CalendarEvent => ({
  id,
  title: 'Urlop',
  description: '',
  location: '',
  meetingUrl: '',
  date,
  startMinutes: 0,
  durationMinutes: 1440,
  attendeeIds: [personId],
  kind: 'urlop',
  ...(endDate ? { endDate } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const meeting = (id: string, personId: string, date: string): CalendarEvent => ({
  id,
  title: 'Spotkanie',
  description: '',
  location: '',
  meetingUrl: '',
  date,
  startMinutes: 600,
  durationMinutes: 60,
  attendeeIds: [personId],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const WEEKDAYS = [1, 2, 3, 4, 5];

describe('personVacationRanges', () => {
  it('zbiera wyłącznie urlopy tej osoby, posortowane po starcie', () => {
    const events = [
      vacation('v2', 'p1', '2026-09-07', '2026-09-11'),
      vacation('v1', 'p1', '2026-02-02'),
      vacation('v3', 'p2', '2026-03-02'),
      meeting('m1', 'p1', '2026-02-02'),
    ];
    expect(personVacationRanges(events, 'p1')).toEqual([
      { start: '2026-02-02', end: '2026-02-02' },
      { start: '2026-09-07', end: '2026-09-11' },
    ]);
  });

  it('pusty personId nie łapie niczego', () => {
    expect(personVacationRanges([vacation('v1', 'p1', '2026-02-02')], '')).toEqual([]);
  });

  it('urlop GODZINOWY (2026-08-24) niesie okno; pełnodniowy nie ma klucza', () => {
    const hourly = { ...vacation('v1', 'p1', '2026-02-02'), startMinutes: 540, durationMinutes: 120 };
    expect(personVacationRanges([hourly], 'p1')).toEqual([
      {
        start: '2026-02-02',
        end: '2026-02-02',
        window: { startMinutes: 540, endMinutes: 660 },
      },
    ]);
  });
});

describe('vacationWorkDaysInYear', () => {
  it('liczy tylko dni robocze osoby wewnątrz roku', () => {
    // Pn 2026-09-07 .. Nd 2026-09-13: 5 dni roboczych przy Pn–Pt.
    const ranges = [{ start: '2026-09-07', end: '2026-09-13' }];
    expect(vacationWorkDaysInYear(ranges, WEEKDAYS, 2026)).toBe(5);
  });

  it('weekendowy grafik liczy weekendy, nie dni Pn–Pt', () => {
    const ranges = [{ start: '2026-09-07', end: '2026-09-13' }];
    expect(vacationWorkDaysInYear(ranges, [6, 7], 2026)).toBe(2);
  });

  it('przycina zakres przechodzący przez granicę roku', () => {
    // Śr 2026-12-30 .. Pt 2027-01-01: w 2026 zostają Śr i Cz.
    const ranges = [{ start: '2026-12-30', end: '2027-01-01' }];
    expect(vacationWorkDaysInYear(ranges, WEEKDAYS, 2026)).toBe(2);
    expect(vacationWorkDaysInYear(ranges, WEEKDAYS, 2027)).toBe(1);
  });

  it('zakres całkiem poza rokiem daje zero', () => {
    const ranges = [{ start: '2025-06-01', end: '2025-06-05' }];
    expect(vacationWorkDaysInYear(ranges, WEEKDAYS, 2026)).toBe(0);
  });

  it('urlop GODZINOWY nie zdejmuje dnia z limitu (to nie dzień urlopu)', () => {
    const ranges = [
      { start: '2026-09-07', end: '2026-09-07', window: { startMinutes: 540, endMinutes: 660 } },
      { start: '2026-09-08', end: '2026-09-08' },
    ];
    expect(vacationWorkDaysInYear(ranges, WEEKDAYS, 2026)).toBe(1);
  });
});

describe('upcomingVacationRanges', () => {
  const ranges = [
    { start: '2026-02-02', end: '2026-02-06' },
    { start: '2026-08-03', end: '2026-08-07' },
    { start: '2026-09-07', end: '2026-09-11' },
    { start: '2026-10-05', end: '2026-10-09' },
  ];

  it('zwraca trwające i przyszłe, od najbliższego, z limitem', () => {
    // 2026-08-05 jest w środku drugiego zakresu — trwający zostaje.
    expect(upcomingVacationRanges(ranges, '2026-08-05', 0, 2)).toEqual([
      { start: '2026-08-03', end: '2026-08-07' },
      { start: '2026-09-07', end: '2026-09-11' },
    ]);
  });

  it('po ostatnim urlopie lista jest pusta', () => {
    expect(upcomingVacationRanges(ranges, '2026-11-01', 0)).toEqual([]);
  });

  it('dzisiejszy urlop GODZINOWY trwa tylko do końca swojego okna', () => {
    const hourly = {
      start: '2026-08-05',
      end: '2026-08-05',
      window: { startMinutes: 540, endMinutes: 660 }, // 9:00-11:00
    };
    const fullDay = { start: '2026-08-05', end: '2026-08-05' };
    // 10:00 — okno trwa; 12:00 — okno minęło (pełny dzień zostaje do północy).
    expect(upcomingVacationRanges([hourly, fullDay], '2026-08-05', 600)).toEqual([
      hourly,
      fullDay,
    ]);
    expect(upcomingVacationRanges([hourly, fullDay], '2026-08-05', 720)).toEqual([fullDay]);
  });
});

describe('remainingVacationDays', () => {
  it('odejmuje wykorzystane od limitu i nie schodzi poniżej zera', () => {
    expect(remainingVacationDays(7, DEFAULT_VACATION_ALLOWANCE_DAYS)).toBe(19);
    expect(remainingVacationDays(30, DEFAULT_VACATION_ALLOWANCE_DAYS)).toBe(0);
  });
});
