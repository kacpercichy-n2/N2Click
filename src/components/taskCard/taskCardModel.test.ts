import { describe, expect, it } from 'vitest';
import {
  TASK_TILE_ORDER,
  blockerTarget,
  compactHours,
  hoursTileSummary,
  peopleTileLabel,
  periodTileLabel,
  taskHoursRows,
} from './taskCardModel';

describe('blockerTarget', () => {
  it('każda kotwica powodu blokującego zapis otwiera swój edytor', () => {
    expect(blockerTarget('t-title')).toEqual({ kind: 'title' });
    expect(blockerTarget('t-project')).toEqual({ kind: 'crumbs' });
    expect(blockerTarget('t-client')).toEqual({ kind: 'crumbs' });
    expect(blockerTarget('t-status')).toEqual({ kind: 'tile', tile: 'status' });
    expect(blockerTarget('t-start')).toEqual({ kind: 'tile', tile: 'period' });
    expect(blockerTarget('t-end')).toEqual({ kind: 'tile', tile: 'period' });
    expect(blockerTarget('t-assignees')).toEqual({ kind: 'tile', tile: 'people' });
    expect(blockerTarget('t-priority')).toEqual({ kind: 'tile', tile: 'priority' });
    expect(blockerTarget('t-department')).toEqual({ kind: 'tile', tile: 'classification' });
  });

  it('powód bez kotwicy i nieznana kotwica niczego nie otwierają', () => {
    expect(blockerTarget(null)).toEqual({ kind: 'none' });
    expect(blockerTarget('cos-innego')).toEqual({ kind: 'none' });
  });

  it('siatka ma sześć kafelków w kolejności z makiety', () => {
    expect(TASK_TILE_ORDER).toEqual(['status', 'priority', 'period', 'people', 'hours', 'classification']);
  });
});

describe('compactHours', () => {
  it('pisze liczby bez zbędnych zer, z polskim przecinkiem', () => {
    expect(compactHours(9)).toBe('9');
    expect(compactHours(9.5)).toBe('9,5');
    expect(compactHours(0.25)).toBe('0,25');
    expect(compactHours(0)).toBe('0');
  });

  it('trzyma siatkę 0,25 h i nie schodzi poniżej zera', () => {
    expect(compactHours(1.1)).toBe('1');
    expect(compactHours(-3)).toBe('0');
  });
});

describe('hoursTileSummary', () => {
  it('kalendarz wobec sprzedanych, zasobnik jako drugi odcinek paska', () => {
    const s = hoursTileSummary({ calendar: 9, bin: 2, sold: 11 });
    expect(s.label).toBe('9/11h');
    expect(s.over).toBe(false);
    expect(s.calendarRatio).toBeCloseTo(9 / 11);
    expect(s.binRatio).toBeCloseTo(2 / 11);
    expect(s.spoken).toContain('w zasobniku 2 h');
  });

  it('nadmiar w kalendarzu to ten sam warunek, co ostrzeżenie edytora', () => {
    const s = hoursTileSummary({ calendar: 12, bin: 0, sold: 10 });
    expect(s.over).toBe(true);
    expect(s.calendarRatio).toBe(1);
    expect(s.binRatio).toBe(0);
  });

  it('bez sprzedanych godzin pokazuje sam kalendarz i nigdy nie dzieli przez zero', () => {
    const s = hoursTileSummary({ calendar: 0, bin: 0, sold: 0 });
    expect(s.label).toBe('0h');
    expect(s.over).toBe(false);
    expect(s.calendarRatio).toBe(0);
    expect(s.binRatio).toBe(0);
  });
});

describe('taskHoursRows', () => {
  it('zasobnik liczy się jak binTargets, razem = kalendarz + zasobnik', () => {
    const rows = taskHoursRows(
      [
        { id: 'a', name: 'Ola Nowak' },
        { id: 'b', name: 'Kasia Kowalska' },
      ],
      new Map([
        ['a', 6],
        ['b', 5],
      ]),
      new Map([
        ['a', 4],
        ['b', 5],
      ]),
    );
    expect(rows).toEqual([
      { id: 'a', name: 'Ola Nowak', calendar: 4, bin: 2, total: 6, over: false },
      { id: 'b', name: 'Kasia Kowalska', calendar: 5, bin: 0, total: 5, over: false },
    ]);
  });

  it('kalendarz ponad godziny osoby: zero w zasobniku, razem = kalendarz, flaga ostrzeżenia', () => {
    const [row] = taskHoursRows([{ id: 'a', name: 'Ola' }], new Map([['a', 2]]), new Map([['a', 3]]));
    expect(row).toEqual({ id: 'a', name: 'Ola', calendar: 3, bin: 0, total: 3, over: true });
  });

  it('osoba bez godzin zostaje w tabeli z zerami', () => {
    expect(taskHoursRows([{ id: 'a', name: 'Ola' }], new Map(), new Map())).toEqual([
      { id: 'a', name: 'Ola', calendar: 0, bin: 0, total: 0, over: false },
    ]);
  });
});

describe('periodTileLabel', () => {
  it('zakres dni z liczbą dni', () => {
    expect(periodTileLabel({ startDate: '2026-11-02', endDate: '2026-11-16', valid: true, days: 15 })).toBe(
      '2 lis → 16 lis · 15 dni',
    );
  });

  it('jeden dzień nie powtarza daty', () => {
    expect(periodTileLabel({ startDate: '2026-11-02', endDate: '2026-11-02', valid: true, days: 1 })).toBe(
      '2 lis · 1 dzień',
    );
  });

  it('zły okres nie formatuje dat (żadnego Invalid Date ani NaN)', () => {
    expect(periodTileLabel({ startDate: '', endDate: '2026-13-45', valid: false, days: 0 })).toBe('Popraw okres');
  });
});

describe('peopleTileLabel', () => {
  it('imiona dwóch pierwszych osób i licznik reszty', () => {
    expect(peopleTileLabel(['Ola Nowak', 'Kasia Kowalska'])).toBe('Ola, Kasia');
    expect(peopleTileLabel(['Ola Nowak', 'Kasia Kowalska', 'Marek W', 'Jan K'])).toBe('Ola, Kasia +2');
  });

  it('pusta lista ma zaprojektowany tekst', () => {
    expect(peopleTileLabel([])).toBe('Nikt nie jest przypisany');
  });
});
