// Unit tests for the reducer-command validation boundary added by
// PKG-20260713-reducer-validation (commandValidation.ts wired into AppStore).
// Every rejection must return the ORIGINAL state reference and append no
// activity row; valid-legacy payloads (orphan-client project, off-grid estimate,
// SET_CURRENT_USER '') must keep working. Pure reducer tests — no React, no
// localStorage: build a minimal valid AppData fixture by hand.
import { describe, expect, it } from 'vitest';
import { reducer, type PersonDraft, type ProjectDraft, type TaskDraft } from './AppStore';
import { emptyData } from './storage';
import {
  hasEntity,
  isValidClientContacts,
  isValidClientDraft,
  isValidTaskDraft,
  sanitizeClientContacts,
} from './commandValidation';
import type { Client, Milestone, Person, Project, Status, Task, WorkloadEntry } from '../types';

const CLIENT: Client = { id: 'c1', name: 'Client', archived: false };
const STATUS: Status = { id: 's1', name: 'Do zrobienia', slug: 'do-zrobienia', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const STATUS_DONE: Status = { id: 's2', name: 'Zrobione', slug: 'zrobione', color: '#4caf50', order: 1, archived: false, isDone: true };
const PROJECT: Project = {
  id: 'proj1',
  clientId: 'c1',
  name: 'Project',
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
// Legacy orphan project: clientId points at a client that no longer exists.
// ProjectsPage renders these under a "Bez klienta" group; they must stay editable.
const ORPHAN_PROJECT: Project = { ...PROJECT, id: 'proj2', name: 'Orphan', clientId: 'ghost-client' };
const TASK: Task = {
  id: 't1',
  projectId: 'proj1',
  statusId: 's1',
  title: 'Task',
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
const MILESTONE: Milestone = { id: 'm1', projectId: 'proj1', name: 'Milestone', date: '2026-07-07' };
const PERSON: Person = {
  id: 'p1',
  firstName: 'Ala',
  lastName: '',
  name: 'Ala',
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
const PERSON2: Person = { ...PERSON, id: 'p2', firstName: 'Bob', name: 'Bob', accessRole: 'ograniczone' };

/** Minimal valid AppData: one client, two statuses, one project + one legacy
 *  orphan project, one task, one milestone, two people. Fresh per call. */
function makeState() {
  return {
    ...emptyData(),
    clients: [CLIENT],
    statuses: [STATUS, STATUS_DONE],
    projects: [PROJECT, ORPHAN_PROJECT],
    tasks: [TASK],
    milestones: [MILESTONE],
    people: [PERSON, PERSON2],
  };
}

function draftFromTask(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    projectId: TASK.projectId,
    statusId: TASK.statusId,
    title: TASK.title,
    description: TASK.description,
    startDate: TASK.startDate,
    endDate: TASK.endDate,
    estimatedHours: TASK.estimatedHours,
    priority: TASK.priority,
    workCategoryId: TASK.workCategoryId,
    departmentId: TASK.departmentId,
    checklist: TASK.checklist,
    ...overrides,
  };
}

function draftFromProject(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    clientId: PROJECT.clientId,
    name: PROJECT.name,
    description: PROJECT.description,
    statusId: PROJECT.statusId,
    paid: PROJECT.paid,
    startDate: PROJECT.startDate,
    endDate: PROJECT.endDate,
    departmentId: PROJECT.departmentId,
    serviceTypeId: PROJECT.serviceTypeId,
    companyId: PROJECT.companyId ?? '',
    ...overrides,
  };
}

function personDraft(overrides: Partial<PersonDraft> = {}): PersonDraft {
  return {
    firstName: 'Nowy',
    lastName: '',
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

/** Assert a rejection: same state reference, no new activity row. */
function expectRejected(state: ReturnType<typeof makeState>, next: ReturnType<typeof makeState>) {
  expect(next).toBe(state);
  expect(next.activity.length).toBe(state.activity.length);
}

describe('SAVE_TASK command validation', () => {
  it('rejects a stale taskId AND creates no ghost assignments/workload/activity', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 'ghost',
        draft: draftFromTask(),
        assigneeIds: ['p1'],
        allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 2 }],
      },
    });
    expectRejected(state, next);
    expect(next.assignments.length).toBe(state.assignments.length);
    expect(next.workload.length).toBe(state.workload.length);
  });

  it('rejects a whitespace-only title', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ title: '   ' }), assigneeIds: [], allocations: [] },
    });
    expectRejected(state, next);
  });

  it('rejects a dangling projectId (reducer-level), and the predicate agrees', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ projectId: 'nope' }), assigneeIds: [], allocations: [] },
    });
    expectRejected(state, next);
    // Direct predicate unit check: dangling projectId -> false, valid -> true.
    expect(isValidTaskDraft(state, draftFromTask({ projectId: 'nope' }))).toBe(false);
    expect(isValidTaskDraft(state, draftFromTask())).toBe(true);
  });

  it('rejects a dangling statusId (reducer-level), and the predicate agrees', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ statusId: 'nope' }), assigneeIds: [], allocations: [] },
    });
    expectRejected(state, next);
    expect(isValidTaskDraft(state, draftFromTask({ statusId: 'nope' }))).toBe(false);
  });

  it('rejects a negative and a NaN estimate', () => {
    const state = makeState();
    const negative = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ estimatedHours: -1 }), assigneeIds: [], allocations: [] },
    });
    expectRejected(state, negative);
    const nan = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ estimatedHours: Number.NaN }), assigneeIds: [], allocations: [] },
    });
    expectRejected(state, nan);
  });

  it('rejects an unknown person id in assigneeIds atomically', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: {
        taskId: 't1',
        draft: draftFromTask(),
        assigneeIds: ['ghost-person'],
        allocations: [{ personId: 'ghost-person', date: '2026-07-06', plannedHours: 2 }],
      },
    });
    expectRejected(state, next);
    expect(next.assignments.length).toBe(state.assignments.length);
    expect(next.workload.length).toBe(state.workload.length);
    // Direct predicate unit check on the reference helper.
    expect(hasEntity(state, 'person', 'p1')).toBe(true);
    expect(hasEntity(state, 'person', 'ghost-person')).toBe(false);
  });
});

describe('SET_TASK_STATUS command validation', () => {
  it('rejects a stale taskId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_TASK_STATUS', taskId: 'ghost', statusId: 's2' });
    expectRejected(state, next);
  });

  it('rejects a dangling statusId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_TASK_STATUS', taskId: 't1', statusId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('SET_BLOCK_DONE command validation (PKG-per-block-done)', () => {
  const ENTRY: WorkloadEntry = {
    id: 'w1',
    taskId: 't1',
    personId: 'p1',
    date: '2026-07-08',
    plannedHours: 2,
    startMinutes: 480,
    sortIndex: 0,
  };

  function stateWithBlock(overrides: Partial<WorkloadEntry> = {}) {
    return { ...makeState(), workload: [{ ...ENTRY, ...overrides }] };
  }

  it('marks only the targeted entry done without touching the task status', () => {
    const state = stateWithBlock();
    const next = reducer(state, { type: 'SET_BLOCK_DONE', entryId: 'w1', done: true });
    expect(next).not.toBe(state);
    expect(next.workload[0].done).toBe(true);
    expect(next.tasks.find((t) => t.id === 't1')!.statusId).toBe('s1'); // status unchanged
    expect(next.activity.length).toBe(state.activity.length + 1);
  });

  it('invariant 6: an unknown entryId returns the SAME state reference', () => {
    const state = stateWithBlock();
    const next = reducer(state, { type: 'SET_BLOCK_DONE', entryId: 'ghost', done: true });
    expectRejected(state, next);
  });

  it('invariant 6: a no-op (value already equal) returns the SAME state reference', () => {
    const already = stateWithBlock({ done: true });
    const noop = reducer(already, { type: 'SET_BLOCK_DONE', entryId: 'w1', done: true });
    expectRejected(already, noop);

    const fresh = stateWithBlock(); // done === undefined
    const noopFalse = reducer(fresh, { type: 'SET_BLOCK_DONE', entryId: 'w1', done: false });
    expectRejected(fresh, noopFalse);
  });

  it('can clear a previously-done block back to not done', () => {
    const state = stateWithBlock({ done: true });
    const next = reducer(state, { type: 'SET_BLOCK_DONE', entryId: 'w1', done: false });
    expect(next).not.toBe(state);
    expect(next.workload[0].done).toBe(false);
  });
});

describe('SAVE_PROJECT command validation', () => {
  it('rejects a stale projectId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_PROJECT', projectId: 'ghost', draft: draftFromProject() });
    expectRejected(state, next);
  });

  it('rejects a whitespace-only name', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_PROJECT', projectId: 'proj1', draft: draftFromProject({ name: '  ' }) });
    expectRejected(state, next);
  });

  it('rejects a dangling statusId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_PROJECT', projectId: 'proj1', draft: draftFromProject({ statusId: 'nope' }) });
    expectRejected(state, next);
  });

  it('rejects create with a dangling clientId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_PROJECT', projectId: null, draft: draftFromProject({ clientId: 'nope' }) });
    expectRejected(state, next);
  });

  it("rejects create with '' clientId (client creation lives only in Klienci)", () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: null,
      draft: draftFromProject({ clientId: '' }),
    });
    expectRejected(state, next);
  });

  it("rejects edit switching to '' clientId when the project has a real client", () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: 'proj1',
      draft: draftFromProject({ clientId: '' }),
    });
    expectRejected(state, next);
  });
});

describe('SET_PROJECT_PAID / SET_PROJECT_DATES command validation', () => {
  it('SET_PROJECT_PAID rejects a stale projectId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_PROJECT_PAID', projectId: 'ghost', paid: true });
    expectRejected(state, next);
  });

  it('SET_PROJECT_DATES rejects a stale projectId', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SET_PROJECT_DATES',
      projectId: 'ghost',
      startDate: '2026-07-01',
      endDate: '2026-07-20',
    });
    expectRejected(state, next);
  });
});

describe('SET_PROJECT_STATUS command validation', () => {
  it('rejects a dangling statusId (stale project already guarded)', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_PROJECT_STATUS', projectId: 'proj1', statusId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('SAVE_MILESTONE command validation', () => {
  it('rejects create with a dangling projectId', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: 'ghost',
      name: 'New',
      date: '2026-07-07',
    });
    expectRejected(state, next);
  });

  it('rejects edit with a stale milestoneId', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: 'ghost',
      projectId: 'proj1',
      name: 'New',
      date: '2026-07-07',
    });
    expectRejected(state, next);
  });

  it('rejects edit when the milestone belongs to a different project', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: 'm1',
      projectId: 'proj2',
      name: 'Moved by mistake',
      date: '2026-07-07',
    });
    expectRejected(state, next);
  });

  it('rejects create with a whitespace-only name', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_MILESTONE',
      milestoneId: null,
      projectId: 'proj1',
      name: '   ',
      date: '2026-07-07',
    });
    expectRejected(state, next);
  });
});

describe('DELETE_MILESTONE command validation', () => {
  it('rejects a stale milestoneId by SAME reference (was a new copy before)', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_MILESTONE', milestoneId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('SAVE_STATUS / DELETE_STATUS command validation', () => {
  it('SAVE_STATUS rename rejects a stale statusId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_STATUS', statusId: 'ghost', name: 'Renamed', color: '#fff' });
    expectRejected(state, next);
  });

  it('DELETE_STATUS rejects a stale statusId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_STATUS', statusId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('Person command validation', () => {
  it('ADD_PERSON rejects a whitespace-only firstName', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_PERSON', person: personDraft({ firstName: '   ' }) });
    expectRejected(state, next);
  });

  it('UPDATE_PERSON rejects a stale personId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'UPDATE_PERSON', personId: 'ghost', person: personDraft() });
    expectRejected(state, next);
  });

  it('UPDATE_PERSON rejects a whitespace-only firstName', () => {
    const state = makeState();
    const next = reducer(state, { type: 'UPDATE_PERSON', personId: 'p2', person: personDraft({ firstName: '  ' }) });
    expectRejected(state, next);
  });

  it('DELETE_PERSON rejects a stale personId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('SET_CURRENT_USER command validation', () => {
  it('rejects a stale personId', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SET_CURRENT_USER', personId: 'ghost' });
    expectRejected(state, next);
  });
});

describe('valid / valid-legacy payloads still apply', () => {
  it('SAVE_TASK valid title edit persists', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ title: 'Renamed' }), assigneeIds: ['p1'], allocations: [] },
    });
    expect(next).not.toBe(state);
    expect(next.tasks.find((t) => t.id === 't1')!.title).toBe('Renamed');
  });

  it('SAVE_TASK with a legacy off-grid estimate (5.1h) round-trips unchanged', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_TASK',
      payload: { taskId: 't1', draft: draftFromTask({ estimatedHours: 5.1 }), assigneeIds: [], allocations: [] },
    });
    expect(next).not.toBe(state);
    expect(next.tasks.find((t) => t.id === 't1')!.estimatedHours).toBe(5.1);
  });

  it('SAVE_PROJECT edit of the orphan project keeping its dangling clientId succeeds', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: 'proj2',
      draft: draftFromProject({ name: 'Orphan renamed', clientId: 'ghost-client' }),
    });
    expect(next).not.toBe(state);
    const saved = next.projects.find((p) => p.id === 'proj2')!;
    expect(saved.name).toBe('Orphan renamed');
    expect(saved.clientId).toBe('ghost-client');
  });

  it('SAVE_PROJECT create with an existing clientId succeeds and never adds a client', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_PROJECT',
      projectId: null,
      draft: draftFromProject({ name: 'Fresh', clientId: 'c1' }),
    });
    expect(next).not.toBe(state);
    expect(next.clients).toBe(state.clients);
    expect(next.projects.length).toBe(state.projects.length + 1);
  });

  it('SET_CURRENT_USER sets an existing person, and \'\' clears the identity', () => {
    const state = makeState();
    const set = reducer(state, { type: 'SET_CURRENT_USER', personId: 'p1' });
    expect(set.currentUserId).toBe('p1');
    const seeded = { ...makeState(), currentUserId: 'p1' };
    const cleared = reducer(seeded, { type: 'SET_CURRENT_USER', personId: '' });
    expect(cleared.currentUserId).toBe('');
  });

  it('UPDATE_PERSON valid edit applies, but last-admin demotion is still refused', () => {
    const state = makeState();
    // p1 is the ONLY administrator: a valid non-demoting edit still applies.
    const renamed = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: personDraft({ firstName: 'Alicja', accessRole: 'pelne' }),
    });
    expect(renamed).not.toBe(state);
    expect(renamed.people.find((p) => p.id === 'p1')!.firstName).toBe('Alicja');
    // Demoting the only admin is refused by the pre-existing guard (same ref).
    const demoted = reducer(state, {
      type: 'UPDATE_PERSON',
      personId: 'p1',
      person: personDraft({ firstName: 'Ala', accessRole: 'ograniczone' }),
    });
    expectRejected(state, demoted);
  });
});

// Wymagane pola klienta: nazwa + osoba kontaktowa + (e-mail LUB telefon).
// Świadomie BEZ walidacji formatu e-maila — to reguła kompletności danych.
describe('isValidClientDraft (client required fields — AND rule)', () => {
  const full = {
    name: 'Acme',
    contactName: 'Anna Nowak',
    contactEmail: 'anna@acme.pl',
    contactPhone: '+48 600 100 200',
  };

  it('accepts a draft with BOTH channels present', () => {
    expect(isValidClientDraft(full)).toBe(true);
  });

  it('rejects an e-mail-only or phone-only draft (the OR rule is gone)', () => {
    expect(isValidClientDraft({ ...full, contactPhone: '' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactEmail: '' })).toBe(false);
    // Missing (undefined) contact channel behaves exactly like ''.
    expect(isValidClientDraft({ name: 'Acme', contactName: 'Anna', contactEmail: 'a@b.pl' })).toBe(false);
  });

  it('rejects a missing name, a missing contact person and a missing channel', () => {
    expect(isValidClientDraft({ ...full, name: '' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactName: '' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactEmail: '', contactPhone: '' })).toBe(false);
    expect(isValidClientDraft({ name: 'Acme' })).toBe(false);
  });

  it('treats whitespace-only values as empty', () => {
    expect(isValidClientDraft({ ...full, name: '   ' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactName: '  \t ' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactEmail: '  ' })).toBe(false);
    expect(isValidClientDraft({ ...full, contactPhone: ' ' })).toBe(false);
  });

  it('does NOT check the e-mail format (data completeness, not a format boundary)', () => {
    expect(isValidClientDraft({ ...full, contactEmail: 'nie-jest-mailem' })).toBe(true);
  });

  it('rejects when a present `contacts` array is structurally invalid', () => {
    expect(isValidClientDraft({ ...full, contacts: 'not-an-array' })).toBe(false);
    expect(isValidClientDraft({ ...full, contacts: [{ id: 'k1', firstName: 'Jan', lastName: '' }] })).toBe(false);
    // undefined contacts is fine; a valid array is fine.
    expect(isValidClientDraft({ ...full, contacts: undefined })).toBe(true);
    expect(
      isValidClientDraft({ ...full, contacts: [{ id: 'k1', firstName: 'Jan', lastName: 'Kos', phone: '', email: '' }] }),
    ).toBe(true);
  });
});

describe('isValidClientContacts (strict reducer gate)', () => {
  const row = { id: 'k1', firstName: 'Jan', lastName: 'Kos', phone: '', email: '' };

  it('accepts an empty array and well-formed rows', () => {
    expect(isValidClientContacts([])).toBe(true);
    expect(isValidClientContacts([row])).toBe(true);
    expect(isValidClientContacts([row, { ...row, id: 'k2', phone: '600' }])).toBe(true);
    // phone/email may be omitted (treated as '').
    expect(isValidClientContacts([{ id: 'k3', firstName: 'Ala', lastName: 'Ma' }])).toBe(true);
  });

  it('rejects a non-array, a missing/duplicate id, blank names, and non-string channels', () => {
    expect(isValidClientContacts('x')).toBe(false);
    expect(isValidClientContacts([{ firstName: 'Jan', lastName: 'Kos' }])).toBe(false); // no id
    expect(isValidClientContacts([{ ...row, id: '' }])).toBe(false); // empty id
    expect(isValidClientContacts([row, { ...row }])).toBe(false); // duplicate id
    expect(isValidClientContacts([{ ...row, firstName: '  ' }])).toBe(false); // blank first
    expect(isValidClientContacts([{ ...row, lastName: '' }])).toBe(false); // blank last
    expect(isValidClientContacts([{ ...row, phone: 123 }])).toBe(false); // non-string phone
    expect(isValidClientContacts([null])).toBe(false);
  });
});

describe('sanitizeClientContacts (lenient load/hydration cleaner)', () => {
  it('coerces, trims, drops junk and dedupes; empty result → undefined', () => {
    expect(sanitizeClientContacts('x')).toBeUndefined();
    expect(sanitizeClientContacts([])).toBeUndefined();
    // Row without id dropped; blank-both-names dropped; empty → undefined.
    expect(sanitizeClientContacts([{ firstName: 'Jan', lastName: 'Kos' }])).toBeUndefined();
    expect(sanitizeClientContacts([{ id: 'k1', firstName: '  ', lastName: '' }])).toBeUndefined();
    // Coercion + trim of the four fields; non-string channels → ''.
    expect(
      sanitizeClientContacts([{ id: 'k1', firstName: ' Jan ', lastName: ' Kos ', phone: 123, email: null }]),
    ).toEqual([{ id: 'k1', firstName: 'Jan', lastName: 'Kos', phone: '', email: '' }]);
    // Dedupe by id (first wins).
    expect(
      sanitizeClientContacts([
        { id: 'k1', firstName: 'Jan', lastName: 'Kos' },
        { id: 'k1', firstName: 'Ala', lastName: 'Ma' },
      ]),
    ).toEqual([{ id: 'k1', firstName: 'Jan', lastName: 'Kos', phone: '', email: '' }]);
  });

  it('is idempotent: sanitize(sanitize(x)) ≡ sanitize(x)', () => {
    const raw = [
      { id: 'k1', firstName: ' Jan ', lastName: 'Kos', phone: 5, email: '' },
      { id: '', firstName: 'x', lastName: 'y' },
      { id: 'k2', firstName: '', lastName: '' },
    ];
    const once = sanitizeClientContacts(raw);
    expect(sanitizeClientContacts(once)).toEqual(once);
  });
});

describe('ADD_CLIENT / SAVE_CLIENT required-field validation (AND rule)', () => {
  // Complete contact now needs BOTH channels.
  const contact = { contactName: 'Anna Nowak', contactEmail: 'anna@acme.pl', contactPhone: '+48 600 100 200' };

  it('ADD_CLIENT rejects an incomplete draft by the SAME state reference', () => {
    const state = makeState();
    expectRejected(state, reducer(state, { type: 'ADD_CLIENT', name: 'Acme' }));
    expectRejected(state, reducer(state, { type: 'ADD_CLIENT', name: 'Acme', contactName: 'Anna' }));
    // e-mail-only and phone-only are now rejected.
    expectRejected(
      state,
      reducer(state, { type: 'ADD_CLIENT', name: 'Acme', contactName: 'Anna', contactEmail: 'a@b.pl' }),
    );
    expectRejected(
      state,
      reducer(state, { type: 'ADD_CLIENT', name: 'Acme', contactName: 'Anna', contactPhone: '600' }),
    );
    expectRejected(state, reducer(state, { type: 'ADD_CLIENT', name: '  ', ...contact }));
  });

  it('ADD_CLIENT accepts a complete draft and stores trimmed contacts, omitting an empty list', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_CLIENT', name: ' Acme ', ...contact });
    expect(next).not.toBe(state);
    expect(next.clients.length).toBe(state.clients.length + 1);
    const added = next.clients[next.clients.length - 1];
    expect(added).toMatchObject({
      name: 'Acme',
      contactName: 'Anna Nowak',
      contactEmail: 'anna@acme.pl',
      contactPhone: '+48 600 100 200',
    });
    // Canonical: no `contacts` key when the list is empty/absent.
    expect('contacts' in added).toBe(false);

    // With additional persons: trimmed and stored under `contacts`.
    const withContacts = reducer(state, {
      type: 'ADD_CLIENT',
      name: 'Acme',
      ...contact,
      contacts: [{ id: 'k1', firstName: ' Marek ', lastName: ' Kos ', phone: ' 600 ', email: ' m@k.pl ' }],
    });
    const c2 = withContacts.clients[withContacts.clients.length - 1];
    expect(c2.contacts).toEqual([{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '600', email: 'm@k.pl' }]);
  });

  it('ADD_CLIENT rejects a structurally invalid contacts payload by the SAME state reference', () => {
    const state = makeState();
    expectRejected(
      state,
      reducer(state, { type: 'ADD_CLIENT', name: 'Acme', ...contact, contacts: [{ id: 'k1', firstName: 'Jan', lastName: '' }] as never }),
    );
  });

  it('SAVE_CLIENT rejects an incomplete draft by the SAME state reference', () => {
    const state = makeState();
    const base = { type: 'SAVE_CLIENT' as const, clientId: 'c1', notes: '' };
    expectRejected(
      state,
      reducer(state, { ...base, name: 'Acme', contactName: '', contactEmail: 'a@b.pl', contactPhone: '600' }),
    );
    expectRejected(
      state,
      reducer(state, { ...base, name: 'Acme', contactName: 'Anna', contactEmail: '', contactPhone: '600' }),
    );
    expectRejected(
      state,
      reducer(state, { ...base, name: 'Acme', contactName: 'Anna', contactEmail: 'a@b.pl', contactPhone: '' }),
    );
  });

  it('SAVE_CLIENT rejects an invalid contacts payload by the SAME state reference (invariant 6)', () => {
    const state = makeState();
    expectRejected(
      state,
      reducer(state, {
        type: 'SAVE_CLIENT',
        clientId: 'c1',
        name: 'Acme',
        ...contact,
        notes: '',
        contacts: [{ id: 'k1', firstName: 'Jan', lastName: '' }] as never,
      }),
    );
  });

  it('SAVE_CLIENT applies a complete draft, stores/removes contacts, and rejects an unknown id', () => {
    const state = makeState();
    const saved = reducer(state, {
      type: 'SAVE_CLIENT',
      clientId: 'c1',
      name: 'Acme',
      ...contact,
      notes: '',
      contacts: [{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '', email: '' }],
    });
    expect(saved).not.toBe(state);
    const c1 = saved.clients.find((c) => c.id === 'c1');
    expect(c1).toMatchObject({ name: 'Acme', contactName: 'Anna Nowak', contactPhone: '+48 600 100 200' });
    expect(c1?.contacts).toEqual([{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '', email: '' }]);

    // Saving with `contacts: []` REMOVES the key from the stored client.
    const cleared = reducer(saved, {
      type: 'SAVE_CLIENT',
      clientId: 'c1',
      name: 'Acme',
      ...contact,
      notes: '',
      contacts: [],
    });
    expect('contacts' in cleared.clients.find((c) => c.id === 'c1')!).toBe(false);

    expectRejected(
      state,
      reducer(state, {
        type: 'SAVE_CLIENT',
        clientId: 'ghost',
        name: 'Acme',
        ...contact,
        notes: '',
      }),
    );
  });
});
