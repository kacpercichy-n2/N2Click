// Stanowisko jako opcja listy wyboru. Sprzężenie stanowisko → rola dostępu
// zniknęło razem z kolapsem ról (2026-07-22) — testów `accessRoleForTitle` brak.
import { describe, expect, it } from 'vitest';
import { jobTitleSelectOptions, roleTitleOptions } from './roleTitles';

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

describe('jobTitleSelectOptions', () => {
  const TITLES = [
    { id: 'j1', name: 'Grafik' },
    { id: 'j2', name: '  Programista  ' }, // przycinany
    { id: 'j3', name: '   ' }, // pusty po trim — pomijany
  ];

  it('kolejność: słownik → działowe → zaszłościowa wartość na końcu', () => {
    const opts = jobTitleSelectOptions(TITLES, DEPTS, 'Zaszłość');
    expect(opts).toEqual([
      'Grafik',
      'Programista',
      'Specjalista Design i IT',
      'Menadżer Design i IT',
      'Specjalista Produkcja',
      'Menadżer Produkcja',
      'Zaszłość',
    ]);
  });

  it('nie dubluje wartości pokrywającej się z opcją działową', () => {
    const opts = jobTitleSelectOptions([{ id: 'j1', name: 'Menadżer Produkcja' }], DEPTS);
    expect(opts.filter((o) => o === 'Menadżer Produkcja')).toHaveLength(1);
  });

  it('zaszłościowa wartość obecna już na liście nie jest dopisywana ponownie', () => {
    const opts = jobTitleSelectOptions([{ id: 'j1', name: 'Grafik' }], DEPTS, 'Grafik');
    expect(opts.filter((o) => o === 'Grafik')).toHaveLength(1);
    expect(opts[opts.length - 1]).not.toBe('Grafik'); // nie na końcu (już był)
  });

  it('istniejąca (zaszłościowa) wartość nigdy nie znika z listy', () => {
    const opts = jobTitleSelectOptions([], [], 'Projektantka');
    expect(opts).toContain('Projektantka');
  });
});
