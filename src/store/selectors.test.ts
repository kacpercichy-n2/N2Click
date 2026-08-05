// Unit tests for pure selectors (src/store/selectors.ts). Currently focused on
// the bin-exclusion regression in `conflictDatesForTask` (P1 fixed alongside
// PKG-20260708-bin-core: bin entries used to add `''`/BIN_DATE as a "conflict
// date", producing NaN offsets in TimelinePage). Follows the AppData-literal
// fixture style of blockActions.test.ts / storage.test.ts.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_LIMIT,
  availableHoursInRange,
  availableHoursOnDate,
  blockIsDone,
  blocksForPersonDate,
  binHoursForTaskPerson,
  binTaskRowsForPerson,
  buildSearchResultMeta,
  conflictDatesForTask,
  conflictDatesForTaskPerson,
  dayAvailabilityForPerson,
  doneStatusIds,
  getClient,
  getProject,
  getStatus,
  projectsOfClient,
  loadPercent,
  loadTone,
  workloadCellBlocks,
  workloadCellDetail,
  rangeAvailabilityForPerson,
  growAllowanceHours,
  hoursForTaskPersonOnDate,
  isDoneStatus,
  isPersonWorkday,
  occurrenceIsDone,
  overdueTasksForPerson,
  overloadedDatesForPersonInRange,
  peopleWithBirthdayOnDate,
  planningStatusForTotals,
  searchAll,
  taskDisplayStatus,
  taskGrowAllowance,
  taskPlanningStatus,
  todayAgendaForPerson,
  unplannedTasksForPerson,
  weekBlocksForPerson,
  scheduleConflictsForRange,
  eventDraftConflicts,
  blockCollidesWithEvent,
  personVacationOnDate,
  splitOverloadedDaysByVacation,
} from './selectors';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import { BIN_DATE } from '../utils/time';
import type { RecurrenceOccurrence } from '../utils/recurrence';
import type { AppData, Person, Status, Task, TaskAssignment, WorkloadEntry } from '../types';

function makeState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1',
    statusId: 'status1',
    title: 'Task',
    description: '',
    startDate: '2026-07-06',
    endDate: '2026-07-08',
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

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Test',
    lastName: '',
    name: 'Test',
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

function makeAssignment(
  overrides: Partial<TaskAssignment> & { id: string; taskId: string; personId: string },
): TaskAssignment {
  return { ...overrides };
}

function makeStatus(overrides: Partial<Status> & { id: string }): Status {
  return {
    name: 'Status',
    slug: 'status',
    color: '#000000',
    order: 0,
    archived: false,
    isDone: false,
    ...overrides,
  };
}

describe('peopleWithBirthdayOnDate', () => {
  it('zwraca osoby, których urodziny (miesiąc+dzień) wypadają na dniu — niezależnie od roku', () => {
    const state = makeState({
      people: [
        makePerson({ id: 'p1', name: 'Ala', birthDate: '1988-03-14' }),
        makePerson({ id: 'p2', name: 'Bok', birthDate: '1994-07-22' }),
        makePerson({ id: 'p3', name: 'Cezary', birthDate: '' }),
      ],
    });
    expect(peopleWithBirthdayOnDate(state, '2026-03-14').map((p) => p.id)).toEqual(['p1']);
    expect(peopleWithBirthdayOnDate(state, '2031-07-22').map((p) => p.id)).toEqual(['p2']);
    expect(peopleWithBirthdayOnDate(state, '2026-01-01')).toEqual([]);
  });

  it('ignoruje puste/niepoprawne daty i nie zależy od filtra pracy', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', birthDate: 'nonsens' })],
      workload: [],
    });
    expect(peopleWithBirthdayOnDate(state, '2026-03-14')).toEqual([]);
  });
});

describe('blockIsDone (PKG-per-block-done)', () => {
  const ACTIVE = makeStatus({ id: 'active', isDone: false });
  const DONE = makeStatus({ id: 'done', isDone: true });

  it('two blocks on the same day carry INDEPENDENT done state', () => {
    const a = makeEntry({ id: 'a', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480 });
    const b = makeEntry({ id: 'b', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 840 });
    const task = makeTask({ id: 't1', statusId: 'active' });
    const state = makeState({
      statuses: [ACTIVE, DONE],
      tasks: [task],
      people: [makePerson({ id: 'p1' })],
      workload: [{ ...a, done: true }, b],
    });
    // Marking block a done must NOT light block b (same date, different id).
    expect(blockIsDone(state, task, { ...a, done: true })).toBe(true);
    expect(blockIsDone(state, task, b)).toBe(false);
  });

  it('a done task STATUS still lights ALL blocks regardless of the per-block flag', () => {
    const a = makeEntry({ id: 'a', taskId: 't1', personId: 'p1', date: '2026-07-08' });
    const b = makeEntry({ id: 'b', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 840 });
    const task = makeTask({ id: 't1', statusId: 'done' });
    const state = makeState({ statuses: [ACTIVE, DONE], tasks: [task] });
    expect(blockIsDone(state, task, a)).toBe(true);
    expect(blockIsDone(state, task, b)).toBe(true);
  });

  it('undefined/false done on an active task = not done', () => {
    const a = makeEntry({ id: 'a', taskId: 't1', personId: 'p1' });
    const task = makeTask({ id: 't1', statusId: 'active' });
    const state = makeState({ statuses: [ACTIVE, DONE], tasks: [task] });
    expect(blockIsDone(state, task, a)).toBe(false);
    expect(blockIsDone(state, task, { ...a, done: false })).toBe(false);
    expect(blockIsDone(state, task, { ...a, done: true })).toBe(true);
  });
});

describe('occurrenceIsDone (PKG-recurring-occurrence-done)', () => {
  const ACTIVE = makeStatus({ id: 'active', isDone: false });
  const DONE = makeStatus({ id: 'done', isDone: true });
  const occ = (done: boolean): RecurrenceOccurrence => ({
    date: '2026-07-13',
    startMinutes: 540,
    durationMinutes: 60,
    overridden: false,
    done,
  });

  it("the occurrence's OWN flag lights it on an active task", () => {
    const task = makeTask({ id: 't1', statusId: 'active' });
    const state = makeState({ statuses: [ACTIVE, DONE], tasks: [task] });
    expect(occurrenceIsDone(state, task, occ(true))).toBe(true);
    expect(occurrenceIsDone(state, task, occ(false))).toBe(false);
  });

  it('a done task STATUS lights an un-flagged occurrence (whole series)', () => {
    const task = makeTask({ id: 't1', statusId: 'done' });
    const state = makeState({ statuses: [ACTIVE, DONE], tasks: [task] });
    expect(occurrenceIsDone(state, task, occ(false))).toBe(true);
    expect(occurrenceIsDone(state, task, occ(true))).toBe(true);
  });
});

describe('conflictDatesForTask — bin exclusion (regression)', () => {
  it("never returns BIN_DATE/'' even when a person's bin hours alone exceed their capacity", () => {
    const binOver = makeEntry({
      id: 'bin1',
      taskId: 't1',
      personId: 'p1',
      date: BIN_DATE,
      startMinutes: 0,
      plannedHours: 20, // way over an 8h capacity, but it's dateless
      sortIndex: 0,
    });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [binOver],
    });

    const conflicts = conflictDatesForTask(state, 't1');
    expect(conflicts).toEqual([]);
    expect(conflicts).not.toContain(BIN_DATE);
    expect(conflicts).not.toContain('');
  });

  it('still reports a genuine dated conflict when a huge bin total is also present for the same person', () => {
    const binOver = makeEntry({
      id: 'bin1',
      taskId: 't1',
      personId: 'p1',
      date: BIN_DATE,
      startMinutes: 0,
      plannedHours: 20,
      sortIndex: 0,
    });
    const datedOk = makeEntry({
      id: 'e1',
      taskId: 't1',
      personId: 'p1',
      date: '2026-07-06',
      plannedHours: 4, // under capacity -> no conflict
      sortIndex: 0,
    });
    const datedOver = makeEntry({
      id: 'e2',
      taskId: 't1',
      personId: 'p1',
      date: '2026-07-07',
      plannedHours: 10, // over the 8h capacity -> conflict
      sortIndex: 0,
    });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [binOver, datedOk, datedOver],
    });

    const conflicts = conflictDatesForTask(state, 't1');
    expect(conflicts).toEqual(['2026-07-07']);
  });
});

describe('hoursForTaskPersonOnDate — valid multi-block totals', () => {
  it('sums every matching block and excludes other task/person/date rows', () => {
    const date = '2026-07-08';
    const state = makeState({
      workload: [
        makeEntry({ id: 'a', taskId: 't1', personId: 'p1', date, plannedHours: 2 }),
        makeEntry({ id: 'b', taskId: 't1', personId: 'p1', date, plannedHours: 3 }),
        makeEntry({ id: 'other-task', taskId: 't2', personId: 'p1', date, plannedHours: 7 }),
        makeEntry({ id: 'other-person', taskId: 't1', personId: 'p2', date, plannedHours: 7 }),
        makeEntry({ id: 'other-date', taskId: 't1', personId: 'p1', date: '2026-07-09', plannedHours: 7 }),
      ],
    });
    expect(hoursForTaskPersonOnDate(state, 't1', 'p1', date)).toBe(5);
  });

  it('sums two non-adjacent blocks on the same task/person/date (only exactly-adjacent blocks fuse)', () => {
    const date = '2026-07-08';
    const state = makeState({
      workload: [
        makeEntry({ id: 'morning', taskId: 't1', personId: 'p1', date, startMinutes: 480, plannedHours: 2 }),
        makeEntry({ id: 'afternoon', taskId: 't1', personId: 'p1', date, startMinutes: 780, plannedHours: 2 }),
      ],
    });
    expect(hoursForTaskPersonOnDate(state, 't1', 'p1', date)).toBe(4);
  });

  it('returns a single matching entry\'s hours unchanged', () => {
    const date = '2026-07-08';
    const state = makeState({
      workload: [makeEntry({ id: 'only', taskId: 't1', personId: 'p1', date, startMinutes: 480, plannedHours: 2 })],
    });
    expect(hoursForTaskPersonOnDate(state, 't1', 'p1', date)).toBe(2);
  });

  it('returns 0 when there is no entry for that task/person/date', () => {
    const state = makeState({ workload: [] });
    expect(hoursForTaskPersonOnDate(state, 't1', 'p1', '2026-07-08')).toBe(0);
  });
});

describe('searchAll strict date query', () => {
  it('does not use an impossible calendar date for period coverage', () => {
    const state = makeState({
      projects: [{
        id: 'proj1', clientId: '', name: 'Projekt', description: '', statusId: 'status1',
        paid: false, startDate: '2026-02-01', endDate: '2026-03-05', departmentId: '',
        serviceTypeId: '', documents: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      tasks: [makeTask({ id: 't1', startDate: '2026-02-01', endDate: '2026-03-05' })],
    });
    expect(searchAll(state, '2026-02-31').projects).toEqual([]);
    expect(searchAll(state, '2026-02-31').tasks).toEqual([]);
  });
});

describe('searchAll draft exclusion', () => {
  it('never returns draft tasks — a szkic is visible only inside its project', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'pub', title: 'Kampania zimowa' }),
        makeTask({ id: 'draft', title: 'Kampania letnia', isDraft: true }),
      ],
    });
    const found = searchAll(state, 'kampania').tasks.map((t) => t.id);
    expect(found).toEqual(['pub']);
  });
});

describe('searchAll — utajniona treść', () => {
  const confidentialState = (currentUserId: string) =>
    makeState({
      projects: [{
        id: 'proj1', clientId: '', name: 'Przejęcie spółki', description: 'negocjacje', statusId: 'status1',
        paid: false, startDate: '2026-07-01', endDate: '2026-07-31', departmentId: '',
        serviceTypeId: '', documents: [], isConfidential: true,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      tasks: [makeTask({ id: 't1', title: 'Tajna strategia cenowa', description: 'poufny opis', isConfidential: true })],
      people: [
        makePerson({ id: 'ceo', role: 'CEO – Chief Executive Officer' }),
        makePerson({ id: 'worker', role: 'Projektant' }),
        makePerson({ id: 'assignee', role: 'Grafik' }),
      ],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'assignee' })],
      currentUserId,
    });

  it('nie-widz nie znajdzie utajnionej encji po prawdziwym tytule/opisie', () => {
    const state = confidentialState('worker');
    expect(searchAll(state, 'tajna').tasks).toEqual([]);
    expect(searchAll(state, 'poufny').tasks).toEqual([]);
    expect(searchAll(state, 'przejęcie').projects).toEqual([]);
    expect(searchAll(state, 'negocjacje').projects).toEqual([]);
  });

  it('nie-widz znajdzie utajnioną encję po etykiecie maskującej', () => {
    const state = confidentialState('worker');
    expect(searchAll(state, 'zadanie #1').tasks.map((t) => t.id)).toEqual(['t1']);
    expect(searchAll(state, 'projekt #1').projects.map((p) => p.id)).toEqual(['proj1']);
  });

  it('zarząd i przypisany wykonawca szukają po prawdziwej treści', () => {
    expect(searchAll(confidentialState('ceo'), 'tajna').tasks.map((t) => t.id)).toEqual(['t1']);
    expect(searchAll(confidentialState('assignee'), 'tajna').tasks.map((t) => t.id)).toEqual(['t1']);
    // Przypisany do zadania widzi też projekt tego zadania.
    expect(searchAll(confidentialState('assignee'), 'przejęcie').projects.map((p) => p.id)).toEqual(['proj1']);
  });

  it('status i data (jawne fakty planistyczne) nadal matchują utajnione encje', () => {
    const base = confidentialState('worker');
    const state = makeState({
      ...base,
      statuses: [...base.statuses, { id: 'status1', name: 'W toku', slug: 'w-toku', color: '#fff', order: 9, archived: false, isDone: false }],
    });
    expect(searchAll(state, 'w toku').tasks.map((t) => t.id)).toContain('t1');
    expect(searchAll(state, '2026-07-07').tasks.map((t) => t.id)).toContain('t1');
  });
});

describe('workloadCellBlocks — utajniona treść', () => {
  it('maskuje taskTitle i projectName dla nie-widza, pełna treść dla zarządu', () => {
    const base = makeState({
      projects: [{
        id: 'proj1', clientId: '', name: 'Przejęcie spółki', description: '', statusId: 'status1',
        paid: false, startDate: '2026-07-01', endDate: '2026-07-31', departmentId: '',
        serviceTypeId: '', documents: [], isConfidential: true,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      tasks: [makeTask({ id: 't1', title: 'Tajna strategia', isConfidential: true })],
      people: [
        makePerson({ id: 'ceo', role: 'CEO' }),
        makePerson({ id: 'worker' }),
        makePerson({ id: 'p1' }),
      ],
      workload: [makeEntry({ id: 'w1', taskId: 't1', personId: 'p1', date: '2026-07-07' })],
    });
    const asWorker = { ...base, currentUserId: 'worker' };
    const workerBlocks = workloadCellBlocks(asWorker, 'p1', '2026-07-07');
    expect(workerBlocks[0].taskTitle).toBe('Zadanie #1');
    expect(workerBlocks[0].projectName).toBe('Projekt #1');

    const asBoard = { ...base, currentUserId: 'ceo' };
    const boardBlocks = workloadCellBlocks(asBoard, 'p1', '2026-07-07');
    expect(boardBlocks[0].taskTitle).toBe('Tajna strategia');
    expect(boardBlocks[0].projectName).toBe('Przejęcie spółki');
  });
});

describe('searchAll — limit per grupa i hasMore', () => {
  const manyTasks = Array.from({ length: 12 }, (_, i) =>
    makeTask({ id: `t${i}`, title: `Zadanie ${i}` }),
  );
  const state = makeState({
    tasks: manyTasks,
    people: [
      makePerson({ id: 'p1', name: 'Ala Szukana' }),
      makePerson({ id: 'p2', name: 'Bo Szukany' }),
    ],
  });

  it('domyślny limit tnie grupę do DEFAULT_SEARCH_LIMIT i ustawia hasMore', () => {
    const res = searchAll(state, 'zadanie');
    expect(res.tasks).toHaveLength(DEFAULT_SEARCH_LIMIT);
    expect(res.tasks.map((t) => t.id)).toEqual(
      manyTasks.slice(0, DEFAULT_SEARCH_LIMIT).map((t) => t.id),
    );
    expect(res.hasMore.tasks).toBe(true);
    // Grupy, które się zmieściły, nie kłamią o obcięciu.
    expect(res.hasMore.projects).toBe(false);
    expect(res.hasMore.clients).toBe(false);
    expect(res.hasMore.people).toBe(false);
  });

  it('jawny limit liczbowy obowiązuje wszystkie grupy', () => {
    const res = searchAll(state, 'sz', 1);
    expect(res.people).toHaveLength(1);
    expect(res.hasMore.people).toBe(true);
  });

  it('limit per grupa podnosi tylko wskazaną grupę', () => {
    const res = searchAll(state, 'zadanie', { tasks: 40 });
    expect(res.tasks).toHaveLength(12);
    expect(res.hasMore.tasks).toBe(false);
  });

  it('wynik z limitem jest identyczny z pełnym wynikiem uciętym do limitu', () => {
    const full = searchAll(state, 'zadanie', Number.POSITIVE_INFINITY);
    expect(full.tasks).toHaveLength(12);
    expect(full.hasMore.tasks).toBe(false);
    expect(searchAll(state, 'zadanie', 5).tasks.map((t) => t.id)).toEqual(
      full.tasks.slice(0, 5).map((t) => t.id),
    );
  });

  it('limit 0 chowa wiersze, ale hasMore nadal mówi prawdę; limit ujemny działa tak samo', () => {
    for (const limit of [0, -3]) {
      const res = searchAll(state, 'zadanie', limit);
      expect(res.tasks).toEqual([]);
      expect(res.hasMore.tasks).toBe(true);
      expect(res.hasMore.clients).toBe(false);
    }
  });

  it('limit NaN spada na wartość domyślną (zły wsad nie zmienia zachowania)', () => {
    const res = searchAll(state, 'zadanie', Number.NaN);
    expect(res.tasks).toHaveLength(DEFAULT_SEARCH_LIMIT);
    expect(res.hasMore.tasks).toBe(true);
  });

  it('pusta fraza zwraca puste grupy bez obcięcia', () => {
    const res = searchAll(state, '   ');
    expect(res.tasks).toEqual([]);
    expect(res.hasMore).toEqual({
      projects: false,
      tasks: false,
      clients: false,
      people: false,
    });
  });
});

describe('buildSearchResultMeta — parity with per-result selector calls', () => {
  function makeProject(id: string, clientId: string, statusId: string) {
    return {
      id, clientId, name: `Projekt ${id}`, description: '', statusId,
      paid: false, startDate: '2026-02-01', endDate: '2026-03-05', departmentId: '',
      serviceTypeId: '', documents: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  function makeClient(id: string, name: string) {
    return { id, name, archived: false, notes: '' };
  }

  const state = makeState({
    clients: [makeClient('cA', 'Klient A'), makeClient('cB', 'Klient B'), makeClient('cEmpty', 'Bez projektów')],
    projects: [
      makeProject('pA1', 'cA', 'status1'),
      makeProject('pA2', 'cA', 'status2'),
      makeProject('pB1', 'cB', 'status1'),
    ],
    statuses: [
      makeStatus({ id: 'status1', name: 'W toku' }),
      makeStatus({ id: 'status2', name: 'Zrobione', isDone: true }),
    ],
    tasks: [makeTask({ id: 't1', projectId: 'pA1', statusId: 'status1' })],
  });

  it('lookup maps mirror getClient/getProject/getStatus (incl. missing => undefined)', () => {
    const meta = buildSearchResultMeta(state);
    for (const id of ['cA', 'cB', 'cEmpty', 'nope']) {
      expect(meta.clientsById.get(id)).toBe(getClient(state, id));
    }
    for (const id of ['pA1', 'pA2', 'pB1', 'nope']) {
      expect(meta.projectsById.get(id)).toBe(getProject(state, id));
    }
    for (const id of ['status1', 'status2', 'nope']) {
      expect(meta.statusesById.get(id)).toBe(getStatus(state, id));
    }
  });

  it('clientProjectCounts mirrors projectsOfClient(...).length (absent client => 0)', () => {
    const meta = buildSearchResultMeta(state);
    for (const id of ['cA', 'cB', 'cEmpty', 'nope']) {
      expect(meta.clientProjectCounts.get(id) ?? 0).toBe(projectsOfClient(state, id).length);
    }
  });

  it('drives byte-identical row metadata across live searchAll results', () => {
    const meta = buildSearchResultMeta(state);
    const results = searchAll(state, 'projekt');
    for (const p of results.projects) {
      expect(meta.clientsById.get(p.clientId)).toBe(getClient(state, p.clientId));
      expect(meta.statusesById.get(p.statusId)).toBe(getStatus(state, p.statusId));
    }
    for (const t of results.tasks) {
      expect(meta.projectsById.get(t.projectId)).toBe(getProject(state, t.projectId));
      expect(meta.statusesById.get(t.statusId)).toBe(getStatus(state, t.statusId));
    }
    for (const c of results.clients) {
      expect(meta.clientProjectCounts.get(c.id) ?? 0).toBe(projectsOfClient(state, c.id).length);
    }
  });
});

// ---------------------------------------------------------------------------
// growAllowanceHours (PKG-20260708-budget-store)
// ---------------------------------------------------------------------------

describe('growAllowanceHours', () => {
  it('returns the person\'s same-task bin hours (a number, never null) when the task has no estimate', () => {
    // New contract (PKG-20260708-b2): null-estimate tasks are no longer
    // unlimited. Allowance = bin hours + 0 headroom. With no bin row here ⇒ 0.
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', plannedHours: 2 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1],
    });

    expect(growAllowanceHours(state, 'e1')).toBe(0);
  });

  it('returns the person\'s same-task bin hours for a null-estimate task with a bin row', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 2 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, bin],
    });

    expect(growAllowanceHours(state, 'e1')).toBe(3); // bin only, no headroom
  });

  it('sums the same-task bin hours and the remaining headroom', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 2 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 })],
      workload: [e1, bin],
    });

    // totalAll = 2 (dated) + 3 (bin) = 5h; headroom = 10 - 5 = 5h; binSame = 3h.
    expect(growAllowanceHours(state, 'e1')).toBe(8);
  });

  it('floors headroom at 0 for an over-budget legacy task (entries already exceed the estimate)', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 8 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 5 })], // legacy over-budget: 8h already logged against a 5h estimate
      workload: [e1],
    });

    // No same-task bin row -> allowance is pure headroom, floored at 0 (not negative).
    expect(growAllowanceHours(state, 'e1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Workday-aware availability (PKG-20260708-auth-data)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// taskGrowAllowance / growAllowanceHours number contract — coverage added by
// PKG-20260708-b2-tests (implementation shipped by PKG-20260708-b2-budget-store).
// The four growAllowanceHours cases just above already cover the summed-value
// contract via the entry-keyed wrapper; these focus on taskGrowAllowance
// directly plus the two gaps in the growAllowanceHours contract (typeof check,
// missing entry id).
// ---------------------------------------------------------------------------

describe('taskGrowAllowance (PKG-20260708-b2-tests)', () => {
  it('null estimate: allowance is the same-task bin hours only (no headroom)', () => {
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [bin],
    });
    expect(taskGrowAllowance(state, 't1', 'p1')).toBe(4);
  });

  it('estimate set: allowance sums the same-task bin hours and the remaining headroom', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 2 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 })],
      workload: [e1, bin],
    });
    // totalAll = 5h; headroom = 10 - 5 = 5h; bin = 3h -> allowance 8h.
    expect(taskGrowAllowance(state, 't1', 'p1')).toBe(8);
  });

  it('over-planned task: headroom floors at 0, but the bin still counts', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 8 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 5 })], // 10h already logged against a 5h estimate
      workload: [e1, bin],
    });
    expect(taskGrowAllowance(state, 't1', 'p1')).toBe(2); // headroom 0, bin 2h
  });

  it('no entries at all (null estimate, no bin, no dated hours): allowance is 0', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [],
    });
    expect(taskGrowAllowance(state, 't1', 'p1')).toBe(0);
  });
});

describe('growAllowanceHours — number contract (PKG-20260708-b2-tests)', () => {
  it('returns a NUMBER (never null) for a null-estimate task entry, equal to the bin hours', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 2 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, bin],
    });
    const allowance = growAllowanceHours(state, 'e1');
    expect(typeof allowance).toBe('number');
    expect(allowance).toBe(3);
  });

  it('returns 0 for a missing entry id', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [] });
    expect(growAllowanceHours(state, 'does-not-exist')).toBe(0);
  });
});

describe('availability selectors', () => {
  it('a person working Mon-Thu has 0 available hours on a Friday and their full capacity on a Wednesday', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', capacity: 6, workDays: [1, 2, 3, 4] })],
    });

    expect(isPersonWorkday(state, 'p1', '2026-07-10')).toBe(false); // Friday
    expect(availableHoursOnDate(state, 'p1', '2026-07-10')).toBe(0);

    expect(isPersonWorkday(state, 'p1', '2026-07-08')).toBe(true); // Wednesday
    expect(availableHoursOnDate(state, 'p1', '2026-07-08')).toBe(6);
  });

  it('availableHoursInRange sums a Mon-Sun week correctly for a Mon-Thu worker', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', capacity: 6, workDays: [1, 2, 3, 4] })],
    });
    const week = [
      '2026-07-06', // Mon
      '2026-07-07', // Tue
      '2026-07-08', // Wed
      '2026-07-09', // Thu
      '2026-07-10', // Fri
      '2026-07-11', // Sat
      '2026-07-12', // Sun
    ];

    expect(availableHoursInRange(state, 'p1', week)).toBe(24); // 4 workdays * 6h
  });
});

// ---------------------------------------------------------------------------
// dayAvailabilityForPerson / rangeAvailabilityForPerson / loadPercent —
// the authoritative availability record (020-availability-risk). A booked day
// with zero availability is DANGEROUS (overbooked), never a safe 0% state.
// ---------------------------------------------------------------------------

describe('dayAvailabilityForPerson', () => {
  const MON = '2026-07-06';
  const SAT = '2026-07-11';

  it('normal workday: available = capacity, booked within it -> not overbooked', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 4 })],
    });

    expect(dayAvailabilityForPerson(state, 'p1', MON)).toEqual({
      date: MON,
      isWorkday: true,
      availableHours: 8,
      bookedHours: 4,
      overbooked: false,
    });
  });

  it('workday boundary: booked === available is NOT overbooked; one 0.25h more is', () => {
    const exact = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 8 })],
    });
    expect(dayAvailabilityForPerson(exact, 'p1', MON).overbooked).toBe(false);

    const over = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 8.25 })],
    });
    expect(dayAvailabilityForPerson(over, 'p1', MON).overbooked).toBe(true);
  });

  it('4h booked on a non-workday (0h available) is overbooked — dangerous, never a safe 0%', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })], // Mon–Fri worker
      workload: [makeEntry({ id: 'e1', personId: 'p1', date: SAT, plannedHours: 4 })],
    });

    expect(dayAvailabilityForPerson(state, 'p1', SAT)).toEqual({
      date: SAT,
      isWorkday: false,
      availableHours: 0,
      bookedHours: 4,
      overbooked: true,
    });
  });

  it('a free non-workday (0h available, 0h booked) is NOT overbooked', () => {
    const state = makeState({ people: [makePerson({ id: 'p1' })], workload: [] });
    const day = dayAvailabilityForPerson(state, 'p1', SAT);
    expect(day.availableHours).toBe(0);
    expect(day.overbooked).toBe(false);
  });

  it('a person with NO workdays at all is overbooked by any booking, on any day', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', workDays: [] })],
      workload: [makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 1 })],
    });
    const day = dayAvailabilityForPerson(state, 'p1', MON);
    expect(day.availableHours).toBe(0);
    expect(day.overbooked).toBe(true);
  });

  it('bin rows never count as booked hours on a real date', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' })],
      workload: [
        makeEntry({ id: 'bin1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 20, sortIndex: 0 }),
      ],
    });
    expect(dayAvailabilityForPerson(state, 'p1', MON).bookedHours).toBe(0);
  });
});

describe('rangeAvailabilityForPerson', () => {
  const WEEK = [
    '2026-07-06', // Mon
    '2026-07-07', // Tue
    '2026-07-08', // Wed
    '2026-07-09', // Thu
    '2026-07-10', // Fri
    '2026-07-11', // Sat
    '2026-07-12', // Sun
  ];

  it('sums availability and booked hours over the range and collects overbooked dates', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 6, workDays: [1, 2, 3, 4] })],
      workload: [
        makeEntry({ id: 'e1', personId: 'p1', date: '2026-07-06', plannedHours: 4 }), // Mon, fine
        makeEntry({ id: 'e2', personId: 'p1', date: '2026-07-07', plannedHours: 7 }), // Tue, 7 > 6
        makeEntry({ id: 'e3', personId: 'p1', date: '2026-07-11', plannedHours: 4 }), // Sat, 0h available
      ],
    });

    expect(rangeAvailabilityForPerson(state, 'p1', WEEK)).toEqual({
      availableHours: 24, // 4 workdays × 6h
      bookedHours: 15,
      overbookedDates: ['2026-07-07', '2026-07-11'],
    });
  });

  it('agrees with availableHoursOnDate/availableHoursInRange on the availability sum', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', capacity: 6, workDays: [1, 2, 3, 4] })],
    });
    expect(rangeAvailabilityForPerson(state, 'p1', WEEK).availableHours).toBe(
      availableHoursInRange(state, 'p1', WEEK),
    );
  });
});

describe('loadPercent', () => {
  it('normal percentage against positive availability', () => {
    expect(loadPercent(4, 8)).toBe(50);
    expect(loadPercent(9, 8)).toBe(113);
  });

  it('0 booked / 0 available is a genuine, safe 0', () => {
    expect(loadPercent(0, 0)).toBe(0);
  });

  it('hours booked against ZERO availability return null (danger), never 0%', () => {
    expect(loadPercent(4, 0)).toBeNull();
    expect(loadPercent(0.25, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Availability-aware + person-scoped conflict markers (020-availability-risk).
// ---------------------------------------------------------------------------

describe('conflict markers — availability-aware and person-scoped', () => {
  const MON = '2026-07-06';
  const SAT = '2026-07-11';

  it('conflictDatesForTask flags a booking on a 0h-availability day (non-workday)', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', endDate: '2026-07-12' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [
        makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 4 }), // fine
        makeEntry({ id: 'e2', personId: 'p1', date: SAT, plannedHours: 4 }), // 4h vs 0h
      ],
    });

    expect(conflictDatesForTask(state, 't1')).toEqual([SAT]);
  });

  it("Ola's overload is NOT shown on Marek's people-mode row (person-scoped conflicts)", () => {
    // Both work on t1 the same Monday. Ola is overbooked (her total 10h > 8h,
    // via a second task); Marek's 4h day is fine.
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      people: [
        makePerson({ id: 'ola', name: 'Ola', capacity: 8 }),
        makePerson({ id: 'marek', name: 'Marek', capacity: 8 }),
      ],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'ola', date: MON, plannedHours: 6 }),
        makeEntry({ id: 'e2', taskId: 't2', personId: 'ola', date: MON, plannedHours: 4 }), // Ola: 10h > 8h
        makeEntry({ id: 'e3', taskId: 't1', personId: 'marek', date: MON, plannedHours: 4 }),
      ],
    });

    // The any-assignee view still reports the day…
    expect(conflictDatesForTask(state, 't1')).toEqual([MON]);
    // …but only Ola's row carries the marker.
    expect(conflictDatesForTaskPerson(state, 't1', 'ola')).toEqual([MON]);
    expect(conflictDatesForTaskPerson(state, 't1', 'marek')).toEqual([]);
  });

  it('conflictDatesForTaskPerson only reports days where the person works on THIS task', () => {
    // p1 is overbooked on Tuesday, but only via t2 — t1 has no Tuesday entry
    // for them, so t1's row stays clean.
    const TUE = '2026-07-07';
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: MON, plannedHours: 4 }),
        makeEntry({ id: 'e2', taskId: 't2', personId: 'p1', date: TUE, plannedHours: 10 }),
      ],
    });

    expect(conflictDatesForTaskPerson(state, 't1', 'p1')).toEqual([]);
    expect(conflictDatesForTaskPerson(state, 't2', 'p1')).toEqual([TUE]);
  });

  it('conflictDatesForTaskPerson ignores bin rows and stays sorted', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', endDate: '2026-07-12' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [
        makeEntry({ id: 'bin1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 30, sortIndex: 0 }),
        makeEntry({ id: 'e1', personId: 'p1', date: SAT, plannedHours: 2 }), // 0h available
        makeEntry({ id: 'e2', personId: 'p1', date: MON, plannedHours: 9 }), // 9h > 8h
      ],
    });

    expect(conflictDatesForTaskPerson(state, 't1', 'p1')).toEqual([MON, SAT]);
  });

  it('overloadedDatesForPersonInRange flags a booked non-workday alongside a genuine workday overload', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [
        makeEntry({ id: 'e1', personId: 'p1', date: MON, plannedHours: 8 }), // exactly full — fine
        makeEntry({ id: 'e2', personId: 'p1', date: SAT, plannedHours: 4 }), // booked day off
      ],
    });

    expect(overloadedDatesForPersonInRange(state, 'p1', [MON, SAT])).toEqual([SAT]);
  });
});

// ---------------------------------------------------------------------------
// todayAgendaForPerson / weekBlocksForPerson (PKG-20260709-dashboard-selector-tests)
// Implementation shipped by PKG-20260709-dashboard-welcome.
// ---------------------------------------------------------------------------

describe('todayAgendaForPerson', () => {
  const DATE = '2026-07-08'; // Wednesday

  it('timed: returns this person\'s entries on the date, sorted by startMinutes, excluding other people/dates', () => {
    const late = makeEntry({ id: 'e-late', taskId: 't1', personId: 'p1', date: DATE, startMinutes: 600 });
    const early = makeEntry({ id: 'e-early', taskId: 't1', personId: 'p1', date: DATE, startMinutes: 480 });
    const otherPerson = makeEntry({ id: 'e-other-person', taskId: 't1', personId: 'p2', date: DATE, startMinutes: 500 });
    const otherDate = makeEntry({ id: 'e-other-date', taskId: 't1', personId: 'p1', date: '2026-07-09', startMinutes: 490 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      workload: [late, early, otherPerson, otherDate],
    });

    const { timed } = todayAgendaForPerson(state, 'p1', DATE);
    expect(timed.map((w) => w.id)).toEqual(['e-early', 'e-late']);
  });

  it('timed: a bin entry (date === BIN_DATE) for the same person never shows up when querying a real date', () => {
    const dated = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: DATE, startMinutes: 480 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' })],
      workload: [dated, bin],
    });

    const { timed } = todayAgendaForPerson(state, 'p1', DATE);
    expect(timed.map((w) => w.id)).toEqual(['e1']);
    expect(timed.some((w) => w.date === BIN_DATE)).toBe(false);
  });

  it('dateless: an assigned task with deadline on the date and NO entry that day appears; the same task WITH an entry that day does not', () => {
    const withoutEntry = makeTask({
      id: 't-no-entry',
      title: 'No entry today',
      startDate: '2026-07-06',
      endDate: DATE,
    });
    const withEntry = makeTask({
      id: 't-with-entry',
      title: 'Has entry today',
      startDate: '2026-07-06',
      endDate: DATE,
    });
    const entryToday = makeEntry({ id: 'e1', taskId: 't-with-entry', personId: 'p1', date: DATE });
    const state = makeState({
      tasks: [withoutEntry, withEntry],
      people: [makePerson({ id: 'p1' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-no-entry', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-with-entry', personId: 'p1' }),
      ],
      workload: [entryToday],
    });

    const { dateless, timed } = todayAgendaForPerson(state, 'p1', DATE);
    expect(dateless.map((t) => t.id)).toEqual(['t-no-entry']);
    expect(timed.map((w) => w.taskId)).toEqual(['t-with-entry']);
  });

  it('dateless excludes: task period before/after the date, task assigned to someone else, and a done-status task', () => {
    const base = emptyData();
    const doneId = base.statuses[base.statuses.length - 1].id; // 'Gotowe' — the isDone status in seed data
    const activeStatusId = base.statuses[0].id;

    const before = makeTask({
      id: 't-before',
      statusId: activeStatusId,
      startDate: '2026-07-01',
      endDate: '2026-07-05', // ends before DATE
    });
    const after = makeTask({
      id: 't-after',
      statusId: activeStatusId,
      startDate: '2026-07-10',
      endDate: '2026-07-12', // starts after DATE
    });
    const someoneElse = makeTask({
      id: 't-someone-else',
      statusId: activeStatusId,
      startDate: '2026-07-06',
      endDate: DATE, // deadline dziś, ale przypisane do p2
    });
    const done = makeTask({
      id: 't-done',
      statusId: doneId,
      startDate: '2026-07-06',
      endDate: DATE, // deadline dziś, ale status done
    });

    const state = makeState({
      ...base,
      tasks: [before, after, someoneElse, done],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-before', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-after', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-someone-else', personId: 'p2' }),
        makeAssignment({ id: 'a4', taskId: 't-done', personId: 'p1' }),
      ],
      workload: [],
    });

    const { dateless } = todayAgendaForPerson(state, 'p1', DATE);
    expect(dateless).toEqual([]);
  });

  it('dateless ordering: alphabetical by title (every shown task has endDate === date)', () => {
    const zebra = makeTask({ id: 't-zebra', title: 'Zebra', startDate: '2026-07-01', endDate: DATE });
    const banana = makeTask({ id: 't-banana', title: 'Banana', startDate: '2026-07-01', endDate: DATE });
    const apple = makeTask({ id: 't-apple', title: 'Apple', startDate: '2026-07-01', endDate: DATE });
    const state = makeState({
      tasks: [zebra, banana, apple],
      people: [makePerson({ id: 'p1' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-zebra', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-banana', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-apple', personId: 'p1' }),
      ],
      workload: [],
    });

    const { dateless } = todayAgendaForPerson(state, 'p1', DATE);
    expect(dateless.map((t) => t.id)).toEqual(['t-apple', 't-banana', 't-zebra']);
  });

  it('dateless: a multi-day task without calendar blocks appears ONLY on its deadline day, never on covered/adjacent days (241-today-agenda)', () => {
    const multiDay = makeTask({
      id: 't-multi',
      title: 'Wielodniowe bez bloków',
      startDate: '2026-07-06',
      endDate: '2026-07-10',
    });
    const state = makeState({
      tasks: [multiDay],
      people: [makePerson({ id: 'p1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't-multi', personId: 'p1' })],
      workload: [],
    });

    // Covered interior days (including "yesterday"/"tomorrow" around DATE) — empty.
    for (const day of ['2026-07-06', '2026-07-07', DATE, '2026-07-09']) {
      expect(todayAgendaForPerson(state, 'p1', day).dateless).toEqual([]);
    }
    // The deadline day itself — shown.
    expect(todayAgendaForPerson(state, 'p1', '2026-07-10').dateless.map((t) => t.id)).toEqual(['t-multi']);
    // Right after the deadline — gone again.
    expect(todayAgendaForPerson(state, 'p1', '2026-07-11').dateless).toEqual([]);
  });

  it('mon–fri task planned only on Thursday does NOT show on Wednesday, only on Thursday (264)', () => {
    // Zgłoszenie: zadanie z okresem pon–pt widoczne w środę, mimo że w kalendarzu
    // zaplanowane na czwartek. Agenda „na dziś” filtruje po wpisach workload
    // (w.date === date), nie po okresie zadania — więc środa jest pusta.
    const monFri = makeTask({
      id: 't-monfri',
      title: 'Pon–pt, blok tylko w czwartek',
      startDate: '2026-07-06', // poniedziałek
      endDate: '2026-07-10', // piątek
    });
    const thursdayEntry = makeEntry({
      id: 'e-thu',
      taskId: 't-monfri',
      personId: 'p1',
      date: '2026-07-09', // czwartek
      startMinutes: 540,
    });
    const state = makeState({
      tasks: [monFri],
      people: [makePerson({ id: 'p1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't-monfri', personId: 'p1' })],
      workload: [thursdayEntry],
    });

    // Środa (DATE) — nic: brak wpisu tego dnia, a deadline (piątek) też nie jest dziś.
    const wed = todayAgendaForPerson(state, 'p1', DATE);
    expect(wed.timed).toEqual([]);
    expect(wed.dateless).toEqual([]);

    // Czwartek — pokazuje się jako wpis czasowy.
    const thu = todayAgendaForPerson(state, 'p1', '2026-07-09');
    expect(thu.timed.map((w) => w.id)).toEqual(['e-thu']);
  });

  it('empty results: a person with no assignments and no entries gets both arrays empty', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' })],
      workload: [],
      assignments: [],
    });

    const { timed, dateless } = todayAgendaForPerson(state, 'p1', DATE);
    expect(timed).toEqual([]);
    expect(dateless).toEqual([]);
  });
});

describe('weekBlocksForPerson', () => {
  const WEEK = [
    '2026-07-06', // Mon
    '2026-07-07', // Tue
    '2026-07-08', // Wed
    '2026-07-09', // Thu
    '2026-07-10', // Fri
    '2026-07-11', // Sat
    '2026-07-12', // Sun
  ];

  it('returns one key per requested date, each sorted by startMinutes, and an empty array (not a missing key) for days with no entries', () => {
    const monLate = makeEntry({ id: 'mon-late', taskId: 't1', personId: 'p1', date: '2026-07-06', startMinutes: 600 });
    const monEarly = makeEntry({ id: 'mon-early', taskId: 't1', personId: 'p1', date: '2026-07-06', startMinutes: 480 });
    const wed = makeEntry({ id: 'wed1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 540 });
    const fri = makeEntry({ id: 'fri1', taskId: 't1', personId: 'p1', date: '2026-07-10', startMinutes: 500 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' })],
      workload: [monLate, monEarly, wed, fri],
    });

    const map = weekBlocksForPerson(state, 'p1', WEEK);

    expect(Array.from(map.keys())).toEqual(WEEK);
    expect(map.get('2026-07-06')?.map((w) => w.id)).toEqual(['mon-early', 'mon-late']);
    expect(map.get('2026-07-08')?.map((w) => w.id)).toEqual(['wed1']);
    expect(map.get('2026-07-10')?.map((w) => w.id)).toEqual(['fri1']);
    // Days with no blocks -> present as an explicit empty array per the JSDoc contract.
    expect(map.has('2026-07-07')).toBe(true);
    expect(map.get('2026-07-07')).toEqual([]);
    expect(map.get('2026-07-09')).toEqual([]);
    expect(map.get('2026-07-11')).toEqual([]);
    expect(map.get('2026-07-12')).toEqual([]);
  });

  it('excludes other people\'s entries and bin entries', () => {
    const mine = makeEntry({ id: 'mine', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480 });
    const theirs = makeEntry({ id: 'theirs', taskId: 't1', personId: 'p2', date: '2026-07-08', startMinutes: 480 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      workload: [mine, theirs, bin],
    });

    const map = weekBlocksForPerson(state, 'p1', WEEK);

    expect(map.get('2026-07-08')?.map((w) => w.id)).toEqual(['mine']);
    for (const d of WEEK) {
      expect(map.get(d)?.some((w) => w.personId === 'p2')).toBe(false);
      expect(map.get(d)?.some((w) => w.date === BIN_DATE)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// doneStatusIds / overdueTasksForPerson / overloadedDatesForPersonInRange /
// unplannedTasksForPerson / binTaskRowsForPerson (PKG-20260709c-my-work-page)
// Coverage added by PKG-20260709c-my-work-selector-tests.
// ---------------------------------------------------------------------------

describe('doneStatusIds', () => {
  it('returns the ids of the isDone-flagged statuses', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: true });
    const state = makeState({ statuses: [s1, s0] }); // deliberately out of array order
    expect(doneStatusIds(state)).toEqual(new Set(['s1']));
  });

  it('includes an archived done status', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const s1 = makeStatus({ id: 's1', order: 1 });
    const s2 = makeStatus({ id: 's2', order: 2, archived: true, isDone: true });
    const state = makeState({ statuses: [s0, s1, s2] });
    expect(doneStatusIds(state)).toEqual(new Set(['s2']));
  });

  it('returns an empty set when there are no statuses', () => {
    const state = makeState({ statuses: [] });
    expect(doneStatusIds(state)).toEqual(new Set());
  });

  it('doneStatusIds returns ALL isDone statuses (archived included) and isDoneStatus agrees for both done and non-done ids', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: false });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: true });
    const s2 = makeStatus({ id: 's2', order: 2, isDone: true, archived: true });
    const state = makeState({ statuses: [s0, s1, s2] });

    expect(doneStatusIds(state)).toEqual(new Set(['s1', 's2']));
    expect(isDoneStatus(state, 's1')).toBe(true);
    expect(isDoneStatus(state, 's2')).toBe(true);
    expect(isDoneStatus(state, 's0')).toBe(false);
    expect(isDoneStatus(state, 'does-not-exist')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// taskDisplayStatus — status zadania widoczny na blokach kalendarza i kartach
// zasobnika (229-task-status-on-calendar-blocks).
// ---------------------------------------------------------------------------

describe('taskDisplayStatus', () => {
  const sOpen = makeStatus({ id: 's-open', order: 0, isDone: false });
  const sDone = makeStatus({ id: 's-done', order: 1, isDone: true });
  const sDoneArchived = makeStatus({ id: 's-done-arch', order: 2, isDone: true, archived: true });
  const statuses = [sOpen, sDone, sDoneArchived];

  it('zwraca "done" dla zadania w statusie isDone, także gdy termin już minął', () => {
    const task = makeTask({ id: 't1', statusId: 's-done', endDate: '2026-07-01' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('done');
  });

  it('archiwalny status isDone nadal daje "done" (kompletność to wyłącznie flaga)', () => {
    const task = makeTask({ id: 't1', statusId: 's-done-arch', endDate: '2026-07-01' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('done');
  });

  it('zwraca "overdue" dla nie-zrobionego zadania z endDate ściśle przed dziś', () => {
    const task = makeTask({ id: 't1', statusId: 's-open', endDate: '2026-07-19' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('overdue');
  });

  it('endDate == dziś to jeszcze nie po terminie', () => {
    const task = makeTask({ id: 't1', statusId: 's-open', endDate: '2026-07-20' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('open');
  });

  it('przyszły termin i status w toku dają "open"', () => {
    const task = makeTask({ id: 't1', statusId: 's-open', endDate: '2026-07-30' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('open');
  });

  it('nieznany statusId nie liczy się jako zrobiony — przeterminowane zadanie zostaje "overdue"', () => {
    const task = makeTask({ id: 't1', statusId: 'brak', endDate: '2026-07-01' });
    const state = makeState({ statuses, tasks: [task] });
    expect(taskDisplayStatus(state, task, '2026-07-20')).toBe('overdue');
  });

  it('kolejność statusów w pipeline nie zmienia wyniku (niezmiennik 5)', () => {
    const doneFirst = makeStatus({ id: 's-done', order: 0, isDone: true });
    const openLast = makeStatus({ id: 's-open', order: 9, isDone: false });
    const done = makeTask({ id: 't1', statusId: 's-done', endDate: '2026-07-01' });
    const open = makeTask({ id: 't2', statusId: 's-open', endDate: '2026-07-01' });
    const state = makeState({ statuses: [doneFirst, openLast], tasks: [done, open] });
    expect(taskDisplayStatus(state, done, '2026-07-20')).toBe('done');
    expect(taskDisplayStatus(state, open, '2026-07-20')).toBe('overdue');
  });
});

// ---------------------------------------------------------------------------
// doneStatusIds / my-work selectors — reordering and archived-done coverage
// (PKG-20260712c-status-tests).
// ---------------------------------------------------------------------------

describe('doneStatusIds — reordering never changes doneness (PKG-20260712c-status-tests)', () => {
  it('REORDER_STATUS moving the done status to the FIRST pipeline position leaves doneStatusIds unchanged, and a task in that status stays excluded from overdueTasksForPerson / unplannedTasksForPerson / todayAgendaForPerson\'s dateless', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: false });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false });
    const sDone = makeStatus({ id: 's-done', order: 2, isDone: true });
    const task = makeTask({
      id: 't1',
      statusId: 's-done',
      startDate: '2026-07-01',
      endDate: '2026-07-05', // past due relative to TODAY below
    });
    let state = makeState({
      statuses: [s0, s1, sDone],
      tasks: [task],
      people: [makePerson({ id: 'p1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'p1' })],
    });

    expect(doneStatusIds(state)).toEqual(new Set(['s-done']));

    // Adjacent swaps: order 2 -> 1 -> 0 (moves sDone to the FIRST pipeline slot).
    state = reducer(state, { type: 'REORDER_STATUS', statusId: 's-done', direction: -1 });
    state = reducer(state, { type: 'REORDER_STATUS', statusId: 's-done', direction: -1 });

    const reordered = state.statuses.find((s) => s.id === 's-done')!;
    expect(reordered.order).toBe(0);

    // Reordering never changes which statuses are done.
    expect(doneStatusIds(state)).toEqual(new Set(['s-done']));
    expect(isDoneStatus(state, 's-done')).toBe(true);

    const TODAY = '2026-07-10';
    expect(overdueTasksForPerson(state, 'p1', TODAY).map((t) => t.id)).not.toContain('t1');
    expect(unplannedTasksForPerson(state, 'p1').map((t) => t.id)).not.toContain('t1');
    const { dateless } = todayAgendaForPerson(state, 'p1', '2026-07-03');
    expect(dateless.map((t) => t.id)).not.toContain('t1');
  });
});

describe('a done-AND-archived status excludes a task from every my-work selector (PKG-20260712c-status-tests)', () => {
  it('not overdue, not unplanned, not in the dateless agenda', () => {
    const doneArchived = makeStatus({ id: 's-done-archived', order: 0, isDone: true, archived: true });
    const task = makeTask({
      id: 't1',
      statusId: 's-done-archived',
      startDate: '2026-07-01',
      endDate: '2026-07-05', // past due relative to '2026-07-10' below
    });
    const state = makeState({
      statuses: [doneArchived],
      tasks: [task],
      people: [makePerson({ id: 'p1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'p1' })],
    });

    expect(overdueTasksForPerson(state, 'p1', '2026-07-10').map((t) => t.id)).not.toContain('t1');
    expect(unplannedTasksForPerson(state, 'p1').map((t) => t.id)).not.toContain('t1');
    const { dateless } = todayAgendaForPerson(state, 'p1', '2026-07-03');
    expect(dateless.map((t) => t.id)).not.toContain('t1');
  });
});

describe('overdueTasksForPerson — the old last-active-status rule is gone (PKG-20260712c-status-tests)', () => {
  it('a task in a non-done LAST-position status with a past endDate IS overdue, even though it occupies the pipeline\'s last slot', () => {
    // The done status sits at order 0 (NOT last); the last-position status
    // (order 1) is explicitly not done. Under the old "last active status is
    // done" rule this task would have been silently treated as complete.
    const doneStatus = makeStatus({ id: 's-done', order: 0, isDone: true });
    const lastStatus = makeStatus({ id: 's-last', order: 1, isDone: false });
    const task = makeTask({
      id: 't1',
      statusId: 's-last',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });
    const state = makeState({
      statuses: [doneStatus, lastStatus],
      tasks: [task],
      people: [makePerson({ id: 'p1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'p1' })],
    });

    const result = overdueTasksForPerson(state, 'p1', '2026-07-10');
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('overdueTasksForPerson', () => {
  const TODAY = '2026-07-10';
  const base = emptyData();
  const activeStatusId = base.statuses[0].id;
  const doneId = base.statuses[base.statuses.length - 1].id;

  it('includes an assigned task with endDate < today and a non-done status; excludes done, not-yet-due, and unassigned tasks', () => {
    const overdue = makeTask({
      id: 't-overdue',
      title: 'Overdue',
      statusId: activeStatusId,
      startDate: '2026-07-01',
      endDate: '2026-07-05', // < TODAY
    });
    const overdueButDone = makeTask({
      id: 't-done',
      title: 'Overdue but done',
      statusId: doneId,
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });
    const dueToday = makeTask({
      id: 't-today',
      title: 'Due today',
      statusId: activeStatusId,
      startDate: '2026-07-01',
      endDate: TODAY, // ends today -> not overdue
    });
    const dueLater = makeTask({
      id: 't-later',
      title: 'Due later',
      statusId: activeStatusId,
      startDate: '2026-07-01',
      endDate: '2026-07-15',
    });
    const notMine = makeTask({
      id: 't-not-mine',
      title: 'Not mine',
      statusId: activeStatusId,
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });

    const state = makeState({
      ...base,
      tasks: [overdue, overdueButDone, dueToday, dueLater, notMine],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-overdue', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-done', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-today', personId: 'p1' }),
        makeAssignment({ id: 'a4', taskId: 't-later', personId: 'p1' }),
        makeAssignment({ id: 'a5', taskId: 't-not-mine', personId: 'p2' }),
      ],
    });

    const result = overdueTasksForPerson(state, 'p1', TODAY);
    expect(result.map((t) => t.id)).toEqual(['t-overdue']);
  });

  it('sorts by endDate ascending, ties broken by title', () => {
    const zebra = makeTask({
      id: 't-zebra',
      title: 'Zebra',
      statusId: activeStatusId,
      startDate: '2026-06-01',
      endDate: '2026-07-01',
    });
    const banana = makeTask({
      id: 't-banana',
      title: 'Banana',
      statusId: activeStatusId,
      startDate: '2026-06-01',
      endDate: '2026-07-01',
    });
    const apple = makeTask({
      id: 't-apple',
      title: 'Apple',
      statusId: activeStatusId,
      startDate: '2026-06-01',
      endDate: '2026-06-20', // earliest
    });

    const state = makeState({
      ...base,
      tasks: [zebra, banana, apple],
      people: [makePerson({ id: 'p1' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-zebra', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-banana', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-apple', personId: 'p1' }),
      ],
    });

    const result = overdueTasksForPerson(state, 'p1', TODAY);
    expect(result.map((t) => t.id)).toEqual(['t-apple', 't-banana', 't-zebra']);
  });
});

describe('overloadedDatesForPersonInRange', () => {
  it('flags only dates where booked hours strictly exceed capacity; booked === capacity is not overloaded; other people are ignored', () => {
    const d1 = '2026-07-06';
    const d2 = '2026-07-07';
    const d3 = '2026-07-08';
    const entries = [
      makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: d1, plannedHours: 5 }),
      makeEntry({ id: 'e2', taskId: 't2', personId: 'p1', date: d1, plannedHours: 4 }), // sum 9 > 8 -> overloaded
      makeEntry({ id: 'e3', taskId: 't1', personId: 'p1', date: d2, plannedHours: 8 }), // sum 8 === capacity -> not overloaded
      makeEntry({ id: 'e4', taskId: 't1', personId: 'p2', date: d3, plannedHours: 100 }), // other person, ignored
    ];
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      people: [makePerson({ id: 'p1', capacity: 8 }), makePerson({ id: 'p2', capacity: 8 })],
      workload: entries,
    });

    expect(overloadedDatesForPersonInRange(state, 'p1', [d1, d2, d3])).toEqual([d1]);
  });

  it('respects a lower per-person capacity (capacity 6, booked 7 -> overloaded)', () => {
    const d1 = '2026-07-06';
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 6 })],
      workload: [makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: d1, plannedHours: 7 })],
    });

    expect(overloadedDatesForPersonInRange(state, 'p1', [d1])).toEqual([d1]);
  });

  it('sums hours from multiple tasks on the same date to decide overload', () => {
    const d1 = '2026-07-06';
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: d1, plannedHours: 3 }),
        makeEntry({ id: 'e2', taskId: 't2', personId: 'p1', date: d1, plannedHours: 3 }),
        makeEntry({ id: 'e3', taskId: 't3', personId: 'p1', date: d1, plannedHours: 3 }), // 3+3+3 = 9 > 8
      ],
    });

    expect(overloadedDatesForPersonInRange(state, 'p1', [d1])).toEqual([d1]);
  });

  it('returns an empty array when no date in the range is overloaded', () => {
    const dates = ['2026-07-06', '2026-07-07'];
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1', capacity: 8 })],
      workload: [makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-06', plannedHours: 2 })],
    });

    expect(overloadedDatesForPersonInRange(state, 'p1', dates)).toEqual([]);
  });
});

describe('unplannedTasksForPerson', () => {
  const base = emptyData();
  const activeStatusId = base.statuses[0].id;
  const doneId = base.statuses[base.statuses.length - 1].id;

  it('includes an assigned, non-done task with zero workload rows for the person; excludes a bin-only task, a dated-row task, a done task, and an unassigned task', () => {
    const zeroRows = makeTask({
      id: 't-zero',
      title: 'Zero rows',
      statusId: activeStatusId,
      endDate: '2026-07-20',
    });
    const binOnly = makeTask({
      id: 't-bin-only',
      title: 'Bin only',
      statusId: activeStatusId,
      endDate: '2026-07-20',
    });
    const datedRow = makeTask({
      id: 't-dated',
      title: 'Dated row',
      statusId: activeStatusId,
      endDate: '2026-07-20',
    });
    const doneTask = makeTask({
      id: 't-done',
      title: 'Done',
      statusId: doneId,
      endDate: '2026-07-20',
    });
    const unassigned = makeTask({
      id: 't-unassigned',
      title: 'Unassigned',
      statusId: activeStatusId,
      endDate: '2026-07-20',
    });

    const state = makeState({
      ...base,
      tasks: [zeroRows, binOnly, datedRow, doneTask, unassigned],
      people: [makePerson({ id: 'p1' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-zero', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-bin-only', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-dated', personId: 'p1' }),
        makeAssignment({ id: 'a4', taskId: 't-done', personId: 'p1' }),
      ],
      workload: [
        makeEntry({
          id: 'bin1',
          taskId: 't-bin-only',
          personId: 'p1',
          date: BIN_DATE,
          startMinutes: 0,
          sortIndex: 0,
        }),
        makeEntry({ id: 'e1', taskId: 't-dated', personId: 'p1', date: '2026-07-08' }),
      ],
    });

    const result = unplannedTasksForPerson(state, 'p1');
    expect(result.map((t) => t.id)).toEqual(['t-zero']);
  });

  it("another person's rows on the same task do NOT make it planned for this person", () => {
    const shared = makeTask({ id: 't-shared', title: 'Shared', statusId: activeStatusId, endDate: '2026-07-20' });
    const state = makeState({
      ...base,
      tasks: [shared],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-shared', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-shared', personId: 'p2' }),
      ],
      workload: [
        makeEntry({ id: 'e1', taskId: 't-shared', personId: 'p2', date: '2026-07-08', plannedHours: 4 }),
      ],
    });

    const result = unplannedTasksForPerson(state, 'p1');
    expect(result.map((t) => t.id)).toEqual(['t-shared']);
  });

  it('sorts by endDate ascending, ties broken by title', () => {
    const zebra = makeTask({ id: 't-zebra', title: 'Zebra', statusId: activeStatusId, endDate: '2026-07-10' });
    const banana = makeTask({ id: 't-banana', title: 'Banana', statusId: activeStatusId, endDate: '2026-07-10' });
    const apple = makeTask({ id: 't-apple', title: 'Apple', statusId: activeStatusId, endDate: '2026-07-05' });

    const state = makeState({
      ...base,
      tasks: [zebra, banana, apple],
      people: [makePerson({ id: 'p1' })],
      assignments: [
        makeAssignment({ id: 'a1', taskId: 't-zebra', personId: 'p1' }),
        makeAssignment({ id: 'a2', taskId: 't-banana', personId: 'p1' }),
        makeAssignment({ id: 'a3', taskId: 't-apple', personId: 'p1' }),
      ],
      workload: [],
    });

    const result = unplannedTasksForPerson(state, 'p1');
    expect(result.map((t) => t.id)).toEqual(['t-apple', 't-banana', 't-zebra']);
  });
});

describe('binTaskRowsForPerson', () => {
  it('maps each bin entry to { task, hours } in bin sortIndex order', () => {
    const taskA = makeTask({ id: 't-a', title: 'A' });
    const taskB = makeTask({ id: 't-b', title: 'B' });
    const entries = [
      makeEntry({ id: 'bin-b', taskId: 't-b', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 2 }),
      makeEntry({ id: 'bin-a', taskId: 't-a', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 1, plannedHours: 3 }),
    ];
    const state = makeState({
      tasks: [taskA, taskB],
      people: [makePerson({ id: 'p1' })],
      workload: entries,
    });

    const rows = binTaskRowsForPerson(state, 'p1');
    expect(rows).toEqual([
      { task: taskB, hours: 2 },
      { task: taskA, hours: 3 },
    ]);
  });

  it('sums two bin rows of the same task into one row (defensive path)', () => {
    const taskA = makeTask({ id: 't-a', title: 'A' });
    const entries = [
      makeEntry({ id: 'bin1', taskId: 't-a', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 2 }),
      makeEntry({ id: 'bin2', taskId: 't-a', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 1, plannedHours: 5 }),
    ];
    const state = makeState({
      tasks: [taskA],
      people: [makePerson({ id: 'p1' })],
      workload: entries,
    });

    const rows = binTaskRowsForPerson(state, 'p1');
    expect(rows).toEqual([{ task: taskA, hours: 7 }]);
  });

  it('skips a bin entry whose taskId resolves to no task', () => {
    const taskA = makeTask({ id: 't-a', title: 'A' });
    const entries = [
      makeEntry({ id: 'bin-stale', taskId: 't-missing', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 4 }),
      makeEntry({ id: 'bin-a', taskId: 't-a', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 1, plannedHours: 3 }),
    ];
    const state = makeState({
      tasks: [taskA],
      people: [makePerson({ id: 'p1' })],
      workload: entries,
    });

    const rows = binTaskRowsForPerson(state, 'p1');
    expect(rows).toEqual([{ task: taskA, hours: 3 }]);
  });

  it("excludes other people's bin rows and this person's dated rows", () => {
    const taskA = makeTask({ id: 't-a', title: 'A' });
    const entries = [
      makeEntry({ id: 'bin-mine', taskId: 't-a', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 2 }),
      makeEntry({ id: 'bin-theirs', taskId: 't-a', personId: 'p2', date: BIN_DATE, startMinutes: 0, sortIndex: 1, plannedHours: 9 }),
      makeEntry({ id: 'dated-mine', taskId: 't-a', personId: 'p1', date: '2026-07-08', plannedHours: 4 }),
    ];
    const state = makeState({
      tasks: [taskA],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      workload: entries,
    });

    const rows = binTaskRowsForPerson(state, 'p1');
    expect(rows).toEqual([{ task: taskA, hours: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// planningStatusForTotals / taskPlanningStatus (PKG-20260709d-planning-status-tests)
// Implementation shipped by PKG-20260709d-planning-status-core.
// ---------------------------------------------------------------------------

describe('planningStatusForTotals', () => {
  it('(null, 0, 0) -> nie rozplanowano: nothing planned at all, no estimate', () => {
    expect(planningStatusForTotals(null, 0, 0)).toBe('nie rozplanowano');
  });

  it('(8, 0, 0) -> nie rozplanowano: an estimate alone plans nothing', () => {
    expect(planningStatusForTotals(8, 0, 0)).toBe('nie rozplanowano');
  });

  it('(null, 0, 3) -> częściowo: bin-only hours with no estimate', () => {
    expect(planningStatusForTotals(null, 0, 3)).toBe('częściowo');
  });

  it('(8, 0, 3) -> częściowo: bin-only hours under the estimate', () => {
    expect(planningStatusForTotals(8, 0, 3)).toBe('częściowo');
  });

  it('(null, 5, 0) -> rozplanowano: no target and all hours are dated', () => {
    expect(planningStatusForTotals(null, 5, 0)).toBe('rozplanowano');
  });

  it('(8, 8, 0) -> rozplanowano: exactly on target', () => {
    expect(planningStatusForTotals(8, 8, 0)).toBe('rozplanowano');
  });

  it('(8, 8 + 1e-12, 0) -> rozplanowano: EPS absorbs float drift at the boundary', () => {
    expect(planningStatusForTotals(8, 8 + 1e-12, 0)).toBe('rozplanowano');
  });

  it('(8, 8 - 1e-12, 0) -> rozplanowano: dated within EPS of the estimate (rule 5 lower boundary) still counts as fully planned', () => {
    expect(planningStatusForTotals(8, 8 - 1e-12, 0)).toBe('rozplanowano');
  });

  it('(8, 8.25, 0) -> przekroczono: one 0.25h step over the boundary is a real excess', () => {
    expect(planningStatusForTotals(8, 8.25, 0)).toBe('przekroczono');
  });

  it('(8, 5, 0) -> częściowo: under target with an empty bin', () => {
    expect(planningStatusForTotals(8, 5, 0)).toBe('częściowo');
  });

  it('(8, 5, 3) -> częściowo: total == estimate but bin pending — rule 3 beats rule 5', () => {
    expect(planningStatusForTotals(8, 5, 3)).toBe('częściowo');
  });

  it('(8, 8, 1) -> przekroczono: excess sits in the bin', () => {
    expect(planningStatusForTotals(8, 8, 1)).toBe('przekroczono');
  });

  it('(8, 9, 0) -> przekroczono: excess is dated', () => {
    expect(planningStatusForTotals(8, 9, 0)).toBe('przekroczono');
  });

  it('(null, 9, 4) -> częściowo: no estimate makes przekroczono impossible, bin forces częściowo', () => {
    expect(planningStatusForTotals(null, 9, 4)).toBe('częściowo');
  });

  it('(0, 2, 0) -> przekroczono: defensive zero-budget behavior, no special case', () => {
    expect(planningStatusForTotals(0, 2, 0)).toBe('przekroczono');
  });
});

describe('taskPlanningStatus', () => {
  it('dated entries exactly matching the estimate -> rozplanowano', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 8 })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-06', plannedHours: 5 }),
        makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: '2026-07-07', plannedHours: 3 }),
      ],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('rozplanowano');
  });

  it('a bin entry plus dated entries within estimate -> częściowo (proves the bin/dated split uses isBinEntry)', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 8 })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-06', plannedHours: 5 }),
        makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 3 }),
      ],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('częściowo');
  });

  it('dated + bin sum exceeding the estimate -> przekroczono', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 8 })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-06', plannedHours: 6 }),
        makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, sortIndex: 0, plannedHours: 4 }),
      ],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('przekroczono');
  });

  it('estimatedHours: null and zero workload rows -> nie rozplanowano', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('nie rozplanowano');
  });

  it("entries of OTHER tasks never leak into the computation — each task reports its own status", () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', estimatedHours: 8 }),
        makeTask({ id: 't2', estimatedHours: null }),
      ],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-06', plannedHours: 8 }),
        makeEntry({ id: 'e2', taskId: 't2', personId: 'p1', date: '2026-07-06', plannedHours: 2 }),
      ],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('rozplanowano');
    expect(taskPlanningStatus(state, 't2')).toBe('rozplanowano');
  });

  it('an unknown taskId behaves as estimate-null with no entries -> nie rozplanowano', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 8 })],
      workload: [],
    });

    expect(taskPlanningStatus(state, 'does-not-exist')).toBe('nie rozplanowano');
  });
});

// ---------------------------------------------------------------------------
// Partial scheduling (SCHEDULE_BIN_PART, PKG-20260713-bin-split-core) moving a
// task's derived planning status and bin-row selectors, one 8h step at a time.
// ---------------------------------------------------------------------------

describe('partial scheduling → planning status', () => {
  it('a 30h bin row starts częściowo, stays częściowo after one 8h partial schedule, and reaches rozplanowano once fully scheduled', () => {
    const bin1 = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 30, sortIndex: 0 });
    let state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 30 })],
      workload: [bin1],
    });

    expect(taskPlanningStatus(state, 't1')).toBe('częściowo');

    state = reducer(state, {
      type: 'SCHEDULE_BIN_PART',
      entryId: 'bin1',
      date: '2026-07-08',
      startMinutes: 480,
      hours: 8,
    });
    // 22h still sits in the bin -> still częściowo, not rozplanowano yet.
    expect(taskPlanningStatus(state, 't1')).toBe('częściowo');

    state = reducer(state, {
      type: 'SCHEDULE_BIN_PART',
      entryId: 'bin1',
      date: '2026-07-09',
      startMinutes: 0, // a 22h block must start near midnight to fit within the day
      hours: 22,
    });
    // Bin emptied, all 30h now on calendar days, matching the 30h estimate.
    expect(taskPlanningStatus(state, 't1')).toBe('rozplanowano');
  });
});

describe('binTaskRowsForPerson / binHoursForTaskPerson after a partial schedule', () => {
  it('reflects the remainder after a partial schedule and drops the task once the row reaches zero', () => {
    const bin1 = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 30, sortIndex: 0 });
    let state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [bin1],
    });

    state = reducer(state, {
      type: 'SCHEDULE_BIN_PART',
      entryId: 'bin1',
      date: '2026-07-08',
      startMinutes: 480,
      hours: 8,
    });

    expect(binHoursForTaskPerson(state, 't1', 'p1')).toBe(22);
    const rowsAfterPartial = binTaskRowsForPerson(state, 'p1');
    expect(rowsAfterPartial).toHaveLength(1);
    expect(rowsAfterPartial[0].task.id).toBe('t1');
    expect(rowsAfterPartial[0].hours).toBe(22);

    state = reducer(state, {
      type: 'SCHEDULE_BIN_PART',
      entryId: 'bin1',
      date: '2026-07-09',
      startMinutes: 0, // a 22h block must start near midnight to fit within the day
      hours: 22,
    });

    expect(binHoursForTaskPerson(state, 't1', 'p1')).toBe(0);
    expect(binTaskRowsForPerson(state, 'p1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Popover komórki „osoba × dzień” (Obciążenie) + rozdzielone sygnały koloru
// ---------------------------------------------------------------------------

describe('workloadCellBlocks / workloadCellDetail', () => {
  function cellProject(id: string, clientId: string) {
    return {
      id,
      clientId,
      name: `Projekt ${id}`,
      description: '',
      statusId: 'status1',
      paid: false,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      departmentId: '',
      serviceTypeId: '',
      documents: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  // Środa 2026-07-08 (dzień roboczy), czwartek 2026-07-09, sobota 2026-07-11.
  const WED = '2026-07-08';
  const THU = '2026-07-09';
  const SAT = '2026-07-11';

  function cellState() {
    return makeState({
      people: [makePerson({ id: 'p1', name: 'Ala', capacity: 8 }), makePerson({ id: 'p2' })],
      clients: [{ id: 'c1', name: 'Klient A', archived: false, notes: '' }],
      projects: [cellProject('proj1', 'c1')],
      tasks: [
        makeTask({ id: 't1', title: 'Montaż filmu', projectId: 'proj1' }),
        makeTask({ id: 't2', title: 'Korekta', projectId: 'proj1' }),
      ],
      workload: [
        // ZAPISANE odwrotnie do zegara (sortIndex 0 startuje później), żeby
        // sortowanie po godzinie było widoczne, a nie przypadkowe.
        makeEntry({ id: 'e-late', taskId: 't1', date: WED, startMinutes: 780, plannedHours: 1.5, sortIndex: 0 }),
        makeEntry({ id: 'e-early', taskId: 't2', date: WED, startMinutes: 540, plannedHours: 2, sortIndex: 1 }),
        // Szumy: inny dzień, inna osoba, wpis zasobnika (date '').
        makeEntry({ id: 'e-other-day', taskId: 't1', date: THU, startMinutes: 540, plannedHours: 3, sortIndex: 2 }),
        makeEntry({ id: 'e-other-person', taskId: 't1', personId: 'p2', date: WED, startMinutes: 600, plannedHours: 4, sortIndex: 3 }),
        makeEntry({ id: 'e-bin', taskId: 't1', date: BIN_DATE, startMinutes: 0, plannedHours: 5, sortIndex: 4 }),
      ],
    });
  }

  it('zwraca bloki tej pary (osoba, dzień) w kolejności zegara, z zakresem godzin', () => {
    const blocks = workloadCellBlocks(cellState(), 'p1', WED);
    expect(blocks.map((b) => b.entry.id)).toEqual(['e-early', 'e-late']);
    expect(blocks[0]).toMatchObject({
      taskId: 't2',
      taskTitle: 'Korekta',
      projectName: 'Projekt proj1',
      clientName: 'Klient A',
      plannedHours: 2,
      startMinutes: 540,
      endMinutes: 660,
      timeRange: '9:00–11:00',
    });
    expect(blocks[1]).toMatchObject({
      taskTitle: 'Montaż filmu',
      startMinutes: 780,
      endMinutes: 870,
      timeRange: '13:00–14:30',
    });
  });

  it('nie zmienia kolejności bazowego blocksForPersonDate (ta zostaje przy sortIndex)', () => {
    const state = cellState();
    expect(blocksForPersonDate(state, 'p1', WED).map((w) => w.id)).toEqual(['e-late', 'e-early']);
    expect(workloadCellBlocks(state, 'p1', WED).map((b) => b.entry.id)).toEqual([
      'e-early',
      'e-late',
    ]);
  });

  it('pomija wpisy zasobnika (date === "") — one nie należą do żadnego dnia', () => {
    const state = cellState();
    expect(workloadCellBlocks(state, 'p1', WED).some((b) => b.entry.id === 'e-bin')).toBe(false);
    expect(workloadCellBlocks(state, 'p1', BIN_DATE)).toEqual([]);
    expect(workloadCellDetail(state, 'p1', BIN_DATE).blocks).toEqual([]);
  });

  it('daje puste listy dla dnia bez bloków i nie miesza osób', () => {
    const state = cellState();
    expect(workloadCellBlocks(state, 'p1', SAT)).toEqual([]);
    expect(workloadCellBlocks(state, 'p2', WED).map((b) => b.entry.id)).toEqual([
      'e-other-person',
    ]);
  });

  it('rozwiązuje brakujące zadanie/projekt/klienta na bezpieczne wartości zastępcze', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1' })],
      workload: [makeEntry({ id: 'e1', taskId: 'nieistnieje', date: WED })],
    });
    expect(workloadCellBlocks(state, 'p1', WED)[0]).toMatchObject({
      taskTitle: 'Zadanie',
      projectName: '',
      clientName: '',
    });
  });

  it('nagłówek popovera bierze bilans dnia z dayAvailabilityForPerson', () => {
    const state = cellState();
    const detail = workloadCellDetail(state, 'p1', WED);
    const day = dayAvailabilityForPerson(state, 'p1', WED);
    expect(detail).toMatchObject({
      personId: 'p1',
      date: WED,
      availableHours: day.availableHours,
      bookedHours: day.bookedHours,
      overbooked: day.overbooked,
    });
    expect(detail.availableHours).toBe(8);
    expect(detail.bookedHours).toBe(3.5);
    expect(detail.overbooked).toBe(false);
    // Suma godzin listy = bilans nagłówka: „6h / 8h” nigdy nie kłóci się z listą.
    expect(detail.blocks.reduce((s, b) => s + b.plannedHours, 0)).toBe(detail.bookedHours);
  });

  it('oznacza przeciążenie, gdy dzień wolny ma zabukowane godziny', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', capacity: 8, workDays: [1, 2, 3, 4, 5] })],
      tasks: [makeTask({ id: 't1', title: 'Sobota' })],
      workload: [makeEntry({ id: 'e1', date: SAT, plannedHours: 4, startMinutes: 600 })],
    });
    const detail = workloadCellDetail(state, 'p1', SAT);
    expect(detail.availableHours).toBe(0);
    expect(detail.bookedHours).toBe(4);
    expect(detail.overbooked).toBe(true);
    expect(detail.blocks).toHaveLength(1);
  });
});

describe('loadTone (jedna skala wykorzystania)', () => {
  it('trzyma progi skali', () => {
    expect(loadTone(0)).toBe('low');
    expect(loadTone(49)).toBe('low');
    expect(loadTone(50)).toBe('mid');
    expect(loadTone(84)).toBe('mid');
    expect(loadTone(85)).toBe('high');
    expect(loadTone(100)).toBe('high');
    expect(loadTone(101)).toBe('over');
  });

  it('null (godziny przy zerowej dostępności) to szczyt skali, nie spokojne 0%', () => {
    expect(loadTone(null)).toBe('over');
    expect(loadTone(loadPercent(0, 0))).toBe('low');
  });

  it('jest MONOTONICZNA — 75% nigdy nie wygląda groźniej niż 84% (regresja OP-21)', () => {
    const rank: Record<string, number> = { low: 0, mid: 1, high: 2, over: 3 };
    expect(rank[loadTone(75)]).toBeLessThanOrEqual(rank[loadTone(84)]);
    for (let pct = 0; pct <= 150; pct++) {
      expect(rank[loadTone(pct)]).toBeGreaterThanOrEqual(rank[loadTone(pct - 1)]);
    }
  });
});

// ---------------------------------------------------------------------------
// scheduleConflictsForRange — TREŚĆ konfliktu, nie tylko fakt jego istnienia.
//
// Komunikat użytkownika składa się z pól tego wyniku (kto, co, kiedy), więc same
// testy brzmienia w `eventConflictMessage.test.ts` nie wystarczą — działają na
// ręcznie tworzonych obiektach i nie złapałyby złego tytułu czy złej osoby tutaj.
// ---------------------------------------------------------------------------

function makeCalendarEvent(
  overrides: Partial<import('../types').CalendarEvent> & { id: string },
): import('../types').CalendarEvent {
  return {
    title: 'Spotkanie',
    description: '',
    location: '',
    meetingUrl: '',
    date: '2026-07-08',
    startMinutes: 600,
    durationMinutes: 60,
    attendeeIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduleConflictsForRange', () => {
  const base = () =>
    makeState({
      people: [
        makePerson({ id: 'p1', name: 'Ola Nowak' }),
        makePerson({ id: 'p2', name: 'Marek Wiśniewski' }),
      ],
      tasks: [makeTask({ id: 't1', title: 'Regresja QA' })],
      // blok p1: 10:00-12:00
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', startMinutes: 600, plannedHours: 2 }),
      ],
    });

  it('opisuje kolidujący blok osobą, tytułem zadania i zakresem', () => {
    const out = scheduleConflictsForRange(base(), ['p1'], '2026-07-08', 630, 60);
    expect(out).toEqual([
      {
        kind: 'block',
        personId: 'p1',
        personName: 'Ola Nowak',
        title: 'Regresja QA',
        startMinutes: 600,
        durationMinutes: 120,
      },
    ]);
  });

  it('styk krawędzi nie jest kolizją', () => {
    // blok 600-720; zakres 720-780 tylko się styka
    expect(scheduleConflictsForRange(base(), ['p1'], '2026-07-08', 720, 60)).toEqual([]);
    // i z drugiej strony: 540-600
    expect(scheduleConflictsForRange(base(), ['p1'], '2026-07-08', 540, 60)).toEqual([]);
  });

  it('sprawdza tylko WSKAZANE osoby', () => {
    expect(scheduleConflictsForRange(base(), ['p2'], '2026-07-08', 630, 60)).toEqual([]);
  });

  it('deduplikuje powtórzone id osoby', () => {
    const out = scheduleConflictsForRange(base(), ['p1', 'p1', 'p1'], '2026-07-08', 630, 60);
    expect(out).toHaveLength(1);
  });

  it('znosi nieznane id osoby bez wyjątku', () => {
    expect(scheduleConflictsForRange(base(), ['brak'], '2026-07-08', 630, 60)).toEqual([]);
  });

  it('pomija blok wskazany przez excludeEntryId', () => {
    const out = scheduleConflictsForRange(base(), ['p1'], '2026-07-08', 630, 60, {
      excludeEntryId: 'e1',
    });
    expect(out).toEqual([]);
  });

  it('opisuje kolidujące wydarzenie i pomija wskazane excludeEventId', () => {
    const state = makeState({
      people: [makePerson({ id: 'p1', name: 'Ola Nowak' })],
      events: [makeCalendarEvent({ id: 'ev1', title: 'Przegląd', attendeeIds: ['p1'] })],
    });
    const out = scheduleConflictsForRange(state, ['p1'], '2026-07-08', 630, 60);
    expect(out).toEqual([
      {
        kind: 'event',
        personId: 'p1',
        personName: 'Ola Nowak',
        title: 'Przegląd',
        startMinutes: 600,
        durationMinutes: 60,
      },
    ]);
    expect(
      scheduleConflictsForRange(state, ['p1'], '2026-07-08', 630, 60, { excludeEventId: 'ev1' }),
    ).toEqual([]);
  });
});

describe('eventDraftConflicts — próg zależny od uczestników', () => {
  const busyState = () =>
    makeState({
      people: [makePerson({ id: 'p1', name: 'Ola' }), makePerson({ id: 'p2', name: 'Marek' })],
      tasks: [makeTask({ id: 't1', title: 'Regresja QA' })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', startMinutes: 600, plannedHours: 2 }),
      ],
    });

  it('uczestnik imienny => kolizja BLOKUJE, nic w ostrzeżeniach', () => {
    const r = eventDraftConflicts(busyState(), {
      date: '2026-07-08',
      startMinutes: 630,
      durationMinutes: 60,
      attendeeIds: ['p1'],
    });
    expect(r.blocking).toHaveLength(1);
    expect(r.warning).toHaveLength(0);
  });

  it('ogólnofirmowe => kolizja tylko OSTRZEGA i liczona jest po wszystkich', () => {
    const r = eventDraftConflicts(busyState(), {
      date: '2026-07-08',
      startMinutes: 630,
      durationMinutes: 60,
      attendeeIds: [],
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.warning).toHaveLength(1);
    expect(r.warning[0].personId).toBe('p1');
  });

  // SERIA CYKLICZNA (2026-08-04): kolizja w pojedynczym tygodniu nie może
  // blokować serii na pół roku — symulacja wystąpień zwraca ostrzeżenia z DATĄ.
  describe('draft cykliczny — symulacja wystąpień zamiast blokady', () => {
    // 2026-07-08 to środa (isoWeekday 3) — blok Oli 10:00-12:00 tylko tam.
    const weeklyRule = { daysOfWeek: [3], startMinutes: 630, durationMinutes: 60 };

    it('kolizja jednego wystąpienia => ZERO blokad, ostrzeżenie z datą', () => {
      const r = eventDraftConflicts(busyState(), {
        date: '2026-07-08',
        startMinutes: 630,
        durationMinutes: 60,
        attendeeIds: ['p1'],
        recurrence: weeklyRule,
      });
      expect(r.blocking).toHaveLength(0);
      expect(r.warning).toHaveLength(1);
      expect(r.warning[0]).toMatchObject({
        kind: 'block',
        personName: 'Ola',
        title: 'Regresja QA',
        date: '2026-07-08',
      });
    });

    it('wystąpienia bez kolizji nie wnoszą ostrzeżeń (wolna przyszłość przechodzi czysto)', () => {
      const r = eventDraftConflicts(busyState(), {
        // Kotwica TYDZIEŃ PO bloku Oli — żadne wystąpienie nie koliduje.
        date: '2026-07-15',
        startMinutes: 630,
        durationMinutes: 60,
        attendeeIds: ['p1'],
        recurrence: weeklyRule,
      });
      expect(r.blocking).toHaveLength(0);
      expect(r.warning).toHaveLength(0);
    });

    it('`until` reguły przycina symulację', () => {
      // Blok Oli 08.07; until dzień wcześniej => zero wystąpień z kolizją.
      const r = eventDraftConflicts(busyState(), {
        date: '2026-07-01',
        startMinutes: 630,
        durationMinutes: 60,
        attendeeIds: ['p1'],
        recurrence: { ...weeklyRule, until: '2026-07-07' },
      });
      expect(r.blocking).toHaveLength(0);
      expect(r.warning).toHaveLength(0);
    });

    it('co 2 tygodnie omija kolizję z martwego tygodnia', () => {
      // Kotwica 01.07 (środa); interwał 2 tyg. => wystąpienia 01.07, 15.07…
      // Blok Oli 08.07 wypada w tygodniu MARTWYM — nie ma ostrzeżenia.
      const r = eventDraftConflicts(busyState(), {
        date: '2026-07-01',
        startMinutes: 630,
        durationMinutes: 60,
        attendeeIds: ['p1'],
        recurrence: { ...weeklyRule, intervalWeeks: 2 },
      });
      expect(r.blocking).toHaveLength(0);
      expect(r.warning).toHaveLength(0);
    });
  });
});

describe('blockCollidesWithEvent', () => {
  const state = () =>
    makeState({
      people: [makePerson({ id: 'p1' })],
      events: [makeCalendarEvent({ id: 'ev1', attendeeIds: ['p1'] })], // 600-660
    });

  it('wykrywa nachodzenie na wydarzenie osoby', () => {
    expect(blockCollidesWithEvent(state(), 'p1', '2026-07-08', 630, 1)).toBe(true);
  });

  it('styk krawędzi nie koliduje', () => {
    expect(blockCollidesWithEvent(state(), 'p1', '2026-07-08', 660, 1)).toBe(false);
    expect(blockCollidesWithEvent(state(), 'p1', '2026-07-08', 540, 1)).toBe(false);
  });

  // Blokada dotyczy WYŁĄCZNIE osób imiennie przypisanych do wydarzenia —
  // ogólnofirmowe nie blokuje nikomu planowania (symetria z progiem przy
  // zapisie: eventDraftConflicts dla ogólnofirmowego tylko ostrzega).
  it('NIE blokuje na wydarzeniu OGÓLNOFIRMOWYM (puste attendeeIds)', () => {
    const s = makeState({
      people: [makePerson({ id: 'p1' })],
      events: [makeCalendarEvent({ id: 'ev1', attendeeIds: [] })], // 600-660
    });
    expect(blockCollidesWithEvent(s, 'p1', '2026-07-08', 630, 1)).toBe(false);
  });

  // Wystąpienia cykliczne zostają czysto prezentacyjne — nie blokują przeciągania.
  it('NIE blokuje na wystąpieniu zadania cyklicznego', () => {
    const s = makeState({
      people: [makePerson({ id: 'p1' })],
      tasks: [
        makeTask({
          id: 't1',
          startDate: '2026-07-08',
          recurrence: { daysOfWeek: [3], startMinutes: 600, durationMinutes: 60 },
        }),
      ],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'p1' })],
    });
    expect(blockCollidesWithEvent(s, 'p1', '2026-07-08', 630, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// URLOP w selektorach: pełnodniowe wystąpienie w zakresie dat, nazwany rodzaj
// konfliktu, próg wyłącznie ostrzegawczy przy zapisie urlopu oraz czysty
// podział dni przeciążonych (palma zamiast wykrzyknika).
// ---------------------------------------------------------------------------

describe('urlop — selektory', () => {
  const MON = '2026-07-06';
  const WED = '2026-07-08';
  const FRI = '2026-07-10';

  const vacationEvent = (overrides: Partial<import('../types').CalendarEvent> = {}) =>
    makeCalendarEvent({
      id: 'urlop1',
      title: 'Urlop',
      kind: 'urlop',
      date: MON,
      endDate: FRI,
      startMinutes: 0,
      durationMinutes: 1440,
      attendeeIds: ['p1'],
      ...overrides,
    });

  const stateWithVacation = (overrides: Partial<AppData> = {}) =>
    makeState({
      people: [makePerson({ id: 'p1', name: 'Ola Nowak' }), makePerson({ id: 'p2', name: 'Marek' })],
      events: [vacationEvent()],
      ...overrides,
    });

  it('personVacationOnDate zwraca encję w każdym dniu zakresu i null poza nim', () => {
    const state = stateWithVacation();
    expect(personVacationOnDate(state, 'p1', MON)?.id).toBe('urlop1');
    expect(personVacationOnDate(state, 'p1', WED)?.id).toBe('urlop1');
    expect(personVacationOnDate(state, 'p1', FRI)?.id).toBe('urlop1');
    expect(personVacationOnDate(state, 'p1', '2026-07-11')).toBeNull();
    expect(personVacationOnDate(state, 'p1', '2026-07-05')).toBeNull();
  });

  it('personVacationOnDate dotyczy TYLKO uczestnika urlopu', () => {
    expect(personVacationOnDate(stateWithVacation(), 'p2', WED)).toBeNull();
  });

  it('personVacationOnDate znosi nieznaną osobę i złą datę', () => {
    const state = stateWithVacation();
    expect(personVacationOnDate(state, '', WED)).toBeNull();
    expect(personVacationOnDate(state, 'p1', 'not-a-date')).toBeNull();
  });

  it('blockCollidesWithEvent blokuje KAŻDĄ godzinę dnia urlopowego (także 18:00)', () => {
    const state = stateWithVacation();
    expect(blockCollidesWithEvent(state, 'p1', WED, 1080, 1)).toBe(true);
    expect(blockCollidesWithEvent(state, 'p1', WED, 0, 0.25)).toBe(true);
    expect(blockCollidesWithEvent(state, 'p2', WED, 1080, 1)).toBe(false);
  });

  it('scheduleConflictsForRange nazywa urlop własnym rodzajem', () => {
    const out = scheduleConflictsForRange(stateWithVacation(), ['p1'], WED, 600, 60);
    expect(out).toEqual([
      {
        kind: 'urlop',
        personId: 'p1',
        personName: 'Ola Nowak',
        title: 'Urlop',
        startMinutes: 0,
        durationMinutes: 1440,
      },
    ]);
  });

  it('eventDraftConflicts dla draftu urlopu liczy KAŻDY dzień zakresu i tylko OSTRZEGA', () => {
    const state = stateWithVacation({
      events: [],
      tasks: [makeTask({ id: 't1', title: 'Regresja QA' })],
      workload: [
        makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: MON, startMinutes: 600, plannedHours: 2 }),
        makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: WED, startMinutes: 600, plannedHours: 2 }),
        // Poza zakresem — nie może wejść do raportu.
        makeEntry({ id: 'e3', taskId: 't1', personId: 'p1', date: '2026-07-13', startMinutes: 600, plannedHours: 2 }),
      ],
    });
    const r = eventDraftConflicts(state, {
      date: MON,
      startMinutes: 0,
      durationMinutes: 1440,
      attendeeIds: ['p1'],
      kind: 'urlop',
      endDate: FRI,
    });
    expect(r.blocking).toHaveLength(0);
    expect(r.warning.map((c) => c.title)).toEqual(['Regresja QA', 'Regresja QA']);
  });

  it('eventDraftConflicts dla urlopu JEDNODNIOWEGO patrzy tylko na jego dzień', () => {
    const state = stateWithVacation({
      events: [],
      tasks: [makeTask({ id: 't1', title: 'Regresja QA' })],
      workload: [
        makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: WED, startMinutes: 600, plannedHours: 2 }),
      ],
    });
    const r = eventDraftConflicts(state, {
      date: MON,
      startMinutes: 0,
      durationMinutes: 1440,
      attendeeIds: ['p1'],
      kind: 'urlop',
    });
    expect(r.warning).toHaveLength(0);
  });

  it('splitOverloadedDaysByVacation rozdziela dni urlopowe od pozostałych, zachowując kolejność', () => {
    const state = stateWithVacation();
    const out = splitOverloadedDaysByVacation(state, 'p1', [MON, WED, '2026-07-13']);
    expect(out.vacation).toEqual([MON, WED]);
    expect(out.overload).toEqual(['2026-07-13']);
  });

  it('splitOverloadedDaysByVacation dla osoby bez urlopu zostawia wszystko po stronie przeciążenia', () => {
    const out = splitOverloadedDaysByVacation(stateWithVacation(), 'p2', [MON, WED]);
    expect(out.vacation).toEqual([]);
    expect(out.overload).toEqual([MON, WED]);
  });
});
