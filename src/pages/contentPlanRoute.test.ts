// Testy czystej logiki adresu trasy /content-plan (pager miesięcy w URL).
// Środowisko node — bez Reacta i bez routera.
import { describe, expect, it } from 'vitest';
import {
  MONTH_PARAM,
  contentPlanMonthHref,
  monthPagerFromParam,
  resolveMonthParam,
} from './contentPlanRoute';

describe('resolveMonthParam', () => {
  it('poprawny klucz miesiąca przechodzi bez zmian', () => {
    expect(resolveMonthParam('2026-08', '2026-08-03')).toBe('2026-08');
    expect(resolveMonthParam('2025-01', '2026-08-03')).toBe('2025-01');
    expect(resolveMonthParam('2026-12', '2026-08-03')).toBe('2026-12');
  });

  it('brak parametru => miesiąc dzisiejszy', () => {
    expect(resolveMonthParam(null, '2026-08-03')).toBe('2026-08');
    expect(resolveMonthParam(undefined, '2026-01-31')).toBe('2026-01');
    expect(resolveMonthParam('', '2026-08-03')).toBe('2026-08');
  });

  it('śmieci i niepoprawne miesiące => miesiąc dzisiejszy', () => {
    for (const raw of ['2026-13', '2026-00', 'sierpień', '2026-8', '20260-08', '2026-08-03']) {
      expect(resolveMonthParam(raw, '2026-08-03')).toBe('2026-08');
    }
  });
});

describe('monthPagerFromParam', () => {
  it('daje etykietę po polsku z wielkiej litery i sąsiednie miesiące', () => {
    expect(monthPagerFromParam('2026-08', '2026-08-03')).toEqual({
      key: '2026-08',
      label: 'Sierpień 2026',
      prev: '2026-07',
      next: '2026-09',
    });
  });

  it('przeskakuje granicę roku w obie strony', () => {
    expect(monthPagerFromParam('2026-01', '2026-08-03').prev).toBe('2025-12');
    expect(monthPagerFromParam('2026-12', '2026-08-03').next).toBe('2027-01');
  });

  it('niepoprawny parametr ląduje na dzisiejszym miesiącu, nie na pustce', () => {
    const pager = monthPagerFromParam('nie-miesiac', '2026-02-15');
    expect(pager.key).toBe('2026-02');
    expect(pager.label).toBe('Luty 2026');
    expect(pager.prev).toBe('2026-01');
    expect(pager.next).toBe('2026-03');
  });
});

describe('contentPlanMonthHref', () => {
  it('buduje adres modułu z zadeklarowanym parametrem', () => {
    expect(MONTH_PARAM).toBe('m');
    expect(contentPlanMonthHref('2026-08')).toBe('/content-plan?m=2026-08');
  });
});
