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
  readRetirementSetting,
  RETIREMENT_SETTING_KEY,
  writeRetirementSetting,
  type PlannerDb,
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
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '', ...o,
  };
}
const cloudProfile = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
  firstName: '', lastName: '', email: '', roleTitle: '', cloudRole: 'worker', departmentId: null, supervisorId: null, phone: '', avatar: '', capacity: 8, workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, birthDate: '', ...o,
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
  it('classifies constraint-violation codes as permission (drop, not retry)', () => {
    // Naruszenia ograniczeń nie mogą zatkać kolejki ponawiania — porzucane jak
    // odmowa uprawnień: 23502 not-null, 23503 FK, 23505 unique, 23514 check.
    expect(classifyWriteError('23502', 'null value').kind).toBe('permission');
    expect(classifyWriteError('23503', 'foreign key').kind).toBe('permission');
    expect(classifyWriteError('23505', 'duplicate key').kind).toBe('permission');
    expect(classifyWriteError('23514', 'check constraint').kind).toBe('permission');
  });
  it('classifies everything else as transient', () => {
    expect(classifyWriteError('08006', 'connection failure').kind).toBe('transient');
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
    await expect(db.update('profiles', { phone: '1' }, { id: 'x' })).resolves.toEqual({
      error: { kind: 'transient', message: 'offline' },
    });
  });

  it('update: 0 trafionych wierszy (RLS wycisza) => permission, trafienie => ok', async () => {
    const makeClient = (rows: Array<Record<string, unknown>>) =>
      ({
        from: () => ({
          update: () => {
            const builder = {
              eq: () => builder,
              select: async () => ({ data: rows, error: null }),
            };
            return builder;
          },
        }),
      }) as unknown as Parameters<typeof createSupabasePlannerDb>[0];

    const missed = await createSupabasePlannerDb(makeClient([])).update(
      'profiles',
      { phone: '123' },
      { id: 'x' },
    );
    expect(missed.error?.kind).toBe('permission');

    const hit = await createSupabasePlannerDb(makeClient([{ id: 'x' }])).update(
      'profiles',
      { phone: '123' },
      { id: 'x' },
    );
    expect(hit.error).toBeNull();
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

  it('hydrates order_index when finite and coerces missing/garbage to 0', async () => {
    const TK2 = uuid('task-two');
    const db = new FakeSelectDb()
      .seed('projects', [
        {
          id: PR, client_id: null, name: 'P', description: '', status_id: S1, paid: false,
          start_date: '2026-07-06', end_date: '2026-07-12', department_id: null, service_type_id: null,
          created_at: '', updated_at: '',
        },
      ])
      .seed('tasks', [
        { id: TK, project_id: PR, status_id: S1, title: 'Z rangą', description: '', start_date: '2026-07-06', end_date: '2026-07-08', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], order_index: 3, created_at: '', updated_at: '' },
        { id: TK2, project_id: PR, status_id: S1, title: 'Śmieciowa ranga', description: '', start_date: '2026-07-06', end_date: '2026-07-08', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], order_index: 'oops', created_at: '', updated_at: '' },
      ]);
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.tasks.find((t) => t.id === TK)!.orderIndex).toBe(3);
    expect(result.payload.tasks.find((t) => t.id === TK2)!.orderIndex).toBe(0);
  });

  it('hydrates is_draft (true => szkic; brak/null/inne => opublikowane)', async () => {
    const TK2 = uuid('task-two');
    const db = new FakeSelectDb()
      .seed('projects', [
        {
          id: PR, client_id: null, name: 'P', description: '', status_id: S1, paid: false,
          start_date: '2026-07-06', end_date: '2026-07-12', department_id: null, service_type_id: null,
          created_at: '', updated_at: '',
        },
      ])
      .seed('tasks', [
        { id: TK, project_id: PR, status_id: S1, title: 'Szkic', description: '', start_date: '2026-07-06', end_date: '2026-07-08', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], order_index: 0, is_draft: true, created_at: '', updated_at: '' },
        { id: TK2, project_id: PR, status_id: S1, title: 'Bez kolumny', description: '', start_date: '2026-07-06', end_date: '2026-07-08', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], order_index: 0, created_at: '', updated_at: '' },
      ]);
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.tasks.find((t) => t.id === TK)!.isDraft).toBe(true);
    expect(result.payload.tasks.find((t) => t.id === TK2)!.isDraft).toBe(false);
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

  it('filtruje wiersze zależne od pominiętych encji — jedna sierota nie może zatruć całej hydracji', async () => {
    // Zadanie ponad limitem 92 dni odpada; jego przypisanie, godziny i kamień
    // pominiętego projektu też muszą odpaść, inaczej fail-closed
    // MERGE_CLOUD_ENTITIES odrzuciłby CAŁY payload (trwały, cichy no-op).
    const db = new FakeSelectDb()
      .seed('projects', [
        { id: PR, client_id: CLI, name: 'P', description: '', status_id: S1, paid: false, start_date: '2026-07-06', end_date: '2026-07-12', department_id: null, service_type_id: null, created_at: '', updated_at: '' },
        { id: uuid('pr-bad'), client_id: null, name: 'Bez dat', description: '', status_id: null, paid: false, start_date: null, end_date: null, department_id: null, service_type_id: null, created_at: '', updated_at: '' },
      ])
      .seed('milestones', [
        { id: uuid('ms-orphan'), project_id: uuid('pr-bad'), name: 'Sierota', milestone_date: '2026-07-10' },
      ])
      .seed('tasks', [
        { id: TK, project_id: PR, status_id: S1, title: 'Za długie', description: '', start_date: '2026-01-01', end_date: '2026-12-31', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], created_at: '', updated_at: '' },
      ])
      .seed('task_assignments', [{ task_id: TK, profile_id: CLOUD_PA }])
      .seed('workload_entries', [
        { id: uuid('wl-orphan'), task_id: TK, profile_id: CLOUD_PA, work_date: '2026-07-06', planned_hours: 2, start_minutes: 480, sort_index: 0 },
      ]);
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.projects).toHaveLength(1);
    expect(p.tasks).toHaveLength(0);
    expect(p.milestones).toHaveLength(0);
    expect(p.assignments).toHaveLength(0);
    expect(p.workload).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);
  });

  it('fails atomically with the Polish error when any select errors', async () => {
    const db = new FakeSelectDb().fail('tasks');
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result).toEqual({ ok: false, error: PLANNER_SNAPSHOT_ERROR });
  });

  it('maps workload (bin null<->"" + dated) and milestones, excluding invalid rows', async () => {
    // Rodzice (projekt + zadanie) muszą przetrwać walidację — wiersze zależne
    // wskazujące pominiętą encję są teraz filtrowane (patrz survivingProjectIds
    // / survivingTaskIds w loadPlannerSnapshot).
    const db = new FakeSelectDb()
      .seed('projects', [
        { id: PR, client_id: CLI, name: 'P', description: '', status_id: S1, paid: false, start_date: '2026-07-06', end_date: '2026-07-12', department_id: null, service_type_id: null, created_at: '', updated_at: '' },
      ])
      .seed('tasks', [
        { id: TK, project_id: PR, status_id: S1, title: 'T', description: '', start_date: '2026-07-06', end_date: '2026-07-08', estimated_hours: null, priority: 'normal', work_category_id: null, checklist: [], created_at: '', updated_at: '' },
      ])
      .seed('milestones', [
        { id: uuid('ms1'), project_id: PR, name: 'Publikacja', milestone_date: '2026-07-10' },
        { id: uuid('ms-bad'), project_id: PR, name: 'Zła', milestone_date: '' }, // invalid -> excluded
      ])
      .seed('workload_entries', [
        { id: uuid('wl-bin'), task_id: TK, profile_id: CLOUD_PA, work_date: null, planned_hours: 4, start_minutes: 0, sort_index: 0 },
        { id: uuid('wl-dated'), task_id: TK, profile_id: CLOUD_PA, work_date: '2026-07-06', planned_hours: 2, start_minutes: 480, sort_index: 1 },
        { id: uuid('wl-offgrid'), task_id: TK, profile_id: CLOUD_PA, work_date: '2026-07-06', planned_hours: 0.3, start_minutes: 0, sort_index: 2 }, // off-grid -> excluded
        { id: uuid('wl-ghost'), task_id: TK, profile_id: uuid('ghost-profile'), work_date: null, planned_hours: 1, start_minutes: 0, sort_index: 3 }, // unmappable -> excluded
        { id: uuid('wl-bin2'), task_id: TK, profile_id: CLOUD_PA, work_date: null, planned_hours: 1, start_minutes: 0, sort_index: 4 }, // dup bin pair -> excluded
      ]);
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.payload;
    expect(p.milestones).toEqual([
      expect.objectContaining({ projectId: PR, name: 'Publikacja', date: '2026-07-10' }),
    ]);
    // Only the first bin row + the valid dated row survive; person reversed to PA.
    expect(p.workload).toHaveLength(2);
    expect(p.workload.find((w) => w.date === '')).toMatchObject({ personId: PA, plannedHours: 4, startMinutes: 0 });
    expect(p.workload.find((w) => w.date === '2026-07-06')).toMatchObject({ personId: PA, plannedHours: 2, startMinutes: 480 });
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
  });

  it('treats empty collections as a valid empty payload', async () => {
    const db = new FakeSelectDb();
    const result = await loadPlannerSnapshot(db, maps(), localFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      clients: [], projects: [], milestones: [], tasks: [], assignments: [], workload: [], comments: [], activity: [], tickets: [],
    });
    expect(result.diagnostics).toEqual([]);
  });
});

// ---- Retirement flag accessors ----------------------------------------------

class FakeWriteDb implements PlannerDb {
  settings = new Map<string, Record<string, unknown>>();
  failUpsert = false;
  failSelect = false;
  async select(table: string) {
    if (this.failSelect) return { rows: [] as Row[], error: 'boom' };
    if (table === 'app_settings') {
      return { rows: [...this.settings.values()], error: null };
    }
    return { rows: [] as Row[], error: null };
  }
  async upsert(_table: string, row: Row) {
    if (this.failUpsert) return { error: { kind: 'transient' as const, message: 'net' } };
    this.settings.set(String(row.key), row);
    return { error: null };
  }
  async update() {
    return { error: null };
  }
  async remove() {
    return { error: null };
  }
}

describe('retirement flag accessors', () => {
  it('reads false when the row is missing and true when enabled', async () => {
    const db = new FakeWriteDb();
    expect(await readRetirementSetting(db)).toEqual({ ok: true, enabled: false });
    db.settings.set(RETIREMENT_SETTING_KEY, { key: RETIREMENT_SETTING_KEY, value: { enabled: true } });
    expect(await readRetirementSetting(db)).toEqual({ ok: true, enabled: true });
  });

  it('reports ok:false on a select error (caller keeps cached value)', async () => {
    const db = new FakeWriteDb();
    db.failSelect = true;
    expect(await readRetirementSetting(db)).toEqual({ ok: false, enabled: false });
  });

  it('upserts the flag row on write, round-tripping through read', async () => {
    const db = new FakeWriteDb();
    const res = await writeRetirementSetting(db, true, 'admin-profile');
    expect(res.error).toBeNull();
    expect(await readRetirementSetting(db)).toEqual({ ok: true, enabled: true });
    expect(db.settings.get(RETIREMENT_SETTING_KEY)!.value).toMatchObject({ enabled: true, by_profile: 'admin-profile' });
  });

  it('surfaces a write error without throwing', async () => {
    const db = new FakeWriteDb();
    db.failUpsert = true;
    const res = await writeRetirementSetting(db, false, 'x');
    expect(res.error).toEqual({ kind: 'transient', message: 'net' });
  });
});
