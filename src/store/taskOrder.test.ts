// Unit tests for manual per-project task ordering (PKG-20260720-manual-task-order):
// the REORDER_PROJECT_TASK reducer (invariant-6 reference equality on any invalid
// input, single-project renumber, identity preservation, completion/workload
// isolation), append-at-end on SAVE_TASK create and project-change edit, and the
// orderedTasksOfProject selector tie-break. Pure reducer/selector tests — no
// React, no localStorage — following the fixture style of taskMeta.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer, type SaveTaskPayload, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import { orderedTasksOfProject } from './selectors';
import type {
  AppData,
  Person,
  Project,
  Status,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';

const STATUS: Status = { id: 's1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const STATUS_DONE: Status = { id: 's2', name: 'Zrobione', slug: 'zrobione', color: '#4caf50', order: 1, archived: false, isDone: true };

const PROJECT_A: Project = {
  id: 'projA', clientId: '', name: 'Projekt A', description: '', statusId: 's1', paid: false,
  startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const PROJECT_B: Project = { ...PROJECT_A, id: 'projB', name: 'Projekt B' };

const PERSON: Person = {
  id: 'p1', firstName: 'Anna', lastName: 'Kowalska', name: 'Anna Kowalska', email: '', phone: '',
  role: '', departmentId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
  workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
  birthDate: '',
};

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'projA', statusId: 's1', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    statuses: [STATUS, STATUS_DONE],
    projects: [PROJECT_A, PROJECT_B],
    people: [PERSON],
    ...overrides,
  };
}

// Three tasks in projA (ranks 0,1,2) + two in projB (ranks 0,1).
function fixture(): AppData {
  return makeState({
    tasks: [
      makeTask({ id: 'a1', title: 'A1', orderIndex: 0 }),
      makeTask({ id: 'a2', title: 'A2', orderIndex: 1 }),
      makeTask({ id: 'a3', title: 'A3', orderIndex: 2 }),
      makeTask({ id: 'b1', title: 'B1', projectId: 'projB', orderIndex: 0 }),
      makeTask({ id: 'b2', title: 'B2', projectId: 'projB', orderIndex: 1 }),
    ],
  });
}

const orderIn = (state: AppData, projectId: string): Array<[string, number]> =>
  orderedTasksOfProject(state, projectId).map((t) => [t.id, t.orderIndex]);

describe('REORDER_PROJECT_TASK — valid moves', () => {
  it('swaps a task down and renumbers ONLY the target project', () => {
    const state = fixture();
    const next = reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 'a1', direction: 1 });
    expect(orderIn(next, 'projA')).toEqual([
      ['a2', 0],
      ['a1', 1],
      ['a3', 2],
    ]);
    // projB ranks untouched; every projB task keeps its object identity.
    expect(orderIn(next, 'projB')).toEqual([
      ['b1', 0],
      ['b2', 1],
    ]);
    const byId = (s: AppData, id: string) => s.tasks.find((t) => t.id === id)!;
    expect(byId(next, 'b1')).toBe(byId(state, 'b1'));
    expect(byId(next, 'b2')).toBe(byId(state, 'b2'));
    // a3's rank did not change -> identity preserved (minimizes mirror upserts).
    expect(byId(next, 'a3')).toBe(byId(state, 'a3'));
    // The two swapped tasks are fresh objects with new ranks.
    expect(byId(next, 'a1')).not.toBe(byId(state, 'a1'));
    expect(byId(next, 'a2')).not.toBe(byId(state, 'a2'));
  });

  it('swaps a task up (direction -1)', () => {
    const next = reducer(fixture(), { type: 'REORDER_PROJECT_TASK', taskId: 'a3', direction: -1 });
    expect(orderIn(next, 'projA')).toEqual([
      ['a1', 0],
      ['a3', 1],
      ['a2', 2],
    ]);
  });
});

describe('REORDER_PROJECT_TASK — invalid input returns SAME state reference', () => {
  it('unknown task id', () => {
    const state = fixture();
    expect(reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 'ghost', direction: 1 })).toBe(state);
  });

  it('first task moved up (off the top edge)', () => {
    const state = fixture();
    expect(reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 'a1', direction: -1 })).toBe(state);
  });

  it('last task moved down (off the bottom edge)', () => {
    const state = fixture();
    expect(reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 'a3', direction: 1 })).toBe(state);
  });

  it('out-of-range direction', () => {
    const state = fixture();
    const action = { type: 'REORDER_PROJECT_TASK', taskId: 'a1', direction: 2 } as unknown as {
      type: 'REORDER_PROJECT_TASK';
      taskId: string;
      direction: -1 | 1;
    };
    expect(reducer(state, action)).toBe(state);
  });
});

describe('REORDER_PROJECT_TASK — completion / workload isolation (invariant 5)', () => {
  it('leaves statusId/isDone, assignments and workload untouched', () => {
    const assignments: TaskAssignment[] = [{ id: 'as1', taskId: 'a1', personId: 'p1' }];
    const workload: WorkloadEntry[] = [
      { id: 'w1', taskId: 'a1', personId: 'p1', date: '2026-07-07', plannedHours: 4, startMinutes: 480, sortIndex: 0 },
    ];
    const state = makeState({
      tasks: [
        makeTask({ id: 'a1', orderIndex: 0, statusId: 's1' }),
        makeTask({ id: 'a2', orderIndex: 1, statusId: 's2' }),
      ],
      assignments,
      workload,
    });
    const next = reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 'a1', direction: 1 });
    // Non-task collections keep their reference (reducer only maps tasks).
    expect(next.assignments).toBe(state.assignments);
    expect(next.workload).toBe(state.workload);
    // Status assignment and updatedAt survive the reorder.
    expect(next.tasks.find((t) => t.id === 'a1')!.statusId).toBe('s1');
    expect(next.tasks.find((t) => t.id === 'a2')!.statusId).toBe('s2');
    expect(next.tasks.find((t) => t.id === 'a1')!.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('SAVE_TASK — append at end of project', () => {
  const draftFor = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
    projectId: 'projA', statusId: 's1', title: 'Nowe', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], ...overrides,
  });

  it('a new task lands at maxOrderIndex + 1 of its project', () => {
    const state = fixture(); // projA max = 2
    const payload: SaveTaskPayload = { taskId: null, draft: draftFor(), assigneeIds: [], allocations: [] };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    const created = next.tasks.find((t) => !state.tasks.some((s) => s.id === t.id))!;
    expect(created.orderIndex).toBe(3);
  });

  it('the FIRST task of an empty project gets orderIndex 0', () => {
    const state = makeState({ tasks: [] });
    const payload: SaveTaskPayload = { taskId: null, draft: draftFor(), assigneeIds: [], allocations: [] };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    expect(next.tasks[0].orderIndex).toBe(0);
  });

  it('editing a task to a different project re-appends at the destination end', () => {
    const state = fixture(); // b1 is rank 0 in projB; projA max = 2
    const payload: SaveTaskPayload = {
      taskId: 'b1',
      draft: draftFor({ projectId: 'projA', title: 'B1 przeniesione' }),
      assigneeIds: [],
      allocations: [],
    };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    const moved = next.tasks.find((t) => t.id === 'b1')!;
    expect(moved.projectId).toBe('projA');
    expect(moved.orderIndex).toBe(3);
  });

  it('editing within the same project preserves the stored orderIndex', () => {
    const state = fixture(); // a2 rank 1
    const payload: SaveTaskPayload = {
      taskId: 'a2',
      draft: draftFor({ projectId: 'projA', title: 'A2 zmienione' }),
      assigneeIds: [],
      allocations: [],
    };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    expect(next.tasks.find((t) => t.id === 'a2')!.orderIndex).toBe(1);
  });
});

describe('orderedTasksOfProject — deterministic tie-break', () => {
  it('breaks a duplicate orderIndex by (startDate, id)', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 'z', orderIndex: 0, startDate: '2026-07-10' }),
        makeTask({ id: 'a', orderIndex: 0, startDate: '2026-07-08' }),
        makeTask({ id: 'm', orderIndex: 0, startDate: '2026-07-08' }),
      ],
    });
    // Same orderIndex -> earlier startDate first; equal startDate -> id asc.
    expect(orderedTasksOfProject(state, 'projA').map((t) => t.id)).toEqual(['a', 'm', 'z']);
  });
});
