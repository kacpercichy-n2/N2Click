// Ścieżka `isConfidential` przez reduktor i repair wczytania: bramka zarządu
// (wartość z draftu honorowana tylko od isBoardMember), forma kanoniczna
// (klucz wyłącznie jako literalne `true`, nigdy na urlopie) i generyczne
// etykiety w niemutowalnych wpisach dziennika aktywności.
import { describe, expect, it } from 'vitest';
import { reducer, type EventDraft, type ProjectDraft, type TaskDraft } from './AppStore';
import { emptyData, normalizeTaskMeta, repairEvents, repairProjectDocuments } from './storage';
import type { AppData, CalendarEvent, Person, Project, Status, Task } from '../types';

const BOARD_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';

const STATUS: Status = {
  id: 'status1',
  name: 'Do zrobienia',
  slug: 'do-zrobienia',
  color: '#9aa7c4',
  order: 0,
  archived: false,
  isDone: false,
};

function person(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    firstName: 'Osoba',
    lastName: '',
    name: 'Osoba',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj1',
    clientId: '',
    name: 'Projekt',
    description: '',
    statusId: 'status1',
    paid: false,
    startDate: '2026-08-03',
    endDate: '2026-08-28',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'proj1',
    statusId: 'status1',
    title: 'Zadanie',
    description: '',
    startDate: '2026-08-03',
    endDate: '2026-08-07',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Spotkanie',
    description: '',
    location: '',
    meetingUrl: '',
    date: '2026-08-05',
    startMinutes: 600,
    durationMinutes: 60,
    attendeeIds: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Stan z zarządem (CEO) i zwykłym pracownikiem; `currentUserId` wybiera aktora. */
function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    statuses: [...base.statuses, STATUS],
    clients: [{ id: 'client1', name: 'Klient', archived: false }],
    projects: [project()],
    people: [person(BOARD_ID, { role: 'CEO – Chief Executive Officer' }), person(WORKER_ID, { role: 'Projektant' })],
    ...overrides,
  };
}

function taskDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    projectId: 'proj1',
    statusId: 'status1',
    title: 'Nowe zadanie',
    description: '',
    startDate: '2026-08-03',
    endDate: '2026-08-07',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    ...overrides,
  };
}

function projectDraft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    clientId: 'client1',
    name: 'Projekt',
    description: '',
    statusId: 'status1',
    paid: false,
    startDate: '2026-08-03',
    endDate: '2026-08-28',
    departmentId: '',
    serviceTypeId: '',
    companyId: '',
    ...overrides,
  };
}

function eventDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Spotkanie',
    description: '',
    location: '',
    meetingUrl: '',
    date: '2026-08-05',
    startMinutes: 600,
    durationMinutes: 60,
    attendeeIds: [],
    recurrence: null,
    ...overrides,
  };
}

describe('SAVE_TASK a utajnienie', () => {
  it('zarząd tworzy zadanie utajnione (klucz jako literalne true)', () => {
    const state = makeState({ currentUserId: BOARD_ID });
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: taskDraft({ isConfidential: true }), assigneeIds: [], allocations: [] },
    });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].isConfidential).toBe(true);
  });

  it('nie-zarząd nie może utajnić przy tworzeniu (klucz nieobecny)', () => {
    const state = makeState({ currentUserId: WORKER_ID });
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft: taskDraft({ isConfidential: true }), assigneeIds: [], allocations: [] },
    });
    expect('isConfidential' in next.tasks[0]).toBe(false);
  });

  it('zarząd utajnia i odtajnia istniejące zadanie', () => {
    const state = makeState({ currentUserId: BOARD_ID, tasks: [task()] });
    const hidden = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: taskDraft({ isConfidential: true }), assigneeIds: [], allocations: [] },
    });
    expect(hidden.tasks[0].isConfidential).toBe(true);
    const revealed = reducer(hidden, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: taskDraft({ isConfidential: false }), assigneeIds: [], allocations: [] },
    });
    expect('isConfidential' in revealed.tasks[0]).toBe(false);
  });

  it('edycja nie-zarządu i edycja bez pola zachowują istniejące utajnienie', () => {
    const state = makeState({ currentUserId: WORKER_ID, tasks: [task({ isConfidential: true })] });
    const tryClear = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: taskDraft({ isConfidential: false }), assigneeIds: [], allocations: [] },
    });
    expect(tryClear.tasks[0].isConfidential).toBe(true);
    const noField = reducer(makeState({ currentUserId: BOARD_ID, tasks: [task({ isConfidential: true })] }), {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: taskDraft(), assigneeIds: [], allocations: [] },
    });
    expect(noField.tasks[0].isConfidential).toBe(true);
  });
});

describe('SAVE_PROJECT a utajnienie', () => {
  it('zarząd tworzy i odtajnia; nie-zarząd zachowuje stan projektu', () => {
    const created = reducer(makeState({ currentUserId: BOARD_ID }), {
      type: 'SAVE_PROJECT',
      projectId: null,
      draft: projectDraft({ name: 'Tajny', isConfidential: true }),
    });
    const tajny = created.projects.find((p) => p.name === 'Tajny')!;
    expect(tajny.isConfidential).toBe(true);

    const workerEdit = reducer(
      makeState({ currentUserId: WORKER_ID, projects: [project({ isConfidential: true })] }),
      { type: 'SAVE_PROJECT', projectId: 'proj1', draft: projectDraft({ isConfidential: false }) },
    );
    expect(workerEdit.projects[0].isConfidential).toBe(true);

    const boardClear = reducer(
      makeState({ currentUserId: BOARD_ID, projects: [project({ isConfidential: true })] }),
      { type: 'SAVE_PROJECT', projectId: 'proj1', draft: projectDraft({ isConfidential: false }) },
    );
    expect('isConfidential' in boardClear.projects[0]).toBe(false);
  });

  it('spread draftu nigdy nie wpisuje boolean false do stanu', () => {
    const next = reducer(makeState({ currentUserId: BOARD_ID }), {
      type: 'SAVE_PROJECT',
      projectId: null,
      draft: projectDraft({ name: 'Jawny', isConfidential: false }),
    });
    const jawny = next.projects.find((p) => p.name === 'Jawny')!;
    expect('isConfidential' in jawny).toBe(false);
  });
});

describe('ADD_EVENT / SAVE_EVENT a utajnienie', () => {
  it('zarząd tworzy utajnione spotkanie; nie-zarząd nie', () => {
    const board = reducer(makeState({ currentUserId: BOARD_ID }), {
      type: 'ADD_EVENT',
      draft: eventDraft({ isConfidential: true }),
    });
    expect(board.events[0].isConfidential).toBe(true);

    const worker = reducer(makeState({ currentUserId: WORKER_ID }), {
      type: 'ADD_EVENT',
      draft: eventDraft({ isConfidential: true }),
    });
    expect('isConfidential' in worker.events[0]).toBe(false);
  });

  it('urlop nigdy nie niesie flagi, nawet od zarządu', () => {
    const next = reducer(makeState({ currentUserId: BOARD_ID }), {
      type: 'ADD_EVENT',
      draft: eventDraft({ kind: 'urlop', attendeeIds: [BOARD_ID], isConfidential: true }),
    });
    expect(next.events).toHaveLength(1);
    expect(next.events[0].kind).toBe('urlop');
    expect('isConfidential' in next.events[0]).toBe(false);
  });

  it('SAVE_EVENT: zarząd przełącza, nie-zarząd i brak pola zachowują', () => {
    const withEvent = (userId: string, confidential: boolean) =>
      makeState({
        currentUserId: userId,
        events: [calendarEvent(confidential ? { isConfidential: true } : {})],
      });

    const hidden = reducer(withEvent(BOARD_ID, false), {
      type: 'SAVE_EVENT',
      eventId: 'e1',
      draft: eventDraft({ isConfidential: true }),
    });
    expect(hidden.events[0].isConfidential).toBe(true);

    const preservedNoField = reducer(withEvent(BOARD_ID, true), {
      type: 'SAVE_EVENT',
      eventId: 'e1',
      draft: eventDraft(),
    });
    expect(preservedNoField.events[0].isConfidential).toBe(true);

    const preservedWorker = reducer(withEvent(WORKER_ID, true), {
      type: 'SAVE_EVENT',
      eventId: 'e1',
      draft: eventDraft({ isConfidential: false }),
    });
    expect(preservedWorker.events[0].isConfidential).toBe(true);
  });
});

describe('dziennik aktywności bez tytułów utajnionych encji', () => {
  it('DELETE_TASK utajnionego zadania pisze rzeczownik ogólny', () => {
    const state = makeState({
      currentUserId: BOARD_ID,
      tasks: [task({ title: 'Tajna strategia', isConfidential: true })],
    });
    const next = reducer(state, { type: 'DELETE_TASK', taskId: 't1' });
    const row = next.activity[next.activity.length - 1];
    expect(row.message).toBe('usunął(a) utajnione zadanie');
    expect(row.message).not.toContain('Tajna strategia');
  });

  it('DELETE_PROJECT utajnionego projektu pisze rzeczownik ogólny', () => {
    const state = makeState({
      currentUserId: BOARD_ID,
      projects: [project({ name: 'Przejęcie spółki', isConfidential: true })],
    });
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: 'proj1' });
    const row = next.activity[next.activity.length - 1];
    expect(row.message).toBe('usunął(a) utajniony projekt');
    expect(row.message).not.toContain('Przejęcie');
  });

  it('jawne encje zachowują tytuł w komunikacie', () => {
    const state = makeState({ currentUserId: BOARD_ID, tasks: [task({ title: 'Jawne zadanie' })] });
    const next = reducer(state, { type: 'DELETE_TASK', taskId: 't1' });
    expect(next.activity[next.activity.length - 1].message).toContain('Jawne zadanie');
  });
});

describe('repair wczytania — forma kanoniczna', () => {
  it('normalizeTaskMeta: true zostaje, false/śmieci znikają; idempotentne', () => {
    const state = makeState({
      tasks: [
        task({ id: 't1', isConfidential: true }),
        task({ id: 't2', isConfidential: false as unknown as true }),
        task({ id: 't3', isConfidential: 'tak' as unknown as true }),
      ],
    });
    const repaired = normalizeTaskMeta(state);
    expect(repaired.tasks[0].isConfidential).toBe(true);
    expect('isConfidential' in repaired.tasks[1]).toBe(false);
    expect('isConfidential' in repaired.tasks[2]).toBe(false);
    expect(normalizeTaskMeta(repaired).tasks).toEqual(repaired.tasks);
  });

  it('repairProjectDocuments kanonizuje flagę projektu', () => {
    const state = makeState({
      projects: [
        project({ id: 'proj1', isConfidential: true }),
        project({ id: 'proj2', isConfidential: 0 as unknown as true }),
      ],
    });
    const repaired = repairProjectDocuments(state);
    expect(repaired.projects[0].isConfidential).toBe(true);
    expect('isConfidential' in repaired.projects[1]).toBe(false);
  });

  it('repairEvents kanonizuje flagę i zdejmuje ją z urlopu', () => {
    const state = makeState({
      events: [
        calendarEvent({ id: 'e1', isConfidential: true }),
        calendarEvent({ id: 'e2', isConfidential: 1 as unknown as true }),
        calendarEvent({
          id: 'e3',
          kind: 'urlop',
          attendeeIds: [BOARD_ID],
          startMinutes: 0,
          durationMinutes: 1440,
          isConfidential: true,
        }),
      ],
    });
    const repaired = repairEvents(state);
    expect(repaired.events[0].isConfidential).toBe(true);
    expect('isConfidential' in repaired.events[1]).toBe(false);
    expect('isConfidential' in repaired.events[2]).toBe(false);
  });
});
