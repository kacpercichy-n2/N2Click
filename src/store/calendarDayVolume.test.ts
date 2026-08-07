// Objętość godzinowa dnia w kalendarzu (zgłoszenie 77d10f85, decyzja usera
// 2026-08-07): `calendarDayVolume` = bloki (`dayTotal`) + spotkania i
// wystąpienia zadań cyklicznych liczone w ROBOCZOGODZINACH (× osoby w
// zakresie), URLOP wykluczony. `dayTotal` sam w sobie zostaje bez zmian
// (inwariant 1 dla logiki planowania) — asercje krzyżowe pilnują obu sum.
//
// Pure selector tests: no React / localStorage — fixtures from emptyData().
import { describe, expect, it } from 'vitest';
import { emptyData } from './storage';
import { calendarDayVolume, dayTotal } from './selectors';
import type {
  AppData,
  CalendarEvent,
  Person,
  Project,
  Status,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';

const ACTIVE: Status = { id: 'active', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const PROJECT: Project = {
  id: 'proj1', clientId: '', name: 'Projekt', description: '', statusId: 'active',
  paid: false, startDate: '2026-07-01', endDate: '2026-08-31', departmentId: '',
  serviceTypeId: '', documents: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const PERSON: Person = {
  id: 'p1', firstName: 'Ala', lastName: '', name: 'Ala', email: '', phone: '', role: '',
  departmentId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
  workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '',
};
const PERSON2: Person = { ...PERSON, id: 'p2', firstName: 'Bo', name: 'Bo' };
const PERSON3: Person = { ...PERSON, id: 'p3', firstName: 'Ce', name: 'Ce' };

// 2026-07-06 to poniedziałek (ISO 1).
const MON = '2026-07-06';

function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1', statusId: 'active', title: 'Zadanie', description: '',
    startDate: MON, endDate: '2026-07-31', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

function makeEvent(o: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: 'Spotkanie', description: '', location: '', meetingUrl: '', date: MON,
    startMinutes: 600, durationMinutes: 60, attendeeIds: [],
    createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z', ...o,
  };
}

function entry(o: Partial<WorkloadEntry> & { id: string }): WorkloadEntry {
  return { taskId: 't1', personId: 'p1', date: MON, plannedHours: 2, startMinutes: 540, sortIndex: 0, ...o };
}

function baseState(o: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    statuses: [ACTIVE],
    projects: [PROJECT],
    people: [PERSON, PERSON2, PERSON3],
    tasks: [makeTask({ id: 't1' })],
    ...o,
  };
}

describe('calendarDayVolume', () => {
  it('bez spotkań i cykliczności równa się dayTotal', () => {
    const state = baseState({ workload: [entry({ id: 'w1', plannedHours: 3 })] });
    expect(calendarDayVolume(state, MON)).toBe(3);
    expect(calendarDayVolume(state, MON)).toBe(dayTotal(state, MON));
  });

  it('spotkanie imienne dodaje czas × liczba uczestników; dayTotal bez zmian', () => {
    const state = baseState({
      workload: [entry({ id: 'w1', plannedHours: 2 })],
      events: [makeEvent({ id: 'e1', durationMinutes: 60, attendeeIds: ['p1', 'p2'] })],
    });
    expect(calendarDayVolume(state, MON)).toBe(2 + 2 * 1);
    expect(dayTotal(state, MON)).toBe(2);
  });

  it('filtr osób zawęża wkład spotkania do uczestników w filtrze', () => {
    const state = baseState({
      events: [makeEvent({ id: 'e1', durationMinutes: 90, attendeeIds: ['p1', 'p2'] })],
    });
    expect(calendarDayVolume(state, MON, new Set(['p1']))).toBe(1.5);
    expect(calendarDayVolume(state, MON, new Set(['p3']))).toBe(0);
  });

  it('spotkanie ogólnofirmowe liczy wszystkich w zakresie (zespół / rozmiar filtra)', () => {
    const state = baseState({ events: [makeEvent({ id: 'e1', durationMinutes: 60 })] });
    // Bez filtra: cały zespół (3 osoby) × 1h.
    expect(calendarDayVolume(state, MON)).toBe(3);
    // Filtr jednoosobowy: 1 × 1h.
    expect(calendarDayVolume(state, MON, new Set(['p2']))).toBe(1);
  });

  it('URLOP nie wnosi godzin (nieobecność to nie praca)', () => {
    const state = baseState({
      workload: [entry({ id: 'w1', plannedHours: 2 })],
      events: [
        makeEvent({
          id: 'e1', kind: 'urlop', attendeeIds: ['p1'],
          startMinutes: 0, durationMinutes: 1440, endDate: '2026-07-10',
        }),
      ],
    });
    expect(calendarDayVolume(state, MON)).toBe(2);
  });

  it('wystąpienie cykliczne dodaje czas × liczba przypisanych (∩ filtr)', () => {
    const assignments: TaskAssignment[] = [
      { id: 'a1', taskId: 't1', personId: 'p1' },
      { id: 'a2', taskId: 't1', personId: 'p2' },
    ];
    const state = baseState({
      tasks: [
        makeTask({
          id: 't1',
          recurrence: { daysOfWeek: [1], startMinutes: 540, durationMinutes: 30 },
        }),
      ],
      assignments,
    });
    expect(calendarDayVolume(state, MON)).toBe(0.5 * 2);
    expect(calendarDayVolume(state, MON, new Set(['p2']))).toBe(0.5);
    expect(dayTotal(state, MON)).toBe(0);
  });

  it('zadanie cykliczne bez przypisanych nie wnosi godzin', () => {
    const state = baseState({
      tasks: [
        makeTask({
          id: 't1',
          recurrence: { daysOfWeek: [1], startMinutes: 540, durationMinutes: 30 },
        }),
      ],
    });
    expect(calendarDayVolume(state, MON)).toBe(0);
  });
});
