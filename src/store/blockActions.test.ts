// Unit tests for the timed-block reducer actions (SET_BLOCK_TIME, INSERT_BLOCK).
// Pure reducer tests: no React rendering, no localStorage — build AppData
// fixtures by hand from emptyData() + literal tasks/people/workload rows.
import { describe, expect, it } from 'vitest';
import { reducer, type TaskDraft } from './AppStore';
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
    isAdmin: false,
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
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
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
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
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
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
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
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
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
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
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
    const existingBin = makeEntry({ id: 'bin0', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
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

  it('quarters a 1.25h block: original 0.5h + three 0.25h bin entries, bin sortIndex contiguous in creation order', () => {
    const e1 = makeEntry({ id: 'e1', date: '2026-07-08', startMinutes: 480, plannedHours: 1.25, sortIndex: 0 });
    const state = makeState({ tasks: [makeTask({ id: 't1' })], workload: [e1] });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'e1', parts: 4 });

    const original = next.workload.find((w) => w.id === 'e1')!;
    expect(original.plannedHours).toBe(0.5);

    const binEntries = next.workload
      .filter((w) => w.id !== 'e1')
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(binEntries).toHaveLength(3);
    binEntries.forEach((w) => {
      expect(w.date).toBe(BIN_DATE);
      expect(w.plannedHours).toBe(0.25);
    });
    expect(binEntries.map((w) => w.sortIndex)).toEqual([0, 1, 2]);
  });

  it('splits a bin entry within the bin: original stays a bin entry, new part appended to the bin end', () => {
    const e0 = makeEntry({ id: 'e0', taskId: 't2', date: BIN_DATE, startMinutes: 0, plannedHours: 1, sortIndex: 0 });
    const target = makeEntry({ id: 'target', taskId: 't1', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 1 });
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      workload: [e0, target],
    });

    const next = reducer(state, { type: 'SPLIT_BLOCK', entryId: 'target', parts: 2 });

    const original = next.workload.find((w) => w.id === 'target')!;
    expect(original.date).toBe(BIN_DATE);
    expect(original.startMinutes).toBe(0);
    expect(original.plannedHours).toBe(2);
    expect(original.sortIndex).toBe(1); // keeps its bin position

    const newPart = next.workload.find((w) => w.id !== 'e0' && w.id !== 'target')!;
    expect(newPart.date).toBe(BIN_DATE);
    expect(newPart.plannedHours).toBe(2);
    expect(newPart.sortIndex).toBe(2); // appended to the bin end
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

  it('newUnassigned: appends bin hours for assigned people, snaps off-grid hours, skips <=0 hours and unassigned people', () => {
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

    const p1Bin = next.workload
      .filter((w) => w.personId === 'p1' && w.date === BIN_DATE)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(p1Bin).toHaveLength(2);
    expect(p1Bin[0].plannedHours).toBe(10);
    expect(p1Bin[1].plannedHours).toBe(1.25);
    expect(p1Bin.map((w) => w.sortIndex)).toEqual([0, 1]);

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
  it("moving a bin entry to another person appends it to the target's bin (date/startMinutes stay bin values, contiguous sortIndex)", () => {
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

    const moved = next.workload.find((w) => w.id === 'bin1')!;
    expect(moved.personId).toBe('p2');
    expect(moved.date).toBe(BIN_DATE); // stays in the bin, not nextFreeStart'd onto a day
    expect(moved.startMinutes).toBe(0);
    expect(moved.sortIndex).toBe(1); // appended after the target's existing bin entry (sortIndex 0)

    const untouchedTargetBin = next.workload.find((w) => w.id === 'binT')!;
    expect(untouchedTargetBin.sortIndex).toBe(0);
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
