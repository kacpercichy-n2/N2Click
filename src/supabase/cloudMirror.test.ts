// Focused tests for the pure cloud mirror (cloudMirror.ts): buildCloudIdMaps
// (email/slug/name fallbacks), diffToCloudOps per entity family, and
// applyCloudOps (transient stops + preserves the queue; permission drops and
// continues). No SDK, no live Supabase — an injected fake PlannerDb.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import { reducer } from '../store/AppStore';
import type { AppData, Person, Project, Task } from '../types';
import type { CloudProfile, OrgSnapshot } from './referenceData';
import type { CloudWriteError, PlannerDb } from './plannerData';
import {
  applyCloudOps,
  buildCloudIdMaps,
  diffToCloudOps,
  type CloudIdMaps,
  type CloudOp,
} from './cloudMirror';

const uuid = (seed: string): string => {
  const hex = Array.from(seed)
    .reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const PA = uuid('person-a');
const PB = uuid('person-b');
const CLOUD_PA = uuid('cloud-a');
const CLOUD_PB = uuid('cloud-b');
const S1 = uuid('status-todo');
const SV = uuid('service-video');
const WC = uuid('cat-design');
const CLI = uuid('client-one');
const PR = uuid('project-one');
const TK = uuid('task-one');

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '', ...o,
  };
}
function makeProject(o: Partial<Project> & { id: string }): Project {
  return {
    clientId: '', name: 'Projekt', description: '', statusId: '', paid: false,
    startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
    documents: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}
function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: PR, statusId: '', title: 'Zadanie', description: '', startDate: '2026-07-06',
    endDate: '2026-07-08', estimatedHours: null, priority: 'normal', workCategoryId: '', departmentId: '',
    checklist: [], orderIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}
const cloudProfile = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
  firstName: '', lastName: '', email: '', roleTitle: '', cloudRole: 'worker', departmentId: null, companyId: null, supervisorId: null, phone: '', avatar: '', capacity: 8, workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, birthDate: '', ...o,
});

// A local AppData + a cloud org snapshot whose ids/keys line up so the maps
// resolve every reference the diff tests use.
function localFixture(): AppData {
  return {
    ...emptyData(),
    people: [makePerson({ id: PA, email: 'a@x.com' }), makePerson({ id: PB, email: 'b@x.com' })],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '#fff', order: 0, archived: false, isDone: false }],
    serviceTypes: [{ id: SV, name: 'Wideo' }],
    workCategories: [{ id: WC, name: 'Design' }],
  };
}
function orgFixture(): OrgSnapshot {
  return {
    profile: null,
    profiles: [
      cloudProfile({ id: CLOUD_PA, email: 'a@x.com' }),
      cloudProfile({ id: CLOUD_PB, email: 'b@x.com' }),
    ],
    departments: [],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '#fff', order: 0, archived: false, isDone: false }],
    serviceTypes: [{ id: SV, name: 'Wideo' }],
    workCategories: [{ id: WC, name: 'Design' }],
    jobTitles: [],
    companies: [],
  };
}
const maps = (): CloudIdMaps => buildCloudIdMaps(localFixture(), orgFixture());

describe('buildCloudIdMaps', () => {
  it('maps people by email, statuses by id or slug, dictionaries by id or name', () => {
    const local: AppData = {
      ...emptyData(),
      people: [makePerson({ id: PA, email: '  A@X.com ' })],
      statuses: [
        { id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false },
        { id: uuid('local-done'), name: 'Zrobione', slug: 'done', color: '', order: 1, archived: false, isDone: true },
      ],
      serviceTypes: [{ id: uuid('local-sv'), name: '  Wideo ' }],
      workCategories: [{ id: uuid('local-wc'), name: 'Design' }],
      departments: [{ id: uuid('local-dept'), name: 'Kreacja' }],
    };
    const cloudDone = uuid('cloud-done');
    const org: OrgSnapshot = {
      profile: null,
      profiles: [cloudProfile({ id: CLOUD_PA, email: 'a@x.com' })],
      statuses: [
        { id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false },
        { id: cloudDone, name: 'Zrobione', slug: 'done', color: '', order: 1, archived: false, isDone: true },
      ],
      serviceTypes: [{ id: SV, name: 'Wideo' }],
      workCategories: [{ id: WC, name: 'Design' }],
      departments: [{ id: uuid('cloud-dept'), name: 'Kreacja' }],
      jobTitles: [],
      companies: [],
    };
    const m = buildCloudIdMaps(local, org);
    expect(m.people.get(PA)).toBe(CLOUD_PA); // by normalized email
    expect(m.statuses.get(S1)).toBe(S1); // by id
    expect(m.statuses.get(local.statuses[1].id)).toBe(cloudDone); // by slug fallback
    expect(m.serviceTypes.get(local.serviceTypes[0].id)).toBe(SV); // by name
    expect(m.workCategories.get(local.workCategories[0].id)).toBe(WC);
    expect(m.departments.get(local.departments[0].id)).toBe(org.departments[0].id);
  });
});

describe('diffToCloudOps — families', () => {
  it('emits zero ops for identical states (same reference)', () => {
    const s = localFixture();
    expect(diffToCloudOps(s, s, maps()).ops).toHaveLength(0);
  });

  it('adds, renames and deletes a client', () => {
    const m = maps();
    const withClient: AppData = { ...localFixture(), clients: [{ id: CLI, name: 'Klient', archived: false }] };
    const add = diffToCloudOps(localFixture(), withClient, m);
    expect(add.ops).toEqual([
      expect.objectContaining({ kind: 'upsert', table: 'clients', row: expect.objectContaining({ id: CLI, name: 'Klient' }) }),
    ]);

    const renamed: AppData = { ...localFixture(), clients: [{ id: CLI, name: 'Nowa', archived: false }] };
    expect(diffToCloudOps(withClient, renamed, m).ops[0]).toMatchObject({ kind: 'upsert', table: 'clients' });

    const del = diffToCloudOps(withClient, localFixture(), m);
    expect(del.ops).toEqual([
      expect.objectContaining({ kind: 'remove', table: 'clients', match: { id: CLI } }),
    ]);
  });

  it('clientRow niesie contacts: [] gdy klient nie ma klucza, a tablicę dosłownie gdy ma', () => {
    const m = maps();
    // Bez klucza => pusta tablica w wierszu chmury.
    const noKey: AppData = { ...localFixture(), clients: [{ id: CLI, name: 'Klient', archived: false }] };
    const addNoKey = diffToCloudOps(localFixture(), noKey, m);
    expect(addNoKey.ops[0].row).toMatchObject({ id: CLI, contacts: [] });

    // Z kluczem => tablica dosłownie.
    const contacts = [{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '600', email: 'm@k.pl' }];
    const withKey: AppData = { ...localFixture(), clients: [{ id: CLI, name: 'Klient', archived: false, contacts }] };
    const addWithKey = diffToCloudOps(localFixture(), withKey, m);
    expect(addWithKey.ops[0].row).toMatchObject({ id: CLI, contacts });
  });

  it('save project with a new client emits client upsert THEN project upsert', () => {
    const m = maps();
    const prev = localFixture();
    const next: AppData = {
      ...prev,
      clients: [{ id: CLI, name: 'Klient', archived: false }],
      projects: [makeProject({ id: PR, clientId: CLI, statusId: S1, name: 'P' })],
    };
    const { ops } = diffToCloudOps(prev, next, m);
    expect(ops.map((o) => o.table)).toEqual(['clients', 'projects']);
    const projectRow = ops[1].row!;
    expect(projectRow).toMatchObject({ id: PR, client_id: CLI, status_id: S1 });
  });

  it('treats a task status change as a plain upsert', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK, statusId: '' })] };
    const next: AppData = { ...localFixture(), tasks: [makeTask({ id: TK, statusId: S1 })] };
    const { ops } = diffToCloudOps(prev, next, m);
    expect(ops).toEqual([
      expect.objectContaining({ kind: 'upsert', table: 'tasks', row: expect.objectContaining({ id: TK, status_id: S1 }) }),
    ]);
  });

  it('deletes a task by id', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK })] };
    const { ops } = diffToCloudOps(prev, localFixture(), m);
    expect(ops).toEqual([expect.objectContaining({ kind: 'remove', table: 'tasks', match: { id: TK } })]);
  });

  it('an adjacent reorder swap emits EXACTLY two task upserts carrying order_index', () => {
    const m = maps();
    const TK2 = uuid('task-two');
    const prev: AppData = {
      ...localFixture(),
      tasks: [makeTask({ id: TK, orderIndex: 0 }), makeTask({ id: TK2, orderIndex: 1 })],
    };
    const next = reducer(prev, { type: 'REORDER_PROJECT_TASK', taskId: TK, direction: 1 });
    const taskUpserts = diffToCloudOps(prev, next, m).ops.filter(
      (o) => o.table === 'tasks' && o.kind === 'upsert',
    );
    expect(taskUpserts).toHaveLength(2);
    const rowOf = (id: string) => taskUpserts.find((o) => o.row!.id === id)!.row!;
    expect(rowOf(TK).order_index).toBe(1);
    expect(rowOf(TK2).order_index).toBe(0);
  });

  it('task upsert niesie is_draft (szkic true, opublikowane/legacy false)', () => {
    const m = maps();
    const TK2 = uuid('task-two');
    const prev: AppData = { ...localFixture(), tasks: [] };
    const next: AppData = {
      ...localFixture(),
      tasks: [
        makeTask({ id: TK, isDraft: true }),
        makeTask({ id: TK2 }), // brak pola => opublikowane
      ],
    };
    const upserts = diffToCloudOps(prev, next, m).ops.filter(
      (o) => o.table === 'tasks' && o.kind === 'upsert',
    );
    const rowOf = (id: string) => upserts.find((o) => o.row!.id === id)!.row!;
    expect(rowOf(TK).is_draft).toBe(true);
    expect(rowOf(TK2).is_draft).toBe(false);
  });

  it('task upsert mapuje draftHours na draft_hours (profil per wpis; niemapowalny odpada; brak => null)', () => {
    const m = maps();
    const TK2 = uuid('task-two');
    const TK3 = uuid('task-three');
    const prev: AppData = { ...localFixture(), tasks: [] };
    const next: AppData = {
      ...localFixture(),
      tasks: [
        makeTask({ id: TK, isDraft: true, draftHours: [{ personId: PA, hours: 4 }, { personId: uuid('ghost'), hours: 9 }] }),
        makeTask({ id: TK2, isDraft: true }), // szkic bez godzin => null
        makeTask({ id: TK3 }), // opublikowane => null
      ],
    };
    const upserts = diffToCloudOps(prev, next, m).ops.filter(
      (o) => o.table === 'tasks' && o.kind === 'upsert',
    );
    const rowOf = (id: string) => upserts.find((o) => o.row!.id === id)!.row!;
    // Niemapowalny wpis odpada; mapowalny niesie cloud profile id.
    expect(rowOf(TK).draft_hours).toEqual([{ profile_id: CLOUD_PA, hours: 4 }]);
    expect(rowOf(TK2).draft_hours).toBeNull();
    expect(rowOf(TK3).draft_hours).toBeNull();
  });

  it('task upsert niesie recurrence dosłownie (obiekt kanoniczny; brak => null)', () => {
    const m = maps();
    const TK2 = uuid('task-two');
    const rec = {
      daysOfWeek: [1],
      startMinutes: 540,
      durationMinutes: 60,
      overrides: [{ date: '2026-07-13', startMinutes: 600, durationMinutes: 30 }],
    };
    const prev: AppData = { ...localFixture(), tasks: [] };
    const next: AppData = {
      ...localFixture(),
      tasks: [
        makeTask({ id: TK, recurrence: rec }),
        makeTask({ id: TK2 }), // brak reguły => null
      ],
    };
    const upserts = diffToCloudOps(prev, next, m).ops.filter(
      (o) => o.table === 'tasks' && o.kind === 'upsert',
    );
    const rowOf = (id: string) => upserts.find((o) => o.row!.id === id)!.row!;
    expect(rowOf(TK).recurrence).toEqual(rec);
    expect(rowOf(TK2).recurrence).toBeNull();
  });

  it('a rejected reorder (unknown task) keeps the state reference so the diff emits zero ops', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK, orderIndex: 0 })] };
    const next = reducer(prev, { type: 'REORDER_PROJECT_TASK', taskId: uuid('ghost'), direction: 1 });
    expect(next).toBe(prev);
    expect(diffToCloudOps(prev, next, m).ops).toHaveLength(0);
  });

  it('emits composite upsert/remove for assignment set deltas', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), assignments: [{ id: 'a1', taskId: TK, personId: PA }] };
    const next: AppData = { ...localFixture(), assignments: [{ id: 'a2', taskId: TK, personId: PB }] };
    const { ops } = diffToCloudOps(prev, next, m);
    const remove = ops.find((o) => o.kind === 'remove' && o.table === 'task_assignments');
    const upsert = ops.find((o) => o.kind === 'upsert' && o.table === 'task_assignments');
    expect(remove!.match).toEqual({ task_id: TK, profile_id: CLOUD_PA });
    expect(upsert!.row).toEqual({ task_id: TK, profile_id: CLOUD_PB });
    expect(upsert!.onConflict).toBe('task_id,profile_id');
  });

  it('appends new comments/activity and mirrors NOTHING for local prunes', () => {
    const m = maps();
    const comment = { id: uuid('cm1'), entityType: 'task' as const, entityId: TK, authorId: PA, body: 'Hej', mentionIds: [], createdAt: '2026-07-16T00:00:00.000Z' };
    const activity = { id: uuid('ac1'), entityType: 'task' as const, entityId: TK, actorId: PA, message: 'x', createdAt: '2026-07-16T00:00:00.000Z' };
    const withRows: AppData = { ...localFixture(), comments: [comment], activity: [activity] };

    // Append: new rows -> insert-upsert.
    const add = diffToCloudOps(localFixture(), withRows, m);
    expect(add.ops.filter((o) => o.table === 'comments')).toHaveLength(1);
    expect(add.ops.filter((o) => o.table === 'activity_events')).toHaveLength(1);

    // Local prune (row removed) -> nothing mirrored (cloud cascade owns deletes).
    const prune = diffToCloudOps(withRows, localFixture(), m);
    expect(prune.ops).toHaveLength(0);
  });

  it('diagnoses non-UUID and unmappable rows, emitting no op', () => {
    const m = maps();
    // Non-UUID client id.
    const badClient: AppData = { ...localFixture(), clients: [{ id: 'legacy-1', name: 'X', archived: false }] };
    const c = diffToCloudOps(localFixture(), badClient, m);
    expect(c.ops).toHaveLength(0);
    expect(c.diagnostics.length).toBeGreaterThan(0);

    // Project referencing a status absent from the maps.
    const badProject: AppData = {
      ...localFixture(),
      projects: [makeProject({ id: PR, statusId: uuid('ghost-status') })],
    };
    const p = diffToCloudOps(localFixture(), badProject, m);
    expect(p.ops).toHaveLength(0);
    expect(p.diagnostics.length).toBeGreaterThan(0);
  });
});

const MS = uuid('milestone-one');
const WB = uuid('wl-bin');
const WD = uuid('wl-dated');

describe('diffToCloudOps — milestones + workload families', () => {
  it('upserts and removes a milestone (by-id LWW)', () => {
    const m = maps();
    const milestone = { id: MS, projectId: PR, name: 'Publikacja', date: '2026-07-10' };
    const withM: AppData = { ...localFixture(), milestones: [milestone] };
    const add = diffToCloudOps(localFixture(), withM, m);
    expect(add.ops).toEqual([
      expect.objectContaining({ kind: 'upsert', table: 'milestones', row: expect.objectContaining({ id: MS, project_id: PR, milestone_date: '2026-07-10' }) }),
    ]);
    const del = diffToCloudOps(withM, localFixture(), m);
    expect(del.ops).toEqual([
      expect.objectContaining({ kind: 'remove', table: 'milestones', match: { id: MS } }),
    ]);
  });

  it('upserts added/changed workload and removes deleted (full row, person mapped)', () => {
    const m = maps();
    const dated = { id: WD, taskId: TK, personId: PA, date: '2026-07-06', plannedHours: 2, startMinutes: 480, sortIndex: 0 };
    const withW: AppData = { ...localFixture(), tasks: [makeTask({ id: TK })], workload: [dated] };
    const add = diffToCloudOps({ ...localFixture(), tasks: [makeTask({ id: TK })] }, withW, m);
    const up = add.ops.find((o) => o.table === 'workload_entries');
    expect(up!.row).toMatchObject({ id: WD, task_id: TK, profile_id: CLOUD_PA, work_date: '2026-07-06', planned_hours: 2, start_minutes: 480 });
    const del = diffToCloudOps(withW, { ...localFixture(), tasks: [makeTask({ id: TK })] }, m);
    expect(del.ops).toEqual([
      expect.objectContaining({ kind: 'remove', table: 'workload_entries', match: { id: WD } }),
    ]);
  });

  it('serializes the per-block done flag (PKG-per-block-done): true when set, false otherwise', () => {
    const m = maps();
    const base = { ...localFixture(), tasks: [makeTask({ id: TK })] };
    const doneRow = { id: WD, taskId: TK, personId: PA, date: '2026-07-06', plannedHours: 2, startMinutes: 480, sortIndex: 0, done: true };
    const withDone: AppData = { ...base, workload: [doneRow] };
    const up = diffToCloudOps(base, withDone, m).ops.find((o) => o.table === 'workload_entries');
    expect(up!.row).toMatchObject({ id: WD, done: true });

    // A row without the flag serializes done: false (default, not undefined).
    const plain = { ...doneRow, done: undefined };
    const withPlain: AppData = { ...base, workload: [plain] };
    const upPlain = diffToCloudOps(base, withPlain, m).ops.find((o) => o.table === 'workload_entries');
    expect(upPlain!.row).toMatchObject({ id: WD, done: false });
  });

  it('maps a bin workload row work_date to null', () => {
    const m = maps();
    const bin = { id: WB, taskId: TK, personId: PA, date: '', plannedHours: 4, startMinutes: 0, sortIndex: 0 };
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK })] };
    const next: AppData = { ...prev, workload: [bin] };
    const { ops } = diffToCloudOps(prev, next, m);
    expect(ops[0].row).toMatchObject({ id: WB, work_date: null, planned_hours: 4, start_minutes: 0 });
  });

  it('emits the atomic pair for a bin-part schedule (decremented bin + new dated)', () => {
    const m = maps();
    const prev: AppData = {
      ...localFixture(),
      tasks: [makeTask({ id: TK })],
      workload: [{ id: WB, taskId: TK, personId: PA, date: '', plannedHours: 4, startMinutes: 0, sortIndex: 0 }],
    };
    const next: AppData = {
      ...prev,
      workload: [
        { id: WB, taskId: TK, personId: PA, date: '', plannedHours: 3, startMinutes: 0, sortIndex: 0 },
        { id: WD, taskId: TK, personId: PA, date: '2026-07-06', plannedHours: 1, startMinutes: 480, sortIndex: 0 },
      ],
    };
    const wlOps = diffToCloudOps(prev, next, m).ops.filter((o) => o.table === 'workload_entries');
    expect(wlOps).toHaveLength(2);
    expect(wlOps.map((o) => o.row!.id).sort()).toEqual([WB, WD].sort());
  });

  it('emits zero workload ops for an unchanged SAVE_TASK (same workload reference)', () => {
    const m = maps();
    const workload = [{ id: WD, taskId: TK, personId: PA, date: '2026-07-06', plannedHours: 2, startMinutes: 480, sortIndex: 0 }];
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK, title: 'Stary' })], workload };
    const next: AppData = { ...prev, tasks: [makeTask({ id: TK, title: 'Nowy' })], workload };
    const { ops } = diffToCloudOps(prev, next, m);
    expect(ops.filter((o) => o.table === 'workload_entries')).toHaveLength(0);
    expect(ops.filter((o) => o.table === 'tasks')).toHaveLength(1);
  });

  it('diagnoses an unmappable person / non-UUID workload row, no op', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK })] };
    const badPerson: AppData = {
      ...prev,
      workload: [{ id: WD, taskId: TK, personId: uuid('ghost'), date: '', plannedHours: 1, startMinutes: 0, sortIndex: 0 }],
    };
    const r1 = diffToCloudOps(prev, badPerson, m);
    expect(r1.ops.filter((o) => o.table === 'workload_entries')).toHaveLength(0);
    expect(r1.diagnostics.length).toBeGreaterThan(0);

    const badId: AppData = {
      ...prev,
      workload: [{ id: 'legacy-1', taskId: TK, personId: PA, date: '', plannedHours: 1, startMinutes: 0, sortIndex: 0 }],
    };
    const r2 = diffToCloudOps(prev, badId, m);
    expect(r2.ops.filter((o) => o.table === 'workload_entries')).toHaveLength(0);
    expect(r2.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('diffToCloudOps — wydarzenia kalendarza', () => {
  const EV = uuid('event-1');
  const makeEvent = (o: Record<string, unknown> = {}) => ({
    id: EV,
    title: 'Spotkanie',
    description: '',
    location: '',
    meetingUrl: '',
    date: '2026-07-06',
    startMinutes: 540,
    durationMinutes: 60,
    attendeeIds: [] as string[],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  });

  it('event upsert mapuje attendees na profile chmury (niemapowalny odpada)', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), events: [] };
    const next: AppData = {
      ...localFixture(),
      events: [makeEvent({ attendeeIds: [PA, uuid('ghost'), PB] })],
    };
    const { ops, diagnostics } = diffToCloudOps(prev, next, m);
    const up = ops.find((o) => o.table === 'events' && o.kind === 'upsert');
    expect(up).toBeDefined();
    expect(up!.row).toMatchObject({
      id: EV,
      event_date: '2026-07-06',
      start_minutes: 540,
      duration_minutes: 60,
      attendee_ids: [CLOUD_PA, CLOUD_PB],
    });
    expect(diagnostics.length).toBeGreaterThan(0); // niemapowalny uczestnik
  });

  it('emituje remove dla usuniętego wydarzenia (id UUID)', () => {
    const m = maps();
    const prev: AppData = { ...localFixture(), events: [makeEvent()] };
    const next: AppData = { ...localFixture(), events: [] };
    const rm = diffToCloudOps(prev, next, m).ops.find(
      (o) => o.table === 'events' && o.kind === 'remove',
    );
    expect(rm!.match).toEqual({ id: EV });
  });
});

// ---- applyCloudOps -----------------------------------------------------------

class FakePlannerDb implements PlannerDb {
  calls: Array<{ op: 'upsert' | 'update' | 'remove'; table: string }> = [];
  upsertErr: (table: string, row: Record<string, unknown>) => CloudWriteError | null = () => null;
  updateErr: (table: string, row: Record<string, unknown>) => CloudWriteError | null = () => null;
  removeErr: (table: string) => CloudWriteError | null = () => null;
  async select() {
    return { rows: [] as Array<Record<string, unknown>>, error: null };
  }
  async upsert(table: string, row: Record<string, unknown>) {
    this.calls.push({ op: 'upsert', table });
    return { error: this.upsertErr(table, row) };
  }
  async update(table: string, row: Record<string, unknown>) {
    this.calls.push({ op: 'update', table });
    return { error: this.updateErr(table, row) };
  }
  async remove(table: string) {
    this.calls.push({ op: 'remove', table });
    return { error: this.removeErr(table) };
  }
}

const op = (id: string, table = 'clients'): CloudOp => ({
  kind: 'upsert',
  table,
  row: { id },
  sourceId: id,
  label: `Op ${id}`,
});

describe('applyCloudOps', () => {
  it('stops on a transient error and preserves the remaining queue', async () => {
    const db = new FakePlannerDb();
    db.upsertErr = (_t, row) =>
      row.id === 'two' ? { kind: 'transient', message: 'network' } : null;
    const ops = [op('one'), op('two'), op('three')];
    const result = await applyCloudOps(db, ops);
    expect(result.done).toBe(1);
    expect(result.error).toBe(
      'Nie udało się zapisać zmian na serwerze. Dane pozostały w tej przeglądarce.',
    );
    expect(result.remaining.map((o) => o.sourceId)).toEqual(['two', 'three']);
    // op 'three' was never attempted.
    expect(db.calls).toHaveLength(2);
  });

  it('routes an update op to db.update and drops it on permission', async () => {
    const db = new FakePlannerDb();
    db.updateErr = () => ({ kind: 'permission', message: 'row-level security' });
    const updateOp: CloudOp = {
      kind: 'update',
      table: 'profiles',
      row: { phone: '123' },
      match: { id: 'p1' },
      sourceId: 'p1',
      label: 'Profil „Test”',
    };
    const result = await applyCloudOps(db, [op('one'), updateOp]);
    expect(db.calls).toEqual([
      { op: 'upsert', table: 'clients' },
      { op: 'update', table: 'profiles' },
    ]);
    expect(result.done).toBe(1);
    expect(result.dropped).toEqual([{ label: 'Profil „Test”', message: 'row-level security' }]);
  });

  it('drops a permission-denied op with a Polish notice and continues', async () => {
    const db = new FakePlannerDb();
    db.upsertErr = (_t, row) =>
      row.id === 'two' ? { kind: 'permission', message: 'row-level security' } : null;
    const ops = [op('one'), op('two'), op('three')];
    const result = await applyCloudOps(db, ops);
    expect(result.done).toBe(2);
    expect(result.error).toBeNull();
    expect(result.remaining).toHaveLength(0);
    expect(result.dropped).toEqual([{ label: 'Op two', message: 'row-level security' }]);
    expect(db.calls).toHaveLength(3);
  });
});

describe('diffToCloudOps — słowniki i profile (przewód zapisu paneli admina)', () => {
  it('mutacje słowników emitują upsert/remove do właściwych tabel', () => {
    const prev = localFixture();
    const newStatus = uuid('status-new');
    const next: AppData = {
      ...prev,
      statuses: [
        { ...prev.statuses[0], name: 'Do zrobienia (edytowany)' },
        { id: newStatus, name: 'Nowy', slug: 'nowy', color: '#abc', order: 1, archived: false, isDone: true },
      ],
      serviceTypes: [], // usunięcie SV
    };
    const { ops } = diffToCloudOps(prev, next, maps());
    const byTable = (t: string) => ops.filter((o) => o.table === t);
    expect(byTable('statuses').map((o) => o.kind).sort()).toEqual(['upsert', 'upsert']);
    const inserted = byTable('statuses').find((o) => o.sourceId === newStatus)!;
    expect(inserted.kind).toBe('upsert');
    expect(inserted.row).toMatchObject({
      slug: 'nowy',
      sort_order: 1,
      is_done: true,
    });
    expect(byTable('service_types')).toEqual([
      expect.objectContaining({ kind: 'remove', sourceId: SV }),
    ]);
  });

  it('stanowiska: dodanie/zmiana emituje upsert, usunięcie emituje remove do job_titles (UUID)', () => {
    const jt = uuid('jt-1');
    const prev: AppData = { ...localFixture(), jobTitles: [{ id: jt, name: 'Grafik' }] };
    // Dodanie nowego + zmiana nazwy istniejącego.
    const jt2 = uuid('jt-2');
    const added: AppData = {
      ...prev,
      jobTitles: [{ id: jt, name: 'Senior Grafik' }, { id: jt2, name: 'Programista' }],
    };
    const addOps = diffToCloudOps(prev, added, maps()).ops.filter((o) => o.table === 'job_titles');
    expect(addOps.map((o) => o.kind).sort()).toEqual(['upsert', 'upsert']);
    expect(addOps.find((o) => o.sourceId === jt2)!.row).toMatchObject({ id: jt2, name: 'Programista' });
    // Usunięcie wiersza o UUID emituje remove.
    const removeOps = diffToCloudOps(prev, { ...prev, jobTitles: [] }, maps()).ops.filter(
      (o) => o.table === 'job_titles',
    );
    expect(removeOps).toEqual([expect.objectContaining({ kind: 'remove', sourceId: jt })]);
  });

  it('spółki: dodanie/zmiana emituje upsert, usunięcie emituje remove do companies (UUID)', () => {
    const co = uuid('co-1');
    const prev: AppData = { ...localFixture(), companies: [{ id: co, name: 'Acme' }] };
    // Dodanie nowego + zmiana nazwy istniejącego.
    const co2 = uuid('co-2');
    const added: AppData = {
      ...prev,
      companies: [{ id: co, name: 'Acme Studio' }, { id: co2, name: 'Globex' }],
    };
    const addOps = diffToCloudOps(prev, added, maps()).ops.filter((o) => o.table === 'companies');
    expect(addOps.map((o) => o.kind).sort()).toEqual(['upsert', 'upsert']);
    expect(addOps.find((o) => o.sourceId === co2)!.row).toMatchObject({ id: co2, name: 'Globex' });
    // Usunięcie wiersza o UUID emituje remove.
    const removeOps = diffToCloudOps(prev, { ...prev, companies: [] }, maps()).ops.filter(
      (o) => o.table === 'companies',
    );
    expect(removeOps).toEqual([expect.objectContaining({ kind: 'remove', sourceId: co })]);
  });

  it('edycja osoby emituje WYŁĄCZNIE update istniejącego profilu chmury', () => {
    const prev = localFixture();
    const next: AppData = {
      ...prev,
      people: [
        { ...prev.people[0], role: 'Projektant', capacity: 6, accessRole: 'ograniczone', birthDate: '1990-06-01', companyId: 'company-uuid' },
        prev.people[1],
        // Nowa osoba lokalna bez konta chmury — NIE wolno robić insertu.
        makePerson({ id: uuid('local-only'), email: 'nowa@x.com' }),
      ],
    };
    const { ops, diagnostics } = diffToCloudOps(prev, next, maps());
    const profileOps = ops.filter((o) => o.table === 'profiles');
    expect(profileOps).toHaveLength(1);
    const up = profileOps[0];
    // UPDATE (nie upsert): polityka INSERT na profiles jest admin-only, a
    // `INSERT ... ON CONFLICT` sprawdza ją nawet przy samej aktualizacji.
    expect(up.kind).toBe('update');
    expect(up.match).toEqual({ id: CLOUD_PA }); // zmapowane po e-mailu na profil chmury
    expect(up.row).not.toHaveProperty('id');
    expect(up.row).toMatchObject({
      role_title: 'Projektant',
      capacity: 6,
      access_role: 'worker',
      birth_date: '1990-06-01', // '' mapuje się na null; poprawna data przechodzi
      company_id: 'company-uuid', // '' mapuje się na null; ustawiona spółka przechodzi
    });
    // Nowa osoba nie generuje op-a (konto tworzy provisioning) — jest diagnostyka.
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
