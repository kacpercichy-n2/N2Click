// Focused tests for the admin-only, read-only export + Supabase migration
// DRY-RUN tool (src/store/exportDryRun.ts) and its side-effect-free storage read
// (peekDataResult in src/store/storage.ts). Covers: a valid export payload is
// sanitized and metadata-stamped; peek has zero side effects (no revision
// mutation, no localStorage write); malformed/invalid/unavailable storage is
// classified without throwing; and the dry-run report's counts, mappings,
// unsupported data and blockers.
import { describe, expect, it } from 'vitest';
import {
  DATA_VERSION,
  emptyData,
  getLatestKnownRevision,
  loadDataResult,
  peekDataResult,
} from './storage';
import { buildDryRunReport, buildExportPayload } from './exportDryRun';
import type { AppData, Person, Project, Task, TaskAssignment } from '../types';

// Mirrors storage.ts's private STORAGE_KEY (not exported) and storage.test.ts.
const STORAGE_KEY = 'n2hub.data.v1';

function withLocalStorage<T>(
  initial: Record<string, string>,
  fn: () => T,
  overrides?: { getItem?: (k: string) => string | null },
): T {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: overrides?.getItem ?? ((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = stub;
  try {
    return fn();
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = prev;
  }
}

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Ann',
    lastName: 'Nowak',
    name: 'Ann Nowak',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> & { id: string }): Project {
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
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1',
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
    ...overrides,
  };
}

function makeAssignment(o: TaskAssignment): TaskAssignment {
  return o;
}

describe('peekDataResult — valid data + zero side effects', () => {
  it('reads a valid v7 payload without mutating latestKnownRevision or localStorage', () => {
    const stored: AppData = {
      ...emptyData(),
      people: [makePerson({ id: 'p1', passwordHash: 'secret-hash' })],
      currentUserId: 'p1',
    };
    // A revision that must NOT be recorded by peek.
    const raw = JSON.stringify({ ...stored, revision: 99 });

    withLocalStorage({ [STORAGE_KEY]: raw }, () => {
      // Reset the module revision counter to a known 0 via the app load path.
      loadDataResult(); // empty payload? no — this reads `raw`. Capture after.
      const before = getLatestKnownRevision();

      const result = peekDataResult();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.storedVersion).toBe(DATA_VERSION);
      expect(result.data.people[0].id).toBe('p1');

      // No side effects: revision unchanged and stored bytes identical.
      expect(getLatestKnownRevision()).toBe(before);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    });
  });

  it('returns emptyData at DATA_VERSION for a missing key (no revision write)', () => {
    withLocalStorage({}, () => {
      const result = peekDataResult();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.storedVersion).toBe(DATA_VERSION);
      expect(result.data.tasks).toEqual([]);
    });
  });
});

describe('buildExportPayload — sanitization + metadata', () => {
  it('strips passwordHash / currentUserId / impersonatorId and stamps format + versions + exportedAt', () => {
    const data: AppData = {
      ...emptyData(),
      people: [
        makePerson({ id: 'p1', passwordHash: 'hash-a' }),
        makePerson({ id: 'p2', passwordHash: 'hash-b' }),
      ],
      currentUserId: 'p1',
      impersonatorId: 'p2',
    };
    const now = new Date('2026-07-16T09:43:27.000Z');
    const payload = buildExportPayload(data, 6, now);

    expect(payload.format).toBe('n2hub-backup');
    expect(payload.appDataVersion).toBe(DATA_VERSION);
    expect(payload.storedVersion).toBe(6);
    expect(payload.exportedAt).toBe('2026-07-16T09:43:27.000Z');
    expect(payload.data.people.every((p) => p.passwordHash === '')).toBe(true);
    expect(payload.data.currentUserId).toBe('');
    expect(payload.data.impersonatorId).toBe('');

    // No credential/session values may appear anywhere in the serialized output.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('hash-a');
    expect(serialized).not.toContain('hash-b');
    // No revision field is added.
    expect('revision' in payload).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload.data, 'revision')).toBe(false);
    // Source data is not mutated.
    expect(data.people[0].passwordHash).toBe('hash-a');
    expect(data.currentUserId).toBe('p1');
  });
});

describe('peekDataResult — malformed / invalid / unavailable', () => {
  it('classifies garbage JSON as malformed', () => {
    withLocalStorage({ [STORAGE_KEY]: '{"version":7' }, () => {
      const result = peekDataResult();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('malformed');
      expect(result.error.message).toMatch(/odczytać zapisanych danych/i);
    });
  });

  it('classifies structurally invalid JSON as invalid', () => {
    // Valid JSON object, but missing the tasks/people/workload arrays.
    withLocalStorage({ [STORAGE_KEY]: JSON.stringify({ version: 7 }) }, () => {
      const result = peekDataResult();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalid');
    });
  });

  it('classifies a throwing storage as unavailable', () => {
    const result = withLocalStorage({}, () => peekDataResult(), {
      getItem: () => {
        throw { name: 'SecurityError' };
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');
  });
});

describe('buildDryRunReport — mapping diagnostics', () => {
  const longName = 'x'.repeat(301);

  function fixture(): AppData {
    const people: Person[] = [
      makePerson({ id: 'admin', accessRole: 'administrator' }),
      makePerson({ id: 'pm', accessRole: 'pm' }),
      makePerson({ id: 'sales', accessRole: 'handlowiec' }),
      makePerson({ id: 'worker', firstName: '', accessRole: 'pracownik' }), // empty firstName -> blocker
    ];
    const projects: Project[] = [makeProject({ id: 'proj1', name: longName })]; // >300 -> blocker
    const tasks: Task[] = [makeTask({ id: 't1', projectId: 'ghost', title: 'OK' })]; // dangling projectId -> blocker
    const assignments: TaskAssignment[] = [
      makeAssignment({ id: 'a1', taskId: 't1', personId: 'admin' }),
      makeAssignment({ id: 'a2', taskId: 't1', personId: 'admin' }), // duplicate pair -> blocker
    ];
    return {
      ...emptyData(),
      statuses: [],
      clients: [{ id: 'c1', name: 'Klient', archived: false }],
      people,
      projects,
      tasks,
      assignments,
    };
  }

  it('reports exactly the four blockers, correct counts, role mapping, person-id remap and unsupported collections', () => {
    const report = buildDryRunReport(fixture());

    // Blockers: project name, empty firstName, dangling task projectId, duplicate assignment.
    expect(report.blockers).toHaveLength(4);
    const byTable = report.blockers.map((b) => `${b.table}:${b.entityId}`).sort();
    expect(byTable).toEqual(
      ['projects:proj1', 'profiles:worker', 'tasks:t1', 'task_assignments:a2'].sort(),
    );

    // Counts.
    expect(report.counts.source.people).toBe(4);
    expect(report.counts.source.projects).toBe(1);
    expect(report.counts.source.tasks).toBe(1);
    expect(report.counts.source.assignments).toBe(2);
    expect(report.counts.target.profiles).toBe(4);
    expect(report.counts.target.task_assignments).toBe(2);
    // project_members: distinct (projectId, personId) through the task -> one pair.
    expect(report.counts.target.project_members).toBe(1);

    // Role mapping counts, one of each role.
    const roleFor = (role: string) => report.roleMapping.find((r) => r.sourceRole === role)!;
    expect(roleFor('administrator')).toMatchObject({ targetRole: 'administrator', count: 1 });
    expect(roleFor('pm')).toMatchObject({ targetRole: 'manager', count: 1 });
    expect(roleFor('handlowiec')).toMatchObject({ targetRole: 'worker', count: 1 });
    expect(roleFor('pracownik')).toMatchObject({ targetRole: 'worker', count: 1 });

    // Person-id remap entry present with the people count.
    expect(report.idMappings[0].count).toBe(4);

    // Unsupported collections: only the non-empty ones (here: clients).
    const names = report.unsupported.collections.map((c) => c.name);
    expect(names).toContain('Klienci');
    expect(report.unsupported.collections.find((c) => c.name === 'Klienci')!.count).toBe(1);
    // Empty collections are not listed.
    expect(names).not.toContain('Statusy');

    // Dropped-field lists are always reported per entity.
    const entities = report.unsupported.fields.map((f) => f.entity);
    expect(entities).toEqual(['Projekt', 'Zadanie', 'Osoba']);
  });

  it('reports no blockers for a clean fixture and warns on a dangling department reference', () => {
    const data: AppData = {
      ...emptyData(),
      statuses: [],
      departments: [{ id: 'd1', name: 'Projektowanie' }],
      people: [
        makePerson({ id: 'p1', accessRole: 'administrator', departmentId: 'd1' }),
        makePerson({ id: 'p2', accessRole: 'pracownik', departmentId: 'ghost' }), // dangling -> warning
      ],
      projects: [makeProject({ id: 'proj1', name: 'Realny projekt' })],
      tasks: [makeTask({ id: 't1', projectId: 'proj1' })],
      assignments: [makeAssignment({ id: 'a1', taskId: 't1', personId: 'p1' })],
    };
    const report = buildDryRunReport(data);
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ table: 'profiles', entityId: 'p2' });
    expect(report.unsupported.collections).toHaveLength(0);
  });
});
