// Edge-case coverage for the person-scoped filter selectors that back the
// "filtr po osobie" on ProjectsPage (`projectsOfPerson`) and TasksPage
// (`assigneeIdsOfTask`). These two are NOT exercised in selectors.test.ts, so
// this file adds the boundary behavior filtering relies on — distinctness,
// draft exclusion, dangling references and per-task isolation. Pure AppData
// literals, mirroring the fixture style of pages/kanbanBoard.test.ts.
import { describe, expect, it } from 'vitest';
import { assigneeIdsOfTask, projectsOfPerson } from './selectors';
import { emptyData } from './storage';
import type { AppData, Person, Project, Task, TaskAssignment } from '../types';

const PROJ_A: Project = {
  id: 'projA', clientId: 'c1', name: 'Projekt A', description: '', statusId: 's1', paid: true,
  startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const PROJ_B: Project = { ...PROJ_A, id: 'projB', name: 'Projekt B', clientId: 'c2', paid: false };

function makePerson(id: string, firstName: string): Person {
  return {
    id, firstName, lastName: 'Testowy', name: `${firstName} Testowy`, email: '', phone: '',
    role: '', departmentId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
    birthDate: '',
  };
}
const ANNA = makePerson('p1', 'Anna');
const BOGDAN = makePerson('p2', 'Bogdan');

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'projA', statusId: 's1', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}
const assign = (id: string, taskId: string, personId: string): TaskAssignment => ({ id, taskId, personId });

function makeState(overrides: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    projects: [PROJ_A, PROJ_B],
    people: [ANNA, BOGDAN],
    ...overrides,
  };
}

describe('projectsOfPerson — edge cases', () => {
  it('deduplicates: two tasks in the same project yield one project', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', projectId: 'projA' }), makeTask({ id: 't2', projectId: 'projA' })],
      assignments: [assign('a1', 't1', 'p1'), assign('a2', 't2', 'p1')],
    });
    expect(projectsOfPerson(state, 'p1').map((p) => p.id)).toEqual(['projA']);
  });

  it('returns every distinct project a person works on, in projects-list order', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', projectId: 'projB' }), makeTask({ id: 't2', projectId: 'projA' })],
      assignments: [assign('a1', 't1', 'p1'), assign('a2', 't2', 'p1')],
    });
    // Order follows state.projects (A before B), not assignment order.
    expect(projectsOfPerson(state, 'p1').map((p) => p.id)).toEqual(['projA', 'projB']);
  });

  it('excludes projects reached only through a draft task', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', projectId: 'projA', isDraft: true })],
      assignments: [assign('a1', 't1', 'p1')],
    });
    expect(projectsOfPerson(state, 'p1')).toEqual([]);
  });

  it('still surfaces a project when a person has both a draft and a published task in it', () => {
    const state = makeState({
      tasks: [
        makeTask({ id: 't1', projectId: 'projA', isDraft: true }),
        makeTask({ id: 't2', projectId: 'projA' }),
      ],
      assignments: [assign('a1', 't1', 'p1'), assign('a2', 't2', 'p1')],
    });
    expect(projectsOfPerson(state, 'p1').map((p) => p.id)).toEqual(['projA']);
  });

  it('ignores assignments to a task whose project no longer exists', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1', projectId: 'gone' })],
      assignments: [assign('a1', 't1', 'p1')],
    });
    expect(projectsOfPerson(state, 'p1')).toEqual([]);
  });

  it('returns nothing for a person with no assignments', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1', projectId: 'projA' })] });
    expect(projectsOfPerson(state, 'p2')).toEqual([]);
  });
});

describe('assigneeIdsOfTask — edge cases', () => {
  it('lists every person on a task, preserving assignment order', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' })],
      assignments: [assign('a1', 't1', 'p2'), assign('a2', 't1', 'p1')],
    });
    expect(assigneeIdsOfTask(state, 't1')).toEqual(['p2', 'p1']);
  });

  it('returns an empty list for a task with no assignments', () => {
    const state = makeState({ tasks: [makeTask({ id: 't1' })] });
    expect(assigneeIdsOfTask(state, 't1')).toEqual([]);
  });

  it('does not leak assignees from other tasks', () => {
    const state = makeState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      assignments: [assign('a1', 't1', 'p1'), assign('a2', 't2', 'p2')],
    });
    expect(assigneeIdsOfTask(state, 't1')).toEqual(['p1']);
    expect(assigneeIdsOfTask(state, 't2')).toEqual(['p2']);
  });
});
