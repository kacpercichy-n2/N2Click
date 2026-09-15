// Osobisty czas wystąpienia + spotkania w obciążeniu osoby (2026-09-15):
// objętość dnia per osoba, godziny spotkań osoby, dostępność/przeciążenie.
import { describe, expect, it } from 'vitest';
import { emptyData } from './storage';
import {
  bookedHoursForPersonOnDate,
  calendarDayVolume,
  dayAvailabilityForPerson,
  overloadedPeopleOnDate,
  personEventHoursOnDate,
  rangeAvailabilityForPerson,
} from './selectors';
import type { AppData, CalendarEvent, Person, Project, Status, Task, TaskAssignment, WorkloadEntry } from '../types';

const ACTIVE: Status = { id: 'active', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const PROJECT: Project = {
  id: 'proj1', clientId: '', name: 'Projekt', description: '', statusId: 'active',
  paid: false, startDate: '2026-07-01', endDate: '2026-08-31', departmentId: '',
  serviceTypeId: '', documents: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const PERSON: Person = {
  id: 'p1', firstName: 'Ala', lastName: '', name: 'Ala', email: '', phone: '', role: '',
  departmentId: '', companyId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
  workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '',
};
const PERSON2: Person = { ...PERSON, id: 'p2', firstName: 'Bo', name: 'Bo' };
const MON = '2026-07-06';
const WED = '2026-07-08';

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
  return { ...emptyData(), statuses: [ACTIVE], projects: [PROJECT], people: [PERSON, PERSON2], tasks: [makeTask({ id: 't1' })], ...o };
}

describe('personEventHoursOnDate / bookedHoursForPersonOnDate', () => {
  it('spotkanie imienne liczy się uczestnikowi, nie innym; ogólnofirmowe każdemu; urlop nigdy', () => {
    const state = baseState({
      events: [
        makeEvent({ id: 'named', attendeeIds: ['p1'], durationMinutes: 60 }),
        makeEvent({ id: 'all', attendeeIds: [], startMinutes: 720, durationMinutes: 30 }),
        makeEvent({ id: 'urlop', kind: 'urlop', attendeeIds: ['p2'], startMinutes: 0, durationMinutes: 1440 }),
      ],
      workload: [entry({ id: 'e1', personId: 'p1', plannedHours: 2 })],
    });
    expect(personEventHoursOnDate(state, 'p1', MON)).toBe(1.5);
    expect(personEventHoursOnDate(state, 'p2', MON)).toBe(0.5);
    expect(bookedHoursForPersonOnDate(state, 'p1', MON)).toBe(3.5);
    expect(bookedHoursForPersonOnDate(state, 'p2', MON)).toBe(0.5);
    expect(personEventHoursOnDate(state, 'p1', WED)).toBe(0);
  });

  it('odmowa („nie biorę udziału") zeruje godziny wystąpienia u tej osoby', () => {
    const rule = { daysOfWeek: [1, 3], startMinutes: 600, durationMinutes: 60 };
    const state = baseState({
      events: [makeEvent({ id: 'r', attendeeIds: ['p1', 'p2'], recurrence: rule, rsvps: [{ date: WED, personId: 'p1', status: 'no' }] })],
    });
    expect(personEventHoursOnDate(state, 'p1', WED)).toBe(0);
    expect(personEventHoursOnDate(state, 'p2', WED)).toBe(1);
    expect(personEventHoursOnDate(state, 'p1', MON)).toBe(1);
  });

  it('osobisty czas zastępuje czas wydarzenia u tej osoby; objętość dnia liczy każdemu jego czas', () => {
    const rule = { daysOfWeek: [1, 3], startMinutes: 600, durationMinutes: 60 };
    const state = baseState({
      events: [
        makeEvent({
          id: 'r',
          attendeeIds: ['p1', 'p2'],
          recurrence: rule,
          personalTimes: [{ date: WED, personId: 'p1', startMinutes: 600, durationMinutes: 15 }],
        }),
      ],
    });
    expect(personEventHoursOnDate(state, 'p1', WED)).toBe(0.25);
    expect(personEventHoursOnDate(state, 'p2', WED)).toBe(1);
    // Objętość: bez filtra = 0,25 + 1; filtr p1 = 0,25; filtr p2 = 1; oboje = 1,25.
    expect(calendarDayVolume(state, WED)).toBe(1.25);
    expect(calendarDayVolume(state, WED, new Set(['p1']))).toBe(0.25);
    expect(calendarDayVolume(state, WED, new Set(['p2']))).toBe(1);
    expect(calendarDayVolume(state, WED, new Set(['p1', 'p2']))).toBe(1.25);
    // Inny dzień (bez osobistego czasu) liczy się normalnie.
    expect(calendarDayVolume(state, MON)).toBe(2);
  });

  it('wystąpienie zadania cyklicznego liczy się przypisanej osobie', () => {
    const assignment: TaskAssignment = { id: 'a1', taskId: 't1', personId: 'p1' };
    const state = baseState({
      tasks: [makeTask({ id: 't1', recurrence: { daysOfWeek: [1], startMinutes: 480, durationMinutes: 30 } })],
      assignments: [assignment],
    });
    expect(personEventHoursOnDate(state, 'p1', MON)).toBe(0.5);
    expect(personEventHoursOnDate(state, 'p2', MON)).toBe(0);
  });
});

describe('dayAvailabilityForPerson liczy spotkania do obciążenia (zgłoszenie „spotkania nie liczą się do obciążenia per dzień")', () => {
  it('bookedHours = bloki + spotkania; przeciążenie widzi spotkania; agregat tygodnia też', () => {
    const state = baseState({
      events: [makeEvent({ id: 'm', attendeeIds: ['p1'], startMinutes: 900, durationMinutes: 120 })],
      workload: [entry({ id: 'e1', personId: 'p1', plannedHours: 7 })],
    });
    const day = dayAvailabilityForPerson(state, 'p1', MON);
    expect(day.bookedHours).toBe(9);
    expect(day.overbooked).toBe(true);
    expect(overloadedPeopleOnDate(state, MON)).toEqual(['p1']);
    const week = rangeAvailabilityForPerson(state, 'p1', [MON, '2026-07-07']);
    expect(week.bookedHours).toBe(9);
    expect(week.overbookedDates).toEqual([MON]);
    // Bez spotkania te same 7h mieszczą się w etacie.
    const noMeeting = { ...state, events: [] };
    expect(dayAvailabilityForPerson(noMeeting, 'p1', MON).overbooked).toBe(false);
  });
});
