// Unit tests for pure selectors (src/store/selectors.ts). Currently focused on
// the bin-exclusion regression in `conflictDatesForTask` (P1 fixed alongside
// PKG-20260708-bin-core: bin entries used to add `''`/BIN_DATE as a "conflict
// date", producing NaN offsets in TimelinePage). Follows the AppData-literal
// fixture style of blockActions.test.ts / storage.test.ts.
import { describe, expect, it } from 'vitest';
import {
  availableHoursInRange,
  availableHoursOnDate,
  binHoursForTaskPerson,
  binTaskRowsForPerson,
  conflictDatesForTask,
  conflictDatesForTaskPerson,
  dayAvailabilityForPerson,
  doneStatusIds,
  loadPercent,
  rangeAvailabilityForPerson,
  growAllowanceHours,
  hoursForTaskPersonOnDate,
  isDoneStatus,
  isPersonWorkday,
  isImpersonating,
  overdueTasksForPerson,
  overloadedDatesForPersonInRange,
  peopleWithBirthdayOnDate,
  planningStatusForTotals,
  realUser,
  realUserId,
  searchAll,
  taskDisplayStatus,
  taskGrowAllowance,
  taskPlanningStatus,
  todayAgendaForPerson,
  unplannedTasksForPerson,
  weekBlocksForPerson,
} from './selectors';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import { BIN_DATE } from '../utils/time';
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
    avatar: '',
    capacity: 8,
    phone: '',
    accessRole: 'pracownik',
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

// ---------------------------------------------------------------------------
// realUserId / realUser / isImpersonating — coverage added by
// PKG-20260708-b2-tests (implementation shipped by PKG-20260708-b2-impersonation).
// ---------------------------------------------------------------------------

describe('realUserId / realUser / isImpersonating (PKG-20260708-b2-tests)', () => {
  it('not impersonating: realUserId/realUser resolve to self, isImpersonating is false', () => {
    const p1 = makePerson({ id: 'p1', name: 'Ann' });
    const state = makeState({ people: [p1], currentUserId: 'p1', impersonatorId: '' });

    expect(realUserId(state)).toBe('p1');
    expect(realUser(state)?.id).toBe('p1');
    expect(isImpersonating(state)).toBe(false);
  });

  it('impersonating: realUserId/realUser resolve to the impersonator, isImpersonating is true', () => {
    const p1 = makePerson({ id: 'p1', name: 'Ann' });
    const p2 = makePerson({ id: 'p2', name: 'Bob' });
    const state = makeState({ people: [p1, p2], currentUserId: 'p2', impersonatorId: 'p1' });

    expect(realUserId(state)).toBe('p1');
    expect(realUser(state)?.id).toBe('p1');
    expect(isImpersonating(state)).toBe(true);
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

  it('dateless: an assigned task covering the date with NO entry that day appears; the same task WITH an entry that day does not', () => {
    const withoutEntry = makeTask({
      id: 't-no-entry',
      title: 'No entry today',
      startDate: '2026-07-06',
      endDate: '2026-07-10',
    });
    const withEntry = makeTask({
      id: 't-with-entry',
      title: 'Has entry today',
      startDate: '2026-07-06',
      endDate: '2026-07-10',
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
      endDate: '2026-07-10',
    });
    const done = makeTask({
      id: 't-done',
      statusId: doneId,
      startDate: '2026-07-06',
      endDate: '2026-07-10',
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

  it('dateless ordering: ascending endDate, ties broken by title', () => {
    const zebra = makeTask({ id: 't-zebra', title: 'Zebra', startDate: '2026-07-01', endDate: '2026-07-10' });
    const banana = makeTask({ id: 't-banana', title: 'Banana', startDate: '2026-07-01', endDate: '2026-07-10' });
    const apple = makeTask({ id: 't-apple', title: 'Apple', startDate: '2026-07-01', endDate: '2026-07-09' });
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
