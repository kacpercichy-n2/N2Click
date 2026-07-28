// Testy wzoru glifów listy kontrolnej. Bez Reacta i bez store'a.
import { describe, expect, it } from 'vitest';
import { CHECKLIST_GLYPH_LIMIT, checklistGlyphs } from './checklistGlyphs';

describe('checklistGlyphs', () => {
  it('brak listy (0/0) nie ma reprezentacji', () => {
    expect(checklistGlyphs(0, 0)).toBeNull();
    expect(checklistGlyphs(2, 0)).toBeNull();
    expect(checklistGlyphs(0, undefined)).toBeNull();
  });

  it('nic odhaczonego rysuje same puste glify', () => {
    expect(checklistGlyphs(0, 3)).toEqual({
      pattern: '◌◌◌',
      text: '0/3',
      label: 'Lista kontrolna: 0 z 3',
    });
  });

  it('2 z 3 daje „◍◍◌ 2/3”', () => {
    const out = checklistGlyphs(2, 3);
    expect(out).toEqual({
      pattern: '◍◍◌',
      text: '2/3',
      label: 'Lista kontrolna: 2 z 3',
    });
  });

  it('komplet zapełnia wszystkie glify', () => {
    expect(checklistGlyphs(3, 3)?.pattern).toBe('◍◍◍');
  });

  it('lista dokładnie w limicie nie jest skalowana', () => {
    expect(checklistGlyphs(4, CHECKLIST_GLYPH_LIMIT)?.pattern).toBe('◍◍◍◍◌');
  });
});

describe('checklistGlyphs — długa lista', () => {
  it('nigdy nie rysuje więcej niż limit glifów', () => {
    const out = checklistGlyphs(20, 40);
    expect(out?.pattern).toHaveLength(CHECKLIST_GLYPH_LIMIT);
    expect(out?.text).toBe('20/40');
  });

  it('jedna odhaczona pozycja z 40 pokazuje JEDEN pełny glif (nie zero)', () => {
    expect(checklistGlyphs(1, 40)?.pattern).toBe('◍◌◌◌◌');
  });

  it('39 z 40 zostawia pusty glif — komplet znaczy komplet', () => {
    expect(checklistGlyphs(39, 40)?.pattern).toBe('◍◍◍◍◌');
    expect(checklistGlyphs(40, 40)?.pattern).toBe('◍◍◍◍◍');
  });

  it('własny limit zawęża wzór', () => {
    expect(checklistGlyphs(5, 10, 2)?.pattern).toBe('◍◌');
  });
});

describe('checklistGlyphs — wejścia śmieciowe', () => {
  it('odhaczonych nie może być więcej niż wszystkich', () => {
    expect(checklistGlyphs(9, 3)).toEqual({
      pattern: '◍◍◍',
      text: '3/3',
      label: 'Lista kontrolna: 3 z 3',
    });
  });

  it('ujemne i NaN degradują do zera', () => {
    expect(checklistGlyphs(-2, 3)?.text).toBe('0/3');
    expect(checklistGlyphs(Number.NaN, 3)?.text).toBe('0/3');
    expect(checklistGlyphs(1, Number.NaN)).toBeNull();
  });

  it('ułamki są obcinane w dół', () => {
    expect(checklistGlyphs(1.9, 3.9)?.text).toBe('1/3');
  });
});
