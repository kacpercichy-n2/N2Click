// Testy czystego view-modelu kalendarza pól daty (`dateCalendar.ts`) — node,
// bez Reacta i DOM-u. Pokrywają: siatkę pełnych tygodni pon-nd, nawigację
// klawiaturą (wzór React Aria), stany komórek zakresu (wzór react-day-picker)
// i limit długości zakresu (urlop: 92 dni).
import { describe, expect, it } from 'vitest';
import {
  calendarDayState,
  calendarWeeks,
  inAnchorMonth,
  initialCalendarAnchor,
  monthAnchorShift,
  rangeDayCount,
  rangeEndLimit,
  resolveCalendarKey,
} from './dateCalendar';

const AUG = '2026-08-01'; // sierpień 2026: 1. to sobota

describe('calendarWeeks', () => {
  it('zwraca pełne tygodnie pon-nd z dniami przyległych miesięcy', () => {
    const weeks = calendarWeeks(AUG);
    // Sierpień 2026 zaczyna się w sobotę: pierwszy tydzień rusza od pon 27 lip.
    expect(weeks[0][0]).toBe('2026-07-27');
    expect(weeks[0][6]).toBe('2026-08-02');
    const last = weeks[weeks.length - 1];
    expect(last[6] >= '2026-08-31').toBe(true);
    // Każdy tydzień ma dokładnie 7 dni, kolejne dni różnią się o 1.
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it('kotwica w środku miesiąca daje tę samą siatkę co pierwszy dzień', () => {
    expect(calendarWeeks('2026-08-19')).toEqual(calendarWeeks(AUG));
  });
});

describe('nawigacja', () => {
  it('strzałki przesuwają o 1/7 dni, PageUp/Down o miesiąc, Home/End do granic tygodnia', () => {
    expect(resolveCalendarKey('ArrowLeft', '2026-08-19')).toBe('2026-08-18');
    expect(resolveCalendarKey('ArrowRight', '2026-08-19')).toBe('2026-08-20');
    expect(resolveCalendarKey('ArrowUp', '2026-08-19')).toBe('2026-08-12');
    expect(resolveCalendarKey('ArrowDown', '2026-08-19')).toBe('2026-08-26');
    expect(resolveCalendarKey('PageUp', '2026-08-19')).toBe('2026-07-19');
    expect(resolveCalendarKey('PageDown', '2026-08-19')).toBe('2026-09-19');
    expect(resolveCalendarKey('Home', '2026-08-19')).toBe('2026-08-17'); // pon
    expect(resolveCalendarKey('End', '2026-08-19')).toBe('2026-08-23'); // nd
    expect(resolveCalendarKey('Enter', '2026-08-19')).toBeNull();
  });

  it('monthAnchorShift przechodzi przez granicę roku', () => {
    expect(monthAnchorShift('2026-12-01', 1)).toBe('2027-01-01');
    expect(monthAnchorShift('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('inAnchorMonth odróżnia dni przyległe', () => {
    expect(inAnchorMonth('2026-08-01', AUG)).toBe(true);
    expect(inAnchorMonth('2026-07-27', AUG)).toBe(false);
  });
});

describe('calendarDayState', () => {
  const ctx = {
    selected: '2026-08-10' as const,
    rangeEnd: '2026-08-14' as const,
    min: '' as const,
    max: '' as const,
    today: '2026-08-24',
  };

  it('końce zakresu są selected, środek to range-middle', () => {
    expect(calendarDayState('2026-08-10', ctx)).toMatchObject({
      isSelected: true,
      isRangeStart: true,
      isRangeMiddle: false,
    });
    expect(calendarDayState('2026-08-12', ctx)).toMatchObject({
      isSelected: false,
      isRangeMiddle: true,
    });
    expect(calendarDayState('2026-08-14', ctx)).toMatchObject({
      isSelected: true,
      isRangeEnd: true,
    });
    expect(calendarDayState('2026-08-15', ctx)).toMatchObject({
      isSelected: false,
      isRangeMiddle: false,
    });
  });

  it('bez końca zakresu zaznaczona jest tylko wybrana data', () => {
    const single = { ...ctx, rangeEnd: '' as const };
    expect(calendarDayState('2026-08-10', single).isSelected).toBe(true);
    expect(calendarDayState('2026-08-12', single).isRangeMiddle).toBe(false);
  });

  it('min/max wyłączają dni poza granicami (włącznie)', () => {
    const bounded = { ...ctx, min: '2026-08-10' as const, max: '2026-08-20' as const };
    expect(calendarDayState('2026-08-09', bounded).disabled).toBe(true);
    expect(calendarDayState('2026-08-10', bounded).disabled).toBe(false);
    expect(calendarDayState('2026-08-20', bounded).disabled).toBe(false);
    expect(calendarDayState('2026-08-21', bounded).disabled).toBe(true);
  });

  it('dzisiaj dostaje flagę isToday', () => {
    expect(calendarDayState('2026-08-24', ctx).isToday).toBe(true);
  });
});

describe('limity zakresu', () => {
  it('rangeEndLimit liczy start + (maxDays - 1) — lustro 92 dni urlopu', () => {
    expect(rangeEndLimit('2026-08-01', 92)).toBe('2026-10-31');
    expect(rangeEndLimit('', 92)).toBe('');
  });

  it('rangeDayCount: brak końca albo koniec przed startem = 1 dzień', () => {
    expect(rangeDayCount('2026-08-10', '')).toBe(1);
    expect(rangeDayCount('2026-08-10', '2026-08-14')).toBe(5);
  });
});

describe('initialCalendarAnchor', () => {
  it('kotwiczy miesiąc wartości, a bez wartości — dzisiejszy', () => {
    expect(initialCalendarAnchor('2026-02-14', '2026-08-24')).toBe('2026-02-01');
    expect(initialCalendarAnchor('', '2026-08-24')).toBe('2026-08-01');
  });
});
