// Testy wspólnego wzoru postępu (SY-20). Bez Reacta i bez store'a.
import { describe, expect, it } from 'vitest';
import { blocksProgressLabel, itemsProgressLabel } from './progressLabel';

describe('itemsProgressLabel', () => {
  it('składa „<n>/<N> pozycji” bez czasownika', () => {
    expect(itemsProgressLabel(2, 5)).toBe('2/5 pozycji');
    expect(itemsProgressLabel(0, 3)).toBe('0/3 pozycji');
    expect(itemsProgressLabel(3, 3)).toBe('3/3 pozycji');
  });

  it('nie używa „ukończono” ani „wykonano”', () => {
    const label = itemsProgressLabel(1, 4);
    expect(label).not.toContain('ukończono');
    expect(label).not.toContain('wykonano');
  });

  it('pojedyncza pozycja też idzie tym samym wzorem (bez odmiany)', () => {
    expect(itemsProgressLabel(1, 1)).toBe('1/1 pozycji');
  });
});

describe('blocksProgressLabel', () => {
  it('składa „<n>/<N> bloków”', () => {
    expect(blocksProgressLabel(3, 7)).toBe('3/7 bloków');
    expect(blocksProgressLabel(0, 0)).toBe('0/0 bloków');
  });

  it('różni się od wzoru pozycji WYŁĄCZNIE nazwą bytu', () => {
    expect(blocksProgressLabel(2, 5).replace('bloków', 'pozycji')).toBe(
      itemsProgressLabel(2, 5),
    );
  });
});

describe('wejścia śmieciowe', () => {
  it('zrobionych nigdy nie ma więcej niż wszystkich', () => {
    expect(itemsProgressLabel(9, 3)).toBe('3/3 pozycji');
    expect(blocksProgressLabel(9, 3)).toBe('3/3 bloków');
  });

  it('ujemne, NaN i null degradują do zera', () => {
    expect(itemsProgressLabel(-2, 3)).toBe('0/3 pozycji');
    expect(itemsProgressLabel(Number.NaN, 3)).toBe('0/3 pozycji');
    expect(itemsProgressLabel(null, undefined)).toBe('0/0 pozycji');
    expect(blocksProgressLabel(1, Number.POSITIVE_INFINITY)).toBe('0/0 bloków');
  });

  it('ułamki są obcinane w dół', () => {
    expect(itemsProgressLabel(1.9, 3.9)).toBe('1/3 pozycji');
  });
});
