// Unit tests for the timed-block reducer actions (SET_BLOCK_TIME, INSERT_BLOCK).
// Pure reducer tests: no React rendering, no localStorage — build AppData
// fixtures by hand from emptyData() + literal tasks/people/workload rows.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Task, WorkloadEntry } from '../types';

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
