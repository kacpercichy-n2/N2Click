// Reguły wglądu w utajnioną treść (src/store/confidentiality.ts): matryca
// predykatu zarządu, wyjątki wykonawcy/uczestnika, deterministyczna numeracja
// etykiet „Zadanie #N" i display-helpery. Administrator (accessRole 'pelne')
// bez sygnałów zarządu MUSI widzieć maskę — to sedno zgłoszenia.
import { describe, expect, it } from 'vitest';
import {
  canViewEventContent,
  canViewProjectContent,
  canViewTaskContent,
  eventDisplayTitle,
  isBoardDepartment,
  isBoardMember,
  isBoardPerson,
  isBoardTitle,
  isEventContentMasked,
  isProjectContentMasked,
  isTaskContentMasked,
  maskedTaskLabel,
  projectDisplayName,
  taskDisplayTitle,
} from './confidentiality';
import { emptyData } from './storage';
import type { AppData, CalendarEvent, Person, Project, Task, TaskAssignment } from '../types';

const CEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const DEPT_BOARD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEPT_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TASK2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

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

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    statusId: 's1',
    title: 'Tajna strategia cenowa',
    description: 'Szczegóły negocjacji.',
    startDate: '2026-08-03',
    endDate: '2026-08-07',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    clientId: '',
    name: 'Przejęcie spółki',
    description: '',
    statusId: 's1',
    paid: false,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

function calendarEvent(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: 'Rozmowa o fuzji',
    description: '',
    location: '',
    meetingUrl: '',
    date: '2026-08-05',
    startMinutes: 600,
    durationMinutes: 60,
    attendeeIds: [],
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
    ...overrides,
  };
}

function assignment(taskId: string, personId: string): TaskAssignment {
  return { id: `as-${taskId}-${personId}`, taskId, personId };
}

/** Stan bazowy: CEO (stanowisko), zwykły pracownik i administrator bez
 *  żadnych sygnałów zarządu. */
function makeState(overrides: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    departments: [
      { id: DEPT_BOARD, name: 'Zarząd' },
      { id: DEPT_OTHER, name: 'Zarządzanie' },
    ],
    people: [
      person(CEO_ID, { role: 'CEO – Chief Executive Officer', name: 'Kamil' }),
      person(WORKER_ID, { role: 'Projektant', departmentId: DEPT_OTHER, accessRole: 'ograniczone' }),
      person(ADMIN_ID, { role: 'Administrator systemu', accessRole: 'pelne' }),
    ],
    currentUserId: WORKER_ID,
    ...overrides,
  };
}

describe('isBoardTitle', () => {
  it.each([
    ['CEO', true],
    ['COO', true],
    ['CTO', true],
    ['CTO – Chief Technology Officer', true],
    ['COO - cokolwiek', true],
    ['ceo', true],
    ['  CEO  ', true],
    ['CFO', false],
    ['CFO – Chief Financial Officer', false],
    ['CEOX', false],
    ['Wice CEO', false],
    ['Projektant', false],
    ['', false],
  ])('„%s" => %s', (title, expected) => {
    expect(isBoardTitle(title)).toBe(expected);
  });
});

describe('isBoardDepartment', () => {
  it('rozpoznaje dział „Zarząd" niezależnie od wielkości liter i spacji', () => {
    const state = makeState({
      departments: [
        { id: 'd1', name: ' zarząd ' },
        { id: 'd2', name: 'ZARZĄD' },
        { id: 'd3', name: 'Zarządzanie' },
        { id: 'd4', name: 'zarzad' },
      ],
    });
    expect(isBoardDepartment(state, 'd1')).toBe(true);
    expect(isBoardDepartment(state, 'd2')).toBe(true);
    expect(isBoardDepartment(state, 'd3')).toBe(false);
    expect(isBoardDepartment(state, 'd4')).toBe(false);
    expect(isBoardDepartment(state, '')).toBe(false);
    expect(isBoardDepartment(state, 'nieistniejacy')).toBe(false);
  });
});

describe('isBoardPerson / isBoardMember', () => {
  it('zarząd przez stanowisko LUB dział; administrator bez sygnałów NIE jest zarządem', () => {
    const state = makeState();
    expect(isBoardPerson(state, state.people[0])).toBe(true); // CEO
    expect(isBoardPerson(state, state.people[1])).toBe(false); // Projektant
    expect(isBoardPerson(state, state.people[2])).toBe(false); // admin bez sygnałów
    expect(isBoardPerson(state, undefined)).toBe(false);

    const viaDept = makeState({
      people: [person(WORKER_ID, { role: 'Asystent', departmentId: DEPT_BOARD })],
      currentUserId: WORKER_ID,
    });
    expect(isBoardMember(viaDept)).toBe(true);
  });

  it('pusty currentUserId nigdy nie jest zarządem', () => {
    expect(isBoardMember(makeState({ currentUserId: '' }))).toBe(false);
  });
});

describe('wyjątki wglądu', () => {
  const confidentialTask = task(TASK_ID, { isConfidential: true });

  it('zadanie: zarząd i przypisany wykonawca widzą, reszta (w tym admin) nie', () => {
    const base = {
      projects: [project(PROJECT_ID, { isConfidential: true })],
      tasks: [confidentialTask],
      assignments: [assignment(TASK_ID, WORKER_ID)],
    };
    const asBoard = makeState({ ...base, currentUserId: CEO_ID });
    const asAssignee = makeState({ ...base, currentUserId: WORKER_ID });
    const asAdmin = makeState({ ...base, currentUserId: ADMIN_ID });

    expect(canViewTaskContent(asBoard, confidentialTask)).toBe(true);
    expect(canViewTaskContent(asAssignee, confidentialTask)).toBe(true);
    expect(canViewTaskContent(asAdmin, confidentialTask)).toBe(false);
    expect(isTaskContentMasked(asAdmin, confidentialTask)).toBe(true);

    // Projekt: wgląd przez przypisanie do dowolnego zadania projektu.
    expect(canViewProjectContent(asAssignee, asAssignee.projects[0])).toBe(true);
    expect(canViewProjectContent(asAdmin, asAdmin.projects[0])).toBe(false);
    expect(isProjectContentMasked(asAdmin, asAdmin.projects[0])).toBe(true);
  });

  it('zadanie dziedziczy maskę z utajnionego projektu (tytuły zadań to treść projektu)', () => {
    // Zadanie BEZ własnej flagi w utajnionym projekcie: masku­je się dla osób
    // bez wglądu w projekt; wgląd w projekt (przypisanie do dowolnego jego
    // zadania) odsłania także tytuły pozostałych zadań projektu.
    const plainTask = task(TASK_ID);
    const siblingTask = task(TASK2_ID, { createdAt: '2026-08-02T10:00:00.000Z' });
    const base = {
      projects: [project(PROJECT_ID, { isConfidential: true })],
      tasks: [plainTask, siblingTask],
      assignments: [assignment(TASK2_ID, WORKER_ID)],
    };
    const asAdmin = makeState({ ...base, currentUserId: ADMIN_ID });
    expect(canViewTaskContent(asAdmin, plainTask)).toBe(false);
    expect(taskDisplayTitle(asAdmin, plainTask)).toBe('Zadanie #1');
    expect(taskDisplayTitle(asAdmin, siblingTask)).toBe('Zadanie #2');

    // Przypisany do zadania-rodzeństwa ma wgląd w projekt => widzi oba tytuły.
    const asMember = makeState({ ...base, currentUserId: WORKER_ID });
    expect(canViewTaskContent(asMember, plainTask)).toBe(true);
    expect(taskDisplayTitle(asMember, plainTask)).toBe('Tajna strategia cenowa');

    const asBoard = makeState({ ...base, currentUserId: CEO_ID });
    expect(canViewTaskContent(asBoard, plainTask)).toBe(true);
  });

  it('zadanie z WŁASNĄ flagą wymaga przypisania do tego zadania, nie do projektu', () => {
    const ownFlag = task(TASK_ID, { isConfidential: true });
    const sibling = task(TASK2_ID, { createdAt: '2026-08-02T10:00:00.000Z' });
    const state = makeState({
      projects: [project(PROJECT_ID)],
      tasks: [ownFlag, sibling],
      assignments: [assignment(TASK2_ID, WORKER_ID)], // przypisany do INNEGO zadania
      currentUserId: WORKER_ID,
    });
    expect(canViewTaskContent(state, ownFlag)).toBe(false);
    expect(canViewTaskContent(state, sibling)).toBe(true);
  });

  it('publiczna encja jest widoczna dla każdego', () => {
    const publicTask = task(TASK_ID);
    const state = makeState({ tasks: [publicTask] });
    expect(canViewTaskContent(state, publicTask)).toBe(true);
    expect(isTaskContentMasked(state, publicTask)).toBe(false);
  });

  it('wydarzenie: jawny uczestnik widzi; puste attendeeIds NIE daje wyjątku', () => {
    const withAttendee = calendarEvent(EVENT_ID, { isConfidential: true, attendeeIds: [WORKER_ID] });
    const companyWide = calendarEvent(EVENT_ID, { isConfidential: true, attendeeIds: [] });

    const state = makeState({ events: [withAttendee] });
    expect(canViewEventContent(state, withAttendee)).toBe(true);

    const stateWide = makeState({ events: [companyWide] });
    expect(canViewEventContent(stateWide, companyWide)).toBe(false);
    expect(isEventContentMasked(stateWide, companyWide)).toBe(true);
    expect(canViewEventContent(makeState({ events: [companyWide], currentUserId: CEO_ID }), companyWide)).toBe(true);
  });
});

describe('numeracja i display-helpery', () => {
  it('numeruje 1-based po (createdAt, id), pomijając encje publiczne', () => {
    const t1 = task(TASK2_ID, { isConfidential: true, createdAt: '2026-08-02T10:00:00.000Z', title: 'Późniejsze' });
    const t2 = task(TASK_ID, { isConfidential: true, createdAt: '2026-08-01T10:00:00.000Z', title: 'Wcześniejsze' });
    const t3 = task('00000000-0000-4000-8000-000000000000', { title: 'Publiczne' });
    const state = makeState({ tasks: [t1, t2, t3], currentUserId: ADMIN_ID });

    expect(taskDisplayTitle(state, t2)).toBe('Zadanie #1');
    expect(taskDisplayTitle(state, t1)).toBe('Zadanie #2');
    expect(taskDisplayTitle(state, t3)).toBe('Publiczne');
    expect(maskedTaskLabel(state, TASK_ID)).toBe('Zadanie #1');
  });

  it('numeracja jest niezależna od widza (zarząd i nie-zarząd widzą ten sam #N)', () => {
    const t = task(TASK_ID, { isConfidential: true });
    const asAdmin = makeState({ tasks: [t], currentUserId: ADMIN_ID });
    expect(taskDisplayTitle(asAdmin, t)).toBe('Zadanie #1');
    expect(maskedTaskLabel(makeState({ tasks: [t], currentUserId: CEO_ID }), TASK_ID)).toBe('Zadanie #1');
  });

  it('renumeruje po zniknięciu wcześniejszej utajnionej encji', () => {
    const t1 = task(TASK_ID, { isConfidential: true, createdAt: '2026-08-01T10:00:00.000Z' });
    const t2 = task(TASK2_ID, { isConfidential: true, createdAt: '2026-08-02T10:00:00.000Z' });
    const before = makeState({ tasks: [t1, t2], currentUserId: ADMIN_ID });
    expect(taskDisplayTitle(before, t2)).toBe('Zadanie #2');
    const after = makeState({ tasks: [t2], currentUserId: ADMIN_ID });
    expect(taskDisplayTitle(after, t2)).toBe('Zadanie #1');
  });

  it('projekt i wydarzenie mają własne rzeczowniki etykiet', () => {
    const p = project(PROJECT_ID, { isConfidential: true });
    const e = calendarEvent(EVENT_ID, { isConfidential: true });
    const state = makeState({ projects: [p], events: [e], currentUserId: ADMIN_ID });
    expect(projectDisplayName(state, p)).toBe('Projekt #1');
    expect(eventDisplayTitle(state, e)).toBe('Wydarzenie #1');
  });

  it('widz z wglądem dostaje zawsze prawdziwy tytuł', () => {
    const t = task(TASK_ID, { isConfidential: true });
    const state = makeState({ tasks: [t], assignments: [assignment(TASK_ID, WORKER_ID)] });
    expect(taskDisplayTitle(state, t)).toBe('Tajna strategia cenowa');
  });

  it('display-helpery są deterministyczne dla tej samej referencji stanu', () => {
    const t = task(TASK_ID, { isConfidential: true });
    const state = makeState({ tasks: [t], currentUserId: ADMIN_ID });
    expect(taskDisplayTitle(state, t)).toBe(taskDisplayTitle(state, t));
  });
});
