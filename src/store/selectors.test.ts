// Unit tests for pure selectors (src/store/selectors.ts). Currently focused on
// the bin-exclusion regression in `conflictDatesForTask` (P1 fixed alongside
// PKG-20260708-bin-core: bin entries used to add `''`/BIN_DATE as a "conflict
// date", producing NaN offsets in TimelinePage). Follows the AppData-literal
// fixture style of blockActions.test.ts / storage.test.ts.
import { describe, expect, it } from 'vitest';
import {
  availableHoursInRange,
  availableHoursOnDate,
  conflictDatesForTask,
  growAllowanceHours,
  isPersonWorkday,
} from './selectors';
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
    phone: '',
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
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

// ---------------------------------------------------------------------------
// growAllowanceHours (PKG-20260708-budget-store)
// ---------------------------------------------------------------------------

describe('growAllowanceHours', () => {
  it('returns null when the task has no estimate (unlimited/free grow)', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', plannedHours: 2 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1],
    });

    expect(growAllowanceHours(state, 'e1')).toBeNull();
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
