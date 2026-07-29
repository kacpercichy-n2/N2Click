import { describe, expect, it } from 'vitest';
import { comparePl, sortByNamePl } from './collation';

describe('comparePl', () => {
  it('ustawia polskie znaki diakrytyczne we właściwym miejscu alfabetu', () => {
    // Bez locale 'pl' „Łoś" wylądowałby za „Zebra" (Ł > Z w ASCII/Unicode).
    const names = ['Zebra', 'Łoś', 'Adam', 'Ćma', 'Cyprys'];
    expect([...names].sort(comparePl)).toEqual(['Adam', 'Cyprys', 'Ćma', 'Łoś', 'Zebra']);
  });
});

describe('sortByNamePl', () => {
  it('sortuje po nazwie i nie mutuje wejścia', () => {
    const input = [{ name: 'Żubr' }, { name: 'Agencja' }, { name: 'Świt' }];
    const out = sortByNamePl(input);
    expect(out.map((i) => i.name)).toEqual(['Agencja', 'Świt', 'Żubr']);
    expect(input.map((i) => i.name)).toEqual(['Żubr', 'Agencja', 'Świt']);
  });
});
