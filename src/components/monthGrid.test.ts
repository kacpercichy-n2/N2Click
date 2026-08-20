// Testy czystej matematyki siatki miesiąca (PKG-20260728-calendar-blocks-keyboard):
// ruch strzałkami bez zawijania, Home/End w wierszu i w całej siatce, PageUp/
// PageDown jako zmiana miesiąca (z Shiftem — roku), wskazanie komórki z
// wędrującym `tabindex` oraz polska nazwa dostępna dnia. Bez Reacta i DOM-u.
import { describe, expect, it } from 'vitest';
import {
  MONTH_GRID_COLS,
  monthCellName,
  monthFocusIndex,
  monthGridCommand,
  monthGridRows,
} from './monthGrid';
import { monthGridDays } from '../utils/dates';

const NONE = { shift: false, ctrl: false };
const SHIFT = { shift: true, ctrl: false };
const CTRL = { shift: false, ctrl: true };
/** Lipiec 2026 zaczyna się w środę → siatka ma 5 pełnych tygodni (35 komórek). */
const DAYS = monthGridDays('2026-07-15');
const CELLS = DAYS.length;

describe('monthGridCommand — ruch po komórkach', () => {
  it('strzałki poziome chodzą o dzień, pionowe o tydzień', () => {
    expect(monthGridCommand('ArrowRight', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 11 });
    expect(monthGridCommand('ArrowLeft', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 9 });
    expect(monthGridCommand('ArrowDown', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 17 });
    expect(monthGridCommand('ArrowUp', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 3 });
  });

  it('NIE zawija się na żadnej krawędzi siatki', () => {
    expect(monthGridCommand('ArrowLeft', NONE, 0, CELLS)).toBe(null);
    expect(monthGridCommand('ArrowUp', NONE, 3, CELLS)).toBe(null);
    expect(monthGridCommand('ArrowRight', NONE, CELLS - 1, CELLS)).toBe(null);
    expect(monthGridCommand('ArrowDown', NONE, CELLS - 3, CELLS)).toBe(null);
  });

  it('Home/End trzyma się WIERSZA, a z Ctrl obejmuje całą siatkę', () => {
    expect(monthGridCommand('Home', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 7 });
    expect(monthGridCommand('End', NONE, 10, CELLS)).toEqual({ type: 'focus', index: 13 });
    expect(monthGridCommand('Home', CTRL, 10, CELLS)).toEqual({ type: 'focus', index: 0 });
    expect(monthGridCommand('End', CTRL, 10, CELLS)).toEqual({ type: 'focus', index: CELLS - 1 });
    // Już na miejscu → brak komendy (nie ma czego ogłaszać ani przestawiać).
    expect(monthGridCommand('Home', NONE, 7, CELLS)).toBe(null);
  });

  it('ignoruje klawisze spoza modelu i wejście spoza zakresu', () => {
    expect(monthGridCommand('Enter', NONE, 10, CELLS)).toBe(null);
    expect(monthGridCommand('ArrowRight', NONE, -1, CELLS)).toBe(null);
    expect(monthGridCommand('ArrowRight', NONE, 0, 0)).toBe(null);
  });
});

describe('monthGridCommand — zmiana widocznego okresu', () => {
  it('PageUp/PageDown przestawia miesiąc, z Shiftem rok', () => {
    expect(monthGridCommand('PageUp', NONE, 10, CELLS)).toEqual({ type: 'shiftMonth', delta: -1 });
    expect(monthGridCommand('PageDown', NONE, 10, CELLS)).toEqual({ type: 'shiftMonth', delta: 1 });
    expect(monthGridCommand('PageUp', SHIFT, 10, CELLS)).toEqual({ type: 'shiftYear', delta: -1 });
    expect(monthGridCommand('PageDown', SHIFT, 10, CELLS)).toEqual({ type: 'shiftYear', delta: 1 });
  });

  it('zmiana okresu działa nawet bez sensownego indeksu (pusta siatka)', () => {
    expect(monthGridCommand('PageDown', NONE, -1, 0)).toEqual({ type: 'shiftMonth', delta: 1 });
  });
});

describe('monthFocusIndex — jedyna komórka z `tabindex=0`', () => {
  it('wskazuje zapamiętany dzień, gdy jest w siatce', () => {
    expect(monthFocusIndex(DAYS, '2026-07-15', '2026-07-01')).toBe(DAYS.indexOf('2026-07-15'));
  });

  it('spada na kotwicę miesiąca, gdy zapamiętany dzień wypadł z siatki', () => {
    expect(monthFocusIndex(DAYS, '2025-01-01', '2026-07-03')).toBe(DAYS.indexOf('2026-07-03'));
  });

  it('w ostateczności wskazuje pierwszą komórkę', () => {
    expect(monthFocusIndex(DAYS, '2025-01-01', '2025-02-02')).toBe(0);
    expect(monthFocusIndex([], '2026-07-15', '2026-07-01')).toBe(0);
  });
});

describe('monthGridRows — wiersze siatki', () => {
  it('dzieli dni na pełne tygodnie', () => {
    const rows = monthGridRows(DAYS);
    expect(rows.length).toBe(CELLS / MONTH_GRID_COLS);
    expect(rows.every((r) => r.length === MONTH_GRID_COLS)).toBe(true);
    expect(rows[0][0]).toBe(DAYS[0]);
    expect(monthGridRows([])).toEqual([]);
  });
});

describe('monthCellName — polska nazwa dostępna komórki', () => {
  it('składa dzień, godziny i liczbę osób z poprawną odmianą', () => {
    expect(monthCellName({ dayLabel: '30 lipca', hours: 6, peopleCount: 2 })).toBe(
      '30 lipca, 6 zaplanowanych godzin, 2 osoby',
    );
    expect(monthCellName({ dayLabel: '1 lipca', hours: 1, peopleCount: 1 })).toBe(
      '1 lipca, 1 zaplanowana godzina, 1 osoba',
    );
    expect(monthCellName({ dayLabel: '2 lipca', hours: 2.5, peopleCount: 5 })).toBe(
      '2 lipca, 2,5 zaplanowanej godziny, 5 osób',
    );
  });

  it('pusty dzień mówi „brak pracy” i nie wspomina o osobach', () => {
    expect(monthCellName({ dayLabel: '4 lipca', hours: 0, peopleCount: 0 })).toBe(
      '4 lipca, brak pracy',
    );
  });

  it('dzień z samym wykonaniem NIE jest dniem bez pracy', () => {
    // Plan 0, ale 7h przepracowane ponad plan (zadanie sprzedane co do minuty):
    // komórka musi ogłosić te godziny, nie „brak pracy”.
    expect(monthCellName({ dayLabel: '20 sierpnia', hours: 0, peopleCount: 0, overrunHours: 7 })).toBe(
      '20 sierpnia, 7 godzin ponad plan',
    );
    expect(monthCellName({ dayLabel: '21 sierpnia', hours: 0, peopleCount: 0, overrunHours: 1 })).toBe(
      '21 sierpnia, 1 godzina ponad plan',
    );
    expect(monthCellName({ dayLabel: '22 sierpnia', hours: 0, peopleCount: 0, overrunHours: 2.5 })).toBe(
      '22 sierpnia, 2,5 godziny ponad plan',
    );
  });

  it('plan i nadgodziny stoją obok siebie, plan pierwszy', () => {
    expect(monthCellName({ dayLabel: '20 sierpnia', hours: 2, peopleCount: 1, overrunHours: 7 })).toBe(
      '20 sierpnia, 2 zaplanowane godziny, 7 godzin ponad plan, 1 osoba',
    );
    // Zero nadgodzin nic nie dokłada — nazwa zostaje bajt w bajt dotychczasowa.
    expect(monthCellName({ dayLabel: '4 lipca', hours: 0, peopleCount: 0, overrunHours: 0 })).toBe(
      '4 lipca, brak pracy',
    );
  });

  it('dokłada kontekst dnia, przeciążenie i znaczniki w stałej kolejności', () => {
    expect(
      monthCellName({
        dayLabel: '30 lipca',
        hours: 9,
        peopleCount: 1,
        today: true,
        outOfMonth: true,
        overloaded: true,
        markers: ['Urodziny: Anna', '', 'Wydarzenia: Standup'],
      }),
    ).toBe(
      '30 lipca, dzisiaj, poza miesiącem, 9 zaplanowanych godzin, 1 osoba, powyżej dostępności, Urodziny: Anna, Wydarzenia: Standup',
    );
  });
});
