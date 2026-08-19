import { describe, expect, it } from 'vitest';
import { axisHourRange, layoutColumns, minuteToPx, pxToSnappedMinute } from './dayTrackerLayout';

describe('dayTrackerLayout', () => {
  it('oś: domyślnie 7-19, rozszerza się do danych', () => {
    expect(axisHourRange([])).toEqual({ startHour: 7, endHour: 19 });
    expect(axisHourRange([{ startMinutes: 6 * 60 + 30, endMinutes: 20 * 60 + 15 }])).toEqual({ startHour: 6, endHour: 21 });
    expect(axisHourRange([{ startMinutes: 0, endMinutes: 1440 }])).toEqual({ startHour: 0, endHour: 24 });
  });
  it('px <-> minuta na siatce 15, w granicach osi', () => {
    const r = { startHour: 7, endHour: 19 };
    expect(minuteToPx(8 * 60, r, 56)).toBe(56);
    expect(pxToSnappedMinute(56 + 12, r, 56)).toBe(8 * 60 + 15);
    expect(pxToSnappedMinute(-100, r, 56)).toBe(7 * 60);
    expect(pxToSnappedMinute(10_000, r, 56)).toBe(19 * 60);
  });
  it('kolumny: nachodzące dzielą szerokość, rozłączne zostają pełne', () => {
    const lay = layoutColumns([
      { id: 'a', startMinutes: 600, endMinutes: 720 },
      { id: 'b', startMinutes: 660, endMinutes: 690 },
      { id: 'c', startMinutes: 720, endMinutes: 780 },
    ]);
    expect(lay.get('a')).toEqual({ col: 0, cols: 2 });
    expect(lay.get('b')).toEqual({ col: 1, cols: 2 });
    expect(lay.get('c')).toEqual({ col: 0, cols: 1 });
  });
});
