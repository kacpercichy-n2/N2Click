// Focused tests for the MERGE_CLOUD_ENTITIES reducer action (cloud hydration).
// Merge never destroys local work: same-id replace, local-only kept, cloud-only
// appended, assignment ids preserved by (taskId, personId) pair, non-mirrored
// collections reference-identical. An invalid payload returns the ORIGINAL state
// reference (invariant 6). Pure — no React, no Supabase.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { CloudMergePayload } from '../supabase/plannerData';
import type {
  ActivityEvent,
  AppData,
  Client,
  Comment,
  Project,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';

const P1 = 'person-1';
const P2 = 'person-2';
const P3 = 'person-3';
const T1 = 'task-1';
const T2 = 'task-2';

function makeProject(o: Partial<Project> & { id: string }): Project {
  return {
    clientId: '',
    name: 'Projekt',
    description: '',
    statusId: '',
    paid: false,
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    departmentId: '',
    serviceTypeId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  };
}

function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj-1',
    statusId: '',
    title: 'Zadanie',
    description: '',
    startDate: '2026-07-06',
    endDate: '2026-07-08',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    checklist: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  };
}

const client = (o: Partial<Client> & { id: string }): Client => ({
  name: 'Klient',
  archived: false,
  ...o,
});

const wl = (o: Partial<WorkloadEntry> & { id: string }): WorkloadEntry => ({
  taskId: T1,
  personId: P1,
  date: '2026-07-06',
  plannedHours: 2,
  startMinutes: 480,
  sortIndex: 0,
  ...o,
});

function baseState(): AppData {
  return {
    ...emptyData(),
    people: [
      { ...person(P1) },
      { ...person(P2) },
      { ...person(P3) },
    ],
    projects: [makeProject({ id: 'proj-1', name: 'Lokalny' })],
    tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
    assignments: [
      { id: 'asg-existing', taskId: T1, personId: P1 },
      { id: 'asg-local-only', taskId: T1, personId: P3 },
    ],
    workload: [wl({ id: 'w1' })],
    clients: [client({ id: 'c-local', name: 'Tylko lokalny' })],
  };
}

function person(id: string) {
  return {
    id,
    firstName: 'A',
    lastName: 'B',
    name: 'A B',
    email: `${id}@example.com`,
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik' as const,
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
  };
}

function emptyPayload(): CloudMergePayload {
  return { clients: [], projects: [], tasks: [], assignments: [], comments: [], activity: [] };
}

const merge = (state: AppData, payload: CloudMergePayload): AppData =>
  reducer(state, { type: 'MERGE_CLOUD_ENTITIES', payload });

describe('MERGE_CLOUD_ENTITIES — merge semantics', () => {
  it('replaces same-id rows, appends cloud-only, keeps local-only', () => {
    const state = baseState();
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      clients: [
        client({ id: 'c-local', name: 'Zaktualizowany w chmurze' }), // replace by id
        client({ id: 'c-cloud', name: 'Nowy z chmury' }), // cloud-only append
      ],
      projects: [makeProject({ id: 'proj-1', name: 'Zmieniony w chmurze' })],
      tasks: [],
    };
    const next = merge(state, payload);

    // Client replaced by id, cloud-only appended, none lost.
    expect(next.clients.find((c) => c.id === 'c-local')!.name).toBe('Zaktualizowany w chmurze');
    expect(next.clients.find((c) => c.id === 'c-cloud')!.name).toBe('Nowy z chmury');
    expect(next.clients).toHaveLength(2);

    // Project replaced in place.
    expect(next.projects.find((p) => p.id === 'proj-1')!.name).toBe('Zmieniony w chmurze');
    expect(next.projects).toHaveLength(1);
  });

  it('keeps a local-only project absent from the cloud payload', () => {
    const state: AppData = {
      ...baseState(),
      projects: [
        makeProject({ id: 'proj-1', name: 'Lokalny' }),
        makeProject({ id: 'proj-local', name: 'Tylko lokalny' }),
      ],
    };
    const next = merge(state, {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1', name: 'Z chmury' })],
    });
    expect(next.projects.find((p) => p.id === 'proj-local')).toBeDefined();
    expect(next.projects).toHaveLength(2);
  });

  it('preserves assignment ids by (taskId, personId) pair and appends new pairs', () => {
    const state = baseState();
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      assignments: [
        { taskId: T1, personId: P1 }, // existing pair
        { taskId: T1, personId: P2 }, // new pair
      ],
    };
    const next = merge(state, payload);

    // Existing pair keeps its id; local-only pair kept; new pair added w/ fresh id.
    const byPair = new Map(next.assignments.map((a) => [`${a.taskId}|${a.personId}`, a]));
    expect(byPair.get(`${T1}|${P1}`)!.id).toBe('asg-existing');
    expect(byPair.get(`${T1}|${P3}`)!.id).toBe('asg-local-only');
    const fresh = byPair.get(`${T1}|${P2}`)!;
    expect(fresh.id).not.toBe('');
    expect(next.assignments).toHaveLength(3);
  });

  it('leaves workload/people/statuses/milestones/savedFilters reference-identical', () => {
    const state = baseState();
    const next = merge(state, {
      ...emptyPayload(),
      clients: [client({ id: 'c-cloud', name: 'X' })],
    });
    expect(next.workload).toBe(state.workload);
    expect(next.people).toBe(state.people);
    expect(next.statuses).toBe(state.statuses);
    expect(next.milestones).toBe(state.milestones);
    expect(next.savedFilters).toBe(state.savedFilters);
  });

  it('merges cloud comments and activity, appending by id (append semantics)', () => {
    const state = baseState();
    const cloudComment: Comment = {
      id: 'cm-cloud',
      entityType: 'task',
      entityId: T1,
      authorId: P1,
      body: 'Z chmury',
      mentionIds: [],
      createdAt: '2026-07-16T00:00:00.000Z',
    };
    const cloudActivity: ActivityEvent = {
      id: 'ac-cloud',
      entityType: 'task',
      entityId: T1,
      actorId: P1,
      message: 'zaktualizował(a) zadanie',
      createdAt: '2026-07-16T00:00:00.000Z',
    };
    const next = merge(state, {
      ...emptyPayload(),
      comments: [cloudComment],
      activity: [cloudActivity],
    });
    expect(next.comments.find((c) => c.id === 'cm-cloud')).toBeDefined();
    expect(next.activity.find((a) => a.id === 'ac-cloud')).toBeDefined();
  });
});

describe('MERGE_CLOUD_ENTITIES — fail-closed (invariant 6)', () => {
  it('returns the ORIGINAL state reference for a non-array collection', () => {
    const state = baseState();
    const bad = { ...emptyPayload(), projects: null as unknown as Project[] };
    expect(merge(state, bad)).toBe(state);
  });

  it('rejects a task with an invalid period', () => {
    const state = baseState();
    const bad: CloudMergePayload = {
      ...emptyPayload(),
      tasks: [makeTask({ id: T2, projectId: 'proj-1', startDate: '2026-07-10', endDate: '2026-07-01' })],
    };
    expect(merge(state, bad)).toBe(state);
  });

  it('rejects a task referencing a missing project', () => {
    const state = baseState();
    const bad: CloudMergePayload = {
      ...emptyPayload(),
      tasks: [makeTask({ id: T2, projectId: 'ghost-project' })],
    };
    expect(merge(state, bad)).toBe(state);
  });

  it('rejects an assignment referencing a missing task or person', () => {
    const state = baseState();
    expect(
      merge(state, { ...emptyPayload(), assignments: [{ taskId: 'ghost', personId: P1 }] }),
    ).toBe(state);
    expect(
      merge(state, { ...emptyPayload(), assignments: [{ taskId: T1, personId: 'ghost' }] }),
    ).toBe(state);
  });

  it('rejects a row with no string id', () => {
    const state = baseState();
    const bad = {
      ...emptyPayload(),
      clients: [{ name: 'Bez id', archived: false } as unknown as Client],
    };
    expect(merge(state, bad)).toBe(state);
  });

  it('accepts a task whose project arrives in the SAME payload', () => {
    const state = baseState();
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-cloud' })],
      tasks: [makeTask({ id: T2, projectId: 'proj-cloud' })],
    };
    const next = merge(state, payload);
    expect(next).not.toBe(state);
    expect(next.tasks.find((t) => t.id === T2)).toBeDefined();
  });

  it('handles cloud-provided TaskAssignment-shaped objects without extra fields', () => {
    const state = baseState();
    const payload = { ...emptyPayload(), assignments: [{ taskId: T1, personId: P2 }] };
    const next = merge(state, payload);
    const added = next.assignments.find((a: TaskAssignment) => a.taskId === T1 && a.personId === P2);
    expect(added).toBeDefined();
    expect(typeof added!.id).toBe('string');
  });
});
