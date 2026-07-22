// Unit tests for honest local activity attribution shipped by
// PKG-20260714-activity-attribution. Impersonation was removed
// (PKG-20260722-settings-nav-cleanup), so every new row now stamps
// `impersonatorId: ''` (the field survives only as read-only historical
// attribution on old/cloud rows). The reducer writes exactly ONE row for the
// enumerated person/status/session/deletion events, and rejected / no-op
// commands append none while preserving the original state reference.
// Pure reducer tests — no React, no localStorage: build AppData fixtures by hand
// and dispatch through the exported `reducer`. Follows the fixture style of
// statusActions.test.ts / commandValidation.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer, type PersonDraft } from './AppStore';
import { emptyData } from './storage';
import { ROLE_LABELS } from './permissions';
import type {
  ActivityEvent,
  Client,
  Person,
  Project,
  Status,
  Task,
} from '../types';

const CLIENT: Client = { id: 'c1', name: 'Klient', archived: false };
const STATUS: Status = { id: 's1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const STATUS_DONE: Status = { id: 's2', name: 'Zrobione', slug: 'zrobione', color: '#4caf50', order: 1, archived: false, isDone: true };
// Unused + archived + non-done -> deletable without tripping any guard.
const STATUS_SPARE: Status = { id: 's3', name: 'Zapas', slug: 'zapas', color: '#888888', order: 2, archived: true, isDone: false };
const PROJECT: Project = {
  id: 'proj1',
  clientId: 'c1',
  name: 'Projekt',
  description: '',
  statusId: 's1',
  paid: false,
  startDate: '2026-07-06',
  endDate: '2026-07-12',
  departmentId: '',
  serviceTypeId: '',
  documents: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const TASK: Task = {
  id: 't1',
  projectId: 'proj1',
  statusId: 's1',
  title: 'Zadanie',
  description: '',
  startDate: '2026-07-06',
  endDate: '2026-07-08',
  estimatedHours: null,
  priority: 'normal',
  workCategoryId: '',
  departmentId: '',
  checklist: [],
  orderIndex: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
// p1 is the ONLY administrator; p2 is a plain worker.
const ADMIN: Person = {
  id: 'p1',
  firstName: 'Anna',
  lastName: 'Kowalska',
  name: 'Anna Kowalska',
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
const WORKER: Person = { ...ADMIN, id: 'p2', firstName: 'Jan', lastName: 'Nowak', name: 'Jan Nowak', accessRole: 'ograniczone' };
const WORKER3: Person = { ...ADMIN, id: 'p3', firstName: 'Ewa', lastName: 'Wiśniewska', name: 'Ewa Wiśniewska', accessRole: 'ograniczone' };

/** Fresh valid AppData per call; caller may override identity fields. */
function makeState(overrides: Partial<ReturnType<typeof emptyData>> = {}) {
  return {
    ...emptyData(),
    clients: [CLIENT],
    statuses: [STATUS, STATUS_DONE, STATUS_SPARE],
    projects: [PROJECT],
    tasks: [TASK],
    people: [ADMIN, WORKER, WORKER3],
    currentUserId: 'p1',
    ...overrides,
  };
}

function personDraft(overrides: Partial<PersonDraft> = {}): PersonDraft {
  return {
    firstName: 'Nowa',
    lastName: 'Osoba',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'ograniczone',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
    ...overrides,
  };
}

/** Last appended activity row. */
function lastRow(state: { activity: ActivityEvent[] }): ActivityEvent {
  return state.activity[state.activity.length - 1];
}

describe('1. default stamping (not impersonating)', () => {
  it("an accepted mutation writes impersonatorId ''", () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'ADD_COMMENT',
      entityType: 'task',
      entityId: 't1',
      body: 'Cześć',
      mentionIds: [],
    });
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.actorId).toBe('p1');
    expect(row.impersonatorId).toBe('');
  });
});

describe('7. SET_CURRENT_USER', () => {
  it('login writes a system row attributed to the id via override', () => {
    const state = makeState({ currentUserId: '' });
    const next = reducer(state, { type: 'SET_CURRENT_USER', personId: 'p1' });
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.entityType).toBe('system');
    expect(row.actorId).toBe('p1');
    expect(row.impersonatorId).toBe('');
    expect(row.message).toBe('zalogował(a) się');
  });

  it('same-id re-select -> no new row', () => {
    const state = makeState({ currentUserId: 'p1' });
    const next = reducer(state, { type: 'SET_CURRENT_USER', personId: 'p1' });
    expect(next.activity.length).toBe(state.activity.length);
  });

  it("'' clears identity -> no row", () => {
    const state = makeState({ currentUserId: 'p1' });
    const next = reducer(state, { type: 'SET_CURRENT_USER', personId: '' });
    expect(next.currentUserId).toBe('');
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('unknown id -> same reference', () => {
    const state = makeState();
    expect(reducer(state, { type: 'SET_CURRENT_USER', personId: 'ghost' })).toBe(state);
  });
});

describe('8. LOGOUT', () => {
  it('records the pre-logout identity', () => {
    const state = makeState({ currentUserId: 'p1' });
    const next = reducer(state, { type: 'LOGOUT' });
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.entityType).toBe('system');
    expect(row.actorId).toBe('p1');
    expect(row.impersonatorId).toBe('');
    expect(row.message).toBe('wylogował(a) się');
  });

  it('logged-out LOGOUT -> no row', () => {
    const state = makeState({ currentUserId: '' });
    const next = reducer(state, { type: 'LOGOUT' });
    expect(next.activity.length).toBe(state.activity.length);
  });
});

describe('9. SET_PASSWORD', () => {
  it('set then clear produce identical message, no hash substring', () => {
    const state = makeState();
    const hash = 'SECRET-HASH-9f8e7d';
    const afterSet = reducer(state, { type: 'SET_PASSWORD', personId: 'p1', passwordHash: hash });
    const afterClear = reducer(afterSet, { type: 'SET_PASSWORD', personId: 'p1', passwordHash: '' });
    const setRow = lastRow(afterSet);
    const clearRow = lastRow(afterClear);
    expect(setRow.message).toBe(clearRow.message);
    expect(setRow.message).toBe('zmienił(a) ustawienia hasła osoby „Anna Kowalska”');
    expect(setRow.message).not.toContain(hash);
    expect(setRow.entityType).toBe('person');
    expect(setRow.entityId).toBe('p1');
  });

  it('unknown person -> no row, password map otherwise unchanged', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_PASSWORD', personId: 'ghost', passwordHash: 'x' });
    expect(next.activity.length).toBe(state.activity.length);
    expect(next.people).toEqual(state.people);
  });
});

describe('10. ADD_PERSON / UPDATE_PERSON', () => {
  it('ADD_PERSON logs one person row with the new name', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_PERSON', person: personDraft({ firstName: 'Kasia', lastName: 'Zielińska' }) });
    expect(next.people.length).toBe(state.people.length + 1);
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.entityType).toBe('person');
    expect(row.message).toBe('dodał(a) osobę „Kasia Zielińska”');
  });

  it('UPDATE_PERSON role change includes both role labels', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p2',
      person: personDraft({ firstName: 'Jan', lastName: 'Nowak', accessRole: 'pelne' }),
    });
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.message).toContain('rola:');
    expect(row.message).toContain(ROLE_LABELS.ograniczone);
    expect(row.message).toContain(ROLE_LABELS.pelne);
  });

  it('UPDATE_PERSON without role change logs a plain update row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p2',
      person: personDraft({ firstName: 'Janek', lastName: 'Nowak', accessRole: 'ograniczone' }),
    });
    expect(next.activity.length).toBe(state.activity.length + 1);
    expect(lastRow(next).message).toBe('zaktualizował(a) dane osoby „Janek Nowak”');
  });

  it('last-admin demote -> same reference, no row', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: personDraft({ firstName: 'Anna', lastName: 'Kowalska', accessRole: 'ograniczone' }),
    });
    expect(next).toBe(state);
  });
});

describe('11. DELETE_PERSON', () => {
  it('logs one person row that survives the delete', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'p2' });
    expect(next.people.some((p) => p.id === 'p2')).toBe(false);
    const row = lastRow(next);
    expect(row.entityType).toBe('person');
    expect(row.entityId).toBe('p2');
    expect(row.message).toBe('usunął(a) osobę „Jan Nowak”');
    // The row is a 'person' row -> never pruned.
    expect(next.activity.some((e) => e.entityType === 'person' && e.entityId === 'p2')).toBe(true);
  });

  it('last-admin delete -> same reference, no row', () => {
    const state = makeState();
    expect(reducer(state, { type: 'DELETE_PERSON', personId: 'p1' })).toBe(state);
  });

  it('stale id -> same reference, no row', () => {
    const state = makeState();
    expect(reducer(state, { type: 'DELETE_PERSON', personId: 'ghost' })).toBe(state);
  });
});

describe('12. statuses', () => {
  it('create logs, rename/color edit logs nothing', () => {
    const state = makeState();
    const created = reducer(state, { type: 'SAVE_STATUS', statusId: null, name: 'Nowy', color: '#abcdef' });
    expect(created.activity.length).toBe(state.activity.length + 1);
    expect(lastRow(created).message).toBe('utworzył(a) status „Nowy”');
    expect(lastRow(created).entityType).toBe('status');

    const edited = reducer(created, { type: 'SAVE_STATUS', statusId: 's1', name: 'Zmienione', color: '#123456' });
    expect(edited.activity.length).toBe(created.activity.length); // no row on edit
  });

  it('archive then restore each log one row', () => {
    const state = makeState();
    const archived = reducer(state, { type: 'SET_STATUS_ARCHIVED', statusId: 's1', archived: true });
    expect(archived.activity.length).toBe(state.activity.length + 1);
    expect(lastRow(archived).message).toBe('zarchiwizował(a) status „Do zrobienia”');
    const restored = reducer(archived, { type: 'SET_STATUS_ARCHIVED', statusId: 's1', archived: false });
    expect(restored.activity.length).toBe(archived.activity.length + 1);
    expect(lastRow(restored).message).toBe('przywrócił(a) status „Do zrobienia”');
  });

  it('done-toggle both directions each log one row', () => {
    const state = makeState();
    const on = reducer(state, { type: 'SET_STATUS_DONE', statusId: 's1', isDone: true });
    expect(on.activity.length).toBe(state.activity.length + 1);
    expect(lastRow(on).message).toBe('oznaczył(a) status „Do zrobienia” jako ukończony');
    const off = reducer(on, { type: 'SET_STATUS_DONE', statusId: 's1', isDone: false });
    expect(off.activity.length).toBe(on.activity.length + 1);
    expect(lastRow(off).message).toBe('cofnął(a) oznaczenie ukończenia statusu „Do zrobienia”');
  });

  it('delete logs one row', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 's3' });
    expect(next.statuses.some((s) => s.id === 's3')).toBe(false);
    expect(next.activity.length).toBe(state.activity.length + 1);
    expect(lastRow(next).message).toBe('usunął(a) status „Zapas”');
  });

  it('refused archive/done/delete guards -> same reference, no row', () => {
    // s2 is the only done status: archiving it, un-doning it and deleting it are refused.
    const state = makeState();
    expect(reducer(state, { type: 'SET_STATUS_ARCHIVED', statusId: 's2', archived: true })).toBe(state);
    expect(reducer(state, { type: 'SET_STATUS_DONE', statusId: 's2', isDone: false })).toBe(state);
    // s1 is referenced by the project/task -> delete refused.
    expect(reducer(state, { type: 'DELETE_STATUS', statusId: 's1' })).toBe(state);
  });

  it('REORDER_STATUS logs no row', () => {
    const state = makeState();
    const next = reducer(state, { type: 'REORDER_STATUS', statusId: 's2', direction: -1 });
    expect(next.activity.length).toBe(state.activity.length);
  });

  it('REORDER_PROJECT_TASK logs no row (cosmetic ordering)', () => {
    const second: Task = { ...TASK, id: 't2', title: 'Drugie', orderIndex: 1 };
    const state = makeState({ tasks: [{ ...TASK, orderIndex: 0 }, second] });
    const next = reducer(state, { type: 'REORDER_PROJECT_TASK', taskId: 't1', direction: 1 });
    // The move actually happened (ranks swapped) but no activity row was written.
    expect(next.tasks.find((t) => t.id === 't1')!.orderIndex).toBe(1);
    expect(next.activity.length).toBe(state.activity.length);
  });
});

describe('13. deletions of task / project / client', () => {
  it('DELETE_TASK -> one project row with the task title that survives', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_TASK', taskId: 't1' });
    expect(next.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(next.activity.length).toBe(state.activity.length + 1);
    const row = lastRow(next);
    expect(row.entityType).toBe('project');
    expect(row.entityId).toBe('proj1');
    expect(row.message).toBe('usunął(a) zadanie „Zadanie”');
  });

  it('DELETE_PROJECT prunes its project/task rows and leaves one system row', () => {
    // Seed a project row and a task row that the cascade should prune.
    const seeded = makeState();
    seeded.activity = [
      { id: 'a1', entityType: 'project', entityId: 'proj1', actorId: 'p1', impersonatorId: '', message: 'stary', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', entityType: 'task', entityId: 't1', actorId: 'p1', impersonatorId: '', message: 'stary', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const next = reducer(seeded, { type: 'DELETE_PROJECT', projectId: 'proj1' });
    expect(next.projects.some((p) => p.id === 'proj1')).toBe(false);
    expect(next.activity.some((e) => e.entityType === 'project' && e.entityId === 'proj1')).toBe(false);
    expect(next.activity.some((e) => e.entityType === 'task' && e.entityId === 't1')).toBe(false);
    const systemRows = next.activity.filter((e) => e.entityType === 'system');
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0].message).toBe('usunął(a) projekt „Projekt”');
  });

  it('DELETE_CLIENT -> exactly one client row despite cascaded projects', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_CLIENT', clientId: 'c1' });
    expect(next.clients.some((c) => c.id === 'c1')).toBe(false);
    const clientRows = next.activity.filter((e) => e.entityType === 'client');
    expect(clientRows).toHaveLength(1);
    expect(clientRows[0].entityId).toBe('c1');
    expect(clientRows[0].message).toBe('usunął(a) klienta „Klient”');
  });
});

describe('14. pruning regression for new entity types', () => {
  it("pre-seeded 'person'/'status' rows survive task and project deletions", () => {
    const state = makeState();
    state.activity = [
      { id: 'p-row', entityType: 'person', entityId: 'p2', actorId: 'p1', impersonatorId: '', message: 'usunął(a) osobę „Jan Nowak”', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 's-row', entityType: 'status', entityId: 's3', actorId: 'p1', impersonatorId: '', message: 'utworzył(a) status „Zapas”', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const afterTask = reducer(state, { type: 'DELETE_TASK', taskId: 't1' });
    const afterProject = reducer(afterTask, { type: 'DELETE_PROJECT', projectId: 'proj1' });
    expect(afterProject.activity.some((e) => e.id === 'p-row')).toBe(true);
    expect(afterProject.activity.some((e) => e.id === 's-row')).toBe(true);
  });
});
