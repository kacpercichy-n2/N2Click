import { describe, expect, it } from 'vitest';
import { toDateStr } from '../../utils/dates';
import { dayKey, formatClock, formatDaySeparator, formatListTime } from './chatTime';

// Znaczniki budujemy z LOKALNEJ daty i konwertujemy do ISO, więc test jest
// niezależny od strefy czasowej maszyny (na CI i lokalnie ten sam wynik).
function iso(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

const TODAY = toDateStr(new Date(2026, 7, 13));

describe('dayKey / formatClock', () => {
  it('zwraca dzień kalendarzowy użytkownika', () => {
    expect(dayKey(iso(2026, 8, 13, 9, 30))).toBe('2026-08-13');
  });

  it('formatuje godzinę dwucyfrowo', () => {
    expect(formatClock(iso(2026, 8, 13, 9, 5))).toBe('09:05');
    expect(formatClock(iso(2026, 8, 13, 23, 59))).toBe('23:59');
  });

  it('śmieciowy znacznik nie rzuca, tylko daje pusty string', () => {
    expect(dayKey('nie-data')).toBe('');
    expect(formatClock('')).toBe('');
    expect(formatListTime('nie-data', TODAY)).toBe('');
  });
});

describe('formatDaySeparator', () => {
  it('dzisiaj i wczoraj są słowne', () => {
    expect(formatDaySeparator(iso(2026, 8, 13, 8, 0), TODAY)).toBe('Dzisiaj');
    expect(formatDaySeparator(iso(2026, 8, 12, 8, 0), TODAY)).toBe('Wczoraj');
  });

  it('starszy dzień idzie prymitywem osi ze skrótem dnia tygodnia', () => {
    // 20 lipca 2026 to poniedziałek.
    expect(formatDaySeparator(iso(2026, 7, 20, 8, 0), TODAY)).toBe('20 lip (pon)');
  });
});

describe('formatListTime', () => {
  it('dzisiejsza rozmowa pokazuje godzinę', () => {
    expect(formatListTime(iso(2026, 8, 13, 14, 5), TODAY)).toBe('14:05');
  });

  it('wczorajsza pokazuje słowo, starsza skrót daty', () => {
    expect(formatListTime(iso(2026, 8, 12, 14, 5), TODAY)).toBe('Wczoraj');
    expect(formatListTime(iso(2026, 7, 20, 14, 5), TODAY)).toBe('20 lip');
  });

  it('rozmowa bez wiadomości nie ma czasu', () => {
    expect(formatListTime(null, TODAY)).toBe('');
  });
});
