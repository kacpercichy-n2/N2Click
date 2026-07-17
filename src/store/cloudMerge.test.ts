// Focused tests for the MERGE_CLOUD_ENTITIES reducer action (cloud hydration).
// AUTHORITATIVE: the cloud payload replaces the mirrored collections (local-only
// rows drop — hydration runs once per sign-in with an empty push queue), while
// assignment ids stay stable by (taskId, personId) pair and people/statuses/
// savedFilters pass through untouched unless payload.people is present. An
// invalid payload returns the ORIGINAL state reference (invariant 6).
// Pure — no React, no Supabase.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { CloudMergePayload } from '../supabase/plannerData';
import type {
  ActivityEvent,
  AppData,
  Client,
  Comment,
  Milestone,
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
  return {
    clients: [],
    projects: [],
    milestones: [],
    tasks: [],
    assignments: [],
    workload: [],
    comments: [],
    activity: [],
  };
}

const merge = (state: AppData, payload: CloudMergePayload): AppData =>
  reducer(state, { type: 'MERGE_CLOUD_ENTITIES', payload });

describe('MERGE_CLOUD_ENTITIES — merge semantics', () => {
  it('replaces same-id rows and appends cloud-only rows (payload = truth)', () => {
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

  it('drops a local-only project absent from the cloud payload (authoritative)', () => {
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
    expect(next.projects.find((p) => p.id === 'proj-local')).toBeUndefined();
    expect(next.projects).toHaveLength(1);
  });

  it('preserves assignment ids by (taskId, personId) pair; pairs unknown to the cloud are dropped', () => {
    const state = baseState();
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
      assignments: [
        { taskId: T1, personId: P1 }, // existing pair
        { taskId: T1, personId: P2 }, // new pair
      ],
    };
    const next = merge(state, payload);

    // Existing pair keeps its id; new pair gets a fresh id; local-only dropped.
    const byPair = new Map(next.assignments.map((a) => [`${a.taskId}|${a.personId}`, a]));
    expect(byPair.get(`${T1}|${P1}`)!.id).toBe('asg-existing');
    expect(byPair.get(`${T1}|${P3}`)).toBeUndefined();
    const fresh = byPair.get(`${T1}|${P2}`)!;
    expect(fresh.id).not.toBe('');
    expect(next.assignments).toHaveLength(2);
  });

  it('leaves people/statuses/savedFilters reference-identical; planner collections follow the payload', () => {
    const state = baseState();
    const next = merge(state, {
      ...emptyPayload(),
      clients: [client({ id: 'c-cloud', name: 'X' })],
    });
    // Bez payload.people zespół pozostaje nietknięty; słowniki ma
    // MERGE_CLOUD_DICTIONARIES; filtry są lokalne per-użytkownik.
    expect(next.people).toBe(state.people);
    expect(next.statuses).toBe(state.statuses);
    expect(next.savedFilters).toBe(state.savedFilters);
    // Autorytatywnie: kolekcje planera odpowiadają dokładnie ładunkowi.
    expect(next.workload).toEqual([]);
    expect(next.milestones).toEqual([]);
    expect(next.clients.map((c) => c.id)).toEqual(['c-cloud']);
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

describe('MERGE_CLOUD_ENTITIES — milestones + workload merge', () => {
  it('replaces milestones with the cloud payload (local-only dropped)', () => {
    const state: AppData = {
      ...baseState(),
      milestones: [
        { id: 'ms-1', projectId: 'proj-1', name: 'Lokalny', date: '2026-07-08' },
        { id: 'ms-local', projectId: 'proj-1', name: 'Tylko lokalny', date: '2026-07-09' },
      ],
    };
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1' })],
      milestones: [
        { id: 'ms-1', projectId: 'proj-1', name: 'Z chmury', date: '2026-07-08' },
        { id: 'ms-cloud', projectId: 'proj-1', name: 'Nowy', date: '2026-07-10' },
      ],
    };
    const next = merge(state, payload);
    expect(next.milestones.find((m) => m.id === 'ms-1')!.name).toBe('Z chmury');
    expect(next.milestones.find((m) => m.id === 'ms-cloud')).toBeDefined();
    expect(next.milestones.find((m) => m.id === 'ms-local')).toBeUndefined();
    expect(next.milestones).toHaveLength(2);
  });

  it('replaces workload with the cloud payload (dated rows by id)', () => {
    const state = baseState(); // workload: [w1] dated
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
      workload: [
        wl({ id: 'w1', plannedHours: 4 }), // replace same id
        wl({ id: 'w-cloud', plannedHours: 1 }), // cloud-only append
      ],
    };
    const next = merge(state, payload);
    expect(next.workload.find((w) => w.id === 'w1')!.plannedHours).toBe(4);
    expect(next.workload.find((w) => w.id === 'w-cloud')).toBeDefined();
    expect(next.workload).toHaveLength(2);
  });

  it('bin pair: wiersz chmury wygrywa autorytatywnie (lokalny duplikat pary znika)', () => {
    const state: AppData = {
      ...baseState(),
      workload: [
        wl({ id: 'w1' }),
        { id: 'bin-local', taskId: T1, personId: P1, date: '', plannedHours: 2, startMinutes: 0, sortIndex: 0 },
      ],
    };
    const payload: CloudMergePayload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
      workload: [{ id: 'bin-cloud', taskId: T1, personId: P1, date: '', plannedHours: 3, startMinutes: 0, sortIndex: 0 }],
    };
    const next = merge(state, payload);
    // Chmura jest prawdą: zostaje wyłącznie wiersz chmury z jej godzinami;
    // jeden wiersz zasobnika na parę (invariant 4) zachowany konstrukcyjnie.
    expect(next.workload).toHaveLength(1);
    const survivor = next.workload[0];
    expect(survivor.id).toBe('bin-cloud');
    expect(survivor.plannedHours).toBe(3);
  });
});

describe('MERGE_CLOUD_ENTITIES — fail-closed (invariant 6)', () => {
  it('rejects an off-grid or day-overflowing workload row', () => {
    const state = baseState();
    expect(merge(state, { ...emptyPayload(), workload: [wl({ id: 'w2', plannedHours: 0.3 })] })).toBe(state);
    expect(
      merge(state, { ...emptyPayload(), workload: [wl({ id: 'w2', startMinutes: 1425, plannedHours: 2 })] }),
    ).toBe(state);
  });

  it('rejects a workload row referencing a missing task or person', () => {
    const state = baseState();
    const withTask = {
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
    };
    expect(
      merge(state, { ...emptyPayload(), ...withTask, workload: [wl({ id: 'w2', taskId: 'ghost' })] }),
    ).toBe(state);
    expect(
      merge(state, { ...emptyPayload(), ...withTask, workload: [wl({ id: 'w2', personId: 'ghost' })] }),
    ).toBe(state);
  });

  it('rejects a milestone with an invalid date or missing project', () => {
    const state = baseState();
    const bad = (o: Partial<Milestone>): Milestone => ({ id: 'm', projectId: 'proj-1', name: 'M', date: '2026-07-08', ...o });
    const withProject = { projects: [makeProject({ id: 'proj-1' })] };
    expect(
      merge(state, { ...emptyPayload(), ...withProject, milestones: [bad({ date: 'nie-data' })] }),
    ).toBe(state);
    expect(
      merge(state, { ...emptyPayload(), ...withProject, milestones: [bad({ projectId: 'ghost' })] }),
    ).toBe(state);
  });

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
    const withTask = {
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
    };
    expect(
      merge(state, { ...emptyPayload(), ...withTask, assignments: [{ taskId: 'ghost', personId: P1 }] }),
    ).toBe(state);
    expect(
      merge(state, { ...emptyPayload(), ...withTask, assignments: [{ taskId: T1, personId: 'ghost' }] }),
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
    const payload = {
      ...emptyPayload(),
      projects: [makeProject({ id: 'proj-1' })],
      tasks: [makeTask({ id: T1, projectId: 'proj-1' })],
      assignments: [{ taskId: T1, personId: P2 }],
    };
    const next = merge(state, payload);
    const added = next.assignments.find((a: TaskAssignment) => a.taskId === T1 && a.personId === P2);
    expect(added).toBeDefined();
    expect(typeof added!.id).toBe('string');
  });
});

// ---- MERGE_CLOUD_PEOPLE (pełna synchronizacja osób) --------------------------

import type { CloudPersonMergeRow } from '../supabase/referenceData';

function cloudRow(o: Partial<CloudPersonMergeRow> & { id: string; email: string }): CloudPersonMergeRow {
  return {
    firstName: 'Chmura',
    lastName: 'Osoba',
    role: '',
    departmentId: '',
    phone: '',
    avatar: '',
    capacity: 8,
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    accessRole: 'pracownik',
    supervisorEmail: '',
    ...o,
  };
}

describe('MERGE_CLOUD_PEOPLE', () => {
  const UUID_K = 'a1a1a1a1-0000-0000-0000-000000000001';
  const UUID_Z = 'a1a1a1a1-0000-0000-0000-000000000002';

  it('aktualizuje istniejącą osobę po e-mailu (lokalne id i hasło zostają, dział z chmury)', () => {
    const state: AppData = {
      ...baseState(),
      people: [
        { ...person(P1), email: 'kacper@x.pl', passwordHash: 'h', departmentId: 'd-local', accessRole: 'pracownik' },
      ],
    };
    const next = reducer(state, {
      type: 'MERGE_CLOUD_PEOPLE',
      payload: [
        cloudRow({ id: UUID_K, email: 'Kacper@X.PL', firstName: 'Kacper', lastName: 'Cichy', role: 'Menadżer', departmentId: 'd-cloud', accessRole: 'administrator', capacity: 6 }),
      ],
    });
    expect(next).not.toBe(state);
    expect(next.people).toHaveLength(1);
    const p = next.people[0];
    expect(p.id).toBe(P1); // lokalne id zachowane
    expect(p.passwordHash).toBe('h');
    expect(p.departmentId).toBe('d-cloud'); // dział jest prawdą chmury
    expect(p).toMatchObject({ firstName: 'Kacper', lastName: 'Cichy', name: 'Kacper Cichy', role: 'Menadżer', accessRole: 'administrator', capacity: 6 });
  });

  it('tworzy brakującą osobę z id profilu chmury i rozwiązuje przełożonego po e-mailu', () => {
    const state: AppData = { ...baseState(), people: [] };
    const next = reducer(state, {
      type: 'MERGE_CLOUD_PEOPLE',
      payload: [
        cloudRow({ id: UUID_K, email: 'kacper@x.pl', firstName: 'Kacper' }),
        cloudRow({ id: UUID_Z, email: 'zuza@x.pl', firstName: 'Zuzanna', supervisorEmail: 'kacper@x.pl' }),
      ],
    });
    expect(next.people).toHaveLength(2);
    const zuza = next.people.find((p) => p.id === UUID_Z)!;
    expect(zuza.supervisorId).toBe(UUID_K);
    expect(next.people.find((p) => p.id === UUID_K)!.passwordHash).toBe('');
  });

  it('usuwa osoby lokalne bez konta chmury (dane demo); scalenie jest idempotentne', () => {
    const state: AppData = { ...baseState(), people: [{ ...person(P1) }] };
    const payload = [cloudRow({ id: UUID_K, email: 'kacper@x.pl', firstName: 'Kacper' })];
    const next = reducer(state, { type: 'MERGE_CLOUD_PEOPLE', payload });
    // Chmura jest prawdą o zespole: osoba bez konta chmury znika.
    expect(next.people.map((p) => p.id)).toEqual([UUID_K]);
    // Idempotencja: ten sam payload na już scalonym stanie => ta sama referencja.
    const again = reducer(next, { type: 'MERGE_CLOUD_PEOPLE', payload });
    expect(again).toBe(next);
  });

  it('FAIL-CLOSED: pusty payload przy niepustym zespole => ta sama referencja (anomalia RLS nie kasuje zespołu)', () => {
    const state: AppData = { ...baseState(), people: [{ ...person(P1) }] };
    expect(reducer(state, { type: 'MERGE_CLOUD_PEOPLE', payload: [] })).toBe(state);
    // Pusty payload przy pustym zespole to legalny no-op (świeża organizacja).
    const emptyState: AppData = { ...baseState(), people: [] };
    expect(reducer(emptyState, { type: 'MERGE_CLOUD_PEOPLE', payload: [] })).toBe(emptyState);
  });

  it('przełożony spoza widocznego zbioru lub cykl => supervisorId pusty', () => {
    const state: AppData = { ...baseState(), people: [] };
    const next = reducer(state, {
      type: 'MERGE_CLOUD_PEOPLE',
      payload: [cloudRow({ id: UUID_K, email: 'kacper@x.pl', supervisorEmail: 'niewidoczny@x.pl' })],
    });
    expect(next.people[0].supervisorId).toBe('');
    // Samowskazanie (jedyny możliwy cykl w pojedynczym wierszu).
    const self = reducer(state, {
      type: 'MERGE_CLOUD_PEOPLE',
      payload: [cloudRow({ id: UUID_K, email: 'kacper@x.pl', supervisorEmail: 'kacper@x.pl' })],
    });
    expect(self.people[0].supervisorId).toBe('');
  });

  it('niepoprawny payload => oryginalna referencja stanu (invariant 6)', () => {
    const state = baseState();
    const bad = [
      cloudRow({ id: '', email: 'a@x.pl' }),
      cloudRow({ id: UUID_K, email: '' }),
      cloudRow({ id: UUID_K, email: 'a@x.pl', firstName: '   ' }),
      cloudRow({ id: UUID_K, email: 'a@x.pl', capacity: 99 }),
      cloudRow({ id: UUID_K, email: 'a@x.pl', workDays: [0, 9] }),
      cloudRow({ id: UUID_K, email: 'a@x.pl', workStartMinutes: -1 }),
    ];
    for (const row of bad) {
      expect(reducer(state, { type: 'MERGE_CLOUD_PEOPLE', payload: [row] })).toBe(state);
    }
    expect(
      reducer(state, { type: 'MERGE_CLOUD_PEOPLE', payload: 'zle' as unknown as CloudPersonMergeRow[] }),
    ).toBe(state);
  });

  it('nie dotyka innych kolekcji (referencje) i nie dopisuje aktywności', () => {
    const state: AppData = { ...baseState(), people: [] };
    const next = reducer(state, {
      type: 'MERGE_CLOUD_PEOPLE',
      payload: [cloudRow({ id: UUID_K, email: 'kacper@x.pl' })],
    });
    expect(next.tasks).toBe(state.tasks);
    expect(next.statuses).toBe(state.statuses);
    expect(next.workload).toBe(state.workload);
    expect(next.activity).toBe(state.activity);
  });
});
