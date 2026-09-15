// Unit tests for the status reducer guards (SAVE_STATUS, REORDER_STATUS,
// SET_STATUS_ARCHIVED, SET_STATUS_DONE, DELETE_STATUS) shipped by
// PKG-20260712c-status-done-core. Pure reducer tests: no React rendering, no
// localStorage — build AppData fixtures by hand, dispatch through the exported
// `reducer`, and assert on the returned state. Follows the fixture style of
// blockActions.test.ts / selectors.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Project, Status, Task } from '../types';

function makeState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
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

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    clientId: 'c1',
    name: 'Project',
    description: '',
    statusId: 'status1',
    paid: false,
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SET_STATUS_ARCHIVED', () => {
  it('archiving the only ACTIVE status is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, archived: false });
    const s1 = makeStatus({ id: 's1', order: 1, archived: true }); // already archived, not the only active one
    const state = makeState({ statuses: [s0, s1] });

    const next = reducer(state, { type: 'SET_STATUS_ARCHIVED', statusId: 's0', archived: true });

    expect(next).toEqual(state);
    expect(next.statuses.find((s) => s.id === 's0')!.archived).toBe(false);
  });

  it('archiving the only DONE status is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true }); // the only done status
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false }); // active, keeps s0 from being "only active"
    const state = makeState({ statuses: [s0, s1] });

    const next = reducer(state, { type: 'SET_STATUS_ARCHIVED', statusId: 's0', archived: true });

    expect(next).toEqual(state);
    expect(next.statuses.find((s) => s.id === 's0')!.archived).toBe(false);
  });

  it('archiving a used-but-not-only status succeeds, and referencing projects/tasks keep their statusId', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: false });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: true }); // second active status so s0 isn't "only"
    const project = makeProject({ id: 'proj1', statusId: 's0' });
    const task = makeTask({ id: 't1', projectId: 'proj1', statusId: 's0' });
    const state = makeState({ statuses: [s0, s1], projects: [project], tasks: [task] });

    const next = reducer(state, { type: 'SET_STATUS_ARCHIVED', statusId: 's0', archived: true });

    expect(next).not.toBe(state);
    expect(next.statuses.find((s) => s.id === 's0')!.archived).toBe(true);
    expect(next.projects.find((p) => p.id === 'proj1')!.statusId).toBe('s0');
    expect(next.tasks.find((t) => t.id === 't1')!.statusId).toBe('s0');
  });
});

describe('DELETE_STATUS', () => {
  it('a REFERENCED status (by a project) is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, archived: true });
    const s1 = makeStatus({ id: 's1', order: 1 });
    const project = makeProject({ id: 'proj1', statusId: 's0' });
    const state = makeState({ statuses: [s0, s1], projects: [project] });

    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's0' });

    expect(next).toEqual(state);
    expect(next.statuses.some((s) => s.id === 's0')).toBe(true);
  });

  it('a REFERENCED status (by a task) is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, archived: true });
    const s1 = makeStatus({ id: 's1', order: 1 });
    const task = makeTask({ id: 't1', statusId: 's0' });
    const state = makeState({ statuses: [s0, s1], tasks: [task] });

    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's0' });

    expect(next).toEqual(state);
    expect(next.statuses.some((s) => s.id === 's0')).toBe(true);
  });

  it('deleting the only ACTIVE status is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, archived: false });
    const s1 = makeStatus({ id: 's1', order: 1, archived: true });
    const state = makeState({ statuses: [s0, s1] });

    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's0' });

    expect(next).toEqual(state);
    expect(next.statuses.some((s) => s.id === 's0')).toBe(true);
  });

  it('deleting the only DONE status is refused — state unchanged', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true, archived: true });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false });
    const state = makeState({ statuses: [s0, s1] });

    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's0' });

    expect(next).toEqual(state);
    expect(next.statuses.some((s) => s.id === 's0')).toBe(true);
  });

  it('an UNUSED, non-only, archived, non-done status is removed', () => {
    const s0 = makeStatus({ id: 's0', order: 0, archived: true, isDone: false }); // deletable
    const s1 = makeStatus({ id: 's1', order: 1, archived: false, isDone: false }); // keeps s0 from being "only active"
    const s2 = makeStatus({ id: 's2', order: 2, isDone: true }); // keeps s0 from being "only done"
    const state = makeState({ statuses: [s0, s1, s2] });

    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's0' });

    expect(next).not.toBe(state);
    expect(next.statuses.some((s) => s.id === 's0')).toBe(false);
    expect(next.statuses.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });
});

describe('SET_STATUS_DONE', () => {
  it('turning isDone OFF on the only done status is refused; turning it ON for a second status makes both done; then un-toggling the first is allowed; then archiving the remaining done status is refused', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true }); // the only done status
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false });
    let state = makeState({ statuses: [s0, s1] });

    // 1. Refused: s0 is the only done status.
    const afterRefusedOff = reducer(state, { type: 'SET_STATUS_DONE', statusId: 's0', isDone: false });
    expect(afterRefusedOff).toEqual(state);
    expect(afterRefusedOff.statuses.find((s) => s.id === 's0')!.isDone).toBe(true);

    // 2. Turning ON a second status is always allowed -> both done.
    state = reducer(state, { type: 'SET_STATUS_DONE', statusId: 's1', isDone: true });
    expect(state.statuses.find((s) => s.id === 's0')!.isDone).toBe(true);
    expect(state.statuses.find((s) => s.id === 's1')!.isDone).toBe(true);

    // 3. Now un-toggling s0 is allowed (s1 is still done).
    state = reducer(state, { type: 'SET_STATUS_DONE', statusId: 's0', isDone: false });
    expect(state.statuses.find((s) => s.id === 's0')!.isDone).toBe(false);
    expect(state.statuses.find((s) => s.id === 's1')!.isDone).toBe(true);

    // 4. s1 is now the only done status -> archiving it is refused.
    const afterArchiveAttempt = reducer(state, {
      type: 'SET_STATUS_ARCHIVED',
      statusId: 's1',
      archived: true,
    });
    expect(afterArchiveAttempt).toEqual(state);
    expect(afterArchiveAttempt.statuses.find((s) => s.id === 's1')!.archived).toBe(false);
  });
});

describe('SAVE_STATUS', () => {
  it('create (statusId: null) produces a new status with isDone: false', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const state = makeState({ statuses: [s0] });

    const next = reducer(state, {
      type: 'SAVE_STATUS',
      statusId: null,
      name: 'Nowy status',
      color: '#abcdef',
    });

    expect(next.statuses).toHaveLength(2);
    const created = next.statuses.find((s) => s.id !== 's0')!;
    expect(created.name).toBe('Nowy status');
    expect(created.color).toBe('#abcdef');
    expect(created.isDone).toBe(false);
    expect(created.archived).toBe(false);
  });

  it('renaming/recoloring a done status preserves isDone: true', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true, name: 'Gotowe', color: '#111111' });
    const state = makeState({ statuses: [s0] });

    const next = reducer(state, {
      type: 'SAVE_STATUS',
      statusId: 's0',
      name: 'Zakonczone',
      color: '#00ff00',
    });

    const renamed = next.statuses.find((s) => s.id === 's0')!;
    expect(renamed.name).toBe('Zakonczone');
    expect(renamed.color).toBe('#00ff00');
    expect(renamed.isDone).toBe(true);
  });
});

describe('SET_TASK_STATUS', () => {
  it('re-applying the CURRENT status is a no-op: same state reference, no activity row, no updatedAt churn (mirrors SET_PROJECT_STATUS)', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const task = makeTask({ id: 't1', statusId: 's0', updatedAt: '2020-01-01T00:00:00.000Z' });
    const state = makeState({ statuses: [s0], tasks: [task] });

    const next = reducer(state, { type: 'SET_TASK_STATUS', taskId: 't1', statusId: 's0' });

    expect(next).toBe(state);
    expect(next.tasks.find((t) => t.id === 't1')!.updatedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('moving to a DIFFERENT status applies, bumps updatedAt, and appends exactly one activity row', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const s1 = makeStatus({ id: 's1', order: 1 });
    const task = makeTask({ id: 't1', statusId: 's0', updatedAt: '2020-01-01T00:00:00.000Z' });
    const state = makeState({ statuses: [s0, s1], tasks: [task] });

    const next = reducer(state, { type: 'SET_TASK_STATUS', taskId: 't1', statusId: 's1' });

    expect(next).not.toBe(state);
    const moved = next.tasks.find((t) => t.id === 't1')!;
    expect(moved.statusId).toBe('s1');
    expect(moved.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('rejects a stale taskId and a dangling statusId by same reference', () => {
    const s0 = makeStatus({ id: 's0', order: 0 });
    const task = makeTask({ id: 't1', statusId: 's0' });
    const state = makeState({ statuses: [s0], tasks: [task] });

    expect(reducer(state, { type: 'SET_TASK_STATUS', taskId: 'ghost', statusId: 's0' })).toBe(state);
    expect(reducer(state, { type: 'SET_TASK_STATUS', taskId: 't1', statusId: 'ghost' })).toBe(state);
  });
});

describe('COMPLETE_TASK (szybkie ukończenie z menu bloku)', () => {
  const bin = (id: string, taskId: string, personId: string, plannedHours: number) => ({
    id,
    taskId,
    personId,
    date: '',
    plannedHours,
    startMinutes: 0,
    sortIndex: 0,
  });
  const block = (id: string, taskId: string, personId: string, done?: boolean) => ({
    id,
    taskId,
    personId,
    date: '2026-09-15',
    plannedHours: 2,
    startMinutes: 540,
    sortIndex: 0,
    ...(done === true ? { done: true } : {}),
  });

  it('przełącza zadanie na pierwszy AKTYWNY status isDone, kasuje zasobnik zadania, zostawia bloki datowane i dopisuje jeden wpis dziennika', () => {
    const open = makeStatus({ id: 'open', order: 0 });
    const doneArchived = makeStatus({ id: 'done-old', order: 1, isDone: true, archived: true });
    const done = makeStatus({ id: 'done', order: 2, isDone: true });
    const task = makeTask({ id: 't1', statusId: 'open', updatedAt: '2020-01-01T00:00:00.000Z' });
    const other = makeTask({ id: 't2', statusId: 'open' });
    const state = makeState({
      statuses: [open, doneArchived, done],
      tasks: [task, other],
      workload: [bin('b1', 't1', 'p1', 3), block('d1', 't1', 'p1'), bin('b2', 't2', 'p1', 1)],
    });

    const next = reducer(state, { type: 'COMPLETE_TASK', taskId: 't1' });

    expect(next).not.toBe(state);
    const closed = next.tasks.find((t) => t.id === 't1')!;
    expect(closed.statusId).toBe('done');
    expect(closed.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(next.workload.map((w) => w.id)).toEqual(['d1', 'b2']);
    expect(next.workload.find((w) => w.id === 'd1')!.done).toBeUndefined();
    expect(next.activity.length).toBe(state.activity.length + 1);
    expect(next.activity[next.activity.length - 1].message).toContain('3h');
  });

  it('bez zasobnika zmienia tylko status (tablica workload zachowuje referencję)', () => {
    const open = makeStatus({ id: 'open', order: 0 });
    const done = makeStatus({ id: 'done', order: 1, isDone: true });
    const state = makeState({
      statuses: [open, done],
      tasks: [makeTask({ id: 't1', statusId: 'open' })],
      workload: [block('d1', 't1', 'p1', true)],
    });
    const next = reducer(state, { type: 'COMPLETE_TASK', taskId: 't1' });
    expect(next.tasks[0].statusId).toBe('done');
    expect(next.workload).toBe(state.workload);
  });

  it('odrzuca nieznane zadanie, zadanie już zamknięte i stan bez statusu isDone tą samą referencją', () => {
    const open = makeStatus({ id: 'open', order: 0 });
    const done = makeStatus({ id: 'done', order: 1, isDone: true });
    const withDone = makeState({
      statuses: [open, done],
      tasks: [makeTask({ id: 't1', statusId: 'done' })],
      workload: [bin('b1', 't1', 'p1', 1)],
    });
    expect(reducer(withDone, { type: 'COMPLETE_TASK', taskId: 't1' })).toBe(withDone);
    expect(reducer(withDone, { type: 'COMPLETE_TASK', taskId: 'ghost' })).toBe(withDone);
    const noDone = makeState({ statuses: [open], tasks: [makeTask({ id: 't1', statusId: 'open' })] });
    expect(reducer(noDone, { type: 'COMPLETE_TASK', taskId: 't1' })).toBe(noDone);
  });
});
