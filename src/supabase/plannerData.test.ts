// Focused tests for the pure planner repository (plannerData.ts): write-error
// classification, the thin adapter's error shape, and loadPlannerSnapshot's
// reverse id mapping, null<->'' dates, unmappable people, invalid-row exclusion,
// atomic failure and empty-collection validity. No SDK, no live Supabase.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import type { AppData, Person } from '../types';
import type { CloudProfile, OrgSnapshot } from './referenceData';
import { buildCloudIdMaps, type CloudIdMaps } from './cloudMirror';
import {
  classifyWriteError,
  createSupabasePlannerDb,
  loadPlannerSnapshot,
  PLANNER_SNAPSHOT_ERROR,
} from './plannerData';

const uuid = (seed: string): string => {
  const hex = Array.from(seed)
    .reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const PA = uuid('person-a');
const CLOUD_PA = uuid('cloud-a');
const S1 = uuid('status-todo');
const SV = uuid('service-video');
const WC = uuid('cat-design');
const CLI = uuid('client-one');
const PR = uuid('project-one');
const TK = uuid('task-one');

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', ...o,
  };
}
const cloudProfile = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
  firstName: '', lastName: '', email: '', roleTitle: '', cloudRole: 'worker', departmentId: null, ...o,
});

function localFixture(): AppData {
  return {
    ...emptyData(),
    people: [makePerson({ id: PA, email: 'a@x.com' })],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false }],
    serviceTypes: [{ id: SV, name: 'Wideo' }],
    workCategories: [{ id: WC, name: 'Design' }],
  };
}
function orgFixture(): OrgSnapshot {
  return {
    profile: null,
    profiles: [cloudProfile({ id: CLOUD_PA, email: 'a@x.com' })],
    departments: [],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false }],
    serviceTypes: [{ id: SV, name: 'Wideo' }],
    workCategories: [{ id: WC, name: 'Design' }],
  };
}
const maps = (): CloudIdMaps => buildCloudIdMaps(localFixture(), orgFixture());

type Row = Record<string, unknown>;
class FakeSelectDb {
  tables = new Map<string, Row[]>();
  failTables = new Set<string>();
  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows);
    return this;
  }
  fail(table: string) {
    this.failTables.add(table);
    return this;
  }
  async select(table: string) {
    if (this.failTables.has(table)) return { rows: [] as Row[], error: 'boom' };
    return { rows: this.tables.get(table) ?? [], error: null };
  }
}

// ---- classifyWriteError ------------------------------------------------------

describe('classifyWriteError', () => {
  it('classifies 42501 and RLS messages as permission', () => {
    expect(classifyWriteError('42501', 'x').kind).toBe('permission');
    expect(classifyWriteError(null, 'new row violates row-level security policy').kind).toBe('permission');
    expect(classifyWriteError(null, 'permission denied for table').kind).toBe('permission');
  });
  it('classifies everything else as transient', () => {
    expect(classifyWriteError('23505', 'duplicate key').kind).toBe('transient');
    expect(classifyWriteError(null, 'fetch failed').kind).toBe('transient');
  });
});

// ---- adapter shape -----------------------------------------------------------

describe('createSupabasePlannerDb', () => {
  it('maps a returned permission error (42501) without throwing', async () => {
    const client = {
      from: () => ({ upsert: async () => ({ error: { code: '42501', message: 'denied' } }) }),
    } as unknown as Parameters<typeof createSupabasePlannerDb>[0];
    const db = createSupabasePlannerDb(client);
    const res = await db.upsert('clients', { id: 'x' });
    expect(res.error).toEqual({ kind: 'permission', message: 'denied' });
  });

  it('maps a thrown error to a transient CloudWriteError', async () => {
    const client = {
      from() {
        throw new Error('offline');
      },
    } as unknown as Parameters<typeof createSupabasePlannerDb>[0];
    const db = createSupabasePlannerDb(client);
    await expect(db.upsert('clients', { id: 'x' })).resolves.toEqual({
      error: { kind: 'transient', message: 'offline' },
    });
    await expect(db.remove('clients', { id: 'x' })).resolves.toEqual({
      error: { kind: 'transient', message: 'offline' },
    });
  });
});

// ---- loadPlannerSnapshot -----------------------------------------------------

describe('loadPlannerSnapshot', () => {
  it('maps rows to local shapes via reverse id maps and null<->"" dates', async () => {
    const db = new FakeSelectDb()
      .seed('clients', [{ id: CLI, name: 'Klient', archived: false }])
      .seed('projects', [
        {
          id: PR, client_id: CLI, name: 'P', description: 'opis', status_id: S1, paid: true,
          start_date: '2026-07-06', end_date: '2026-07-12', department_id: null, service_type_id: SV,
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
        },
      ])
      .seed('tasks', [
        {
          id: TK, project_id: PR, status_id: S1, title: 'T', description: '', start_date: '2026-07-06',
          end_date: '2026-07-08', estimated_hours: 3, priority: 'high', work_category_id: WC, checklist: [],
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        },
      ])
      .seed('task_assignments', [
        { task_id: TK, profile_id: CLOUD_PA },
        { task_id: TK, profile_id: uuid('ghost-profile') }, // unmappable -> skipped
      ])
      .seed('comments', [
        { id: uuid('cm1'), project_id: null, task_id: TK, author_id: CLOUD_PA, body: 'B', mention_ids: [CLOUD_PA], created_at: '2026-07-16T00:00:00.000Z' },
      ])
      .seed('activity_events', [
        { id: uuid('ac1'), entity_type: 'task', entity_id: TK, actor_id: CLOUD_PA, impersonator_id: null, message: 'm', created_at: '2026-07-16T00:00:00.000Z' },
      ]);

    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;

    expect(p.clients).toHaveLength(1);
    expect(p.projects[0]).toMatchObject({
      id: PR, clientId: CLI, statusId: S1, serviceTypeId: SV, paid: true,
      startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '',
    });
    expect(p.tasks[0]).toMatchObject({
      id: TK, statusId: S1, workCategoryId: WC, estimatedHours: 3, priority: 'high',
    });
    // Unmappable assignment skipped, mappable resolved to LOCAL person id.
    expect(p.assignments).toEqual([{ taskId: TK, personId: PA }]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // Comment/activity author + mentions reversed to local person ids.
    expect(p.comments[0]).toMatchObject({ entityType: 'task', entityId: TK, authorId: PA, mentionIds: [PA] });
    expect(p.activity[0]).toMatchObject({ entityType: 'task', entityId: TK, actorId: PA });
  });

  it('excludes a project with null dates and a task over the 92-day cap', async () => {
    const db = new FakeSelectDb()
      .seed('projects', [
        { id: PR, client_id: null, name: 'Bez dat', description: '', status_id: null, paid: false, start_date: null, end_date: null, department_id: null, service_type_id: null, created_at: '', updated_at: '' },
      ])
      .seed('tasks', [
        { id: TK, project_id: PR, status_id: null, title: 'Za długie', description: '', start_date: '2026-01-01', end_date: '2026-12-31', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], created_at: '', updated_at: '' },
      ]);
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.projects).toHaveLength(0);
    expect(result.payload.tasks).toHaveLength(0);
    expect(result.diagnostics.length).toBe(2);
  });

  it('fails atomically with the Polish error when any select errors', async () => {
    const db = new FakeSelectDb().fail('tasks');
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result).toEqual({ ok: false, error: PLANNER_SNAPSHOT_ERROR });
  });

  it('treats empty collections as a valid empty payload', async () => {
    const db = new FakeSelectDb();
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      clients: [], projects: [], tasks: [], assignments: [], comments: [], activity: [],
    });
    expect(result.diagnostics).toEqual([]);
  });
});
