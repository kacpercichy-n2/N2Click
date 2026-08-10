// Testy reduktora DUPLICATE_TASK (zgłoszenie 2026-08-06): kopia treści i
// przypisań, suma godzin osoby (kalendarz + zasobnik źródła) jako JEDEN świeży
// wiersz zasobnika, tytuł z dopiskiem „ - kopia( N)” unikalnym w projekcie.
// Czyste testy reduktora: bez Reacta i localStorage.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import { BIN_DATE } from '../utils/time';
import type { AppData, Person, Project, Status, Task, TaskAssignment, WorkloadEntry } from '../types';

const PROJECT: Project = {
  id: 'proj1',
  clientId: '',
  name: 'Project',
  description: '',
  statusId: 'status1',
  paid: false,
  startDate: '2026-07-06',
  endDate: '2026-07-10',
  departmentId: '',
  serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const STATUS: Status = { id: 'status1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };

function makePerson(id: string): Person {
  return {
    id,
    firstName: id,
    lastName: '',
    name: id,
    email: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    phone: '',
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
  };
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1',
    statusId: 'status1',
    title: 'Task',
    description: 'Opis',
    startDate: '2026-07-06',
    endDate: '2026-07-10',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<WorkloadEntry> & { id: string }): WorkloadEntry {
  return {
    taskId: 't1',
    personId: 'p1',
    date: '2026-07-08',
    plannedHours: 2,
    startMinutes: 480,
    sortIndex: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    projects: [PROJECT],
    statuses: [...base.statuses, STATUS],
    people: [makePerson('p1'), makePerson('p2')],
    ...overrides,
  };
}

const ASSIGN: TaskAssignment[] = [
  { id: 'a1', taskId: 't1', personId: 'p1' },
  { id: 'a2', taskId: 't1', personId: 'p2' },
];

describe('DUPLICATE_TASK', () => {
  it('kopiuje treść zadania pod nowym id z dopiskiem „ - kopia” i rangą na końcu projektu', () => {
    const task = makeTask({
      id: 't1',
      title: 'Baner FB',
      priority: 'high',
      checklist: [{ id: 'c1', text: 'Sprawdzić', done: true }],
    });
    const other = makeTask({ id: 't2', title: 'Inne', orderIndex: 4 });
    const state = makeState({ tasks: [task, other] });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });

    const copy = next.tasks.find((t) => t.id === 'nowe-id');
    expect(copy).toBeDefined();
    expect(copy!.title).toBe('Baner FB - kopia');
    expect(copy!.description).toBe('Opis');
    expect(copy!.priority).toBe('high');
    expect(copy!.orderIndex).toBe(5);
    // Checklista: treść i odhaczenie jadą, id pozycji są świeże.
    expect(copy!.checklist).toHaveLength(1);
    expect(copy!.checklist[0].text).toBe('Sprawdzić');
    expect(copy!.checklist[0].done).toBe(true);
    expect(copy!.checklist[0].id).not.toBe('c1');
    // Źródło nietknięte.
    expect(next.tasks.find((t) => t.id === 't1')).toBe(task);
  });

  it('kopiuje przypisania osób pod świeżymi id', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })], assignments: ASSIGN });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    const copied = next.assignments.filter((a) => a.taskId === 'nowe-id');
    expect(copied.map((a) => a.personId).sort()).toEqual(['p1', 'p2']);
    expect(copied.every((a) => a.id !== 'a1' && a.id !== 'a2')).toBe(true);
  });

  it('sumuje godziny osoby (kalendarz + zasobnik) do JEDNEGO wiersza zasobnika kopii', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      assignments: ASSIGN,
      workload: [
        makeEntry({ id: 'w1', personId: 'p1', date: '2026-07-07', plannedHours: 1.25 }),
        makeEntry({ id: 'w2', personId: 'p1', date: '2026-07-08', plannedHours: 2, startMinutes: 600 }),
        makeEntry({ id: 'w3', personId: 'p1', date: BIN_DATE, plannedHours: 0.75, startMinutes: 0 }),
        makeEntry({ id: 'w4', personId: 'p2', date: '2026-07-09', plannedHours: 0.5 }),
      ],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    const copyRows = next.workload.filter((w) => w.taskId === 'nowe-id');
    // Wyłącznie zasobnik — nigdy umiejscowienie w kalendarzu.
    expect(copyRows.every((w) => w.date === BIN_DATE && w.startMinutes === 0)).toBe(true);
    expect(copyRows).toHaveLength(2);
    expect(copyRows.find((w) => w.personId === 'p1')!.plannedHours).toBe(4);
    expect(copyRows.find((w) => w.personId === 'p2')!.plannedHours).toBe(0.5);
    // Wiersze źródła bajtowo nietknięte.
    expect(next.workload.filter((w) => w.taskId === 't1')).toEqual(
      state.workload.filter((w) => w.taskId === 't1'),
    );
  });

  it('osoba przypisana bez godzin nie dostaje wiersza zasobnika', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      assignments: ASSIGN,
      workload: [makeEntry({ id: 'w1', personId: 'p1', plannedHours: 1 })],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    const copyRows = next.workload.filter((w) => w.taskId === 'nowe-id');
    expect(copyRows.map((w) => w.personId)).toEqual(['p1']);
  });

  it('kopia kopii nie piętrzy dopisków — bierze następny wolny numer', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', title: 'Baner FB' }),
        makeTask({ id: 't2', title: 'Baner FB - kopia' }),
      ],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't2', newTaskId: 'nowe-id' });
    expect(next.tasks.find((t) => t.id === 'nowe-id')!.title).toBe('Baner FB - kopia 2');
  });

  it('unikalność tytułu liczy się w obrębie projektu, nie globalnie', () => {
    const otherProject: Project = { ...PROJECT, id: 'proj2', name: 'Drugi' };
    const state = makeState({
      projects: [PROJECT, otherProject],
      tasks: [
        makeTask({ id: 't1', title: 'Baner FB' }),
        // Ten sam dopisek istnieje w INNYM projekcie — nie blokuje.
        makeTask({ id: 't2', title: 'Baner FB - kopia', projectId: 'proj2' }),
      ],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    expect(next.tasks.find((t) => t.id === 'nowe-id')!.title).toBe('Baner FB - kopia');
  });

  it('reguła cykliczności przechodzi bez per-datowych wyjątków', () => {
    const state = makeState({
      tasks: [
        makeTask({
          id: 't1',
          recurrence: {
            daysOfWeek: [2, 5],
            startMinutes: 600,
            durationMinutes: 60,
            overrides: [{ date: '2026-07-07', skip: true }],
          },
        }),
      ],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    const copy = next.tasks.find((t) => t.id === 'nowe-id')!;
    expect(copy.recurrence).toEqual({ daysOfWeek: [2, 5], startMinutes: 600, durationMinutes: 60 });
  });

  it('szkic kopiuje się jako szkic z draftHours i bez wierszy workload', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', isDraft: true, draftHours: [{ personId: 'p1', hours: 2 }] }),
      ],
      assignments: [{ id: 'a1', taskId: 't1', personId: 'p1' }],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    const copy = next.tasks.find((t) => t.id === 'nowe-id')!;
    expect(copy.isDraft).toBe(true);
    expect(copy.draftHours).toEqual([{ personId: 'p1', hours: 2 }]);
    expect(next.workload).toHaveLength(0);
  });

  it('odrzuca nieznane zadanie i kolizję newTaskId tą samą referencją stanu', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })] });
    expect(reducer(state, { type: 'DUPLICATE_TASK', taskId: 'ghost', newTaskId: 'x' })).toBe(state);
    expect(reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 't1' })).toBe(state);
    expect(reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: '' })).toBe(state);
  });

  it('utajnione zadanie kopiuje utajnienie i nie zostawia tytułu w dzienniku', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', title: 'Sekret', isConfidential: true })],
    });
    const next = reducer(state, { type: 'DUPLICATE_TASK', taskId: 't1', newTaskId: 'nowe-id' });
    expect(next.tasks.find((t) => t.id === 'nowe-id')!.isConfidential).toBe(true);
    const row = next.activity[next.activity.length - 1];
    expect(row.message).not.toContain('Sekret');
  });
});
