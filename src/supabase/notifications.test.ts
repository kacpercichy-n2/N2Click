// Focused tests for in-app notifications on the cloud boundary:
//   * notificationInsertsFromDiff — event generation from a state diff
//     (assignment / project comment / bin item; no self-notification; dedupe).
//   * loadNotificationsSnapshot — mapping + GRACEFUL DEGRADATION when the table
//     is missing (select error => empty list, never throws).
//   * diffToCloudOps — read_at mirror (mark-as-read emits exactly one UPDATE).
// No SDK, no live Supabase — injected fake PlannerDb + pure diffs.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import { reducer } from '../store/AppStore';
import type { AppData, Comment, Notification, Person, Project, Task, TaskAssignment, WorkloadEntry } from '../types';
import type { CloudProfile, OrgSnapshot } from './referenceData';
import { buildCloudIdMaps, diffToCloudOps, type CloudIdMaps } from './cloudMirror';
import { notificationInsertsFromDiff } from './notificationEvents';
import { loadNotificationsSnapshot, type PlannerDb } from './plannerData';
import { BIN_DATE } from '../utils/time';

const uuid = (seed: string): string => {
  const hex = Array.from(seed)
    .reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const PA = uuid('person-a'); // aktor
const PB = uuid('person-b'); // odbiorca
const CLOUD_PA = uuid('cloud-a');
const CLOUD_PB = uuid('cloud-b');
const S1 = uuid('status-todo');
const PR = uuid('project-one');
const TK = uuid('task-one');

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '', ...o,
  };
}
function makeProject(o: Partial<Project> & { id: string }): Project {
  return {
    clientId: '', name: 'Projekt', description: '', statusId: S1, paid: false,
    startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
    documents: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}
function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: PR, statusId: S1, title: 'Zadanie', description: '', startDate: '2026-07-06',
    endDate: '2026-07-08', estimatedHours: null, priority: 'normal', workCategoryId: '', departmentId: '',
    checklist: [], orderIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}
const cloudProfile = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
  firstName: '', lastName: '', email: '', roleTitle: '', cloudRole: 'worker', departmentId: null, companyId: null, supervisorId: null, phone: '', avatar: '', capacity: 8, workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, birthDate: '', ...o,
});

function localFixture(): AppData {
  return {
    ...emptyData(),
    people: [makePerson({ id: PA, email: 'a@x.com' }), makePerson({ id: PB, email: 'b@x.com' })],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false }],
    projects: [makeProject({ id: PR })],
    tasks: [makeTask({ id: TK })],
  };
}
function orgFixture(): OrgSnapshot {
  return {
    profile: null,
    profiles: [cloudProfile({ id: CLOUD_PA, email: 'a@x.com' }), cloudProfile({ id: CLOUD_PB, email: 'b@x.com' })],
    departments: [],
    statuses: [{ id: S1, name: 'Do zrobienia', slug: 'todo', color: '', order: 0, archived: false, isDone: false }],
    serviceTypes: [], workCategories: [], jobTitles: [], companies: [],
  };
}
const maps = (): CloudIdMaps => buildCloudIdMaps(localFixture(), orgFixture());
const assignment = (o: Partial<TaskAssignment> & { taskId: string; personId: string }): TaskAssignment => ({
  id: uuid(`asg-${o.taskId}-${o.personId}`), ...o,
});
const binRow = (personId: string): WorkloadEntry => ({
  id: uuid(`w-${personId}`), taskId: TK, personId, date: BIN_DATE, plannedHours: 2, startMinutes: 0, sortIndex: 0,
});

describe('notificationInsertsFromDiff — generowanie zdarzeń', () => {
  it('(a) przypisanie zadania do innej osoby generuje task_assigned', () => {
    const prev = localFixture();
    const next: AppData = { ...prev, assignments: [assignment({ taskId: TK, personId: PB })] };
    const rows = notificationInsertsFromDiff(prev, next, maps(), CLOUD_PA);
    expect(rows).toEqual([
      {
        recipient_id: CLOUD_PB,
        type: 'task_assigned',
        payload: { taskId: TK, projectId: PR, actorId: CLOUD_PA },
      },
    ]);
  });

  it('nie powiadamia o WŁASNej akcji (przypisanie do siebie => brak)', () => {
    const prev = localFixture();
    // aktor = CLOUD_PA (== osoba PA); przypisanie do PA jest self => pominięte.
    const next: AppData = { ...prev, assignments: [assignment({ taskId: TK, personId: PA })] };
    expect(notificationInsertsFromDiff(prev, next, maps(), CLOUD_PA)).toEqual([]);
  });

  it('szkic nie generuje przypisania (jeszcze nie praca)', () => {
    const prev: AppData = { ...localFixture(), tasks: [makeTask({ id: TK, isDraft: true })] };
    const next: AppData = { ...prev, assignments: [assignment({ taskId: TK, personId: PB })] };
    expect(notificationInsertsFromDiff(prev, next, maps(), CLOUD_PA)).toEqual([]);
  });

  it('(b) komentarz w projekcie powiadamia uczestników poza autorem', () => {
    const base: AppData = { ...localFixture(), assignments: [assignment({ taskId: TK, personId: PB })] };
    const comment: Comment = {
      id: uuid('comment-1'), entityType: 'project', entityId: PR, authorId: PA, body: 'cześć', mentionIds: [],
      createdAt: '2026-07-07T10:00:00.000Z',
    };
    const next: AppData = { ...base, comments: [comment] };
    const rows = notificationInsertsFromDiff(base, next, maps(), CLOUD_PA);
    expect(rows).toEqual([
      {
        recipient_id: CLOUD_PB,
        type: 'project_comment',
        payload: { projectId: PR, commentId: comment.id, actorId: CLOUD_PA },
      },
    ]);
  });

  it('(c) nowy wiersz zasobnika generuje bin_item', () => {
    const base: AppData = { ...localFixture(), assignments: [assignment({ taskId: TK, personId: PB })] };
    const next: AppData = { ...base, workload: [binRow(PB)] };
    const rows = notificationInsertsFromDiff(base, next, maps(), CLOUD_PA);
    expect(rows).toEqual([
      {
        recipient_id: CLOUD_PB,
        type: 'bin_item',
        payload: { taskId: TK, projectId: PR, actorId: CLOUD_PA },
      },
    ]);
  });

  it('przypisanie + świeży zasobnik tej samej pary => tylko task_assigned (dedupe)', () => {
    const prev = localFixture();
    const next: AppData = {
      ...prev,
      assignments: [assignment({ taskId: TK, personId: PB })],
      workload: [binRow(PB)],
    };
    const rows = notificationInsertsFromDiff(prev, next, maps(), CLOUD_PA);
    expect(rows.map((r) => r.type)).toEqual(['task_assigned']);
  });
});

// ---- Fake DB dla loadera ------------------------------------------------------

function fakeDb(
  handler: (table: string) => { rows: Array<Record<string, unknown>>; error: string | null },
): Pick<PlannerDb, 'select'> {
  return { select: async (table) => handler(table) };
}

describe('loadNotificationsSnapshot — hydracja + graceful degradation', () => {
  it('degraduje się do [] gdy tabela nie istnieje (błąd selectu)', async () => {
    const db = fakeDb(() => ({ rows: [], error: 'relation "public.notifications" does not exist' }));
    await expect(loadNotificationsSnapshot(db, maps())).resolves.toEqual([]);
  });

  it('degraduje się do [] gdy select rzuci wyjątkiem', async () => {
    const db: Pick<PlannerDb, 'select'> = {
      select: async () => {
        throw new Error('network');
      },
    };
    await expect(loadNotificationsSnapshot(db, maps())).resolves.toEqual([]);
  });

  it('mapuje wiersze; read_at null => nieprzeczytane, nieznany type pomijany', async () => {
    const NID = uuid('notif-1');
    const db = fakeDb(() => ({
      rows: [
        { id: NID, recipient_id: CLOUD_PB, type: 'task_assigned', payload: { taskId: TK, projectId: PR }, read_at: null, created_at: '2026-07-07T10:00:00.000Z' },
        { id: uuid('notif-bad'), recipient_id: CLOUD_PB, type: 'unknown', payload: {}, read_at: null, created_at: '' },
      ],
      error: null,
    }));
    const out = await loadNotificationsSnapshot(db, maps());
    expect(out).toEqual([
      {
        id: NID,
        recipientId: PB, // reverse map cloud->local
        type: 'task_assigned',
        payload: { taskId: TK, projectId: PR },
        readAt: '',
        createdAt: '2026-07-07T10:00:00.000Z',
      },
    ]);
  });

  it('mapuje payload.actorId (id profilu chmury) na lokalne id osoby', async () => {
    const NID = uuid('notif-actor');
    const db = fakeDb(() => ({
      rows: [
        { id: NID, recipient_id: CLOUD_PB, type: 'task_assigned', payload: { taskId: TK, actorId: CLOUD_PA }, read_at: null, created_at: '2026-07-07T10:00:00.000Z' },
      ],
      error: null,
    }));
    const out = await loadNotificationsSnapshot(db, maps());
    expect(out[0].payload.actorId).toBe(PA); // reverse map cloud->local
  });
});

describe('diffToCloudOps — lustro read_at powiadomień', () => {
  it('oznaczenie jako przeczytane emituje dokładnie jeden UPDATE notifications', () => {
    const NID = uuid('notif-read');
    const notif: Notification = {
      id: NID, recipientId: PA, type: 'task_assigned', payload: {}, readAt: '', createdAt: '2026-07-07T10:00:00.000Z',
    };
    const prev: AppData = { ...localFixture(), notifications: [notif] };
    const next = reducer(prev, { type: 'MARK_NOTIFICATION_READ', notificationId: NID });
    const { ops } = diffToCloudOps(prev, next, maps());
    const notifOps = ops.filter((o) => o.table === 'notifications');
    expect(notifOps).toHaveLength(1);
    expect(notifOps[0].kind).toBe('update');
    expect(notifOps[0].match).toEqual({ id: NID });
    expect(typeof (notifOps[0].row as { read_at?: unknown }).read_at).toBe('string');
  });
});
