// Unit tests for the task-metadata reducer behavior (PKG-20260710-task-meta-model):
// SAVE_TASK persisting priority/workCategoryId/checklist, and the three
// ADD/RENAME/DELETE_WORK_CATEGORY actions. Pure reducer tests: no React
// rendering, no localStorage — build AppData fixtures by hand from
// emptyData() + literal tasks/categories, mirroring blockActions.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer, type PersonDraft, type SaveTaskPayload, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import type { AppData, ChecklistItem, Person, Project, Status, Task, WorkCategory } from '../types';

// Reference entities the SAVE_TASK drafts point at (projectId 'proj1' /
// statusId 'status1'), so the reducer's reference-existence guard accepts them.
const PROJECT: Project = {
  id: 'proj1',
  clientId: '',
  name: 'Project',
  description: '',
  statusId: 'status1',
  paid: false,
  startDate: '2026-07-06',
  endDate: '2026-07-08',
  departmentId: '',
  serviceTypeId: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const STATUS: Status = { id: 'status1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return { ...base, projects: [PROJECT], statuses: [...base.statuses, STATUS], ...overrides };
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

  it('clears a stale workCategoryId rather than persisting a reference no longer in the dictionary', () => {
    const task = makeTask({ id: 't1', workCategoryId: 'cat1' });
    const state = makeState({
      tasks: [task],
      workCategories: [makeCategory({ id: 'cat1' })],
    });

    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFor(task, { workCategoryId: 'deleted-category' }),
        assigneeIds: [],
        allocations: [],
      },
    });

    expect(next.tasks.find((t) => t.id === 't1')!.workCategoryId).toBe('');
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

  it('DELETE_WORK_CATEGORY removes the row, resets task references, and clears saved filter presets that reference it', () => {
    const referencing = makeTask({ id: 't1', workCategoryId: 'cat1' });
    const other = makeTask({ id: 't2', workCategoryId: 'cat2' });
    const state = makeState({
      tasks: [referencing, other],
      workCategories: [makeCategory({ id: 'cat1' }), makeCategory({ id: 'cat2' })],
      savedFilters: [
        {
          id: 'filter1',
          name: 'Kreacja',
          page: 'tasks',
          criteria: {
            paid: 'all',
            clientId: '',
            statusId: '',
            personId: '',
            priority: '',
            workCategoryId: 'cat1',
            from: '',
            to: '',
          },
        },
      ],
    });

    const next = reducer(state, { type: 'DELETE_WORK_CATEGORY', workCategoryId: 'cat1' });

    expect(next.workCategories.find((c) => c.id === 'cat1')).toBeUndefined();
    expect(next.workCategories).toHaveLength(1);
    expect(next.tasks.find((t) => t.id === 't1')!.workCategoryId).toBe('');
    expect(next.tasks.find((t) => t.id === 't2')!.workCategoryId).toBe('cat2'); // untouched
    expect(next.savedFilters[0].criteria.workCategoryId).toBe('');
  });
});

// The four dictionary RENAME handlers must mirror their ADD_ siblings: trim the
// name and reject an empty/whitespace-only name, plus reject an unknown id — both
// by returning the SAME state reference (invariant 6). Without these guards an
// empty rename persisted a blank row and a stale id was a silent no-op that still
// allocated a new array.
describe('Dictionary rename guards (trim + existence, same-ref reject)', () => {
  it('RENAME_CLIENT: trims a valid name; rejects empty/whitespace and unknown id by same ref', () => {
    const state = makeState({ clients: [{ id: 'c1', name: 'Klient', archived: false }] });

    const renamed = reducer(state, { type: 'RENAME_CLIENT', clientId: 'c1', name: '  Nowa nazwa  ' });
    expect(renamed).not.toBe(state);
    expect(renamed.clients.find((c) => c.id === 'c1')!.name).toBe('Nowa nazwa');

    expect(reducer(state, { type: 'RENAME_CLIENT', clientId: 'c1', name: '   ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_CLIENT', clientId: 'c1', name: '' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_CLIENT', clientId: 'ghost', name: 'X' })).toBe(state);
  });

  it('SAVE_CLIENT: trims name + contact fields; rejects empty name and unknown id by same ref', () => {
    const state = makeState({ clients: [{ id: 'c1', name: 'Klient', archived: false }] });

    const saved = reducer(state, {
      type: 'SAVE_CLIENT',
      clientId: 'c1',
      name: '  Acme  ',
      contactName: ' Anna Nowak ',
      contactEmail: ' anna@acme.pl ',
      contactPhone: ' +48 600 100 200 ',
      notes: ' VIP ',
    });
    expect(saved).not.toBe(state);
    expect(saved.clients.find((c) => c.id === 'c1')).toMatchObject({
      name: 'Acme',
      contactName: 'Anna Nowak',
      contactEmail: 'anna@acme.pl',
      contactPhone: '+48 600 100 200',
      notes: 'VIP',
    });

    const rejectBase = { contactName: '', contactEmail: '', contactPhone: '', notes: '' };
    expect(reducer(state, { type: 'SAVE_CLIENT', clientId: 'c1', name: '   ', ...rejectBase })).toBe(state);
    expect(reducer(state, { type: 'SAVE_CLIENT', clientId: 'ghost', name: 'X', ...rejectBase })).toBe(state);
  });

  it('SET_CLIENT_ARCHIVED: toggles; no-op value and unknown id keep the same ref', () => {
    const state = makeState({ clients: [{ id: 'c1', name: 'Klient', archived: false }] });

    const archived = reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'c1', archived: true });
    expect(archived).not.toBe(state);
    expect(archived.clients[0].archived).toBe(true);

    expect(reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'c1', archived: false })).toBe(state);
    expect(reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'ghost', archived: true })).toBe(state);
  });

  it('ADD_CLIENT: przycina i zapisuje dane kontaktowe', () => {
    const state = makeState({ clients: [] });
    const next = reducer(state, {
      type: 'ADD_CLIENT',
      name: ' Acme ',
      contactName: ' Jan ',
      contactEmail: ' jan@acme.pl ',
      contactPhone: ' 600 ',
      notes: ' n ',
    });
    expect(next.clients[0]).toMatchObject({
      name: 'Acme',
      contactName: 'Jan',
      contactEmail: 'jan@acme.pl',
      contactPhone: '600',
      notes: 'n',
      archived: false,
    });
  });

  it('RENAME_DEPARTMENT: trims a valid name; rejects empty/whitespace and unknown id by same ref', () => {
    const state = makeState({ departments: [{ id: 'd1', name: 'Dział' }] });

    const renamed = reducer(state, { type: 'RENAME_DEPARTMENT', departmentId: 'd1', name: '  Kreacja  ' });
    expect(renamed).not.toBe(state);
    expect(renamed.departments.find((d) => d.id === 'd1')!.name).toBe('Kreacja');

    expect(reducer(state, { type: 'RENAME_DEPARTMENT', departmentId: 'd1', name: '   ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_DEPARTMENT', departmentId: 'ghost', name: 'X' })).toBe(state);
  });

  it('RENAME_SERVICE_TYPE: trims a valid name; rejects empty/whitespace and unknown id by same ref', () => {
    const state = makeState({ serviceTypes: [{ id: 's1', name: 'Usługa' }] });

    const renamed = reducer(state, { type: 'RENAME_SERVICE_TYPE', serviceTypeId: 's1', name: '  Montaż  ' });
    expect(renamed).not.toBe(state);
    expect(renamed.serviceTypes.find((s) => s.id === 's1')!.name).toBe('Montaż');

    expect(reducer(state, { type: 'RENAME_SERVICE_TYPE', serviceTypeId: 's1', name: '   ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_SERVICE_TYPE', serviceTypeId: 'ghost', name: 'X' })).toBe(state);
  });

  it('RENAME_WORK_CATEGORY: trims a valid name; rejects empty/whitespace and unknown id by same ref', () => {
    const state = makeState({ workCategories: [makeCategory({ id: 'cat1', name: 'Kreacja' })] });

    const renamed = reducer(state, { type: 'RENAME_WORK_CATEGORY', workCategoryId: 'cat1', name: '  Design  ' });
    expect(renamed).not.toBe(state);
    expect(renamed.workCategories.find((c) => c.id === 'cat1')!.name).toBe('Design');

    expect(reducer(state, { type: 'RENAME_WORK_CATEGORY', workCategoryId: 'cat1', name: '   ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_WORK_CATEGORY', workCategoryId: 'ghost', name: 'X' })).toBe(state);
  });
});

// ADD_PERSON / UPDATE_PERSON clamp capacity into the UI's [1, 24] hours/day band
// at the reducer boundary. The number input declares min=1/max=24 but does not
// enforce the max on typed input, so 999 could otherwise persist. Clamp (never
// reject) mirrors the UI's silent min-correction.
function personDraft(overrides: Partial<PersonDraft> = {}): PersonDraft {
  return {
    firstName: 'Nowy',
    lastName: '',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Test',
    lastName: '',
    name: 'Test',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'administrator',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

describe('Person capacity clamp (defense-in-depth [1, 24])', () => {
  it('ADD_PERSON clamps an over-max capacity (999) down to 24', () => {
    const next = reducer(makeState(), { type: 'ADD_PERSON', person: personDraft({ capacity: 999 }) });
    expect(next.people).toHaveLength(1);
    expect(next.people[0].capacity).toBe(24);
  });

  it('ADD_PERSON clamps a zero capacity up to 1 (reducer floor; the UI rewrites 0→8 before dispatch)', () => {
    const next = reducer(makeState(), { type: 'ADD_PERSON', person: personDraft({ capacity: 0 }) });
    expect(next.people).toHaveLength(1);
    expect(next.people[0].capacity).toBe(1);
  });

  it('UPDATE_PERSON clamps an over-max capacity (999) down to 24', () => {
    // Keep the administrator role: p1 is the only admin, so a demotion would be
    // refused by the last-admin guard and never reach the capacity clamp.
    const state = makeState({ people: [makePerson({ id: 'p1', capacity: 8 })] });
    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: personDraft({ firstName: 'Ala', accessRole: 'administrator', capacity: 999 }),
    });
    expect(next.people.find((p) => p.id === 'p1')!.capacity).toBe(24);
  });
});
