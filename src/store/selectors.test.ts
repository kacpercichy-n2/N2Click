// Unit tests for pure selectors (src/store/selectors.ts). Currently focused on
// the bin-exclusion regression in `conflictDatesForTask` (P1 fixed alongside
// PKG-20260708-bin-core: bin entries used to add `''`/BIN_DATE as a "conflict
// date", producing NaN offsets in TimelinePage). Follows the AppData-literal
// fixture style of blockActions.test.ts / storage.test.ts.
import { describe, expect, it } from 'vitest';
import { conflictDatesForTask } from './selectors';
import { emptyData } from './storage';
import { BIN_DATE } from '../utils/time';
import type { AppData, Person, Task, WorkloadEntry } from '../types';

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
    avatar: '',
    capacity: 8,
    isAdmin: false,
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
