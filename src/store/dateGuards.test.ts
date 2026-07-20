// Unit tests for the reducer's date guards added by PKG-20260712-date-validation-core
// (periodError / isValidDateStr wired into SAVE_PROJECT, SAVE_TASK, SET_TASK_DATES,
// SET_PROJECT_DATES, SAVE_MILESTONE, MOVE_MILESTONE). Pure reducer tests: no React
// rendering, no localStorage — build a minimal valid AppData fixture by hand.
import { describe, expect, it } from 'vitest';
import { reducer, type ProjectDraft, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import { addDaysStr, MAX_TASK_PERIOD_DAYS } from '../utils/dates';
import type { Client, Milestone, Person, Project, Status, Task } from '../types';

const CLIENT: Client = { id: 'c1', name: 'Client', archived: false };
const STATUS: Status = { id: 's1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const PROJECT: Project = {
  id: 'proj1',
  clientId: 'c1',
  name: 'Project',
  description: '',
  statusId: 's1',
  paid: false,
  startDate: '2026-07-06',
  endDate: '2026-07-12',
  departmentId: '',
  serviceTypeId: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const TASK: Task = {
  id: 't1',
  projectId: 'proj1',
  statusId: 's1',
  title: 'Task',
  description: '',
  startDate: '2026-07-06',
  endDate: '2026-07-08',
  estimatedHours: null,
  priority: 'normal',
  workCategoryId: '',
  departmentId: '',
  checklist: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const MILESTONE: Milestone = { id: 'm1', projectId: 'proj1', name: 'Milestone', date: '2026-07-07' };
const PERSON: Person = {
  id: 'p1',
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
};

/** Minimal valid AppData: one client, one status, one project, one task, one
 *  milestone, one person — fresh per call so each test owns its own object. */
function makeState() {
  return {
    ...emptyData(),
    clients: [CLIENT],
    statuses: [STATUS],
    projects: [PROJECT],
    tasks: [TASK],
    milestones: [MILESTONE],
    people: [PERSON],
  };
}

function draftFromProject(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    clientId: PROJECT.clientId,
    name: PROJECT.name,
    description: PROJECT.description,
    statusId: PROJECT.statusId,
    paid: PROJECT.paid,
    startDate: PROJECT.startDate,
    endDate: PROJECT.endDate,
    departmentId: PROJECT.departmentId,
    serviceTypeId: PROJECT.serviceTypeId,
    ...overrides,
  };
}

function draftFromTask(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    projectId: TASK.projectId,
    statusId: TASK.statusId,
    title: TASK.title,
    description: TASK.description,
    startDate: TASK.startDate,
    endDate: TASK.endDate,
    estimatedHours: TASK.estimatedHours,
    priority: TASK.priority,
    workCategoryId: TASK.workCategoryId,
    departmentId: TASK.departmentId,
    checklist: TASK.checklist,
    ...overrides,
  };
}

describe('SAVE_PROJECT date guard', () => {
  it('rejects an empty startDate (THE blank-screen repro): same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: 'proj1',
      draft: draftFromProject({ startDate: '', endDate: '2026-07-12' }),
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects an invalid endDate (2026-02-31): same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: 'proj1',
      draft: draftFromProject({ startDate: '2026-07-06', endDate: '2026-02-31' }),
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a reversed period (end before start): same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: 'proj1',
      draft: draftFromProject({ startDate: '2026-07-12', endDate: '2026-07-06' }),
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('accepts a valid draft: NOT rejected, project list grows on create', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: null,
      draft: draftFromProject({ name: 'New project', startDate: '2026-08-01', endDate: '2026-08-10' }),
    });
    expect(next).not.toBe(state);
    expect(next.projects.length).toBe(state.projects.length + 1);
  });
});

describe('SAVE_TASK date guard', () => {
  it('rejects an empty startDate: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask({ startDate: '', endDate: '2026-07-08' }),
        assigneeIds: [],
        allocations: [],
      },
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a garbage endDate: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask({ startDate: '2026-07-06', endDate: 'not-a-date' }),
        assigneeIds: [],
        allocations: [],
      },
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a reversed period: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask({ startDate: '2026-07-08', endDate: '2026-07-06' }),
        assigneeIds: [],
        allocations: [],
      },
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a 93-day period (over the MAX_TASK_PERIOD_DAYS cap): same state reference, no new activity row', () => {
    const state = makeState();
    const start = '2026-07-06';
    const end = addDaysStr(start, MAX_TASK_PERIOD_DAYS); // inclusive day count = 93
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask({ startDate: start, endDate: end }),
        assigneeIds: [],
        allocations: [],
      },
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('accepts a 92-day period (exactly at the MAX_TASK_PERIOD_DAYS cap): NOT rejected', () => {
    const state = makeState();
    const start = '2026-07-06';
    const end = addDaysStr(start, MAX_TASK_PERIOD_DAYS - 1); // inclusive day count = 92
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask({ startDate: start, endDate: end }),
        assigneeIds: [],
        allocations: [],
      },
    });
    expect(next).not.toBe(state);
    const saved = next.tasks.find((t) => t.id === 't1')!;
    expect(saved.startDate).toBe(start);
    expect(saved.endDate).toBe(end);
  });
});

describe('SET_TASK_DATES date guard', () => {
  it('rejects an invalid pair (empty startDate): same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_TASK_DATES', taskId: 't1', startDate: '', endDate: '2026-07-08' });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a reversed pair: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_TASK_DATES',
      taskId: 't1',
      startDate: '2026-07-08',
      endDate: '2026-07-06',
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('applies a valid pair: task dates change', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_TASK_DATES',
      taskId: 't1',
      startDate: '2026-07-05',
      endDate: '2026-07-09',
    });
    expect(next).not.toBe(state);
    const task = next.tasks.find((t) => t.id === 't1')!;
    expect(task.startDate).toBe('2026-07-05');
    expect(task.endDate).toBe('2026-07-09');
  });
});

describe('SET_PROJECT_DATES date guard', () => {
  it('rejects an invalid pair (garbage endDate): same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_PROJECT_DATES',
      projectId: 'proj1',
      startDate: '2026-07-06',
      endDate: 'garbage',
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a reversed pair: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_PROJECT_DATES',
      projectId: 'proj1',
      startDate: '2026-07-12',
      endDate: '2026-07-06',
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('applies a valid pair: project dates change', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_PROJECT_DATES',
      projectId: 'proj1',
      startDate: '2026-07-01',
      endDate: '2026-07-20',
    });
    expect(next).not.toBe(state);
    const project = next.projects.find((p) => p.id === 'proj1')!;
    expect(project.startDate).toBe('2026-07-01');
    expect(project.endDate).toBe('2026-07-20');
  });
});

describe('SAVE_MILESTONE date guard', () => {
  it("rejects an empty date ('') on create: same state reference, no new activity row", () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: 'proj1',
      name: 'New milestone',
      date: '',
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a garbage date on edit: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: 'm1',
      projectId: 'proj1',
      name: 'Milestone',
      date: 'not-a-date',
    });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('applies a valid date on edit: milestone date changes', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: 'm1',
      projectId: 'proj1',
      name: 'Milestone',
      date: '2026-07-09',
    });
    expect(next).not.toBe(state);
    const milestone = next.milestones.find((m) => m.id === 'm1')!;
    expect(milestone.date).toBe('2026-07-09');
  });
});

describe('MOVE_MILESTONE date guard', () => {
  it("rejects an empty date (''): same state reference, no new activity row", () => {
    const state = makeState();
    const next = reducer(state, { type: 'MOVE_MILESTONE', milestoneId: 'm1', date: '' });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('rejects a garbage date: same state reference, no new activity row', () => {
    const state = makeState();
    const next = reducer(state, { type: 'MOVE_MILESTONE', milestoneId: 'm1', date: '2026-13-40' });
    expect(next).toBe(state);
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('applies a valid date: milestone date changes', () => {
    const state = makeState();
    const next = reducer(state, { type: 'MOVE_MILESTONE', milestoneId: 'm1', date: '2026-07-10' });
    expect(next).not.toBe(state);
    const milestone = next.milestones.find((m) => m.id === 'm1')!;
    expect(milestone.date).toBe('2026-07-10');
  });
});
