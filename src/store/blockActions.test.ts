// Unit tests for the timed-block reducer actions (SET_BLOCK_TIME, INSERT_BLOCK).
// Pure reducer tests: no React rendering, no localStorage — build AppData
// fixtures by hand from emptyData() + literal tasks/people/workload rows.
import { describe, expect, it } from 'vitest';
import { reducer, type PersonDraft, type TaskDraft } from './AppStore';
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

describe('SET_BLOCK_TIME', () => {
  it('happy path same-day move: updates startMinutes, re-ranks sortIndex by time, appends one activity row', () => {
    const e1 = makeEntry({ id: 'e1', startMinutes: 480, sortIndex: 0 }); // 480-600
    const e2 = makeEntry({ id: 'e2', startMinutes: 600, sortIndex: 1 }); // 600-720
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, e2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 810, // on-grid (54 * 15), well past e2's 600-720 range
      plannedHours: 2,
    });

    expect(next).not.toBe(state);
    const nextE1 = next.workload.find((w) => w.id === 'e1')!;
    const nextE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(nextE1.startMinutes).toBe(810);
    // Time order flipped: e2 (600) now ranks before e1 (800).
    expect(nextE2.sortIndex).toBe(0);
    expect(nextE1.sortIndex).toBe(1);
    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('cross-day move: updates the date, keeps both days sortIndex contiguous, extends the task period', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', date: '2026-07-08', startMinutes: 600, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', startDate: '2026-07-06', endDate: '2026-07-08' })],
      workload: [e1, e2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-10',
      startMinutes: 540,
      plannedHours: 2,
    });

    const nextE1 = next.workload.find((w) => w.id === 'e1')!;
    const nextE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(nextE1.date).toBe('2026-07-10');
    // Source day now has only e2 left -> re-indexed to 0.
    expect(nextE2.sortIndex).toBe(0);
    // Destination day has only e1 -> indexed to 0.
    expect(nextE1.sortIndex).toBe(0);
    // Task period extends to cover the new date (start unchanged, end pushed out).
    const task = next.tasks.find((t) => t.id === 't1')!;
    expect(task.startDate).toBe('2026-07-06');
    expect(task.endDate).toBe('2026-07-10');
  });

  it('rejects a same-person time overlap, returning the same state', () => {
    const e1 = makeEntry({ id: 'e1', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const e2 = makeEntry({ id: 'e2', startMinutes: 700, plannedHours: 2, sortIndex: 1 }); // 700-820
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, e2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e2',
      date: '2026-07-08',
      startMinutes: 500, // 500-620 overlaps e1's 480-600
      plannedHours: 2,
    });

    expect(next).toBe(state);
  });

  it('rejects an off-grid startMinutes', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [makeEntry({ id: 'e1' })],
    });
    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 490,
      plannedHours: 2,
    });
    expect(next).toBe(state);
  });

  it('rejects hours that are not a multiple of 0.25', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [makeEntry({ id: 'e1' })],
    });
    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 1.3,
    });
    expect(next).toBe(state);
  });

  it('rejects a block that would run past 24:00', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [makeEntry({ id: 'e1' })],
    });
    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 1400,
      plannedHours: 2,
    });
    expect(next).toBe(state);
  });

  // PKG-20260709-bin-drop-freeze: a bin row wider than a day can never be
  // dropped — the reducer rejects plannedHours > 24 and returns the same state
  // ref. The BinCard UI now mirrors this (danger tint + Polish hint) so the
  // doomed drop reverts with feedback instead of silently snapping home.
  it('rejects dropping a > 24h bin row onto the grid (same state ref)', () => {
    const binRow = makeEntry({
      id: 'bigbin',
      taskId: 't1',
      personId: 'p1',
      date: BIN_DATE,
      startMinutes: 0,
      plannedHours: 30,
      sortIndex: 0,
    });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [binRow],
    });
    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'bigbin',
      date: '2026-07-08',
      startMinutes: 0,
      plannedHours: 30,
    });
    expect(next).toBe(state);
  });

  it('rejects an unknown entryId', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [makeEntry({ id: 'e1' })],
    });
    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'does-not-exist',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 2,
    });
    expect(next).toBe(state);
  });

  it('does NOT reject when another person occupies the same range', () => {
    const e1 = makeEntry({ id: 'e1', personId: 'p1', startMinutes: 300, plannedHours: 1, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', personId: 'p2', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, e2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480, // fully inside p2's 480-600 range — different person, allowed
      plannedHours: 1,
    });

    expect(next).not.toBe(state);
    const nextE1 = next.workload.find((w) => w.id === 'e1')!;
    expect(nextE1.startMinutes).toBe(480);
    const nextE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(nextE2.startMinutes).toBe(480);
  });
});

describe('INSERT_BLOCK', () => {
  it('"przed" (before): places the new block at the ref start and pushes the ref later', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      // t2 carries an estimate with headroom so the insert draws from budget
      // rather than being rejected by the no-mint rule (PKG-20260708-b2).
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })],
      workload: [ref],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'before', taskId: 't2', hours: 1 },
    });

    expect(next.workload).toHaveLength(2);
    const inserted = next.workload.find((w) => w.taskId === 't2')!;
    const pushedRef = next.workload.find((w) => w.id === 'ref1')!;
    expect(inserted.startMinutes).toBe(480);
    expect(inserted.personId).toBe('p1');
    expect(inserted.date).toBe('2026-07-08');
    expect(pushedRef.startMinutes).toBe(540); // pushed past the new 1h block
  });

  it('"po" (after): places the new block at the ref end', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      // t2 carries an estimate with headroom so the insert draws from budget.
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })],
      workload: [ref],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 1 },
    });

    const inserted = next.workload.find((w) => w.taskId === 't2')!;
    const untouchedRef = next.workload.find((w) => w.id === 'ref1')!;
    expect(inserted.startMinutes).toBe(600); // ref's end (480 + 2h)
    expect(untouchedRef.startMinutes).toBe(480); // unchanged
  });

  it('a later block separated by a large gap does not move', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const far = makeEntry({ id: 'far1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 900, plannedHours: 1, sortIndex: 1 }); // 900-960
    const state = makeState({
      // t2 carries an estimate with headroom so the insert draws from budget.
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })],
      workload: [ref, far],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 1 }, // inserted 600-660
    });

    const farAfter = next.workload.find((w) => w.id === 'far1')!;
    expect(farAfter.startMinutes).toBe(900); // untouched — the gap absorbs the insert
  });

  it("leaves other people's entries untouched", () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const other = makeEntry({ id: 'other1', taskId: 't1', personId: 'p2', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      // t2 carries an estimate with headroom so the insert draws from budget.
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })],
      workload: [ref, other],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'before', taskId: 't2', hours: 1 },
    });

    const otherAfter = next.workload.find((w) => w.id === 'other1')!;
    expect(otherAfter).toEqual(other);
  });

  it("auto-assigns the new entry's person to the task if not already assigned", () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      // t2 carries an estimate with headroom so the insert draws from budget.
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })],
      workload: [ref],
      assignments: [],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'before', taskId: 't2', hours: 1 },
    });

    expect(
      next.assignments.some((a) => a.taskId === 't2' && a.personId === 'p1'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bin ("zasobnik") behavior added by PKG-20260708-bin-core.
// ---------------------------------------------------------------------------

describe('MOVE_BLOCK_TO_BIN', () => {
  it('moves a dated entry into the bin, reindexes the vacated day, and appends after an existing bin entry', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', date: '2026-07-08', startMinutes: 600, plannedHours: 2, sortIndex: 1 });
    // Different task (t2) so the one-bin-row invariant doesn't merge e1 into it.
    const existingBin = makeEntry({ id: 'bin0', taskId: 't2', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      workload: [e1, e2, existingBin],
    });

    const next = reducer(state, { type: 'MOVE_BLOCK_TO_BIN', entryId: 'e1' });

    const movedE1 = next.workload.find((w) => w.id === 'e1')!;
    expect(movedE1.date).toBe(BIN_DATE);
    expect(movedE1.startMinutes).toBe(0);
    expect(movedE1.sortIndex).toBe(1); // appended after existingBin (sortIndex 0)

    const remainingE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(remainingE2.date).toBe('2026-07-08');
    expect(remainingE2.sortIndex).toBe(0); // vacated day reindexed contiguous 0..n

    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('folds into an existing SAME-TASK bin row when one already exists (existing row id survives, moved entry gone)', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const existingBin = makeEntry({ id: 'existingBin', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1, existingBin] });

    const next = reducer(state, { type: 'MOVE_BLOCK_TO_BIN', entryId: 'e1' });

    expect(next.workload.find((w) => w.id === 'e1')).toBeUndefined(); // moved entry dropped
    const bin = next.workload.find((w) => w.taskId === 't1' && w.personId === 'p1')!;
    expect(bin.id).toBe('existingBin'); // existing row's id survives
    expect(bin.plannedHours).toBe(5); // 3h existing + 2h moved
    expect(next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1')).toHaveLength(1);
  });

  it('no-ops on an already-bin entry (same state reference)', () => {
    const bin1 = makeEntry({ id: 'bin1', date: BIN_DATE, startMinutes: 0, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [bin1] });
    expect(reducer(state, { type: 'MOVE_BLOCK_TO_BIN', entryId: 'bin1' })).toBe(state);
  });

  it('no-ops on an unknown entryId', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [] });
    expect(reducer(state, { type: 'MOVE_BLOCK_TO_BIN', entryId: 'nope' })).toBe(state);
  });
});

describe('SPLIT_BLOCK', () => {
  it('halves an even 6h dated block: original keeps date/startMinutes/sortIndex at 3h, one 3h bin entry created', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 6, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 2 });

    const original = next.workload.find((w) => w.id === 'e1')!;
    expect(original.date).toBe('2026-07-08');
    expect(original.startMinutes).toBe(480);
    expect(original.sortIndex).toBe(0);
    expect(original.plannedHours).toBe(3);

    const binEntries = next.workload.filter((w) => w.id !== 'e1');
    expect(binEntries).toHaveLength(1);
    expect(binEntries[0].date).toBe(BIN_DATE);
    expect(binEntries[0].plannedHours).toBe(3);
  });

  it('halves an odd-quarter 1.25h block: larger half (0.75h) stays, smaller half (0.5h) goes to the bin', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 1.25, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 2 });

    const original = next.workload.find((w) => w.id === 'e1')!;
    expect(original.plannedHours).toBe(0.75);
    const binEntry = next.workload.find((w) => w.id !== 'e1')!;
    expect(binEntry.date).toBe(BIN_DATE);
    expect(binEntry.plannedHours).toBe(0.5);
  });

  it('quarters a 1.25h block: original 0.5h stays, the three split-off parts collapse into ONE 0.75h bin row', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 1.25, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 4 });

    const original = next.workload.find((w) => w.id === 'e1')!;
    expect(original.plannedHours).toBe(0.5);

    // One-bin-row invariant: the 3 × 0.25h parts merge into a single bin entry.
    const binEntries = next.workload.filter((w) => w.id !== 'e1');
    expect(binEntries).toHaveLength(1);
    expect(binEntries[0].date).toBe(BIN_DATE);
    expect(binEntries[0].plannedHours).toBe(0.75);
    expect(binEntries[0].sortIndex).toBe(0);
  });

  it('quarters a block and merges the split-off parts into a PRE-EXISTING (task, person) bin row (one-bin-row invariant across writers)', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 4, sortIndex: 0 });
    const existingBin = makeEntry({ id: 'existingBin', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1, existingBin] });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 4 });

    const original = next.workload.find((w) => w.id === 'e1')!;
    expect(original.plannedHours).toBe(1); // 4h/4 = 1h stays scheduled

    // The 3 split-off quarters (3h total) merge into the EXISTING row — no second row.
    const binRows = next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1' && w.id !== 'e1');
    expect(binRows).toHaveLength(1);
    expect(binRows[0].id).toBe('existingBin');
    expect(binRows[0].plannedHours).toBe(4); // 1h existing + 3h split-off
  });

  it('no-ops on a bin entry (same state reference): splitting would create a second same-pair bin row', () => {
    const e0 = makeEntry({ id: 'e0', taskId: 't2', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const target = makeEntry({ id: 'target', taskId: 't1', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      workload: [e0, target],
    });

    // Under the one-bin-row invariant, splitting a bin block into two bin rows is
    // illegal, so SPLIT_BLOCK rejects a bin entry (returns the same state).
    expect(reducer(state, { type: 'SPLIT_BLOCK', entryId: 'target', parts: 2 })).toBe(state);
  });

  it('rejects when the block is too small for the requested parts, and rejects an unknown id', () => {
    const tooSmallHalf = makeEntry({ id: 'e1', plannedHours: 0.25, sortIndex: 0 });
    const state1 = makeState({ tasks: [makeTask({ id: 't1' })], workload: [tooSmallHalf] });
    expect(reducer(state1, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 2 })).toBe(state1);

    const tooSmallQuarter = makeEntry({ id: 'e2', plannedHours: 0.75, sortIndex: 0 });
    const state2 = makeState({ tasks: [makeTask({ id: 't1' })], workload: [tooSmallQuarter] });
    expect(reducer(state2, { type: 'SPLIT_BLOCK', entryId: 'e2', parts: 4 })).toBe(state2);

    const state3 = makeState({ tasks: [makeTask({ id: 't1' })], workload: [] });
    expect(reducer(state3, { type: 'SPLIT_BLOCK', entryId: 'nope', parts: 2 })).toBe(state3);
  });
});

describe('DELETE_BLOCK', () => {
  it("removes a bin entry and reindexes the person's remaining bin entries", () => {
    const bin0 = makeEntry({ id: 'bin0', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const bin1 = makeEntry({ id: 'bin1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 1 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [bin0, bin1] });

    const next = reducer(state, { type: 'DELETE_BLOCK', entryId: 'bin0' });

    expect(next.workload.find((w) => w.id === 'bin0')).toBeUndefined();
    const remaining = next.workload.find((w) => w.id === 'bin1')!;
    expect(remaining.sortIndex).toBe(0);
    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('rejects a dated entry (same state reference)', () => {
    const dated = makeEntry({ id: 'e1', date: '2026-07-08' });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [dated] });
    expect(reducer(state, { type: 'DELETE_BLOCK', entryId: 'e1' })).toBe(state);
  });

  it('rejects an unknown entryId', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [] });
    expect(reducer(state, { type: 'DELETE_BLOCK', entryId: 'nope' })).toBe(state);
  });
});

describe('SET_BLOCK_TIME (bin behavior)', () => {
  it('shrink-to-bin: resizing 8h to 6h keeps the entry in place and returns 2h to the bin', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 8, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 6,
    });

    const resized = next.workload.find((w) => w.id === 'e1')!;
    expect(resized.plannedHours).toBe(6);
    expect(resized.date).toBe('2026-07-08');

    const binEntry = next.workload.find((w) => w.id !== 'e1')!;
    expect(binEntry.date).toBe(BIN_DATE);
    expect(binEntry.plannedHours).toBe(2);
    expect(binEntry.taskId).toBe(e1.taskId);
    expect(binEntry.personId).toBe(e1.personId);

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).toContain('wróciło do zasobnika');
  });

  it('plain move (same hours, new time/day) creates no bin entry', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 4, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-07',
      startMinutes: 600,
      plannedHours: 4,
    });

    expect(next.workload).toHaveLength(1);
    expect(next.workload.some((w) => w.date === BIN_DATE)).toBe(false);
  });

  it('bin→grid: dropping a bin entry onto a date/time assigns it, extends the task period, and reindexes both groups', () => {
    const binA = makeEntry({ id: 'binA', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const binB = makeEntry({ id: 'binB', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', startDate: '2026-07-06', endDate: '2026-07-08' })],
      workload: [binA, binB],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'binA',
      date: '2026-07-10',
      startMinutes: 480,
      plannedHours: 2,
    });

    const dropped = next.workload.find((w) => w.id === 'binA')!;
    expect(dropped.date).toBe('2026-07-10');
    expect(dropped.startMinutes).toBe(480);

    const remainingBin = next.workload.find((w) => w.id === 'binB')!;
    expect(remainingBin.date).toBe(BIN_DATE);
    expect(remainingBin.sortIndex).toBe(0); // bin reindexed after binA left

    const task = next.tasks.find((t) => t.id === 't1')!;
    expect(task.endDate).toBe('2026-07-10');

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).toContain('z zasobnika');
  });

  it("bin→grid drop that collides with the same person's existing block is rejected", () => {
    const binA = makeEntry({ id: 'binA', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const existing = makeEntry({ id: 'existing', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [binA, existing],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'binA',
      date: '2026-07-08',
      startMinutes: 500, // 500-620 overlaps existing's 480-600
      plannedHours: 2,
    });

    expect(next).toBe(state);
  });
});

describe('SAVE_TASK bin behavior', () => {
  function draftFor(task: Task): TaskDraft {
    return {
      projectId: task.projectId,
      statusId: task.statusId,
      title: task.title,
      description: task.description,
      startDate: task.startDate,
      endDate: task.endDate,
      estimatedHours: task.estimatedHours,
    };
  }

  it('preserves an existing bin entry for a still-assigned person, drops it for an unassigned person', () => {
    const task = makeTask({ id: 't1' });
    const binP1 = makeEntry({ id: 'binP1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const binP2 = makeEntry({ id: 'binP2', taskId: 't1', personId: 'p2', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 0 });
    const state = makeState({
      tasks: [task],
      assignments: [
        { id: 'a1', taskId: 't1', personId: 'p1' },
        { id: 'a2', taskId: 't1', personId: 'p2' },
      ],
      workload: [binP1, binP2],
    });

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFor(task),
        assigneeIds: ['p1'], // p2 unassigned
        allocations: [],
      },
    });

    const keptBin = next.workload.find((w) => w.id === 'binP1');
    expect(keptBin).toBeDefined();
    expect(keptBin!.plannedHours).toBe(3);
    expect(next.workload.find((w) => w.id === 'binP2')).toBeUndefined();
  });

  it('newUnassigned: merges a person\'s items into ONE bin row, snaps off-grid hours, skips <=0 hours and unassigned people', () => {
    const task = makeTask({ id: 't1' });
    const state = makeState({
      tasks: [task],
      assignments: [{ id: 'a1', taskId: 't1', personId: 'p1' }],
      workload: [],
    });

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFor(task),
        assigneeIds: ['p1'],
        allocations: [],
        newUnassigned: [
          { personId: 'p1', hours: 10 },
          { personId: 'p1', hours: 1.3 }, // off-grid -> snaps to 1.25
          { personId: 'p1', hours: 0 }, // skipped
          { personId: 'p2', hours: 5 }, // p2 not in assigneeIds -> skipped
        ],
      },
    });

    // One-bin-row invariant: 10h + 1.25h merge into a single 11.25h bin row.
    const p1Bin = next.workload.filter((w) => w.personId === 'p1' && w.date === BIN_DATE);
    expect(p1Bin).toHaveLength(1);
    expect(p1Bin[0].plannedHours).toBe(11.25);
    expect(p1Bin[0].sortIndex).toBe(0);

    expect(next.workload.some((w) => w.personId === 'p2')).toBe(false);
  });
});

describe('MOVE_TASK bin behavior', () => {
  it('shifts dated entries but leaves bin entries untouched', () => {
    const dated = makeEntry({ id: 'e1', taskId: 't1', date: '2026-07-07', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', startDate: '2026-07-06', endDate: '2026-07-08' })],
      workload: [dated, bin],
    });

    const next = reducer(state, { type: 'MOVE_TASK', taskId: 't1', dayDelta: 2 });

    const movedDated = next.workload.find((w) => w.id === 'e1')!;
    expect(movedDated.date).toBe('2026-07-09');

    const untouchedBin = next.workload.find((w) => w.id === 'bin1')!;
    expect(untouchedBin).toEqual(bin);
  });
});

describe('SET_TASK_DATES bin behavior', () => {
  it('drops out-of-period dated entries but keeps the bin entry', () => {
    const inPeriod = makeEntry({ id: 'e1', taskId: 't1', date: '2026-07-07', sortIndex: 0 });
    const outOfPeriod = makeEntry({ id: 'e2', taskId: 't1', date: '2026-07-08', sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', startDate: '2026-07-06', endDate: '2026-07-08' })],
      workload: [inPeriod, outOfPeriod, bin],
    });

    const next = reducer(state, {
      type: 'SET_TASK_DATES',
      taskId: 't1',
      startDate: '2026-07-06',
      endDate: '2026-07-07', // shrinks the period, dropping 07-08
    });

    expect(next.workload.find((w) => w.id === 'e2')).toBeUndefined();
    expect(next.workload.find((w) => w.id === 'e1')).toBeDefined();
    expect(next.workload.find((w) => w.id === 'bin1')).toBeDefined();
  });
});

describe('INSERT_BLOCK bin behavior', () => {
  it('rejects when the ref entry is a bin entry', () => {
    const bin = makeEntry({ id: 'bin1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      workload: [bin],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'bin1', position: 'before', taskId: 't2', hours: 1 },
    });

    expect(next).toBe(state);
  });
});

describe('REASSIGN_ENTRY bin behavior', () => {
  it("moving a bin entry onto a person who already has a same-task bin row merges into it (one-bin-row invariant)", () => {
    const bin1 = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const targetExistingBin = makeEntry({ id: 'binT', taskId: 't1', personId: 'p2', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      assignments: [
        { id: 'a1', taskId: 't1', personId: 'p1' },
        { id: 'a2', taskId: 't1', personId: 'p2' },
      ],
      workload: [bin1, targetExistingBin],
    });

    const next = reducer(state, { type: 'REASSIGN_ENTRY', entryId: 'bin1', toPersonId: 'p2' });

    // The moved entry is folded into the target's existing row (its id survives).
    expect(next.workload.find((w) => w.id === 'bin1')).toBeUndefined();
    const targetBin = next.workload.find((w) => w.id === 'binT')!;
    expect(targetBin.personId).toBe('p2');
    expect(targetBin.plannedHours).toBe(3); // 1h + 2h
    expect(targetBin.date).toBe(BIN_DATE);
    expect(targetBin.startMinutes).toBe(0);
    expect(targetBin.sortIndex).toBe(0);
    // No second bin row survives for (t1, p2).
    expect(next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p2')).toHaveLength(1);
  });

  it("appends to an empty target bin at sortIndex 0 and doesn't duplicate the task assignment when already assigned", () => {
    const bin1 = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      people: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      assignments: [
        { id: 'a1', taskId: 't1', personId: 'p1' },
        { id: 'a2', taskId: 't1', personId: 'p2' },
      ],
      workload: [bin1],
    });

    const next = reducer(state, { type: 'REASSIGN_ENTRY', entryId: 'bin1', toPersonId: 'p2' });

    const moved = next.workload.find((w) => w.id === 'bin1')!;
    expect(moved.personId).toBe('p2');
    expect(moved.sortIndex).toBe(0);
    expect(
      next.assignments.filter((a) => a.taskId === 't1' && a.personId === 'p2'),
    ).toHaveLength(1); // no duplicate assignment added
  });
});

// ---------------------------------------------------------------------------
// SET_BLOCK_TIME hour-budget + bin conservation + adjacent-block merge added
// by PKG-20260708-budget-store.
// ---------------------------------------------------------------------------

describe('SET_BLOCK_TIME budget-capped grow', () => {
  it('rejects (same state reference) any positive grow delta once the task total already equals the estimate and the person has no same-task bin hours', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 10, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 })],
      workload: [e1],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 10.5,
    });

    expect(next).toBe(state);
  });

  it('grow by 2h with a 1.5h same-task bin row and headroom succeeds: bin drained to 0 (row deleted), remaining 0.5h drawn from headroom, task total rises by exactly 0.5h', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 1.5, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 })],
      workload: [e1, bin],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 4, // +2h
    });

    const grown = next.workload.find((w) => w.id === 'e1')!;
    expect(grown.plannedHours).toBe(4);
    expect(next.workload.find((w) => w.id === 'bin1')).toBeUndefined(); // drained bin row deleted

    const taskTotal = next.workload
      .filter((w) => w.taskId === 't1')
      .reduce((s, w) => s + w.plannedHours, 0);
    expect(taskTotal).toBe(4); // was 3.5h (2 + 1.5 bin), rose by exactly 0.5h, never past the 10h estimate

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).toContain('pobrano z zasobnika');
  });

  it('grow by 1h with a 4h same-task bin row draws purely from the bin: row reduced to 3h, task total unchanged', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 })],
      workload: [e1, bin],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 3, // +1h
    });

    const grown = next.workload.find((w) => w.id === 'e1')!;
    expect(grown.plannedHours).toBe(3);
    const shrunkBin = next.workload.find((w) => w.id === 'bin1')!;
    expect(shrunkBin.plannedHours).toBe(3); // 4h - 1h taken

    const taskTotal = next.workload
      .filter((w) => w.taskId === 't1')
      .reduce((s, w) => s + w.plannedHours, 0);
    expect(taskTotal).toBe(6); // unchanged (2+4 before, 3+3 after) — pure bin draw
  });

  it('estimatedHours: null grow is capped at the same-task bin hours (no free minting): succeeds up to the bin (drained) and is rejected past it', () => {
    // New contract (PKG-20260708-b2): null-estimate tasks lose unlimited
    // drag-grow. Allowance = same-task bin hours (0 headroom). e1=2h + bin=3h
    // ⇒ e1 may grow by at most 3h, draining the bin row to 0.
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, bin],
    });

    // Grow by exactly the 3h bin allowance: succeeds, bin drained (row deleted),
    // task total unchanged (pure bin draw).
    const ok = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 5, // +3h == bin hours
    });
    expect(ok).not.toBe(state);
    expect(ok.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(5);
    expect(ok.workload.find((w) => w.id === 'bin1')).toBeUndefined(); // drained row deleted
    const okTotal = ok.workload
      .filter((w) => w.taskId === 't1')
      .reduce((s, w) => s + w.plannedHours, 0);
    expect(okTotal).toBe(5); // was 5 (2 + 3 bin) — pure bin draw, nothing minted

    // Grow past the bin allowance (+3.25h): rejected, same state reference.
    const rejected = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 5.25, // +3.25h > 3h bin, no headroom
    });
    expect(rejected).toBe(state);
  });

  it('grow draws ONLY from headroom and the SAME (task,person) bin row — another person\'s bin row and another task\'s bin row are never consumed', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const otherPersonBin = makeEntry({ id: 'binOtherPerson', taskId: 't1', personId: 'p2', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 0 });
    const otherTaskBin = makeEntry({ id: 'binOtherTask', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 5, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 10 }), makeTask({ id: 't2', estimatedHours: null })],
      workload: [e1, otherPersonBin, otherTaskBin],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 5, // +3h, drawn purely from headroom (10 - (2+3) = 5h available)
    });

    expect(next).not.toBe(state);
    expect(next.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(5);
    expect(next.workload.find((w) => w.id === 'binOtherPerson')!.plannedHours).toBe(3); // untouched
    expect(next.workload.find((w) => w.id === 'binOtherTask')!.plannedHours).toBe(5); // untouched

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).not.toContain('pobrano z zasobnika'); // nothing was taken from any bin
  });

  it('a move-only drag (hours unchanged) is never budget-rejected, even when the task budget allowance is zero', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 5, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 5 })], // fully consumed already; headroom = 0, no bin
      workload: [e1],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-09',
      startMinutes: 600,
      plannedHours: 5, // same hours -> move only
    });

    expect(next).not.toBe(state);
    const moved = next.workload.find((w) => w.id === 'e1')!;
    expect(moved.date).toBe('2026-07-09');
    expect(moved.startMinutes).toBe(600);
    expect(moved.plannedHours).toBe(5);
  });
});

describe('SET_BLOCK_TIME shrink → bin merge', () => {
  it('merges the freed delta into an EXISTING (task, person) bin row instead of appending a second row', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 6, sortIndex: 0 });
    const existingBin = makeEntry({ id: 'existingBin', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, existingBin],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 4, // -2h
    });

    const shrunk = next.workload.find((w) => w.id === 'e1')!;
    expect(shrunk.plannedHours).toBe(4);

    const binRows = next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1' && w.id !== 'e1');
    expect(binRows).toHaveLength(1);
    expect(binRows[0].id).toBe('existingBin'); // existing row's id survives
    expect(binRows[0].plannedHours).toBe(3); // 1h existing + 2h freed
  });
});

describe('SET_BLOCK_TIME adjacent-block merge', () => {
  it('a drop landing EXACTLY at a same-task same-person block\'s end merges into ONE entry: earlier block keeps its id, hours summed, sortIndex contiguous', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const e2 = makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 100, plannedHours: 1, sortIndex: 1 }); // elsewhere
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, e2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e2',
      date: '2026-07-08',
      startMinutes: 600, // exactly touches e1's end — move only, hours unchanged
      plannedHours: 1,
    });

    expect(next.workload).toHaveLength(1);
    const survivor = next.workload[0];
    expect(survivor.id).toBe('e1'); // earlier startMinutes (480) keeps its id
    expect(survivor.startMinutes).toBe(480);
    expect(survivor.plannedHours).toBe(3); // 2h + 1h summed
    expect(survivor.sortIndex).toBe(0);

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).toContain('połączono sąsiednie bloki');
  });

  it('cascade: A|B|C all become exactly touching in one drop -> a single merged entry', () => {
    const a = makeEntry({ id: 'a', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const c = makeEntry({ id: 'c', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 660, plannedHours: 1, sortIndex: 1 }); // 660-720
    const b = makeEntry({ id: 'b', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 100, plannedHours: 1, sortIndex: 2 }); // elsewhere, 1h
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [a, c, b],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'b',
      date: '2026-07-08',
      startMinutes: 600, // 600-660: touches a's end (600) AND c's start (660)
      plannedHours: 1,
    });

    expect(next.workload).toHaveLength(1);
    const survivor = next.workload[0];
    expect(survivor.id).toBe('a'); // earliest startMinutes across the whole cascade
    expect(survivor.startMinutes).toBe(480);
    expect(survivor.plannedHours).toBe(4); // 2h + 1h + 1h
    expect(survivor.sortIndex).toBe(0);

    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).toContain('połączono sąsiednie bloki');
  });

  it('does NOT merge across different tasks even when exactly touching', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const eb = makeEntry({ id: 'eb', taskId: 't2', personId: 'p1', date: '2026-07-08', startMinutes: 100, plannedHours: 1, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      workload: [e1, eb],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'eb',
      date: '2026-07-08',
      startMinutes: 600, // touches e1's end, but different task
      plannedHours: 1,
    });

    expect(next.workload).toHaveLength(2);
    expect(next.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(2);
    expect(next.workload.find((w) => w.id === 'eb')!.startMinutes).toBe(600);
    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).not.toContain('połączono sąsiednie bloki');
  });

  it('does NOT merge across different people even when exactly touching', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const ep2 = makeEntry({ id: 'ep2', taskId: 't1', personId: 'p2', date: '2026-07-08', startMinutes: 100, plannedHours: 1, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, ep2],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'ep2',
      date: '2026-07-08',
      startMinutes: 600, // touches e1's end, but different person
      plannedHours: 1,
    });

    expect(next.workload).toHaveLength(2);
    expect(next.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(2);
    expect(next.workload.find((w) => w.id === 'ep2')!.startMinutes).toBe(600);
  });

  it('does NOT merge a same-task same-person block separated by a 15-minute gap', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 }); // 480-600
    const eb = makeEntry({ id: 'eb', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 100, plannedHours: 1, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      workload: [e1, eb],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'eb',
      date: '2026-07-08',
      startMinutes: 615, // 600 + 15min gap — NOT touching
      plannedHours: 1,
    });

    expect(next.workload).toHaveLength(2);
    expect(next.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(2);
    expect(next.workload.find((w) => w.id === 'eb')!.startMinutes).toBe(615);
    const activityMsg = next.activity[next.activity.length - 1].message;
    expect(activityMsg).not.toContain('połączono sąsiednie bloki');
  });
});

// ---------------------------------------------------------------------------
// Supervisor cycle guard + password/logout actions added by PKG-20260708-auth-data.
// ---------------------------------------------------------------------------

function draftFromPerson(p: Person, overrides: Partial<PersonDraft> = {}): PersonDraft {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    role: p.role,
    departmentId: p.departmentId,
    avatar: p.avatar,
    capacity: p.capacity,
    accessRole: p.accessRole,
    workDays: p.workDays,
    workStartMinutes: p.workStartMinutes,
    workEndMinutes: p.workEndMinutes,
    supervisorId: p.supervisorId,
    ...overrides,
  };
}

describe('UPDATE_PERSON supervisor cycle guard', () => {
  it('self-supervision is dropped to \'\'', () => {
    const p1 = makePerson({ id: 'p1', supervisorId: '' });
    const state = makeState({ people: [p1] });

    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: draftFromPerson(p1, { supervisorId: 'p1' }),
    });

    expect(next.people.find((p) => p.id === 'p1')!.supervisorId).toBe('');
  });

  it('a 2-hop cycle (A -> B -> A) is dropped to \'\'', () => {
    // p2 already reports to p1; setting p1's supervisor to p2 would close the loop.
    const p1 = makePerson({ id: 'p1', supervisorId: '' });
    const p2 = makePerson({ id: 'p2', supervisorId: 'p1' });
    const state = makeState({ people: [p1, p2] });

    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: draftFromPerson(p1, { supervisorId: 'p2' }),
    });

    expect(next.people.find((p) => p.id === 'p1')!.supervisorId).toBe('');
    // The pre-existing (unrelated) edge is untouched.
    expect(next.people.find((p) => p.id === 'p2')!.supervisorId).toBe('p1');
  });

  it('a valid (acyclic) chain is stored as given', () => {
    const p1 = makePerson({ id: 'p1', supervisorId: '' });
    const p2 = makePerson({ id: 'p2', supervisorId: 'p1' });
    const p3 = makePerson({ id: 'p3', supervisorId: '' });
    const state = makeState({ people: [p1, p2, p3] });

    // p3 -> p2 -> p1 -> '' : acyclic.
    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p3',
      person: draftFromPerson(p3, { supervisorId: 'p2' }),
    });

    expect(next.people.find((p) => p.id === 'p3')!.supervisorId).toBe('p2');
  });
});

describe('SET_PASSWORD / LOGOUT', () => {
  it('SET_PASSWORD updates only the hash, leaving every other field untouched', () => {
    const p1 = makePerson({ id: 'p1', passwordHash: '' });
    const state = makeState({ people: [p1] });

    const next = reducer(state, { type: 'SET_PASSWORD', personId: 'p1', passwordHash: 'abc123' });

    const updated = next.people.find((p) => p.id === 'p1')!;
    expect(updated.passwordHash).toBe('abc123');
    expect({ ...updated, passwordHash: '' }).toEqual({ ...p1, passwordHash: '' });
  });

  it('UPDATE_PERSON never clobbers a previously-stored password hash (the draft has no passwordHash field)', () => {
    const p1 = makePerson({ id: 'p1', passwordHash: 'existinghash' });
    const state = makeState({ people: [p1] });

    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: draftFromPerson(p1, { role: 'Nowa rola' }),
    });

    const updated = next.people.find((p) => p.id === 'p1')!;
    expect(updated.passwordHash).toBe('existinghash');
    expect(updated.role).toBe('Nowa rola');
  });

  it('LOGOUT clears currentUserId', () => {
    const state = makeState({ currentUserId: 'p1' });
    const next = reducer(state, { type: 'LOGOUT' });
    expect(next.currentUserId).toBe('');
  });
});

describe('ADD_PERSON fresh-setup admin guard', () => {
  it('forces the FIRST person into an empty people list to administrator, even when the draft asks for pracownik', () => {
    const state = makeState({ people: [] });

    const next = reducer(state, {
      type: 'ADD_PERSON',
      person: draftFromPerson(makePerson({ id: 'ignored', accessRole: 'pracownik' })),
    });

    expect(next.people).toHaveLength(1);
    expect(next.people[0].accessRole).toBe('administrator');
  });

  it('respects the draft role for subsequent people (list is non-empty)', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const state = makeState({ people: [admin] });

    const next = reducer(state, {
      type: 'ADD_PERSON',
      person: draftFromPerson(makePerson({ id: 'ignored', accessRole: 'pracownik' })),
    });

    expect(next.people).toHaveLength(2);
    expect(next.people[1].accessRole).toBe('pracownik');
  });
});

describe('UPDATE_PERSON last-admin demote guard', () => {
  it('rejects demoting the ONLY administrator (returns state unchanged, same ref)', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const state = makeState({ people: [admin, staff] });

    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: draftFromPerson(admin, { accessRole: 'pm' }),
    });

    expect(next).toBe(state);
  });

  it('allows demoting an administrator when another administrator remains', () => {
    const a1 = makePerson({ id: 'p1', accessRole: 'administrator' });
    const a2 = makePerson({ id: 'p2', accessRole: 'administrator' });
    const state = makeState({ people: [a1, a2] });

    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: draftFromPerson(a1, { accessRole: 'pm' }),
    });

    expect(next).not.toBe(state);
    expect(next.people.find((p) => p.id === 'p1')!.accessRole).toBe('pm');
    expect(next.people.find((p) => p.id === 'p2')!.accessRole).toBe('administrator');
  });
});

describe('DELETE_PERSON last-admin + supervisor cascade', () => {
  it('rejects deleting the ONLY administrator (returns state unchanged, same ref)', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const state = makeState({ people: [admin, staff] });

    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'p1' });

    expect(next).toBe(state);
  });

  it('allows deleting an administrator when another administrator remains', () => {
    const a1 = makePerson({ id: 'p1', accessRole: 'administrator' });
    const a2 = makePerson({ id: 'p2', accessRole: 'administrator' });
    const state = makeState({ people: [a1, a2] });

    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'p1' });

    expect(next.people.map((p) => p.id)).toEqual(['p2']);
  });

  it('clears dangling supervisorId on remaining people when their supervisor is deleted', () => {
    const boss = makePerson({ id: 'p1', accessRole: 'administrator' });
    const admin2 = makePerson({ id: 'p0', accessRole: 'administrator' });
    const sub1 = makePerson({ id: 'p2', accessRole: 'pracownik', supervisorId: 'p1' });
    const sub2 = makePerson({ id: 'p3', accessRole: 'pracownik', supervisorId: 'p1' });
    const other = makePerson({ id: 'p4', accessRole: 'pracownik', supervisorId: 'p0' });
    const state = makeState({ people: [admin2, boss, sub1, sub2, other] });

    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'p1' });

    expect(next.people.find((p) => p.id === 'p1')).toBeUndefined();
    expect(next.people.find((p) => p.id === 'p2')!.supervisorId).toBe('');
    expect(next.people.find((p) => p.id === 'p3')!.supervisorId).toBe('');
    // An unrelated supervisorId is left intact.
    expect(next.people.find((p) => p.id === 'p4')!.supervisorId).toBe('p0');
  });
});

// ---------------------------------------------------------------------------
// SET_BLOCK_TIME grow, unbudgeted (estimatedHours: null) tasks — coverage
// added by PKG-20260708-b2-tests (implementation shipped by
// PKG-20260708-b2-budget-store). Budgeted-task grow paths already have
// dedicated regression tests above; these focus on the null-estimate contract.
// ---------------------------------------------------------------------------

describe('SET_BLOCK_TIME grow — unbudgeted (estimatedHours: null) tasks (PKG-20260708-b2-tests)', () => {
  it('grows draining a same-task bin row by the delta: a partial grow reduces the row (not deleted), a full-allowance grow deletes it; both note pobrano z zasobnika', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 5, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, bin],
    });

    // Partial: grow by 2h of the 5h bin -> row reduced to 3h, not deleted.
    const partial = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 4, // +2h
    });
    expect(partial.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(4);
    expect(partial.workload.find((w) => w.id === 'bin1')!.plannedHours).toBe(3);
    expect(partial.activity[partial.activity.length - 1].message).toContain('pobrano z zasobnika');

    // Full: grow by exactly the 5h bin allowance -> row deleted.
    const full = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 7, // +5h == bin allowance
    });
    expect(full.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(7);
    expect(full.workload.find((w) => w.id === 'bin1')).toBeUndefined();
    expect(full.activity[full.activity.length - 1].message).toContain('pobrano z zasobnika');
  });

  it('rejects (same state reference) a grow past the same-task bin hours when there is no headroom to fall back on', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, bin],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 3.25, // +1.25h > 1h bin, no headroom
    });
    expect(next).toBe(state);
  });

  it('rejects a grow when the only bin row present belongs to a DIFFERENT task or a DIFFERENT person (no cross-draw, no headroom)', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });

    const otherTaskBin = makeEntry({ id: 'binOtherTask', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 5, sortIndex: 0 });
    const stateA = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null }), makeTask({ id: 't2' })],
      workload: [e1, otherTaskBin],
    });
    const rejectedA = reducer(stateA, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 3, // +1h — nothing available, a different task's bin can't be drawn from
    });
    expect(rejectedA).toBe(stateA);

    const otherPersonBin = makeEntry({ id: 'binOtherPerson', taskId: 't1', personId: 'p2', date: BIN_DATE, startMinutes: 0, plannedHours: 5, sortIndex: 0 });
    const stateB = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, otherPersonBin],
    });
    const rejectedB = reducer(stateB, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 3, // +1h — a different person's bin can't be drawn from
    });
    expect(rejectedB).toBe(stateB);
  });

  it('never rejects a plain move (unchanged hours) for a null-estimate task with no bin at all', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1],
    });

    const next = reducer(state, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-09',
      startMinutes: 600,
      plannedHours: 2, // unchanged
    });
    expect(next).not.toBe(state);
    const moved = next.workload.find((w) => w.id === 'e1')!;
    expect(moved.date).toBe('2026-07-09');
    expect(moved.startMinutes).toBe(600);
  });

  it('shrink for a null-estimate task creates a bin row when none exists, and merges into an existing one otherwise', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 4, sortIndex: 0 });

    const stateNoBin = makeState({ tasks: [makeTask({ id: 't1', estimatedHours: null })], workload: [e1] });
    const shrunkCreated = reducer(stateNoBin, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 2, // -2h
    });
    const createdBin = shrunkCreated.workload.find((w) => w.id !== 'e1')!;
    expect(createdBin.date).toBe(BIN_DATE);
    expect(createdBin.plannedHours).toBe(2);

    const existingBin = makeEntry({ id: 'existingBin', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const stateWithBin = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: null })],
      workload: [e1, existingBin],
    });
    const shrunkMerged = reducer(stateWithBin, {
      type: 'SET_BLOCK_TIME',
      entryId: 'e1',
      date: '2026-07-08',
      startMinutes: 480,
      plannedHours: 2, // -2h
    });
    const mergedBin = shrunkMerged.workload.find((w) => w.id === 'existingBin')!;
    expect(mergedBin.plannedHours).toBe(3); // 1h existing + 2h freed
  });
});

// ---------------------------------------------------------------------------
// INSERT_BLOCK budget enforcement — coverage added by PKG-20260708-b2-tests
// (implementation shipped by PKG-20260708-b2-budget-store).
// ---------------------------------------------------------------------------

describe('INSERT_BLOCK budget enforcement (PKG-20260708-b2-tests)', () => {
  it('budgeted task, headroom only (no bin): insert within headroom succeeds with no bin suffix in the activity message; insert past headroom is rejected', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 5 })], // t2 headroom = 5h, no bin row
      workload: [ref],
    });

    const ok = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 5 }, // exactly the headroom
    });
    expect(ok).not.toBe(state);
    const inserted = ok.workload.find((w) => w.taskId === 't2')!;
    expect(inserted.plannedHours).toBe(5);
    const msg = ok.activity[ok.activity.length - 1].message;
    expect(msg).not.toContain('pobrano z zasobnika');

    const rejected = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 5.25 }, // past headroom
    });
    expect(rejected).toBe(state);
  });

  it('task with bin + headroom: insert draws bin-first (bin row drained), remainder from headroom, activity message contains pobrano z zasobnika', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 10 })], // plenty of headroom
      workload: [ref, bin],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 3 }, // 2h from bin + 1h from headroom
    });

    expect(next).not.toBe(state);
    expect(next.workload.find((w) => w.id === 'bin1')).toBeUndefined(); // bin fully drained -> row deleted
    const t2Total = next.workload
      .filter((w) => w.taskId === 't2')
      .reduce((s, w) => s + w.plannedHours, 0);
    expect(t2Total).toBe(3); // 2h drawn from bin + 1h newly minted from headroom
    const msg = next.activity[next.activity.length - 1].message;
    expect(msg).toContain('pobrano z zasobnika');
  });

  it('insert exactly equal to the full (bin + headroom) allowance succeeds; allowance + 0.25 is rejected', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    // t2's totalAll (all people, dated + bin) = 1h (other) + 2h (bin) = 3h; headroom = 8 - 3 = 5h;
    // allowance = bin(2h) + headroom(5h) = 7h (headroom already nets out the bin's own contribution
    // to totalAll, so consuming the whole allowance lands the task total exactly at the 8h estimate).
    const otherPersonEntry = makeEntry({ id: 'other1', taskId: 't2', personId: 'p2', date: '2026-07-08', startMinutes: 480, plannedHours: 1, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: 8 })],
      workload: [ref, otherPersonEntry, bin],
    });

    const ok = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 7 }, // == full allowance
    });
    expect(ok).not.toBe(state);
    expect(ok.workload.find((w) => w.id === 'bin1')).toBeUndefined(); // bin drained
    const t2TotalOk = ok.workload
      .filter((w) => w.taskId === 't2')
      .reduce((s, w) => s + w.plannedHours, 0);
    expect(t2TotalOk).toBe(8); // exactly the estimate, never past it

    const rejected = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 7.25 }, // allowance + 0.25
    });
    expect(rejected).toBe(state);
  });

  it('unbudgeted task: insert <= bin hours succeeds and drains the bin row; with zero bin hours it is rejected', () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    const bin = makeEntry({ id: 'bin1', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: null })],
      workload: [ref, bin],
    });

    const ok = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 2 }, // == bin hours
    });
    expect(ok).not.toBe(state);
    expect(ok.workload.find((w) => w.id === 'bin1')).toBeUndefined();

    const noBinState = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', estimatedHours: null })],
      workload: [ref],
    });
    const rejected = reducer(noBinState, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 1 }, // no bin, no headroom
    });
    expect(rejected).toBe(noBinState);
  });

  it("uses the picker's SELECTED task allowance (not the ref block's task) when they differ", () => {
    const ref = makeEntry({ id: 'ref1', taskId: 't1', personId: 'p1', date: '2026-07-08', startMinutes: 480, plannedHours: 2, sortIndex: 0 });
    // t1 (the ref's task) is fully consumed already -- using its budget would reject this insert.
    const state = makeState({
      tasks: [makeTask({ id: 't1', estimatedHours: 2 }), makeTask({ id: 't2', estimatedHours: 5 })],
      workload: [ref],
    });

    const next = reducer(state, {
      type: 'INSERT_BLOCK',
      payload: { refEntryId: 'ref1', position: 'after', taskId: 't2', hours: 5 }, // only fits t2's 5h headroom
    });

    expect(next).not.toBe(state);
    const inserted = next.workload.find((w) => w.taskId === 't2')!;
    expect(inserted.plannedHours).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Impersonation reducer — coverage added by PKG-20260708-b2-tests
// (implementation shipped by PKG-20260708-b2-impersonation).
// ---------------------------------------------------------------------------

describe('Impersonation reducer (PKG-20260708-b2-tests)', () => {
  it('IMPERSONATE sets currentUserId to the target and impersonatorId to the previous user; no-ops for a non-existent person and for personId === currentUserId', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const state = makeState({ people: [admin, staff], currentUserId: 'p1' });

    const next = reducer(state, { type: 'IMPERSONATE', personId: 'p2' });
    expect(next.currentUserId).toBe('p2');
    expect(next.impersonatorId).toBe('p1');

    const noopMissing = reducer(state, { type: 'IMPERSONATE', personId: 'does-not-exist' });
    expect(noopMissing).toBe(state);

    const noopSelf = reducer(state, { type: 'IMPERSONATE', personId: 'p1' }); // == currentUserId
    expect(noopSelf).toBe(state);
  });

  it('chained impersonation preserves the ORIGINAL impersonator; IMPERSONATE with personId === impersonatorId acts as return', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff1 = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const staff2 = makePerson({ id: 'p3', accessRole: 'pracownik' });
    const state = makeState({
      people: [admin, staff1, staff2],
      currentUserId: 'p2', // already impersonating p2
      impersonatorId: 'p1', // original real user
    });

    const chained = reducer(state, { type: 'IMPERSONATE', personId: 'p3' });
    expect(chained.currentUserId).toBe('p3');
    expect(chained.impersonatorId).toBe('p1'); // original preserved, not p2

    const returned = reducer(state, { type: 'IMPERSONATE', personId: 'p1' }); // == impersonatorId
    expect(returned.currentUserId).toBe('p1');
    expect(returned.impersonatorId).toBe('');
  });

  it("STOP_IMPERSONATION restores currentUserId from impersonatorId and clears it; no-ops at ''", () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const state = makeState({ people: [admin, staff], currentUserId: 'p2', impersonatorId: 'p1' });

    const next = reducer(state, { type: 'STOP_IMPERSONATION' });
    expect(next.currentUserId).toBe('p1');
    expect(next.impersonatorId).toBe('');

    const notImpersonating = makeState({ people: [admin, staff], currentUserId: 'p1', impersonatorId: '' });
    expect(reducer(notImpersonating, { type: 'STOP_IMPERSONATION' })).toBe(notImpersonating);
  });

  it('SET_CURRENT_USER and LOGOUT both clear impersonatorId; LOGOUT also clears currentUserId', () => {
    const admin = makePerson({ id: 'p1', accessRole: 'administrator' });
    const staff = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const staff2 = makePerson({ id: 'p3', accessRole: 'pracownik' });
    const state = makeState({ people: [admin, staff, staff2], currentUserId: 'p2', impersonatorId: 'p1' });

    const setUser = reducer(state, { type: 'SET_CURRENT_USER', personId: 'p3' });
    expect(setUser.currentUserId).toBe('p3');
    expect(setUser.impersonatorId).toBe('');

    const loggedOut = reducer(state, { type: 'LOGOUT' });
    expect(loggedOut.currentUserId).toBe('');
    expect(loggedOut.impersonatorId).toBe('');
  });

  it('DELETE_PERSON of the impersonated person returns the session to the impersonator; deleting the impersonator clears impersonatorId only', () => {
    const untouchedAdmin = makePerson({ id: 'p0', accessRole: 'administrator' }); // satisfies the last-admin guard
    const impersonator = makePerson({ id: 'p1', accessRole: 'pracownik' });
    const impersonated = makePerson({ id: 'p2', accessRole: 'pracownik' });
    const state = makeState({
      people: [untouchedAdmin, impersonator, impersonated],
      currentUserId: 'p2',
      impersonatorId: 'p1',
    });

    const afterDeleteImpersonated = reducer(state, { type: 'DELETE_PERSON', personId: 'p2' });
    expect(afterDeleteImpersonated.currentUserId).toBe('p1');
    expect(afterDeleteImpersonated.impersonatorId).toBe('');
    expect(afterDeleteImpersonated.people.some((p) => p.id === 'p2')).toBe(false);

    const afterDeleteImpersonator = reducer(state, { type: 'DELETE_PERSON', personId: 'p1' });
    expect(afterDeleteImpersonator.impersonatorId).toBe('');
    expect(afterDeleteImpersonator.currentUserId).toBe('p2'); // acted-as identity kept
    expect(afterDeleteImpersonator.people.some((p) => p.id === 'p1')).toBe(false);
  });
});
