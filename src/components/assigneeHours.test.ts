// Testy domyślnych godzin osoby przypisanej do zadania (zgłoszenie: osoba bez
// godzin = zadanie znikające z planu). Środowisko `node` — moduł jest czysty.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIGNEE_HOURS,
  DEFAULT_ASSIGNEE_HOURS_RAW,
  assigneeHasNoHours,
  withAssigneeHoursDefault,
  withAssigneeHoursDefaults,
} from './assigneeHours';
import { HOURS_STEP } from '../utils/time';

describe('DEFAULT_ASSIGNEE_HOURS', () => {
  it('to minimalny krok planowania: 15 minut', () => {
    expect(DEFAULT_ASSIGNEE_HOURS).toBe(HOURS_STEP);
    expect(DEFAULT_ASSIGNEE_HOURS * 60).toBe(15);
    expect(DEFAULT_ASSIGNEE_HOURS_RAW).toBe('0.25');
  });
});

describe('withAssigneeHoursDefault', () => {
  it('dopisuje 15 minut osobie bez wartości', () => {
    expect(withAssigneeHoursDefault({}, 'p1')).toEqual({ p1: '0.25' });
  });

  it('traktuje pusty i biały tekst jak brak wartości', () => {
    expect(withAssigneeHoursDefault({ p1: '' }, 'p1')).toEqual({ p1: '0.25' });
    expect(withAssigneeHoursDefault({ p1: '   ' }, 'p1')).toEqual({ p1: '0.25' });
  });

  it('nie rusza wartości już wpisanej, w tym świadomego zera', () => {
    const raw = { p1: '3', p2: '0' };
    expect(withAssigneeHoursDefault(raw, 'p1')).toBe(raw);
    expect(withAssigneeHoursDefault(raw, 'p2')).toBe(raw);
  });

  it('nie rusza godzin pozostałych osób', () => {
    expect(withAssigneeHoursDefault({ p1: '2' }, 'p2')).toEqual({ p1: '2', p2: '0.25' });
  });
});

describe('withAssigneeHoursDefaults', () => {
  it('domyśla godziny każdej wskazanej osobie z osobna', () => {
    expect(withAssigneeHoursDefaults({ p2: '4' }, ['p1', 'p2', 'p3'])).toEqual({
      p1: '0.25',
      p2: '4',
      p3: '0.25',
    });
  });

  it('pusta lista nie zmienia mapy', () => {
    const raw = { p1: '1' };
    expect(withAssigneeHoursDefaults(raw, [])).toBe(raw);
  });
});

describe('assigneeHasNoHours', () => {
  it('wykrywa osobę bez godzin sprzedanych i bez kalendarza', () => {
    expect(assigneeHasNoHours(0, 0)).toBe(true);
  });

  it('milczy, gdy osoba ma godziny sprzedane albo w kalendarzu', () => {
    expect(assigneeHasNoHours(0.25, 0)).toBe(false);
    expect(assigneeHasNoHours(0, 2)).toBe(false);
    expect(assigneeHasNoHours(4, 4)).toBe(false);
  });

  it('wartość poniżej połowy kroku snapuje się do zera', () => {
    expect(assigneeHasNoHours(0.1, 0)).toBe(true);
    expect(assigneeHasNoHours(0.13, 0)).toBe(false);
  });

  it('wartości niepoprawne liczą się jak zero', () => {
    expect(assigneeHasNoHours(Number.NaN, Number.NaN)).toBe(true);
    expect(assigneeHasNoHours(Number.NaN, 1)).toBe(false);
  });
});
