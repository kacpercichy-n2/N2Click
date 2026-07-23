// Unit tests for the derived notification feed (selectors.notificationsForPerson).
// There is no notification table — the feed is derived from `comments`,
// `assignments` and the activity log, scoped to one recipient and to events
// caused by someone else within NOTIFICATION_WINDOW_DAYS. Pure: `now` injected.
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_WINDOW_DAYS,
  notificationsForPerson,
  unreadNotificationCount,
} from './selectors';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type {
  ActivityEvent,
  AppData,
  Comment,
  Person,
  Project,
  Task,
  TaskAssignment,
} from '../types';

const NOW = '2026-07-23T12:00:00.000Z';
const RECENT = '2026-07-23T09:00:00.000Z';
const OLD = '2026-07-01T09:00:00.000Z'; // > 14 days before NOW

function person(id: string, name: string): Person {
  return {
    id,
    firstName: name,
    lastName: '',
    name,
    email: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    phone: '',
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'proj1',
    statusId: 'status1',
    title: `Zadanie ${id}`,
    description: '',
    startDate: '2026-07-20',
    endDate: '2026-07-22',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    clientId: 'c1',
    name,
    description: '',
    statusId: 'status1',
    paid: false,
    startDate: '2026-07-20',
    endDate: '2026-07-22',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function comment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    entityType: 'task',
    entityId: 't1',
    authorId: 'dominik',
    body: '@Zuzia rzuć okiem',
    mentionIds: ['zuzia'],
    createdAt: RECENT,
    ...overrides,
  };
}

function created(taskId: string, actorId: string, createdAt = RECENT): ActivityEvent {
  return {
    id: `act-${taskId}`,
    entityType: 'task',
    entityId: taskId,
    actorId,
    impersonatorId: '',
    message: 'utworzył(a) zadanie',
    createdAt,
  };
}

function assignment(id: string, taskId: string, personId: string): TaskAssignment {
  return { id, taskId, personId };
}

function state(overrides: Partial<AppData>): AppData {
  return {
    ...emptyData(),
    people: [person('zuzia', 'Zuzia'), person('dominik', 'Dominik')],
    ...overrides,
  };
}

describe('notificationsForPerson — @-wzmianki', () => {
  it('emits a mention when another person @-mentions the recipient', () => {
    const s = state({
      tasks: [task('t1', { title: 'Wycena' })],
      comments: [comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'] })],
    });
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'mention',
      actorName: 'Dominik',
      taskId: 't1',
      entityType: 'task',
    });
    expect(out[0].title).toContain('Dominik wspomniał(a) Cię');
    expect(out[0].title).toContain('Wycena');
  });

  it('does not notify the author about their own mention', () => {
    const s = state({
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', authorId: 'zuzia', mentionIds: ['zuzia'] })],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('ignores mentions with no acting author', () => {
    const s = state({
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', authorId: '', mentionIds: ['zuzia'] })],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('drops mentions older than the window', () => {
    const s = state({
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', mentionIds: ['zuzia'], createdAt: OLD })],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('skips a mention whose target entity is gone', () => {
    const s = state({
      tasks: [],
      comments: [comment({ id: 'c1', entityId: 'ghost', mentionIds: ['zuzia'] })],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('labels a project-scoped mention and leaves taskId empty', () => {
    const s = state({
      projects: [project('p1', 'Kampania PKP')],
      comments: [
        comment({ id: 'c1', entityType: 'project', entityId: 'p1', mentionIds: ['zuzia'] }),
      ],
    });
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out).toHaveLength(1);
    expect(out[0].taskId).toBe('');
    expect(out[0].entityId).toBe('p1');
    expect(out[0].title).toContain('Kampania PKP');
  });
});

describe('notificationsForPerson — przypisania zadań', () => {
  it('notifies the assignee when someone else created the task (activity fallback)', () => {
    const s = state({
      tasks: [task('t1', { title: 'Scenariusz do filmu PKP' })],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')],
    });
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'assignment', actorName: 'Dominik', taskId: 't1' });
    expect(out[0].title).toContain('przypisał(a) Ci zadanie');
    expect(out[0].title).toContain('Scenariusz do filmu PKP');
  });

  it('uses structured task.createdBy as the assigner (no activity row needed)', () => {
    const s = state({
      tasks: [task('t1', { title: 'Wycena PKP', createdBy: 'dominik' })],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [],
    });
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'assignment', actorId: 'dominik', actorName: 'Dominik' });
  });

  it('does not notify when createdBy is the assignee themselves', () => {
    const s = state({
      tasks: [task('t1', { createdBy: 'zuzia' })],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')], // fallback nie jest brany, bo createdBy wygrywa
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('does not notify when the assignee created their own task', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'zuzia')],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('stays silent without a creation event (unknown assigner)', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('excludes draft tasks', () => {
    const s = state({
      tasks: [task('t1', { isDraft: true })],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });

  it('drops an assignment whose creation event predates the window', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik', OLD)],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)).toHaveLength(0);
  });
});

describe('notificationsForPerson — general', () => {
  it('returns nothing for an empty person id', () => {
    expect(notificationsForPerson(state({}), '', NOW)).toEqual([]);
  });

  it('sorts newest first across both sources', () => {
    const s = state({
      tasks: [task('t1', { title: 'Przypisane' })],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik', '2026-07-22T08:00:00.000Z')],
      comments: [
        comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: '2026-07-23T08:00:00.000Z' }),
      ],
    });
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out.map((n) => n.kind)).toEqual(['mention', 'assignment']);
  });

  it('window constant is the documented 14 days', () => {
    expect(NOTIFICATION_WINDOW_DAYS).toBe(14);
  });
});

describe('notificationsForPerson — read/unread', () => {
  function feedState(): AppData {
    return state({
      tasks: [task('t1', { title: 'Wycena' })],
      comments: [comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT })],
    });
  }

  it('marks everything unread when the recipient has no watermark', () => {
    const out = notificationsForPerson(feedState(), 'zuzia', NOW);
    expect(out[0].read).toBe(false);
    expect(unreadNotificationCount(out)).toBe(1);
  });

  it('marks a notification read once the watermark is at/after its createdAt', () => {
    const s = feedState();
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsSeenAt: RECENT } : p,
    );
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out[0].read).toBe(true);
    expect(unreadNotificationCount(out)).toBe(0);
  });

  it('keeps a notification unread when it arrived after the watermark', () => {
    const s = feedState();
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsSeenAt: '2026-07-23T08:00:00.000Z' } : p,
    );
    const out = notificationsForPerson(s, 'zuzia', NOW); // comment at 09:00 > 08:00 seen
    expect(out[0].read).toBe(false);
  });
});

describe('MARK_NOTIFICATIONS_SEEN reducer', () => {
  it('stamps the acting user with a fresh ISO watermark', () => {
    const base = state({ currentUserId: 'zuzia' });
    const next = reducer(base, { type: 'MARK_NOTIFICATIONS_SEEN' });
    const zuzia = next.people.find((p) => p.id === 'zuzia');
    expect(zuzia?.notificationsSeenAt).toBeTruthy();
    expect(Number.isNaN(new Date(zuzia!.notificationsSeenAt!).getTime())).toBe(false);
    // Nikt inny nie zostaje dotknięty.
    expect(next.people.find((p) => p.id === 'dominik')?.notificationsSeenAt).toBeUndefined();
  });

  it('is a no-op (same reference) without an acting user', () => {
    const base = state({ currentUserId: '' });
    expect(reducer(base, { type: 'MARK_NOTIFICATIONS_SEEN' })).toBe(base);
  });

  it('is a no-op (same reference) when the acting id is unknown', () => {
    const base = state({ currentUserId: 'ghost' });
    expect(reducer(base, { type: 'MARK_NOTIFICATIONS_SEEN' })).toBe(base);
  });

  it('reading clears the unread feed end to end', () => {
    const before = state({
      currentUserId: 'zuzia',
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT })],
    });
    expect(unreadNotificationCount(notificationsForPerson(before, 'zuzia', NOW))).toBe(1);
    const after = reducer(before, { type: 'MARK_NOTIFICATIONS_SEEN' });
    // Watermark = teraz (po RECENT), więc feed jest przeczytany.
    expect(unreadNotificationCount(notificationsForPerson(after, 'zuzia', NOW))).toBe(0);
  });
});
