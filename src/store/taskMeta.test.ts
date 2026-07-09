// Unit tests for the task-metadata reducer behavior (PKG-20260710-task-meta-model):
// SAVE_TASK persisting priority/workCategoryId/checklist, and the three
// ADD/RENAME/DELETE_WORK_CATEGORY actions. Pure reducer tests: no React
// rendering, no localStorage — build AppData fixtures by hand from
// emptyData() + literal tasks/categories, mirroring blockActions.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer, type SaveTaskPayload, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import type { AppData, ChecklistItem, Task, WorkCategory } from '../types';

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
    checklist: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCategory(overrides: Partial<WorkCategory> & { id: string }): WorkCategory {
  return { name: 'Category', ...overrides };
}

function draftFor(task: Task, overrides: Partial<TaskDraft> = {}): TaskDraft {
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
    ...overrides,
  };
}

describe('SAVE_TASK metadata', () => {
  it('create: a draft with priority "high", a real workCategoryId, and a 2-item checklist persists all three on the created task', () => {
    const cat = makeCategory({ id: 'cat1', name: 'Kreacja' });
    const state = makeState({ workCategories: [cat] });
    const checklist: ChecklistItem[] = [
      { id: 'c1', text: 'Step one', done: false },
      { id: 'c2', text: 'Step two', done: true },
    ];
    const draft: TaskDraft = {
      projectId: 'proj1',
      statusId: 'status1',
      title: 'New task',
      description: '',
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      estimatedHours: null,
      priority: 'high',
      workCategoryId: 'cat1',
      checklist,
    };
    const payload: SaveTaskPayload = { taskId: null, draft, assigneeIds: [], allocations: [] };

    const next = reducer(state, { type: 'SAVE_TASK', payload });

    expect(next.tasks).toHaveLength(1);
    const created = next.tasks[0];
    expect(created.priority).toBe('high');
    expect(created.workCategoryId).toBe('cat1');
    expect(created.checklist).toEqual(checklist);
  });

  it('edit: checklist is replaced WHOLESALE — old removed/toggled items do not survive; priority/category update in place; updatedAt bumps', () => {
    const oldChecklist: ChecklistItem[] = [
      { id: 'old1', text: 'Old item', done: false },
      { id: 'old2', text: 'Old item 2', done: true },
    ];
    const task = makeTask({
      id: 't1',
      priority: 'low',
      workCategoryId: 'cat1',
      checklist: oldChecklist,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    const state = makeState({
      tasks: [task],
      workCategories: [makeCategory({ id: 'cat1' }), makeCategory({ id: 'cat2' })],
    });
    const newChecklist: ChecklistItem[] = [{ id: 'new1', text: 'New item', done: false }];

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFor(task, {
          priority: 'urgent',
          workCategoryId: 'cat2',
          checklist: newChecklist,
        }),
        assigneeIds: [],
        allocations: [],
      },
    });

    const edited = next.tasks.find((t) => t.id === 't1')!;
    expect(edited.priority).toBe('urgent');
    expect(edited.workCategoryId).toBe('cat2');
    expect(edited.checklist).toEqual(newChecklist);
    expect(edited.checklist.some((i) => i.id === 'old1' || i.id === 'old2')).toBe(false);
    expect(edited.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('drops empty-text checklist items (including whitespace-only) on write, per the defensive trim', () => {
    const task = makeTask({ id: 't1' });
    const state = makeState({ tasks: [task] });
    const checklist: ChecklistItem[] = [
      { id: 'c1', text: '  Keep me  ', done: false },
      { id: 'c2', text: '   ', done: false }, // whitespace-only -> dropped
      { id: 'c3', text: '', done: true }, // empty -> dropped
    ];

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFor(task, { checklist }),
        assigneeIds: [],
        allocations: [],
      },
    });

    const edited = next.tasks.find((t) => t.id === 't1')!;
    expect(edited.checklist).toHaveLength(1);
    expect(edited.checklist[0]).toEqual({ id: 'c1', text: 'Keep me', done: false });
  });

  it('checklist item "done" toggling persists through a create -> edit round-trip', () => {
    const draft: TaskDraft = {
      projectId: 'proj1',
      statusId: 'status1',
      title: 'Task',
      description: '',
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      estimatedHours: null,
      priority: 'normal',
      workCategoryId: '',
      checklist: [{ id: 'c1', text: 'Do it', done: false }],
    };
    const state = makeState();
    const created = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: null, draft, assigneeIds: [], allocations: [] },
    });
    const createdTask = created.tasks[0];
    expect(createdTask.checklist[0].done).toBe(false);

    const toggled = reducer(created, {
      type: 'SAVE_TASK',
      payload: {
        taskId: createdTask.id,
        draft: draftFor(createdTask, {
          checklist: [{ ...createdTask.checklist[0], done: true }],
        }),
        assigneeIds: [],
        allocations: [],
      },
    });

    const edited = toggled.tasks.find((t) => t.id === createdTask.id)!;
    expect(edited.checklist[0].done).toBe(true);
    expect(edited.checklist[0].id).toBe('c1'); // same item, not a fresh one
  });
});

describe('Work category CRUD', () => {
  it('ADD_WORK_CATEGORY trims the name and appends a new row', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_WORK_CATEGORY', name: '  Kreacja  ' });
    expect(next.workCategories).toHaveLength(1);
    expect(next.workCategories[0].name).toBe('Kreacja');
  });

  it('ADD_WORK_CATEGORY is a no-op (same state reference) for an empty/whitespace-only name', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_WORK_CATEGORY', name: '   ' });
    expect(next).toBe(state);
  });

  it('RENAME_WORK_CATEGORY renames only the targeted row', () => {
    const state = makeState({
      workCategories: [
        makeCategory({ id: 'cat1', name: 'Kreacja' }),
        makeCategory({ id: 'cat2', name: 'Testy' }),
      ],
    });
    const next = reducer(state, {
      type: 'RENAME_WORK_CATEGORY',
      workCategoryId: 'cat1',
      name: 'Design',
    });
    expect(next.workCategories.find((c) => c.id === 'cat1')!.name).toBe('Design');
    expect(next.workCategories.find((c) => c.id === 'cat2')!.name).toBe('Testy');
  });

  it('DELETE_WORK_CATEGORY removes the row AND resets workCategoryId to \'\' on referencing tasks, while an unrelated task\'s category survives', () => {
    const referencing = makeTask({ id: 't1', workCategoryId: 'cat1' });
    const other = makeTask({ id: 't2', workCategoryId: 'cat2' });
    const state = makeState({
      tasks: [referencing, other],
      workCategories: [makeCategory({ id: 'cat1' }), makeCategory({ id: 'cat2' })],
    });

    const next = reducer(state, { type: 'DELETE_WORK_CATEGORY', workCategoryId: 'cat1' });

    expect(next.workCategories.find((c) => c.id === 'cat1')).toBeUndefined();
    expect(next.workCategories).toHaveLength(1);
    expect(next.tasks.find((t) => t.id === 't1')!.workCategoryId).toBe('');
    expect(next.tasks.find((t) => t.id === 't2')!.workCategoryId).toBe('cat2'); // untouched
  });
});
