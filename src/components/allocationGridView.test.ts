// Testy czystej warstwy prezentacji siatki przydziału (AT-05) i migawki
// kolumny osoby (AT-13). Środowisko `node` — moduł nie dotyka DOM-u.
import { describe, expect, it } from 'vitest';
import {
  allocKey,
  collapsedGroupLabel,
  groupAllocationDays,
  restorePersonColumn,
  snapshotPersonColumn,
  type AllocDayInfo,
} from './allocationGridView';

/** Skrót budowania dni: „2026-03-<dd>" + flagi. */
const day = (dd: number, opts: { weekend?: boolean; empty?: boolean } = {}): AllocDayInfo => ({
  date: `2026-03-${String(dd).padStart(2, '0')}`,
  weekend: opts.weekend ?? false,
  empty: opts.empty ?? true,
});

const NONE: ReadonlySet<string> = new Set<string>();

describe('groupAllocationDays', () => {
  it('cały pusty okres zwija się do JEDNEGO pasa z podziałem na dni robocze i weekendowe', () => {
    const days = [
      day(2),
      day(3),
      day(4),
      day(5),
      day(6),
      day(7, { weekend: true }),
      day(8, { weekend: true }),
    ];
    const segments = groupAllocationDays(days, NONE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      kind: 'group',
      dates: days.map((d) => d.date),
      workdays: 5,
      weekends: 2,
      expanded: false,
    });
  });

  it('weekend Z GODZINAMI zostaje zwykłym wierszem i rozbija pas', () => {
    const days = [
      day(6),
      day(7, { weekend: true, empty: false }),
      day(8, { weekend: true }),
      day(9),
    ];
    const segments = groupAllocationDays(days, NONE);
    expect(segments.map((s) => s.kind)).toEqual(['day', 'day', 'group']);
    // Kolejność nigdy się nie zmienia: pierwszy pusty dzień jest sam, więc
    // zostaje wierszem, potem weekend z wartością, potem pas 08–09.
    expect(segments[0]).toEqual({ kind: 'day', date: '2026-03-06' });
    expect(segments[1]).toEqual({ kind: 'day', date: '2026-03-07' });
    expect(segments[2]).toMatchObject({ dates: ['2026-03-08', '2026-03-09'] });
  });

  it('POJEDYNCZY pusty dzień między wypełnionymi zostaje wierszem (nie ma czego zwijać)', () => {
    const days = [day(2, { empty: false }), day(3), day(4, { empty: false })];
    expect(groupAllocationDays(days, NONE)).toEqual([
      { kind: 'day', date: '2026-03-02' },
      { kind: 'day', date: '2026-03-03' },
      { kind: 'day', date: '2026-03-04' },
    ]);
  });

  it('pas jest rozwinięty dopiero, gdy KAŻDA jego data siedzi w zbiorze', () => {
    const days = [day(2), day(3), day(4)];
    const partial = new Set(['2026-03-02', '2026-03-03']);
    expect(groupAllocationDays(days, partial)[0]).toMatchObject({ expanded: false });
    const all = new Set(days.map((d) => d.date));
    expect(groupAllocationDays(days, all)[0]).toMatchObject({ expanded: true });
  });

  it('wpisanie godzin W ŚRODKU rozwiniętego pasa rozbija go na dwa — oba zostają rozwinięte', () => {
    const dates = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
    const expanded = new Set(dates);
    const days = [day(2), day(3, { empty: false }), day(4), day(5)];
    const segments = groupAllocationDays(days, expanded);
    expect(segments.map((s) => s.kind)).toEqual(['day', 'day', 'group']);
    // Lewa połowa skurczyła się do jednego dnia (wiersz), prawa została pasem —
    // i nadal jest rozwinięta, bo jej daty zostały w zbiorze.
    expect(segments[2]).toMatchObject({
      dates: ['2026-03-04', '2026-03-05'],
      expanded: true,
    });
  });

  it('pusta lista dni nie produkuje segmentów', () => {
    expect(groupAllocationDays([], NONE)).toEqual([]);
  });
});

describe('collapsedGroupLabel', () => {
  it('kształt „X pustych dni roboczych + Y weekendowych"', () => {
    expect(collapsedGroupLabel(14, 6)).toBe('14 pustych dni roboczych + 6 weekendowych');
    expect(collapsedGroupLabel(2, 2)).toBe('2 puste dni robocze + 2 weekendowe');
    expect(collapsedGroupLabel(1, 1)).toBe('1 pusty dzień roboczy + 1 weekendowy');
  });

  it('same dni robocze — odmiana 1/2/5', () => {
    expect(collapsedGroupLabel(1, 0)).toBe('1 pusty dzień roboczy');
    expect(collapsedGroupLabel(2, 0)).toBe('2 puste dni robocze');
    expect(collapsedGroupLabel(5, 0)).toBe('5 pustych dni roboczych');
  });

  it('same weekendy — odmiana 1/2/5', () => {
    expect(collapsedGroupLabel(0, 1)).toBe('1 dzień weekendowy');
    expect(collapsedGroupLabel(0, 2)).toBe('2 dni weekendowe');
    expect(collapsedGroupLabel(0, 5)).toBe('5 dni weekendowych');
  });

  it('12–14 idzie w formę „many" (wyjątek polskiej reguły)', () => {
    expect(collapsedGroupLabel(12, 0)).toBe('12 pustych dni roboczych');
    expect(collapsedGroupLabel(0, 13)).toBe('13 dni weekendowych');
  });

  it('zdegenerowane 0/0 nie wybucha (pas bez dni i tak nie powstaje)', () => {
    expect(collapsedGroupLabel(0, 0)).toBe('0 pustych dni roboczych');
  });
});

describe('snapshotPersonColumn / restorePersonColumn', () => {
  const days = ['2026-03-02', '2026-03-03', '2026-03-04'];
  const allocations = {
    [allocKey('p1', '2026-03-02')]: 4,
    [allocKey('p1', '2026-03-03')]: 2.5,
    [allocKey('p2', '2026-03-02')]: 8,
  };
  const startTimes = {
    [allocKey('p1', '2026-03-03')]: 540,
    [allocKey('p2', '2026-03-02')]: 600,
  };

  it('migawka bierze WYŁĄCZNIE komórki tej osoby z dni okresu', () => {
    const snapshot = snapshotPersonColumn(allocations, startTimes, days, 'p1');
    expect(snapshot).toEqual({
      hours: { 'p1|2026-03-02': 4, 'p1|2026-03-03': 2.5 },
      starts: { 'p1|2026-03-03': 540 },
    });
  });

  it('dzień spoza okresu nie wchodzi do migawki', () => {
    const snapshot = snapshotPersonColumn(
      { ...allocations, [allocKey('p1', '2026-04-01')]: 6 },
      startTimes,
      days,
      'p1',
    );
    expect(snapshot.hours['p1|2026-04-01']).toBeUndefined();
  });

  it('runda migawka → wyczyszczenie → przywrócenie wraca do stanu wyjściowego', () => {
    const snapshot = snapshotPersonColumn(allocations, startTimes, days, 'p1');
    // Wyczyszczenie kolumny p1 (to samo, co robi `clearPerson`).
    const clearedAlloc = { ...allocations };
    const clearedStarts = { ...startTimes };
    for (const d of days) {
      delete clearedAlloc[allocKey('p1', d)];
      delete clearedStarts[allocKey('p1', d)];
    }
    const restored = restorePersonColumn(clearedAlloc, clearedStarts, snapshot);
    expect(restored.allocations).toEqual(allocations);
    expect(restored.startTimes).toEqual(startTimes);
  });

  it('przywrócenie zwraca NOWE obiekty i nie rusza kluczy innych osób', () => {
    const snapshot = snapshotPersonColumn(allocations, startTimes, days, 'p1');
    const cleared = { [allocKey('p2', '2026-03-02')]: 8, [allocKey('p3', '2026-03-04')]: 1 };
    const restored = restorePersonColumn(cleared, {}, snapshot);
    expect(restored.allocations).not.toBe(cleared);
    expect(restored.startTimes).not.toBe(startTimes);
    expect(restored.allocations[allocKey('p2', '2026-03-02')]).toBe(8);
    expect(restored.allocations[allocKey('p3', '2026-03-04')]).toBe(1);
    // Źródło pozostaje nietknięte.
    expect(cleared[allocKey('p1', '2026-03-02')]).toBeUndefined();
  });
});
