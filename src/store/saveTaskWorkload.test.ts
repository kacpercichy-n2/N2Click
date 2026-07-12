// Unit tests for the identity-preserving SAVE_TASK workload reconciliation
// added by PKG-20260712b-savetask-core: allocation cells now carry a
// (person, date) DAY TOTAL, and saveTask reconciles that target against the
// pair's existing blocks by delta instead of drop-and-recreate — so a
// multi-block day survives an unrelated save with the same ids, and grows /
// shrinks touch only the minimum number of blocks. Pure reducer tests: no
// React rendering, no localStorage.
import { describe, expect, it } from 'vitest';
import { reducer, type SaveTaskPayload, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import { BIN_DATE } from '../utils/time';
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
    endDate: '2026-07-10',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    checklist: [],
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

function draftFor(task: Task): TaskDraft {
  return {
    projectId: task.projectId,
    statusId: task.statusId,
    title: task.title,
    description: task.description,
    startDate: task.startDate,
    endDate: task.endDate,
    estimatedHours: task.estimatedHours,
    priority: task.priority,
    workCategoryId: task.workCategoryId,
    checklist: task.checklist,
  };
}

// Comparable projection used for byte-identical assertions per the package's
// implementation notes.
type EntrySnapshot = Pick<
  WorkloadEntry,
  'id' | 'taskId' | 'personId' | 'date' | 'plannedHours' | 'startMinutes' | 'sortIndex'
>;

function snapshot(entries: WorkloadEntry[]): EntrySnapshot[] {
  return entries
    .map((w) => ({
      id: w.id,
      taskId: w.taskId,
      personId: w.personId,
      date: w.date,
      plannedHours: w.plannedHours,
      startMinutes: w.startMinutes,
      sortIndex: w.sortIndex,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const TASK = makeTask({ id: 't1' });
const D = '2026-07-08'; // day with two blocks
const D2 = '2026-07-09'; // day with one block
const D3 = '2026-07-10'; // empty day (used by the "new day" case)

/**
 * Fixture baseline (per the package spec): task T with person P having TWO
 * dated blocks on day D (2h @ 480 idx 0, 3h @ 840 idx 1), one bin row (4h,
 * date '', startMinutes 0), and one dated block on another day D2 (2h @ 480).
 */
function baselineState() {
  const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: D, plannedHours: 2, startMinutes: 480, sortIndex: 0 });
  const e2 = makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: D, plannedHours: 3, startMinutes: 840, sortIndex: 1 });
  const bin1 = makeEntry({ id: 'bin1', taskId: 't1', personId: 'p1', date: BIN_DATE, plannedHours: 4, startMinutes: 0, sortIndex: 0 });
  const e3 = makeEntry({ id: 'e3', taskId: 't1', personId: 'p1', date: D2, plannedHours: 2, startMinutes: 480, sortIndex: 0 });
  const state = makeState({
    tasks: [TASK],
    assignments: [{ id: 'a1', taskId: 't1', personId: 'p1' }],
    workload: [e1, e2, bin1, e3],
  });
  return { state, e1, e2, bin1, e3 };
}

function baseAssigneeIds(): string[] {
  return ['p1'];
}

function payloadFor(
  overrides: Partial<SaveTaskPayload> & { allocations: SaveTaskPayload['allocations'] },
): SaveTaskPayload {
  return {
    taskId: 't1',
    draft: draftFor(TASK),
    assigneeIds: baseAssigneeIds(),
    ...overrides,
  };
}

describe('SAVE_TASK identity-preserving workload reconciliation (PKG-20260712b-savetask-tests)', () => {
  it('1. unchanged save is lossless: entire workload set deep-equals the pre-save set including ids; exactly one activity row appended', () => {
    const { state, e1, e2, bin1, e3 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5 }, // 2h + 3h unchanged
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    expect(snapshot(next.workload)).toEqual(snapshot([e1, e2, bin1, e3]));
    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('2. grow: D cell 5 -> 6 adds the whole 1h delta to the LAST block (840 -> 4h, same id); the 480 block is untouched', () => {
    const { state, e1 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 6 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    const nextE1 = next.workload.find((w) => w.id === 'e1')!;
    expect(nextE1).toEqual(e1); // untouched byte-for-byte

    const nextE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(nextE2.plannedHours).toBe(4);
    expect(nextE2.startMinutes).toBe(840); // 840 + 240min still fits before 24:00, no clamp needed
    expect(nextE2.sortIndex).toBe(1);
  });

  it('3. grow with clamp: a single 0.5h block @ 1380 grown to 3h clamps startMinutes to 1260 so it still ends by 24:00', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: D, plannedHours: 0.5, startMinutes: 1380, sortIndex: 0 });
    const state = makeState({
      tasks: [TASK],
      assignments: [{ id: 'a1', taskId: 't1', personId: 'p1' }],
      workload: [e1],
    });

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [{ personId: 'p1', date: D, plannedHours: 3 }],
      }),
    });

    expect(next.workload).toHaveLength(1);
    const grown = next.workload[0];
    expect(grown.id).toBe('e1');
    expect(grown.plannedHours).toBe(3);
    expect(grown.startMinutes).toBe(1260); // clampBlockStart(1380, 180) = 1440 - 180
  });

  it('4. shrink within the last block: D 5 -> 4 trims 1h off the 840 block (now 2h); the 480 block is unchanged; both ids kept', () => {
    const { state, e1 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 4 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    const nextE1 = next.workload.find((w) => w.id === 'e1')!;
    expect(nextE1).toEqual(e1); // untouched

    const nextE2 = next.workload.find((w) => w.id === 'e2')!;
    expect(nextE2.plannedHours).toBe(2);
    expect(nextE2.startMinutes).toBe(840);
    expect(nextE2.sortIndex).toBe(1);
  });

  it('5. shrink across blocks: D 5 -> 1.5 deletes the 840 block entirely and leaves the 480 block at 1.5h, sortIndex 0', () => {
    const { state } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 1.5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    expect(next.workload.find((w) => w.id === 'e2')).toBeUndefined();
    const survivor = next.workload.find((w) => w.id === 'e1')!;
    expect(survivor.plannedHours).toBe(1.5);
    expect(survivor.startMinutes).toBe(480);
    expect(survivor.sortIndex).toBe(0);
  });

  it('6. zero deletes the pair: omitting the D cell entirely removes both D blocks; D2 and the bin row stay byte-identical', () => {
    const { state, bin1, e3 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D2, plannedHours: 2 }, // D cell omitted entirely
        ],
      }),
    });

    expect(next.workload.find((w) => w.id === 'e1')).toBeUndefined();
    expect(next.workload.find((w) => w.id === 'e2')).toBeUndefined();
    expect(next.workload.find((w) => w.id === 'bin1')).toEqual(bin1);
    expect(next.workload.find((w) => w.id === 'e3')).toEqual(e3);
  });

  it('7. snap: a D cell of 5.1 rounds to 5 (0.25h grid), so it is treated as unchanged — same rows, same ids', () => {
    const { state, e1, e2 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5.1 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    expect(next.workload.find((w) => w.id === 'e1')).toEqual(e1);
    expect(next.workload.find((w) => w.id === 'e2')).toEqual(e2);
  });

  it('8. new day: a cell on the empty day D3 creates exactly one new entry at nextFreeStart/nextSortIndex (08:00, sortIndex 0)', () => {
    const { state } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
          { personId: 'p1', date: D3, plannedHours: 2 },
        ],
      }),
    });

    const d3Entries = next.workload.filter((w) => w.personId === 'p1' && w.date === D3);
    expect(d3Entries).toHaveLength(1);
    expect(d3Entries[0].plannedHours).toBe(2);
    expect(d3Entries[0].startMinutes).toBe(480); // WORKDAY_START_MIN, day was empty
    expect(d3Entries[0].sortIndex).toBe(0);

    // D and D2 remain untouched (same ids/values) since their cells matched the
    // existing totals exactly.
    expect(next.workload.find((w) => w.id === 'e1')!.plannedHours).toBe(2);
    expect(next.workload.find((w) => w.id === 'e2')!.plannedHours).toBe(3);
    expect(next.workload.find((w) => w.id === 'e3')!.plannedHours).toBe(2);
  });

  it("9. mixed dated + bin unchanged: the bin row's id/hours survive an unchanged save; newUnassigned merges into it (6h total, still one row)", () => {
    const { state, bin1 } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
        newUnassigned: [{ personId: 'p1', hours: 2 }],
      }),
    });

    const binRows = next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1' && w.date === BIN_DATE);
    expect(binRows).toHaveLength(1);
    expect(binRows[0].id).toBe(bin1.id); // existing row's id kept
    expect(binRows[0].plannedHours).toBe(6); // 4h existing + 2h new
  });

  it('10. unassign: dropping P from assigneeIds removes ALL of their dated + bin rows for the task', () => {
    const { state } = baselineState();

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        assigneeIds: [], // p1 unassigned
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });

    expect(next.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1')).toHaveLength(0);
  });

  it("11. sortIndex contiguity: after the shrink-across-blocks save, P's day-D sortIndexes are 0..n ranked by startMinutes (also holds on the new day from case 8)", () => {
    const { state: shrinkState } = baselineState();
    const shrunk = reducer(shrinkState, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 1.5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
        ],
      }),
    });
    const dayDEntries = shrunk.workload
      .filter((w) => w.personId === 'p1' && w.date === D)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    dayDEntries.forEach((w, i) => expect(w.sortIndex).toBe(i));

    const { state: newDayState } = baselineState();
    const grown = reducer(newDayState, {
      type: 'SAVE_TASK',
      payload: payloadFor({
        allocations: [
          { personId: 'p1', date: D, plannedHours: 5 },
          { personId: 'p1', date: D2, plannedHours: 2 },
          { personId: 'p1', date: D3, plannedHours: 2 },
        ],
      }),
    });
    const dayD3Entries = grown.workload
      .filter((w) => w.personId === 'p1' && w.date === D3)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    dayD3Entries.forEach((w, i) => expect(w.sortIndex).toBe(i));
  });
});
