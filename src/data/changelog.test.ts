// Etykieta zakresu dat wpisu dziennika zmian.
import { describe, expect, it } from 'vitest';
import { changelogRangeLabel, isSameDayRange } from './changelog';

describe('changelogRangeLabel', () => {
  it('pokazuje jedną datę dla tego samego dnia', () => {
    expect(changelogRangeLabel('2026-07-21', '2026-07-21')).toBe('21.07');
  });

  it('skraca zakres w obrębie jednego miesiąca', () => {
    expect(changelogRangeLabel('2026-07-20', '2026-07-21')).toBe('20–21.07');
  });

  it('rozszerza obie strony przy różnych miesiącach', () => {
    expect(changelogRangeLabel('2026-06-28', '2026-07-02')).toBe('28.06–02.07');
  });

  it('dodaje rok przy zakresie na przełomie roku', () => {
    expect(changelogRangeLabel('2025-12-30', '2026-01-02')).toBe('30.12.2025–02.01.2026');
  });

  it('zwraca pusty tekst dla niepoprawnych dat', () => {
    expect(changelogRangeLabel('', '2026-07-21')).toBe('');
    expect(changelogRangeLabel('2026-13-01', '2026-07-21')).toBe('');
  });
});

describe('isSameDayRange', () => {
  it('true, gdy obie daty są takie same i poprawne', () => {
    expect(isSameDayRange('2026-07-21', '2026-07-21')).toBe(true);
  });

  it('false dla zakresu wielodniowego', () => {
    expect(isSameDayRange('2026-07-20', '2026-07-21')).toBe(false);
  });

  it('false dla niepoprawnych dat', () => {
    expect(isSameDayRange('', '')).toBe(false);
    expect(isSameDayRange('2026-13-01', '2026-13-01')).toBe(false);
  });
});
