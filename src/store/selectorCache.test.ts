// Unit tests for the reference-keyed selector cache (PKG-20260728-store-performance).
// Two halves:
//   (1) the primitives in selectorCache.ts (createRefCache / createKeyedCache /
//       argsKey / filterKey), and
//   (2) their wiring into selectors.ts — cache HIT on the same state reference,
//       MISS across a real reducer-produced revision, and byte-for-byte parity
//       with the naive `.filter()`/`.sort()` implementations they replaced.
// Pure: no React, no localStorage — fixtures are built from emptyData().
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import { argsKey, createKeyedCache, createRefCache, filterKey } from './selectorCache';
import {
  binEntriesForPerson,
  binTotalForPerson,
  blocksForPersonDate,
  dayTotal,
  doneStatusIds,
  entriesForDate,
  entriesForTask,
  entriesForTaskPerson,
  getPerson,
  getTask,
  hoursForPersonOnDate,
  assigneeIdsOfTask,
  taskIdsOfPerson,
  todayAgendaForPerson,
  unplannedTasksForPerson,
} from './selectors';
import type { AppData, Person, Project, Status, Task, WorkloadEntry } from '../types';

const D1 = '2026-07-08';
const D2 = '2026-07-09';

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

const STATUS_OPEN: Status = {
  id: 'status1',
  name: 'Do zrobienia',
  slug: 'do-zrobienia',
  color: '#9aa7c4',
  order: 0,
  archived: false,
  isDone: false,
};
const STATUS_DONE: Status = {
  id: 'status2',
  name: 'Zrobione',
  slug: 'zrobione',
  color: '#5ac48a',
  order: 1,
  archived: false,
  isDone: true,
};

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1',
    statusId: 'status1',
    title: `Task ${overrides.id}`,
    description: '',
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

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Test',
    lastName: '',
    name: `Person ${overrides.id}`,
    email: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    phone: '',
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    birthDate: '',
    supervisorId: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<WorkloadEntry> & { id: string }): WorkloadEntry {
  return {
    taskId: 't1',
    personId: 'p1',
    date: D1,
    plannedHours: 2,
    startMinutes: 480,
    sortIndex: 0,
    ...overrides,
  };
}

/**
 * Seeded fixture: two people, two tasks, six workload rows (dated + bin) whose
 * ARRAY ORDER is deliberately shuffled relative to `sortIndex`/`startMinutes`,
 * so any index that silently reordered a bucket would show up immediately.
 */
function seededState(): AppData {
  return {
    ...emptyData(),
    projects: [PROJECT],
    statuses: [STATUS_OPEN, STATUS_DONE],
    people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
    tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
    assignments: [
      { id: 'a1', taskId: 't1', personId: 'p1' },
      { id: 'a2', taskId: 't1', personId: 'p2' },
      { id: 'a3', taskId: 't2', personId: 'p1' },
    ],
    workload: [
      makeEntry({ id: 'w3', personId: 'p1', taskId: 't2', startMinutes: 600, sortIndex: 2 }),
      makeEntry({ id: 'w1', personId: 'p1', taskId: 't1', startMinutes: 480, sortIndex: 0 }),
      makeEntry({ id: 'w4', personId: 'p2', taskId: 't1', startMinutes: 540, sortIndex: 0 }),
      makeEntry({ id: 'w2', personId: 'p1', taskId: 't1', startMinutes: 720, sortIndex: 1 }),
      makeEntry({ id: 'w5', personId: 'p1', taskId: 't1', date: D2, startMinutes: 480, sortIndex: 0 }),
      makeEntry({ id: 'wb', personId: 'p1', taskId: 't2', date: '', startMinutes: 0, sortIndex: 5 }),
    ],
  };
}

// ---- Primitives -----------------------------------------------------------

describe('createRefCache', () => {
  it('builds once per key REFERENCE and hits on repeat', () => {
    let calls = 0;
    const cache = createRefCache((rows: string[]) => {
      calls += 1;
      return rows.map((r) => r.toUpperCase());
    });
    const a = ['x'];
    const first = cache(a);
    const second = cache(a);
    expect(calls).toBe(1);
    expect(second).toBe(first);

    const b = ['x']; // value-equal, DIFFERENT reference
    const third = cache(b);
    expect(calls).toBe(2);
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });

  it('treats an `undefined` result as a cached value (no recompute)', () => {
    let calls = 0;
    const cache = createRefCache<{ id: string }, string | undefined>(() => {
      calls += 1;
      return undefined;
    });
    const key = { id: 'k' };
    expect(cache(key)).toBeUndefined();
    expect(cache(key)).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe('createKeyedCache', () => {
  it('caches per (state reference, string key) and separates keys', () => {
    let calls = 0;
    const cache = createKeyedCache<string>((_state, key) => {
      calls += 1;
      return `v:${key}`;
    });
    const state = seededState();
    expect(cache(state, 'a')).toBe('v:a');
    expect(cache(state, 'a')).toBe('v:a');
    expect(calls).toBe(1);
    expect(cache(state, 'b')).toBe('v:b');
    expect(calls).toBe(2);

    const other = seededState(); // different reference ⇒ recompute
    expect(cache(other, 'a')).toBe('v:a');
    expect(calls).toBe(3);
  });

  it('returns the SAME result reference for the same (state, key)', () => {
    const cache = createKeyedCache<string[]>((_state, key) => [key]);
    const state = seededState();
    expect(cache(state, 'k')).toBe(cache(state, 'k'));
  });
});

describe('argsKey / filterKey', () => {
  it('argsKey joins parts unambiguously', () => {
    expect(argsKey('p1', D1)).toBe(`p1 ${D1}`);
    expect(argsKey(D1, '')).toBe(`${D1} `);
    expect(argsKey('a', 'b')).not.toBe(argsKey('b', 'a'));
  });

  it('filterKey treats undefined and an EMPTY set identically', () => {
    expect(filterKey(undefined)).toBe('');
    expect(filterKey(new Set())).toBe('');
    expect(filterKey(undefined)).toBe(filterKey(new Set()));
  });

  it('filterKey is order-independent and distinguishes different sets', () => {
    expect(filterKey(new Set(['p2', 'p1']))).toBe(filterKey(new Set(['p1', 'p2'])));
    expect(filterKey(new Set(['p1']))).not.toBe(filterKey(new Set(['p1', 'p2'])));
  });
});

// ---- Cached selectors: hit / miss / invariant 6 ----------------------------

describe('selector cache — hit on the same state reference', () => {
  it('returns the SAME result reference for repeat calls with identical args', () => {
    const state = seededState();
    expect(entriesForDate(state, D1)).toBe(entriesForDate(state, D1));
    expect(blocksForPersonDate(state, 'p1', D1)).toBe(blocksForPersonDate(state, 'p1', D1));
    expect(entriesForTask(state, 't1')).toBe(entriesForTask(state, 't1'));
    expect(entriesForTaskPerson(state, 't1', 'p1')).toBe(entriesForTaskPerson(state, 't1', 'p1'));
    expect(binEntriesForPerson(state, 'p1')).toBe(binEntriesForPerson(state, 'p1'));
    expect(assigneeIdsOfTask(state, 't1')).toBe(assigneeIdsOfTask(state, 't1'));
    expect(taskIdsOfPerson(state, 'p1')).toBe(taskIdsOfPerson(state, 'p1'));
    expect(doneStatusIds(state)).toBe(doneStatusIds(state));
    expect(todayAgendaForPerson(state, 'p1', D1)).toBe(todayAgendaForPerson(state, 'p1', D1));
    expect(unplannedTasksForPerson(state, 'p1')).toBe(unplannedTasksForPerson(state, 'p1'));
    // O(1) lookups hand back the row object itself.
    expect(getTask(state, 't1')).toBe(state.tasks[0]);
    expect(getPerson(state, 'p2')).toBe(state.people[1]);
  });

  it('distinguishes argsKey / filterKey variants', () => {
    const state = seededState();
    expect(entriesForDate(state, D1)).not.toBe(entriesForDate(state, D2));
    expect(blocksForPersonDate(state, 'p1', D1)).not.toBe(blocksForPersonDate(state, 'p2', D1));
    expect(entriesForDate(state, D1, new Set(['p1']))).not.toBe(entriesForDate(state, D1));
    // undefined ≡ empty Set ⇒ the SAME cache line, not just an equal value.
    expect(entriesForDate(state, D1, new Set())).toBe(entriesForDate(state, D1, undefined));
    // Set order does not change the key.
    expect(entriesForDate(state, D1, new Set(['p2', 'p1']))).toBe(
      entriesForDate(state, D1, new Set(['p1', 'p2'])),
    );
  });
});

describe('selector cache — miss across a real reducer revision', () => {
  it('a VALID command produces a new state and a recomputed result', () => {
    const state = seededState();
    const before = entriesForDate(state, D1);
    const beforeAgenda = todayAgendaForPerson(state, 'p1', D1);

    const next = reducer(state, { type: 'SET_BLOCK_DONE', entryId: 'w1', done: true });
    expect(next).not.toBe(state);

    const after = entriesForDate(next, D1);
    expect(after).not.toBe(before);
    expect(after.map((w) => w.id)).toEqual(before.map((w) => w.id)); // order preserved
    expect(after.find((w) => w.id === 'w1')?.done).toBe(true);
    expect(todayAgendaForPerson(next, 'p1', D1)).not.toBe(beforeAgenda);

    // The OLD state's cache line is untouched (states are independent).
    expect(entriesForDate(state, D1)).toBe(before);
    expect(entriesForDate(state, D1).find((w) => w.id === 'w1')?.done).toBeUndefined();
  });

  it('an unrelated action keeps collection-keyed indexes warm', () => {
    const state = seededState();
    const assignees = assigneeIdsOfTask(state, 't1');
    const taskEntries = entriesForTask(state, 't1');

    // Touches only the departments dictionary; workload/assignments are preserved.
    const next = reducer(state, { type: 'ADD_DEPARTMENT', name: 'Produkcja' });
    expect(next).not.toBe(state);
    expect(next.assignments).toBe(state.assignments);
    expect(next.workload).toBe(state.workload);
    expect(assigneeIdsOfTask(next, 't1')).toBe(assignees);
    expect(entriesForTask(next, 't1')).toBe(taskEntries);
  });

  it('invariant 6: an INVALID command returns the same state reference, so the cache still hits', () => {
    const state = seededState();
    const before = entriesForDate(state, D1);
    const beforeBin = binEntriesForPerson(state, 'p1');

    const unknownEntry = reducer(state, {
      type: 'SET_BLOCK_DONE',
      entryId: 'does-not-exist',
      done: true,
    });
    expect(unknownEntry).toBe(state);
    expect(entriesForDate(unknownEntry, D1)).toBe(before);

    const malformedMerge = reducer(state, {
      type: 'MERGE_CLOUD_ENTITIES',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed payload
      payload: { tasks: 'nope' } as any,
    });
    expect(malformedMerge).toBe(state);
    expect(entriesForDate(malformedMerge, D1)).toBe(before);
    expect(binEntriesForPerson(malformedMerge, 'p1')).toBe(beforeBin);
  });
});

// ---- Parity with the naive implementations --------------------------------

describe('cached selectors are byte-identical to the naive implementations', () => {
  const state = seededState();

  it('entriesForDate keeps the workload ARRAY order and the filter semantics', () => {
    const naive = (date: string, f?: Set<string>): WorkloadEntry[] =>
      state.workload.filter(
        (w) => w.date === date && (!f || f.size === 0 || f.has(w.personId)),
      );
    for (const date of [D1, D2, '', '2030-01-01']) {
      expect(entriesForDate(state, date)).toEqual(naive(date));
      expect(entriesForDate(state, date, new Set())).toEqual(naive(date, new Set()));
      expect(entriesForDate(state, date, new Set(['p1']))).toEqual(naive(date, new Set(['p1'])));
      expect(entriesForDate(state, date, new Set(['p1', 'p2']))).toEqual(
        naive(date, new Set(['p1', 'p2'])),
      );
    }
    // Element-for-element identity, not just deep equality.
    expect(entriesForDate(state, D1).map((w) => w.id)).toEqual(['w3', 'w1', 'w4', 'w2']);
  });

  it('dayTotal matches the naive sum', () => {
    const naive = (date: string, f?: Set<string>): number =>
      state.workload
        .filter((w) => w.date === date && (!f || f.size === 0 || f.has(w.personId)))
        .reduce((sum, w) => sum + w.plannedHours, 0);
    expect(dayTotal(state, D1)).toBe(naive(D1));
    expect(dayTotal(state, D1, new Set(['p1']))).toBe(naive(D1, new Set(['p1'])));
    expect(dayTotal(state, D2, new Set(['p2']))).toBe(naive(D2, new Set(['p2'])));
    expect(dayTotal(state, '2030-01-01')).toBe(0);
  });

  it('blocksForPersonDate / hoursForPersonOnDate match the naive filter+sort', () => {
    const naive = (personId: string, date: string): WorkloadEntry[] =>
      state.workload
        .filter((w) => w.personId === personId && w.date === date)
        .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(blocksForPersonDate(state, 'p1', D1).map((w) => w.id)).toEqual(
      naive('p1', D1).map((w) => w.id),
    );
    expect(blocksForPersonDate(state, 'p1', D1).map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(blocksForPersonDate(state, 'p2', D1)).toEqual(naive('p2', D1));
    expect(hoursForPersonOnDate(state, 'p1', D1)).toBe(6);
    expect(hoursForPersonOnDate(state, 'p9', D1)).toBe(0);
  });

  it('the shared index bucket is NOT reordered by a sorting selector', () => {
    // blocksForPersonDate sorts a COPY, so entriesForDate still sees array order.
    expect(blocksForPersonDate(state, 'p1', D1).map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(entriesForDate(state, D1).map((w) => w.id)).toEqual(['w3', 'w1', 'w4', 'w2']);
    expect(state.workload.map((w) => w.id)).toEqual(['w3', 'w1', 'w4', 'w2', 'w5', 'wb']);
  });

  it('bin / assignment / task selectors match their naive forms', () => {
    expect(binEntriesForPerson(state, 'p1').map((w) => w.id)).toEqual(['wb']);
    expect(binTotalForPerson(state, 'p1')).toBe(2);
    expect(binTotalForPerson(state, 'p2')).toBe(0);
    expect(assigneeIdsOfTask(state, 't1')).toEqual(['p1', 'p2']);
    expect(assigneeIdsOfTask(state, 'unknown')).toEqual([]);
    expect(taskIdsOfPerson(state, 'p1')).toEqual(['t1', 't2']);
    expect(entriesForTask(state, 't1').map((w) => w.id)).toEqual(['w1', 'w4', 'w2', 'w5']);
    expect(entriesForTaskPerson(state, 't1', 'p1').map((w) => w.id)).toEqual(['w1', 'w2', 'w5']);
  });

  it('doneStatusIds / getStatus follow the stored isDone flag', () => {
    expect(doneStatusIds(state)).toEqual(new Set(['status2']));
    expect(doneStatusIds({ ...state, statuses: [STATUS_OPEN] })).toEqual(new Set());
  });
});
