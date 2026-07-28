// Testy wspólnego licznika listy (SY-19) i reguły mnogości pod nim.
import { describe, expect, it } from 'vitest';
import { listCounterLabel, polishAmount, polishCount } from './polishPlural';

describe('listCounterLabel', () => {
  it('składa „<widoczne> z <wszystkich> <bytów>”', () => {
    expect(listCounterLabel(3, 21, 'zadań')).toBe('3 z 21 zadań');
    expect(listCounterLabel(0, 7, 'projektów')).toBe('0 z 7 projektów');
    expect(listCounterLabel(12, 12, 'zgłoszeń')).toBe('12 z 12 zgłoszeń');
  });

  it('rzeczownik po „z” zostaje w dopełniaczu mnogim także przy 2–4', () => {
    // Regresja: `polishCount` dawał tu „z 2 projekty”, co jest niepoprawne —
    // przypadek narzuca przyimek, nie liczebnik.
    expect(listCounterLabel(1, 2, 'projektów')).toBe('1 z 2 projektów');
    expect(listCounterLabel(1, 1, 'zadań')).toBe('1 z 1 zadań');
  });

  it('ten sam wzór dla każdej listy — różni się WYŁĄCZNIE nazwą bytu', () => {
    expect(listCounterLabel(2, 9, 'zadań').replace('zadań', 'zgłoszeń')).toBe(
      listCounterLabel(2, 9, 'zgłoszeń'),
    );
  });
});

describe('polishCount', () => {
  it('1 → one, 2–4 → few, reszta → many', () => {
    expect(polishCount(1, 'projekt', 'projekty', 'projektów')).toBe('projekt');
    expect(polishCount(3, 'projekt', 'projekty', 'projektów')).toBe('projekty');
    expect(polishCount(7, 'projekt', 'projekty', 'projektów')).toBe('projektów');
  });

  it('12–14 to wyjątek: „many”, mimo końcówki 2–4', () => {
    expect(polishCount(12, 'projekt', 'projekty', 'projektów')).toBe('projektów');
    expect(polishCount(14, 'projekt', 'projekty', 'projektów')).toBe('projektów');
    expect(polishCount(22, 'projekt', 'projekty', 'projektów')).toBe('projekty');
  });
});

describe('polishAmount', () => {
  const H = { one: 'godzina', few: 'godziny', many: 'godzin', fraction: 'godziny' };

  it('ułamek bierze dopełniacz liczby pojedynczej i przecinek', () => {
    expect(polishAmount(2.5, H)).toBe('2,5 godziny');
  });

  it('wartość całkowita idzie zwykłą regułą mnogości', () => {
    expect(polishAmount(1, H)).toBe('1 godzina');
    expect(polishAmount(3, H)).toBe('3 godziny');
    expect(polishAmount(12, H)).toBe('12 godzin');
  });
});
