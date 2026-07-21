// Unit tests for the pure Kanban TASK board module (PKG-20260721-kanban-on-tasks):
// status grouping, the archived-status bucket, the client/paid/person filters and
// their combination, deterministic in-column ordering and tolerance for dangling
// status/project references. Pure — no React, no localStorage — following the
// fixture style of store/taskOrder.test.ts.
import { describe, expect, it } from 'vitest';
import { buildKanbanColumns, buildTaskAssigneeIds, type KanbanFilters } from './kanbanBoard';
import { emptyData } from '../store/storage';
import type {
  AppData,
  Client,
  Person,
  Project,
  Status,
  Task,
  TaskAssignment,
} from '../types';

const TODO: Status = { id: 's1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const DOING: Status = { id: 's2', name: 'W toku', slug: 'w-toku', color: '#5bdcff', order: 1, archived: false, isDone: false };
const DONE: Status = { id: 's3', name: 'Zrobione', slug: 'zrobione', color: '#4caf50', order: 2, archived: false, isDone: true };
const OLD: Status = { id: 's9', name: 'Archiwum', slug: 'archiwum', color: '#666666', order: 3, archived: true, isDone: false };

const CLIENT_A: Client = { id: 'c1', name: 'Klient A', archived: false };
const CLIENT_B: Client = { id: 'c2', name: 'Klient B', archived: false };

const PROJECT_A: Project = {
  id: 'projA', clientId: 'c1', name: 'Projekt A', description: '', statusId: 's1', paid: true,
  startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
// Different client AND different paid flag, so one project isolates each filter.
const PROJECT_B: Project = { ...PROJECT_A, id: 'projB', name: 'Projekt B', clientId: 'c2', paid: false };

function makePerson(id: string, firstName: string): Person {
  return {
    id, firstName, lastName: 'Testowy', name: `${firstName} Testowy`, email: '', phone: '',
    role: '', departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
    birthDate: '',
  };
}
const ANNA = makePerson('p1', 'Anna');
const BOGDAN = makePerson('p2', 'Bogdan');

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'projA', statusId: 's1', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function makeState(overrides: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    statuses: [TODO, DOING, DONE, OLD],
    clients: [CLIENT_A, CLIENT_B],
    projects: [PROJECT_A, PROJECT_B],
    people: [ANNA, BOGDAN],
    ...overrides,
  };
}

const NO_FILTERS: KanbanFilters = { paid: 'all', clientId: '', personIds: new Set() };
const filters = (over: Partial<KanbanFilters> = {}): KanbanFilters => ({ ...NO_FILTERS, ...over });

/** Column status id -> task ids, for compact assertions. */
const shape = (state: AppData, f: KanbanFilters = NO_FILTERS) => {
  const board = buildKanbanColumns(state, f);
  return {
    columns: board.columns.map((c) => [c.status.id, c.tasks.map((t) => t.id)] as const),
    archived: board.archived.map((t) => t.id),
  };
};

describe('buildKanbanColumns — grouping by task status', () => {
  it('creates one column per active status in pipeline order and buckets tasks', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', statusId: 's2' }),
        makeTask({ id: 't2', statusId: 's1' }),
        makeTask({ id: 't3', statusId: 's3' }),
        makeTask({ id: 't4', statusId: 's2', orderIndex: 1 }),
      ],
    });
    expect(shape(state)).toEqual({
      columns: [
        ['s1', ['t2']],
        ['s2', ['t1', 't4']],
        ['s3', ['t3']],
      ],
      archived: [],
    });
  });

  it('keeps empty columns (they stay drop targets)', () => {
    const board = buildKanbanColumns(makeState({ tasks: [] }), NO_FILTERS);
    expect(board.columns.map((c) => c.status.id)).toEqual(['s1', 's2', 's3']);
    expect(board.columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it('never reads or rewrites completion / orderIndex (invariant 5)', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', statusId: 's3', orderIndex: 7 })],
    });
    const board = buildKanbanColumns(state, NO_FILTERS);
    const card = board.columns.find((c) => c.status.id === 's3')!.tasks[0];
    // Same object reference: the module is a read, not a copy-and-mutate.
    expect(card).toBe(state.tasks[0]);
    expect(card.orderIndex).toBe(7);
    expect(card.statusId).toBe('s3');
  });
});

describe('buildKanbanColumns — archived status bucket', () => {
  it('collects tasks in an archived status instead of dropping them', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', statusId: 's1' }),
        makeTask({ id: 'told', statusId: 's9' }),
      ],
    });
    const board = buildKanbanColumns(state, NO_FILTERS);
    expect(board.archived.map((t) => t.id)).toEqual(['told']);
    // The archived status never gets its own regular column.
    expect(board.columns.some((c) => c.status.id === 's9')).toBe(false);
  });

  it('applies the active filters to the archived bucket too', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'a', statusId: 's9', projectId: 'projA' }),
        makeTask({ id: 'b', statusId: 's9', projectId: 'projB' }),
      ],
    });
    expect(shape(state, filters({ clientId: 'c2' })).archived).toEqual(['b']);
  });
});

describe('buildKanbanColumns — filters resolved through the project', () => {
  const state = makeState({
    tasks: [
      makeTask({ id: 'a', projectId: 'projA' }), // Klient A, opłacony
      makeTask({ id: 'b', projectId: 'projB' }), // Klient B, nieopłacony
    ],
  });

  it('filters by client', () => {
    expect(shape(state, filters({ clientId: 'c1' })).columns[0][1]).toEqual(['a']);
    expect(shape(state, filters({ clientId: 'c2' })).columns[0][1]).toEqual(['b']);
  });

  it('filters by paid', () => {
    expect(shape(state, filters({ paid: 'paid' })).columns[0][1]).toEqual(['a']);
    expect(shape(state, filters({ paid: 'unpaid' })).columns[0][1]).toEqual(['b']);
    expect(shape(state, filters({ paid: 'all' })).columns[0][1]).toEqual(['a', 'b']);
  });
});

describe('buildKanbanColumns — person filter', () => {
  const assignments: TaskAssignment[] = [
    { id: 'as1', taskId: 'a', personId: 'p1' },
    { id: 'as2', taskId: 'b', personId: 'p2' },
    { id: 'as3', taskId: 'c', personId: 'p1' },
    { id: 'as4', taskId: 'c', personId: 'p2' },
  ];
  const state = makeState({
    tasks: [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
      makeTask({ id: 'd' }), // nobody assigned
    ],
    assignments,
  });

  it('an empty set means everybody', () => {
    expect(shape(state).columns[0][1]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps only tasks assigned to a selected person', () => {
    expect(shape(state, filters({ personIds: new Set(['p1']) })).columns[0][1]).toEqual(['a', 'c']);
  });

  it('is a multi-select OR (union), not an intersection', () => {
    expect(shape(state, filters({ personIds: new Set(['p1', 'p2']) })).columns[0][1]).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('drops unassigned tasks when a person is selected', () => {
    const ids = shape(state, filters({ personIds: new Set(['p2']) })).columns[0][1];
    expect(ids).not.toContain('d');
  });
});

describe('buildKanbanColumns — combined filters', () => {
  it('applies client + paid + person together (AND across groups)', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'hit', projectId: 'projA' }),
        makeTask({ id: 'wrongClient', projectId: 'projB' }),
        makeTask({ id: 'wrongPerson', projectId: 'projA' }),
      ],
      assignments: [
        { id: 'as1', taskId: 'hit', personId: 'p1' },
        { id: 'as2', taskId: 'wrongClient', personId: 'p1' },
        { id: 'as3', taskId: 'wrongPerson', personId: 'p2' },
      ],
    });
    const f = filters({ clientId: 'c1', paid: 'paid', personIds: new Set(['p1']) });
    expect(shape(state, f).columns[0][1]).toEqual(['hit']);
  });
});

describe('buildKanbanColumns — deterministic ordering', () => {
  it('sorts by (orderIndex, startDate, id)', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'z', orderIndex: 0, startDate: '2026-07-10' }),
        makeTask({ id: 'a', orderIndex: 0, startDate: '2026-07-08' }),
        makeTask({ id: 'm', orderIndex: 0, startDate: '2026-07-08' }),
        makeTask({ id: 'first', orderIndex: -1, startDate: '2026-07-30' }),
        makeTask({ id: 'last', orderIndex: 5, startDate: '2026-07-01' }),
      ],
    });
    expect(shape(state).columns[0][1]).toEqual(['first', 'a', 'm', 'z', 'last']);
  });

  it('is stable across repeated calls and independent of input order', () => {
    const tasks = [
      makeTask({ id: 'b', orderIndex: 1 }),
      makeTask({ id: 'a', orderIndex: 0 }),
    ];
    const forward = shape(makeState({ tasks }));
    const reversed = shape(makeState({ tasks: [...tasks].reverse() }));
    expect(forward).toEqual(reversed);
  });

  it('does not mutate the source tasks array', () => {
    const tasks = [makeTask({ id: 'b', orderIndex: 1 }), makeTask({ id: 'a', orderIndex: 0 })];
    const state = makeState({ tasks });
    buildKanbanColumns(state, NO_FILTERS);
    expect(state.tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('buildKanbanColumns — dangling references', () => {
  it('skips a task whose statusId matches no status (no crash)', () => {
    const state = makeState({
      tasks: [makeTask({ id: 'ok' }), makeTask({ id: 'ghost', statusId: 'nie-ma-takiego' })],
    });
    const board = buildKanbanColumns(state, NO_FILTERS);
    const all = [...board.columns.flatMap((c) => c.tasks), ...board.archived].map((t) => t.id);
    expect(all).toEqual(['ok']);
  });

  it('a task with a dangling projectId survives with no filters but fails project filters', () => {
    const state = makeState({ tasks: [makeTask({ id: 'orphan', projectId: 'nie-ma' })] });
    expect(shape(state).columns[0][1]).toEqual(['orphan']);
    expect(shape(state, filters({ clientId: 'c1' })).columns[0][1]).toEqual([]);
    expect(shape(state, filters({ paid: 'paid' })).columns[0][1]).toEqual([]);
    expect(shape(state, filters({ paid: 'unpaid' })).columns[0][1]).toEqual([]);
  });

  it('works on a board with no statuses at all', () => {
    const state = makeState({ statuses: [], tasks: [makeTask({ id: 't1' })] });
    expect(buildKanbanColumns(state, NO_FILTERS)).toEqual({ columns: [], archived: [] });
  });
});

describe('buildTaskAssigneeIds', () => {
  it('groups assignment rows by task id', () => {
    const state = makeState({
      assignments: [
        { id: 'as1', taskId: 't1', personId: 'p1' },
        { id: 'as2', taskId: 't1', personId: 'p2' },
        { id: 'as3', taskId: 't2', personId: 'p2' },
      ],
    });
    const map = buildTaskAssigneeIds(state);
    expect(map.get('t1')).toEqual(['p1', 'p2']);
    expect(map.get('t2')).toEqual(['p2']);
    expect(map.get('brak')).toBeUndefined();
  });
});
