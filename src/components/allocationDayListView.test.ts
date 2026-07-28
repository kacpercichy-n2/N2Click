// Testy czystego modelu mobilnej listy dni przydziału. Środowisko `node` —
// moduł nie dotyka DOM-u. Sedno: lista jest bliźniakiem tabeli, więc jej sumy
// muszą wychodzić CO DO LICZBY tak samo, jak `dayTotalAcross`/`personTotal`
// liczone wprost z tej samej mapy `allocations`.
import { describe, expect, it } from 'vitest';
import { allocKey } from './allocationGridView';
import {
  allocationDayRows,
  allocationPersonTotals,
  formatAllocationInput,
  parseAllocationInput,
  stepAllocationHours,
} from './allocationDayListView';

const DAYS = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
const PEOPLE = ['p1', 'p2'];

/** Mapa edytora zbudowana DOKŁADNIE tak, jak zapisuje ją `setCell`. */
const ALLOCATIONS: Record<string, number> = {
  [allocKey('p1', '2026-03-02')]: 4,
  [allocKey('p2', '2026-03-02')]: 2.5,
  [allocKey('p1', '2026-03-04')]: 0.25,
  [allocKey('p2', '2026-03-05')]: 8,
  // Komórka spoza okresu — nie wolno jej wliczyć do żadnej sumy.
  [allocKey('p1', '2026-04-01')]: 6,
};

// --- Semantyka TABELI, przepisana wprost z `AllocationGrid` ---------------
const cellValue = (personId: string, date: string): number =>
  ALLOCATIONS[allocKey(personId, date)] ?? 0;
const dayTotalAcross = (date: string): number =>
  PEOPLE.reduce((sum, p) => sum + cellValue(p, date), 0);
const personTotal = (personId: string): number =>
  DAYS.reduce((sum, d) => sum + cellValue(personId, d), 0);

describe('allocationDayRows', () => {
  it('daje jeden wiersz na dzień okresu, w kolejności dni', () => {
    expect(allocationDayRows(DAYS, PEOPLE, ALLOCATIONS).map((r) => r.date)).toEqual(DAYS);
  });

  it('suma dnia == `dayTotalAcross` tabeli (round-trip po tej samej mapie)', () => {
    for (const row of allocationDayRows(DAYS, PEOPLE, ALLOCATIONS)) {
      expect(row.total).toBe(dayTotalAcross(row.date));
    }
    // Kontrola liczb, żeby test nie zgadzał się „sam ze sobą".
    expect(allocationDayRows(DAYS, PEOPLE, ALLOCATIONS).map((r) => r.total)).toEqual([
      6.5, 0, 0.25, 8,
    ]);
  });

  it('sumy osób po dniach == `personTotal` tabeli', () => {
    const rows = allocationDayRows(DAYS, PEOPLE, ALLOCATIONS);
    const totals = allocationPersonTotals(rows, PEOPLE);
    for (const personId of PEOPLE) {
      expect(totals[personId]).toBe(personTotal(personId));
    }
    expect(totals).toEqual({ p1: 4.25, p2: 10.5 });
  });

  it('rozbicie na osoby ma WSZYSTKIE osoby, brak komórki = 0', () => {
    const rows = allocationDayRows(DAYS, PEOPLE, ALLOCATIONS);
    expect(rows[1]?.byPerson).toEqual({ p1: 0, p2: 0 });
    expect(rows[0]?.byPerson).toEqual({ p1: 4, p2: 2.5 });
  });

  it('dzień spoza okresu i osoba spoza przydziału nie wchodzą do sum', () => {
    const rows = allocationDayRows(DAYS, PEOPLE, ALLOCATIONS);
    expect(rows.some((r) => r.date === '2026-04-01')).toBe(false);
    // Suma całości == suma osób z okresu, więc 6 h z kwietnia nigdzie nie wsiąkło.
    const grand = rows.reduce((sum, r) => sum + r.total, 0);
    expect(grand).toBe(personTotal('p1') + personTotal('p2'));
  });

  it('edycja przez `setCell` przechodzi do sum listy (ta sama mapa, nowa referencja)', () => {
    const edited = { ...ALLOCATIONS, [allocKey('p1', '2026-03-03')]: 1.75 };
    const rows = allocationDayRows(DAYS, PEOPLE, edited);
    expect(rows[1]?.total).toBe(1.75);
    expect(allocationPersonTotals(rows, PEOPLE).p1).toBe(6);
  });

  it('pusty okres i brak osób nie wybuchają', () => {
    expect(allocationDayRows([], PEOPLE, ALLOCATIONS)).toEqual([]);
    expect(allocationDayRows(DAYS, [], ALLOCATIONS)).toEqual(
      DAYS.map((date) => ({ date, total: 0, byPerson: {} })),
    );
  });
});

describe('stepAllocationHours', () => {
  it('krok w górę i w dół po siatce 0,25 h', () => {
    expect(stepAllocationHours(0, 1)).toBe(0.25);
    expect(stepAllocationHours(0.25, 1)).toBe(0.5);
    expect(stepAllocationHours(8, -1)).toBe(7.75);
  });

  it('krawędzie zakresu trzymają: 24 w górę zostaje 24, 0 w dół zostaje 0', () => {
    expect(stepAllocationHours(24, 1)).toBe(24);
    expect(stepAllocationHours(0, -1)).toBe(0);
    // Wartość spoza zakresu wraca do zakresu, a nie ucieka dalej.
    expect(stepAllocationHours(30, 1)).toBe(24);
    expect(stepAllocationHours(-5, 1)).toBe(0.25);
  });

  it('wartość spoza siatki najpierw przyciąga się do 0,25, potem robi krok', () => {
    expect(stepAllocationHours(1.3, 1)).toBe(1.5);
    expect(stepAllocationHours(1.3, -1)).toBe(1);
  });

  it('wielokrotne kroki nie zbierają błędu zmiennoprzecinkowego', () => {
    let value = 0;
    for (let i = 0; i < 12; i += 1) value = stepAllocationHours(value, 1);
    expect(value).toBe(3);
  });

  it('wartość nieliczbowa startuje od zera zamiast produkować NaN', () => {
    expect(stepAllocationHours(Number.NaN, 1)).toBe(0.25);
  });
});

describe('parseAllocationInput', () => {
  it('przecinek i kropka są równoprawne', () => {
    expect(parseAllocationInput('1,75')).toBe(1.75);
    expect(parseAllocationInput('1.75')).toBe(1.75);
    expect(parseAllocationInput(' 2,5 ')).toBe(2.5);
  });

  it('wartość spoza siatki przyciąga się do najbliższego 0,25', () => {
    expect(parseAllocationInput('1.3')).toBe(1.25);
    expect(parseAllocationInput('1,4')).toBe(1.5);
  });

  it('puste pole to zero (kasowanie komórki)', () => {
    expect(parseAllocationInput('')).toBe(0);
    expect(parseAllocationInput('   ')).toBe(0);
  });

  it('sufit 24 h', () => {
    expect(parseAllocationInput('25')).toBe(24);
    expect(parseAllocationInput('100,5')).toBe(24);
  });

  it('śmieci zwracają null (wywołujący je ignoruje)', () => {
    expect(parseAllocationInput('abc')).toBeNull();
    expect(parseAllocationInput('-1')).toBeNull();
    expect(parseAllocationInput('1,2,3')).toBeNull();
    expect(parseAllocationInput('1e3')).toBeNull();
    expect(parseAllocationInput('0x10')).toBeNull();
    expect(parseAllocationInput(',')).toBeNull();
  });

  it('wpis „w trakcie pisania" (samo „1,") daje 1 — pole nie blokuje wpisywania', () => {
    expect(parseAllocationInput('1,')).toBe(1);
    expect(parseAllocationInput(',5')).toBe(0.5);
  });
});

describe('formatAllocationInput', () => {
  it('zero to puste pole, ułamek po polsku z przecinkiem', () => {
    expect(formatAllocationInput(0)).toBe('');
    expect(formatAllocationInput(1.75)).toBe('1,75');
    expect(formatAllocationInput(8)).toBe('8');
  });

  it('runda pole → parser → pole jest stabilna', () => {
    for (const hours of [0, 0.25, 1.75, 7.5, 24]) {
      expect(parseAllocationInput(formatAllocationInput(hours))).toBe(hours);
    }
  });
});
