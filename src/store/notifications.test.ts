// Unit tests for the derived notification feed (selectors.notificationsForPerson).
// There is no notification table — the feed is derived from `comments`,
// `assignments` and the activity log, scoped to one recipient and to events
// caused by someone else within NOTIFICATION_WINDOW_DAYS. Pure: `now` injected.
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_WINDOW_DAYS,
  notificationsForPerson,
  unreadNotificationCount,
  unreadNotificationCountForPerson,
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

  it('read = watermark LUB zbiór per wpis (OR); id spoza zbioru zostaje nieprzeczytane', () => {
    const s = state({
      tasks: [task('t1', { title: 'Wycena' })],
      comments: [
        comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT }),
        comment({ id: 'c2', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT }),
      ],
    });
    // Sam zbiór, BEZ watermarku: przeczytany jest dokładnie wskazany wpis.
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsReadIds: ['mention:c1'] } : p,
    );
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out.find((n) => n.id === 'mention:c1')?.read).toBe(true);
    expect(out.find((n) => n.id === 'mention:c2')?.read).toBe(false);
    expect(unreadNotificationCount(out)).toBe(1);
  });

  it('kompat wsteczna: sam watermark (bez zbioru) czyta wszystko sprzed znacznika', () => {
    const s = feedState();
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsSeenAt: NOW } : p,
    );
    const out = notificationsForPerson(s, 'zuzia', NOW);
    expect(out[0].read).toBe(true);
    expect('notificationsReadIds' in s.people[0]).toBe(false);
  });

  it('id przypisania to klucz PARY assignment:<taskId>:<personId> (nie lokalny uid wiersza)', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')],
    });
    expect(notificationsForPerson(s, 'zuzia', NOW)[0].id).toBe('assignment:t1:zuzia');
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsReadIds: ['assignment:t1:zuzia'] } : p,
    );
    expect(notificationsForPerson(s, 'zuzia', NOW)[0].read).toBe(true);
  });

  it('kompat wsteczna: stary klucz assignment:<TaskAssignment.id> w zbiorze nadal czyta wpis', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('a1', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')],
    });
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsReadIds: ['assignment:a1'] } : p,
    );
    expect(notificationsForPerson(s, 'zuzia', NOW)[0].read).toBe(true);
  });

  it('inny lokalny uid tej samej pary (drugie urządzenie / hydracja) => wpis dalej przeczytany', () => {
    const s = state({
      tasks: [task('t1')],
      assignments: [assignment('inny-uid', 't1', 'zuzia')],
      activity: [created('t1', 'dominik')],
    });
    s.people = s.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsReadIds: ['assignment:t1:zuzia'] } : p,
    );
    expect(notificationsForPerson(s, 'zuzia', NOW)[0].read).toBe(true);
  });
});

describe('unreadNotificationCountForPerson', () => {
  it('liczy z tego samego feedu co kafelek (jedno źródło dla badge’a karty)', () => {
    const s = state({
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT })],
    });
    expect(unreadNotificationCountForPerson(s, 'zuzia', NOW)).toBe(
      unreadNotificationCount(notificationsForPerson(s, 'zuzia', NOW)),
    );
    expect(unreadNotificationCountForPerson(s, 'zuzia', NOW)).toBe(1);
  });

  it('pusty personId (wylogowanie) => 0', () => {
    const s = state({
      tasks: [task('t1')],
      comments: [comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: RECENT })],
    });
    expect(unreadNotificationCountForPerson(s, '', NOW)).toBe(0);
  });

  it('nieznana osoba => 0 (pusty feed)', () => {
    expect(unreadNotificationCountForPerson(state({}), 'ghost', NOW)).toBe(0);
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

  it('czyści zbiór per wpis (pruning) — watermark wyraża ten sam stan', () => {
    const before = state({
      currentUserId: 'zuzia',
      people: [
        { ...person('zuzia', 'Zuzia'), notificationsReadIds: ['mention:c1', 'assignment:a1'] },
        person('dominik', 'Dominik'),
      ],
    });
    const after = reducer(before, { type: 'MARK_NOTIFICATIONS_SEEN' });
    const zuzia = after.people.find((p) => p.id === 'zuzia')!;
    expect('notificationsReadIds' in zuzia).toBe(false); // klucz kanonicznie nieobecny
    expect(zuzia.notificationsSeenAt).toBeTruthy();
  });
});

// ---- MARK_NOTIFICATION_ENTRY_READ (oznaczenie POJEDYNCZEGO wpisu) -----------
//
// Reduktor waliduje `entryId` względem feedu liczonego dla ZEGARA RZECZYWISTEGO
// (nowIso()), więc zdarzenia źródłowe muszą leżeć w oknie względem `Date.now()`
// — stąd znaczniki liczone od teraz, a nie stałe `RECENT`/`NOW`.
const liveNow = (): string => new Date().toISOString();
const hoursAgo = (h: number): string => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

describe('MARK_NOTIFICATION_ENTRY_READ reducer', () => {
  /** Dwa wpisy feedu dla Zuzi (mention:c1, mention:c2) w oknie od „teraz". */
  function liveState(overrides: Partial<AppData> = {}): AppData {
    return state({
      currentUserId: 'zuzia',
      tasks: [task('t1', { title: 'Wycena' })],
      comments: [
        comment({ id: 'c1', entityId: 't1', mentionIds: ['zuzia'], createdAt: hoursAgo(2) }),
        comment({ id: 'c2', entityId: 't1', mentionIds: ['zuzia'], createdAt: hoursAgo(1) }),
      ],
      ...overrides,
    });
  }

  it('oznacza WYŁĄCZNIE wskazany wpis; licznik spada o 1, wpis zostaje w feedzie', () => {
    const before = liveState();
    expect(unreadNotificationCountForPerson(before, 'zuzia', liveNow())).toBe(2);

    const after = reducer(before, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' });
    expect(after).not.toBe(before);
    const zuzia = after.people.find((p) => p.id === 'zuzia')!;
    expect(zuzia.notificationsReadIds).toEqual(['mention:c1']);
    expect(zuzia.notificationsSeenAt).toBeUndefined(); // watermark NIE rusza się

    const feed = notificationsForPerson(after, 'zuzia', liveNow());
    expect(feed).toHaveLength(2); // przeczytany wpis NIE znika
    expect(feed.find((n) => n.id === 'mention:c1')?.read).toBe(true);
    expect(feed.find((n) => n.id === 'mention:c2')?.read).toBe(false);
    expect(unreadNotificationCountForPerson(after, 'zuzia', liveNow())).toBe(1);
  });

  it('kolejne oznaczenia dopisują się w kolejności wstawień (bez duplikatów)', () => {
    const one = reducer(liveState(), { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c2' });
    const two = reducer(one, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' });
    expect(two.people.find((p) => p.id === 'zuzia')!.notificationsReadIds).toEqual([
      'mention:c2',
      'mention:c1',
    ]);
  });

  it('nie dotyka innych osób ani dziennika aktywności', () => {
    const before = liveState();
    const after = reducer(before, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' });
    expect(after.people.find((p) => p.id === 'dominik')).toBe(
      before.people.find((p) => p.id === 'dominik'),
    );
    expect(after.activity).toBe(before.activity);
    expect(after.comments).toBe(before.comments);
  });

  it('inwariant 6: brak użytkownika / nieznane id sesji => TA SAMA referencja', () => {
    const noUser = liveState({ currentUserId: '' });
    expect(reducer(noUser, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' })).toBe(
      noUser,
    );
    const ghost = liveState({ currentUserId: 'ghost' });
    expect(reducer(ghost, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' })).toBe(
      ghost,
    );
  });

  it('inwariant 6: pusty / nie-stringowy entryId => TA SAMA referencja', () => {
    const base = liveState();
    expect(reducer(base, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: '' })).toBe(base);
    expect(
      reducer(base, {
        type: 'MARK_NOTIFICATION_ENTRY_READ',
        entryId: 42 as unknown as string,
      }),
    ).toBe(base);
  });

  it('inwariant 6: id spoza feedu (nieznane, cudze, poza oknem) => TA SAMA referencja', () => {
    const base = liveState();
    expect(reducer(base, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:ghost' })).toBe(
      base,
    );
    // Wpis istnieje, ale należy do innej osoby (feed liczy się dla zalogowanego).
    const others = liveState({
      comments: [
        comment({ id: 'cX', entityId: 't1', authorId: 'zuzia', mentionIds: ['dominik'], createdAt: hoursAgo(1) }),
      ],
    });
    expect(reducer(others, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:cX' })).toBe(
      others,
    );
    // Zdarzenie starsze niż okno feedu nie ma wpisu, więc nie da się go oznaczyć.
    const stale = liveState({
      comments: [
        comment({ id: 'cOld', entityId: 't1', mentionIds: ['zuzia'], createdAt: hoursAgo(24 * 30) }),
      ],
    });
    expect(reducer(stale, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:cOld' })).toBe(
      stale,
    );
  });

  it('inwariant 6: wpis już przeczytany (zbiór albo watermark) => TA SAMA referencja', () => {
    const once = reducer(liveState(), {
      type: 'MARK_NOTIFICATION_ENTRY_READ',
      entryId: 'mention:c1',
    });
    expect(reducer(once, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' })).toBe(once);

    // Przeczytany watermarkiem — zbiór nie puchnie o nadmiarowy wpis.
    const watermarked = reducer(liveState(), { type: 'MARK_NOTIFICATIONS_SEEN' });
    expect(
      reducer(watermarked, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: 'mention:c1' }),
    ).toBe(watermarked);
  });
});

describe('stabilność „przeczytane" przypisania', () => {
  it('SAVE_TASK tego samego zadania (te same osoby) NIE cofa oznaczenia jako przeczytane', () => {
    // Reduktor czyta zegar (nowIso), więc zdarzenie musi leżeć w oknie 14 dni od TERAZ.
    const nowIso = new Date().toISOString();
    const recentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = state({
      currentUserId: 'zuzia',
      projects: [project('proj1', 'Projekt')],
      statuses: [
        { id: 'status1', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false },
        { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true },
      ],
      tasks: [task('t1', { createdBy: 'dominik', createdAt: recentIso })],
      assignments: [assignment('a1', 't1', 'zuzia')],
    });
    const feed = notificationsForPerson(base, 'zuzia', nowIso);
    expect(feed).toHaveLength(1);
    const read = reducer(base, { type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: feed[0].id });
    expect(notificationsForPerson(read, 'zuzia', nowIso)[0].read).toBe(true);
    // Edycja zadania przez modal (ci sami wykonawcy) przebudowuje wiersze przypisań.
    const t = read.tasks[0];
    const saved = reducer(read, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: {
          projectId: t.projectId,
          statusId: t.statusId,
          title: 'Zmieniony tytuł',
          description: t.description,
          startDate: t.startDate,
          endDate: t.endDate,
          estimatedHours: t.estimatedHours,
          priority: t.priority,
          workCategoryId: t.workCategoryId,
          departmentId: t.departmentId,
          checklist: t.checklist,
        },
        assigneeIds: ['zuzia'],
        allocations: [],
      },
    });
    expect(saved).not.toBe(read);
    const after = notificationsForPerson(saved, 'zuzia', nowIso);
    expect(after).toHaveLength(1);
    expect(after[0].read).toBe(true);
  });

  it('stary klucz assignment:<uid> (zapis sprzed 2026-08-19) przeżywa SAVE_TASK — przepisany na klucz pary', () => {
    const nowIso = new Date().toISOString();
    const recentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = state({
      currentUserId: 'zuzia',
      projects: [project('proj1', 'Projekt')],
      statuses: [
        { id: 'status1', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false },
        { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true },
      ],
      tasks: [task('t1', { createdBy: 'dominik', createdAt: recentIso })],
      assignments: [assignment('a1', 't1', 'zuzia')],
    });
    base.people = base.people.map((p) =>
      p.id === 'zuzia' ? { ...p, notificationsReadIds: ['mention:c9', 'assignment:a1'] } : p,
    );
    expect(notificationsForPerson(base, 'zuzia', nowIso)[0].read).toBe(true);
    const dominikBefore = base.people.find((p) => p.id === 'dominik');
    const t = base.tasks[0];
    const saved = reducer(base, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: {
          projectId: t.projectId,
          statusId: t.statusId,
          title: 'Zmieniony tytuł',
          description: t.description,
          startDate: t.startDate,
          endDate: t.endDate,
          estimatedHours: t.estimatedHours,
          priority: t.priority,
          workCategoryId: t.workCategoryId,
          departmentId: t.departmentId,
          checklist: t.checklist,
        },
        assigneeIds: ['zuzia'],
        allocations: [],
      },
    });
    expect(saved).not.toBe(base);
    expect(notificationsForPerson(saved, 'zuzia', nowIso)[0].read).toBe(true);
    // Stary klucz zastąpiony kluczem pary; inne klucze i kolejność bez zmian.
    expect(saved.people.find((p) => p.id === 'zuzia')?.notificationsReadIds).toEqual([
      'mention:c9',
      'assignment:t1:zuzia',
    ]);
    // Osoba bez trafienia zachowuje referencję.
    expect(saved.people.find((p) => p.id === 'dominik')).toBe(dominikBefore);
  });

  it('SAVE_TASK NIE dotyka cudzych profili: stary klucz innej osoby zostaje, jej wiersz tą samą referencją', () => {
    const recentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = state({
      currentUserId: 'zuzia',
      projects: [project('proj1', 'Projekt')],
      statuses: [
        { id: 'status1', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false },
        { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true },
      ],
      tasks: [task('t1', { createdBy: 'zuzia', createdAt: recentIso })],
      assignments: [assignment('a1', 't1', 'dominik')],
    });
    // Dominik ma (z chmury) stary klucz wskazujący lokalny uid „a1" — jego wiersz
    // nie może zostać zmodyfikowany przez zapis Zuzi (poszedłby lustrem jako
    // UPDATE cudzego profilu).
    base.people = base.people.map((p) =>
      p.id === 'dominik' ? { ...p, notificationsReadIds: ['assignment:a1'] } : p,
    );
    const dominikBefore = base.people.find((p) => p.id === 'dominik');
    const t = base.tasks[0];
    const saved = reducer(base, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: {
          projectId: t.projectId,
          statusId: t.statusId,
          title: 'Zmieniony tytuł',
          description: t.description,
          startDate: t.startDate,
          endDate: t.endDate,
          estimatedHours: t.estimatedHours,
          priority: t.priority,
          workCategoryId: t.workCategoryId,
          departmentId: t.departmentId,
          checklist: t.checklist,
        },
        assigneeIds: ['dominik'],
        allocations: [],
      },
    });
    expect(saved).not.toBe(base);
    expect(saved.people).toBe(base.people);
    expect(saved.people.find((p) => p.id === 'dominik')).toBe(dominikBefore);
  });

  it('SAVE_TASK bez starych kluczy zostawia listę osób TĄ SAMĄ referencją', () => {
    const recentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = state({
      currentUserId: 'zuzia',
      projects: [project('proj1', 'Projekt')],
      statuses: [
        { id: 'status1', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false },
        { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true },
      ],
      tasks: [task('t1', { createdBy: 'dominik', createdAt: recentIso })],
      assignments: [assignment('a1', 't1', 'zuzia')],
    });
    const t = base.tasks[0];
    const saved = reducer(base, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: {
          projectId: t.projectId,
          statusId: t.statusId,
          title: 'Zmieniony tytuł',
          description: t.description,
          startDate: t.startDate,
          endDate: t.endDate,
          estimatedHours: t.estimatedHours,
          priority: t.priority,
          workCategoryId: t.workCategoryId,
          departmentId: t.departmentId,
          checklist: t.checklist,
        },
        assigneeIds: ['zuzia'],
        allocations: [],
      },
    });
    expect(saved).not.toBe(base);
    expect(saved.people).toBe(base.people);
  });
});
