// Stanowisko jako opcja + sprzężenie stanowisko → rola dostępu.
import { describe, expect, it } from 'vitest';
import { accessRoleForTitle, roleTitleOptions } from './roleTitles';

const DEPTS = [
  { id: 'd1', name: 'Design i IT' },
  { id: 'd2', name: 'Produkcja' },
];

describe('roleTitleOptions', () => {
  it('generuje parę Specjalista/Menadżer dla każdego działu', () => {
    expect(roleTitleOptions(DEPTS)).toEqual([
      'Specjalista Design i IT',
      'Menadżer Design i IT',
      'Specjalista Produkcja',
      'Menadżer Produkcja',
    ]);
  });

  it('zaszłościowa wartość spoza listy pozostaje wybieralna na końcu', () => {
    const opts = roleTitleOptions(DEPTS, 'Projektantka');
    expect(opts[opts.length - 1]).toBe('Projektantka');
  });

  it('wartość z listy nie jest dublowana', () => {
    const opts = roleTitleOptions(DEPTS, 'Menadżer Produkcja');
    expect(opts.filter((o) => o === 'Menadżer Produkcja')).toHaveLength(1);
  });
});

describe('accessRoleForTitle', () => {
  it('Menadżer {dział} → pm; Specjalista {dział} → pracownik', () => {
    expect(accessRoleForTitle('Menadżer Design i IT')).toBe('pm');
    expect(accessRoleForTitle('Specjalista Design i IT')).toBe('pracownik');
  });

  it('toleruje wielkość liter i pisownię „Menadzer”', () => {
    expect(accessRoleForTitle('menadzer Produkcja')).toBe('pm');
    expect(accessRoleForTitle('SPECJALISTA Produkcja')).toBe('pracownik');
  });

  it('inne/własne stanowiska nie zmieniają roli (null)', () => {
    expect(accessRoleForTitle('Projektantka')).toBeNull();
    expect(accessRoleForTitle('')).toBeNull();
    expect(accessRoleForTitle('Menadżerka')).toBeNull(); // brak spacji-separatora
  });
});
