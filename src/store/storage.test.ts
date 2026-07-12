// Unit tests for the v3->v4 startMinutes normalize pass (src/store/storage.ts).
// This is the architect's declared riskiest area of the migration — every
// load path (legacy v1, v<4, and same-version loads with stray bad data)
// funnels through ensureStartMinutes, so it's worth covering in isolation
// from localStorage/loadData.
import { describe, expect, it } from 'vitest';
import {
  DATA_VERSION,
  DEFAULT_FILTER_CRITERIA,
  ensureStartMinutes,
  emptyData,
  loadData,
  normalizeDates,
  normalizeStatusFlags,
  normalizeTaskMeta,
} from './storage';
import { todayStr } from '../utils/dates';
import { BIN_DATE } from '../utils/time';
import type {
  ActivityEvent,
  AppData,
  Comment,
  Milestone,
  Project,
  SavedFilter,
  Status,
  Task,
  WorkCategory,
  WorkloadEntry,
} from '../types';

// `loadData()` reads directly from `localStorage`, which the vitest `node`
// environment does not provide. Stub a minimal in-memory implementation for
// the duration of a callback and restore whatever was there before (usually
// nothing). `STORAGE_KEY` below mirrors storage.ts's private constant — it is
// not exported, so the key is duplicated here deliberately.
const STORAGE_KEY = 'n2hub.data.v1';

function withLocalStorage<T>(initial: Record<string, string>, fn: () => T): T {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
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

function makeEntry(overrides: Partial<WorkloadEntry> & { id: string }): WorkloadEntry {
  return {
    taskId: 't1',
    personId: 'p1',
    date: '2026-07-08',
    plannedHours: 2,
    startMinutes: 480,
    sortIndex: 0,
    ...overrides,
  };
}

function makeState(workload: WorkloadEntry[]): AppData {
  return { ...emptyData(), workload };
}

describe('ensureStartMinutes', () => {
  it('restacks a group from 08:00 in sortIndex order when any entry lacks a valid startMinutes', () => {
    // -1 mirrors the sentinel migrateV1 itself writes for "needs restacking".
    const e1 = makeEntry({ id: 'e1', sortIndex: 0, plannedHours: 2, startMinutes: -1 });
    const e2 = makeEntry({ id: 'e2', sortIndex: 1, plannedHours: 3, startMinutes: -1 });
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    expect(n1.startMinutes).toBe(480); // 08:00
    expect(n2.startMinutes).toBe(600); // 480 + 2h, right after e1
  });

  it('restacks the WHOLE group (not just the invalid entry) when only one entry is invalid', () => {
    // e1 already has a fine, but non-08:00, start; e2 is invalid. Because the
    // group contains an invalid entry, the whole group is restacked from
    // 08:00 in sortIndex order — e1's original startMinutes is discarded too.
    const e1 = makeEntry({ id: 'e1', sortIndex: 0, plannedHours: 1, startMinutes: 900 });
    const e2 = makeEntry({ id: 'e2', sortIndex: 1, plannedHours: 1, startMinutes: 5000 }); // out of range
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    expect(n1.startMinutes).toBe(480);
    expect(n2.startMinutes).toBe(540);
  });

  it('leaves a group with valid, on-grid startMinutes untouched (idempotent — a second pass changes nothing)', () => {
    const e1 = makeEntry({ id: 'e1', sortIndex: 0, plannedHours: 2, startMinutes: 480 });
    const e2 = makeEntry({ id: 'e2', sortIndex: 1, plannedHours: 1, startMinutes: 600 });
    const state = makeState([e1, e2]);

    const once = ensureStartMinutes(state);
    expect(once).toBe(state); // no patch needed -> same reference back
    expect(once.workload.find((w) => w.id === 'e1')!.startMinutes).toBe(480);
    expect(once.workload.find((w) => w.id === 'e2')!.startMinutes).toBe(600);

    const twice = ensureStartMinutes(once);
    expect(twice).toBe(once); // running again is a no-op
  });

  it('snaps an off-grid but otherwise valid startMinutes to the 15-min grid without restacking siblings', () => {
    // 487 is in-range (fits the day) so it takes the "already valid" branch,
    // which only snaps off-grid values — it does not restack the group.
    const e1 = makeEntry({ id: 'e1', sortIndex: 0, plannedHours: 1, startMinutes: 487 });
    const e2 = makeEntry({ id: 'e2', sortIndex: 1, plannedHours: 1, startMinutes: 600 });
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    expect(n1.startMinutes).toBe(480); // snapToStep(487) -> 480
    expect(n2.startMinutes).toBe(600); // sibling untouched — no restack triggered
  });

  it('clamps a restacked pathological long day so no block passes 24:00 (accepted-by-design behavior)', () => {
    // Two invalid entries totalling 30h: first block (10h) fits from 08:00,
    // but the second (20h) would run past 24:00 from where the first ends,
    // so its start clamps to DAY_MINUTES - durationMin = 1440 - 1200 = 240 —
    // even though that lands it BEFORE the first block ends. This mirrors
    // stackStartTimes' documented clamp rule.
    const e1 = makeEntry({ id: 'e1', sortIndex: 0, plannedHours: 10, startMinutes: -1 });
    const e2 = makeEntry({ id: 'e2', sortIndex: 1, plannedHours: 20, startMinutes: -1 });
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    expect(n1.startMinutes).toBe(480);
    expect(n2.startMinutes).toBe(240);
  });
});

describe('ensureStartMinutes — bin normalization (PKG-20260708-bin-core)', () => {
  it('normalizes a bin entry with garbage startMinutes and gappy sortIndex to startMinutes:0 and contiguous sortIndex', () => {
    // Distinct tasks so the one-bin-row merge doesn't fold them together.
    const e1 = makeEntry({ id: 'e1', taskId: 't1', date: BIN_DATE, startMinutes: 300, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', taskId: 't2', date: BIN_DATE, startMinutes: 999, sortIndex: 3 }); // gappy: 0, 3
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    expect(n1.startMinutes).toBe(0);
    expect(n2.startMinutes).toBe(0);
    expect(n1.sortIndex).toBe(0);
    expect(n2.sortIndex).toBe(1); // renumbered contiguous, order preserved from old sortIndex
  });

  it('is idempotent and returns the same reference for an already-clean bin group', () => {
    // Distinct tasks so no one-bin-row merge is triggered (that would rewrite the group).
    const e1 = makeEntry({ id: 'e1', taskId: 't1', date: BIN_DATE, startMinutes: 0, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', taskId: 't2', date: BIN_DATE, startMinutes: 0, sortIndex: 1 });
    const state = makeState([e1, e2]);

    const once = ensureStartMinutes(state);
    expect(once).toBe(state); // no patch needed -> same reference

    const twice = ensureStartMinutes(once);
    expect(twice).toBe(once); // running the pass again is a no-op
  });

  it('does NOT stack a bin group from 08:00, even with garbage startMinutes on every entry (unlike a dated group)', () => {
    // Distinct tasks so both survive the one-bin-row merge and land at startMinutes 0.
    const e1 = makeEntry({ id: 'e1', taskId: 't1', date: BIN_DATE, startMinutes: -1, plannedHours: 3, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', taskId: 't2', date: BIN_DATE, startMinutes: 5000, plannedHours: 2, sortIndex: 1 });
    const next = ensureStartMinutes(makeState([e1, e2]));

    const n1 = next.workload.find((w) => w.id === 'e1')!;
    const n2 = next.workload.find((w) => w.id === 'e2')!;
    // A dated group with this input would stack at 480 then 660 (see the
    // "restacks a group from 08:00" test above) — bin entries always land at 0.
    expect(n1.startMinutes).toBe(0);
    expect(n2.startMinutes).toBe(0);
  });

  it('merges DUPLICATE per-task bin rows: lowest-sortIndex row survives, hours summed, sortIndex renumbered; idempotent on the result', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 2, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 3, sortIndex: 1 }); // duplicate row for the same (t1, p1)
    const other = makeEntry({ id: 'other', taskId: 't2', personId: 'p1', date: BIN_DATE, startMinutes: 0, plannedHours: 4, sortIndex: 2 }); // distinct task, untouched
    const state = makeState([e1, e2, other]);

    const once = ensureStartMinutes(state);
    expect(once).not.toBe(state);

    const survivor = once.workload.find((w) => w.taskId === 't1' && w.personId === 'p1');
    expect(survivor).toBeDefined();
    expect(survivor!.id).toBe('e1'); // lowest sortIndex kept
    expect(survivor!.plannedHours).toBe(5); // 2h + 3h summed
    expect(once.workload.find((w) => w.id === 'e2')).toBeUndefined(); // duplicate dropped

    const untouchedOther = once.workload.find((w) => w.id === 'other')!;
    expect(untouchedOther.plannedHours).toBe(4); // distinct task, not merged

    // Sort indices are renumbered contiguously across the whole bin group.
    const indices = once.workload.map((w) => w.sortIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);

    const twice = ensureStartMinutes(once);
    expect(twice).toBe(once); // idempotent — second pass is a no-op
  });
});

// ---------------------------------------------------------------------------
// Migration v4 -> v5 (PKG-20260708-auth-data): isAdmin -> accessRole + the new
// account/availability fields. Exercised through `loadData()` with a stubbed
// localStorage, since the internal migrate functions are not exported.
// ---------------------------------------------------------------------------

describe('loadData migration v4 -> v5', () => {
  function v4Payload(people: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
      version: 4,
      clients: [],
      departments: [],
      serviceTypes: [],
      statuses: [],
      projects: [],
      milestones: [],
      tasks: [],
      people,
      assignments: [],
      workload: [],
      comments: [],
      activity: [],
      currentUserId: '',
      sampleBannerDismissed: false,
      savedFilters: [],
    };
  }

  it('maps isAdmin true -> accessRole "administrator", isAdmin false -> "pracownik", strips isAdmin, fills documented defaults, and bumps the version to 5', () => {
    const payload = v4Payload([
      {
        id: 'p1',
        firstName: 'Ann',
        lastName: 'Admin',
        name: 'Ann Admin',
        email: '',
        role: '',
        departmentId: '',
        avatar: '',
        capacity: 6,
        isAdmin: true,
      },
      {
        id: 'p2',
        firstName: 'Bob',
        lastName: 'Staff',
        name: 'Bob Staff',
        email: '',
        role: '',
        departmentId: '',
        avatar: '',
        capacity: 8,
        isAdmin: false,
      },
      {
        id: 'p3',
        firstName: 'Cara',
        lastName: 'BigDay',
        name: 'Cara BigDay',
        email: '',
        role: '',
        departmentId: '',
        avatar: '',
        capacity: 20, // work-end minute must clamp to 24:00, not overflow
        isAdmin: false,
      },
    ]);

    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    expect(data.version).toBe(DATA_VERSION);
    expect(DATA_VERSION).toBe(7);

    const p1 = data.people.find((p) => p.id === 'p1')!;
    const p2 = data.people.find((p) => p.id === 'p2')!;
    const p3 = data.people.find((p) => p.id === 'p3')!;

    expect(p1.accessRole).toBe('administrator');
    expect(p2.accessRole).toBe('pracownik');
    expect(p3.accessRole).toBe('pracownik');
    expect(Object.prototype.hasOwnProperty.call(p1, 'isAdmin')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p2, 'isAdmin')).toBe(false);

    // Documented defaults for the new fields.
    for (const p of [p1, p2]) {
      expect(p.phone).toBe('');
      expect(p.passwordHash).toBe('');
      expect(p.workDays).toEqual([1, 2, 3, 4, 5]);
      expect(p.workStartMinutes).toBe(480);
      expect(p.supervisorId).toBe('');
    }
    expect(p1.workEndMinutes).toBe(480 + 6 * 60); // 840
    expect(p2.workEndMinutes).toBe(480 + 8 * 60); // 960
    expect(p3.workEndMinutes).toBe(1440); // 480 + 20*60 = 1680, capped at 24:00
  });

  it('loading a v5 payload back through loadData is idempotent (values are stable across two loads)', () => {
    const payload = v4Payload([
      {
        id: 'p1',
        firstName: 'Ann',
        lastName: 'Admin',
        name: 'Ann Admin',
        email: '',
        role: '',
        departmentId: '',
        avatar: '',
        capacity: 6,
        isAdmin: true,
      },
    ]);

    const once = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    const twice = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(once) }, () => loadData());

    expect(twice).toEqual(once);
    expect(twice.version).toBe(7);
    expect(twice.people[0].accessRole).toBe('administrator');
  });

  it('defensively normalizes a v5-STAMPED payload whose people were never migrated (isAdmin still present, no accessRole) — normalization runs on every load, not only version < 5', () => {
    // A payload stamped version 5 but carrying pre-v5 people (the mid-dev/HMR
    // hazard the reviewer flagged): migrateV4toV5 only fired for version < 5, so
    // a missing accessRole would make MATRIX[undefined] deny every action and
    // lock the login screen forever.
    const payload = {
      ...v4Payload([
        {
          id: 'p1',
          firstName: 'Ann',
          lastName: 'Admin',
          name: 'Ann Admin',
          email: '',
          role: '',
          departmentId: '',
          avatar: '',
          capacity: 8,
          isAdmin: true, // legacy flag, no accessRole
        },
        {
          id: 'p2',
          firstName: 'Bob',
          lastName: 'Staff',
          name: 'Bob Staff',
          email: '',
          role: '',
          departmentId: '',
          avatar: '',
          capacity: 8,
          isAdmin: false,
        },
      ]),
      version: 5, // stamped current, but people are un-migrated
    };

    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    const p1 = data.people.find((p) => p.id === 'p1')!;
    const p2 = data.people.find((p) => p.id === 'p2')!;
    expect(p1.accessRole).toBe('administrator');
    expect(p2.accessRole).toBe('pracownik');
    expect(Object.prototype.hasOwnProperty.call(p1, 'isAdmin')).toBe(false);
    expect(p1.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(p1.workStartMinutes).toBe(480);
    expect(p1.passwordHash).toBe('');

    // Idempotent: reloading the now-normalized payload is stable.
    const twice = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(data) }, () => loadData());
    expect(twice).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// impersonatorId default/round-trip/sanitize (PKG-20260708-b2-tests, covering
// the additive field shipped by PKG-20260708-b2-impersonation). Version stays
// 5 (additive, no bump) — payloads here are already v5-shaped.
// ---------------------------------------------------------------------------

describe('impersonatorId persistence (PKG-20260708-b2-tests)', () => {
  function v5Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 5,
      clients: [],
      departments: [],
      serviceTypes: [],
      statuses: [],
      projects: [],
      milestones: [],
      tasks: [],
      people: [
        {
          id: 'p1',
          firstName: 'Ann',
          lastName: 'Admin',
          name: 'Ann Admin',
          email: '',
          role: '',
          departmentId: '',
          avatar: '',
          capacity: 8,
          accessRole: 'administrator',
        },
        {
          id: 'p2',
          firstName: 'Bob',
          lastName: 'Staff',
          name: 'Bob Staff',
          email: '',
          role: '',
          departmentId: '',
          avatar: '',
          capacity: 8,
          accessRole: 'pracownik',
        },
      ],
      assignments: [],
      workload: [],
      comments: [],
      activity: [],
      currentUserId: 'p1',
      sampleBannerDismissed: false,
      savedFilters: [],
      ...overrides,
    };
  }

  it("a persisted payload WITHOUT impersonatorId loads with the '' default", () => {
    const payload = v5Payload(); // no impersonatorId key at all
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    expect(data.impersonatorId).toBe('');
  });

  it('a valid non-empty impersonatorId round-trips', () => {
    const payload = v5Payload({ currentUserId: 'p2', impersonatorId: 'p1' });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    expect(data.impersonatorId).toBe('p1');
    expect(data.currentUserId).toBe('p2');
  });

  it("sanitizes an impersonatorId referencing a non-existent person to ''", () => {
    const payload = v5Payload({ currentUserId: 'p2', impersonatorId: 'ghost' });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    expect(data.impersonatorId).toBe('');
  });

  it("sanitizes an impersonatorId equal to currentUserId to ''", () => {
    const payload = v5Payload({ currentUserId: 'p1', impersonatorId: 'p1' });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    expect(data.impersonatorId).toBe('');
  });

  it('loading is idempotent: load -> save-shape -> load again yields the same impersonatorId', () => {
    const payload = v5Payload({ currentUserId: 'p2', impersonatorId: 'p1' });
    const once = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    const twice = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(once) }, () => loadData());
    expect(twice).toEqual(once);
    expect(twice.impersonatorId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// normalizeTaskMeta (PKG-20260710-task-meta-model): the v5->v6 pass adding
// task priority/workCategoryId/checklist and filling saved-filter criteria.
// Runs on EVERY load, same idempotent-by-value philosophy as ensureStartMinutes
// / migratePerson — exercised directly here, and end-to-end through loadData()
// below.
// ---------------------------------------------------------------------------

describe('normalizeTaskMeta', () => {
  // Builds a deliberately v5-shaped task (no priority/workCategoryId/checklist
  // unless overridden) by casting through unknown, mirroring how storage.ts's
  // own migration code treats pre-v6 payloads as untyped records.
  function v5Task(overrides: Record<string, unknown> & { id: string }): Task {
    return {
      projectId: 'proj1',
      statusId: 'status1',
      title: 'Task',
      description: '',
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      estimatedHours: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as unknown as Task;
  }

  it('a v5-shaped task (no priority/workCategoryId/checklist keys) gains priority "normal", workCategoryId "", and checklist []', () => {
    const task = v5Task({ id: 't1' });
    const next = normalizeTaskMeta({ ...emptyData(), tasks: [task] });
    const normalized = next.tasks[0];
    expect(normalized.priority).toBe('normal');
    expect(normalized.workCategoryId).toBe('');
    expect(normalized.checklist).toEqual([]);
  });

  it("resets an invalid priority (e.g. 'critical') to 'normal' and preserves a valid one ('urgent')", () => {
    const bad = v5Task({ id: 't1', priority: 'critical' });
    const good = v5Task({ id: 't2', priority: 'urgent' });
    const next = normalizeTaskMeta({ ...emptyData(), tasks: [bad, good] });
    expect(next.tasks.find((t) => t.id === 't1')!.priority).toBe('normal');
    expect(next.tasks.find((t) => t.id === 't2')!.priority).toBe('urgent');
  });

  it("resets a dangling workCategoryId (no matching row) to '' and preserves a valid reference", () => {
    const dangling = v5Task({ id: 't1', workCategoryId: 'ghost' });
    const valid = v5Task({ id: 't2', workCategoryId: 'cat1' });
    const next = normalizeTaskMeta({
      ...emptyData(),
      workCategories: [{ id: 'cat1', name: 'Kreacja' }],
      tasks: [dangling, valid],
    });
    expect(next.tasks.find((t) => t.id === 't1')!.workCategoryId).toBe('');
    expect(next.tasks.find((t) => t.id === 't2')!.workCategoryId).toBe('cat1');
  });

  it("sanitizes a malformed checklist: non-array -> []; an item missing id gets one generated; non-string text coerces to ''; done is exactly `item.done === true`; non-object entries are dropped", () => {
    const nonArray = v5Task({ id: 't1', checklist: 'not-an-array' });
    const messy = v5Task({
      id: 't2',
      checklist: [
        { text: 'no id', done: true }, // missing id -> generated
        { id: 'c2', text: 42, done: 'yes' }, // non-string text, non-boolean done
        'garbage', // non-object entry, dropped
        null, // non-object entry, dropped
        { id: 'c3', text: 'fine', done: false },
      ],
    });
    const next = normalizeTaskMeta({ ...emptyData(), tasks: [nonArray, messy] });

    expect(next.tasks.find((t) => t.id === 't1')!.checklist).toEqual([]);

    const messyChecklist = next.tasks.find((t) => t.id === 't2')!.checklist;
    expect(messyChecklist).toHaveLength(3); // the 2 non-object entries dropped
    expect(messyChecklist[0].id).toBeTruthy(); // generated id (was missing)
    expect(messyChecklist[0].text).toBe('no id');
    expect(messyChecklist[0].done).toBe(true);
    expect(messyChecklist[1].id).toBe('c2');
    expect(messyChecklist[1].text).toBe(''); // 42 -> '' (non-string coerces)
    expect(messyChecklist[1].done).toBe(false); // 'yes' !== true
    expect(messyChecklist[2]).toEqual({ id: 'c3', text: 'fine', done: false });
  });

  it("fills a v5 saved filter's criteria with DEFAULT_FILTER_CRITERIA's priority/workCategoryId ('') while other criteria fields survive unchanged", () => {
    const filter = {
      id: 'f1',
      name: 'My filter',
      page: 'tasks' as const,
      criteria: {
        paid: 'unpaid',
        clientId: 'c1',
        statusId: 's1',
        personId: 'p1',
        from: '2026-07-01',
        to: '2026-07-31',
      },
    } as unknown as SavedFilter;
    const next = normalizeTaskMeta({ ...emptyData(), savedFilters: [filter] });
    const criteria = next.savedFilters[0].criteria;
    expect(criteria.priority).toBe('');
    expect(criteria.workCategoryId).toBe('');
    expect(criteria.paid).toBe('unpaid');
    expect(criteria.clientId).toBe('c1');
    expect(criteria.statusId).toBe('s1');
    expect(criteria.personId).toBe('p1');
    expect(criteria.from).toBe('2026-07-01');
    expect(criteria.to).toBe('2026-07-31');
  });

  it("resets an invalid criteria.priority to ''", () => {
    const filter = {
      id: 'f1',
      name: 'x',
      page: 'tasks' as const,
      criteria: { ...DEFAULT_FILTER_CRITERIA, priority: 'critical' },
    } as unknown as SavedFilter;
    const next = normalizeTaskMeta({ ...emptyData(), savedFilters: [filter] });
    expect(next.savedFilters[0].criteria.priority).toBe('');
  });

  it("resets a saved filter's dangling workCategoryId while preserving a valid category reference", () => {
    const dangling = {
      id: 'f1',
      name: 'Deleted category',
      page: 'tasks' as const,
      criteria: { ...DEFAULT_FILTER_CRITERIA, workCategoryId: 'ghost' },
    } as SavedFilter;
    const valid = {
      id: 'f2',
      name: 'Current category',
      page: 'tasks' as const,
      criteria: { ...DEFAULT_FILTER_CRITERIA, workCategoryId: 'cat1' },
    } as SavedFilter;

    const next = normalizeTaskMeta({
      ...emptyData(),
      workCategories: [{ id: 'cat1', name: 'Kreacja' }],
      savedFilters: [dangling, valid],
    });

    expect(next.savedFilters.find((filter) => filter.id === 'f1')!.criteria.workCategoryId).toBe('');
    expect(next.savedFilters.find((filter) => filter.id === 'f2')!.criteria.workCategoryId).toBe('cat1');
  });

  it('coerces a missing/non-array workCategories to []', () => {
    const data = { ...emptyData(), workCategories: undefined as unknown as WorkCategory[] };
    const next = normalizeTaskMeta(data);
    expect(next.workCategories).toEqual([]);
  });

  it('is idempotent: running normalizeTaskMeta twice on its own output is deep-equal to running it once (each pass rebuilds task/filter objects, so this is value equality, not reference equality)', () => {
    const task = v5Task({
      id: 't1',
      priority: 'bogus',
      workCategoryId: 'ghost',
      checklist: [{ text: 'x' }],
    });
    const filter = {
      id: 'f1',
      name: 'x',
      page: 'tasks' as const,
      criteria: { paid: 'all', clientId: '', statusId: '', personId: '', from: '', to: '' },
    } as unknown as SavedFilter;
    const data = { ...emptyData(), tasks: [task], savedFilters: [filter] };
    const once = normalizeTaskMeta(data);
    const twice = normalizeTaskMeta(once);
    expect(twice).toEqual(once);
  });

  it('leaves an already-normalized (v6-shaped) task and saved filter value-equal after a pass', () => {
    const task = v5Task({
      id: 't1',
      priority: 'high',
      workCategoryId: 'cat1',
      checklist: [{ id: 'c1', text: 'Do it', done: true }],
    });
    const filter = {
      id: 'f1',
      name: 'x',
      page: 'tasks' as const,
      criteria: { ...DEFAULT_FILTER_CRITERIA, priority: 'high' },
    } as unknown as SavedFilter;
    const next = normalizeTaskMeta({
      ...emptyData(),
      workCategories: [{ id: 'cat1', name: 'Kreacja' }],
      tasks: [task],
      savedFilters: [filter],
    });
    expect(next.tasks[0]).toEqual(task);
    expect(next.savedFilters[0].criteria).toEqual(filter.criteria);
  });
});

// ---------------------------------------------------------------------------
// End-to-end v5 -> v6 migration through loadData() (task-metadata bundle).
// ---------------------------------------------------------------------------

describe('loadData migration v5 -> v6 (task metadata)', () => {
  it('a stored v5 payload with a task missing the new fields and a v5 saved filter loads as version 6 with all defaults applied and NO data loss (task title/dates/estimate, workload untouched)', () => {
    const payload = {
      version: 5,
      clients: [],
      departments: [],
      serviceTypes: [],
      statuses: [],
      projects: [],
      milestones: [],
      tasks: [
        {
          id: 't1',
          projectId: 'proj1',
          statusId: 'status1',
          title: 'Legacy task',
          description: 'desc',
          startDate: '2026-07-06',
          endDate: '2026-07-10',
          estimatedHours: 8,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          // no priority / workCategoryId / checklist — v5 shape
        },
      ],
      people: [
        {
          id: 'p1',
          firstName: 'Ann',
          lastName: 'Admin',
          name: 'Ann Admin',
          email: '',
          role: '',
          departmentId: '',
          avatar: '',
          capacity: 8,
          accessRole: 'administrator',
        },
      ],
      assignments: [],
      workload: [
        {
          id: 'w1',
          taskId: 't1',
          personId: 'p1',
          date: '2026-07-06',
          plannedHours: 4,
          startMinutes: 480,
          sortIndex: 0,
        },
      ],
      comments: [],
      activity: [],
      currentUserId: 'p1',
      sampleBannerDismissed: false,
      savedFilters: [
        {
          id: 'f1',
          name: 'My tasks',
          page: 'tasks',
          criteria: { paid: 'all', clientId: '', statusId: '', personId: 'p1', from: '', to: '' },
          // no priority / workCategoryId — v5 criteria shape
        },
      ],
    };

    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    expect(data.version).toBe(DATA_VERSION);
    expect(DATA_VERSION).toBe(7);

    const task = data.tasks.find((t) => t.id === 't1')!;
    expect(task.priority).toBe('normal');
    expect(task.workCategoryId).toBe('');
    expect(task.checklist).toEqual([]);
    // No data loss on the pre-existing fields.
    expect(task.title).toBe('Legacy task');
    expect(task.startDate).toBe('2026-07-06');
    expect(task.endDate).toBe('2026-07-10');
    expect(task.estimatedHours).toBe(8);

    // Workload untouched.
    expect(data.workload).toHaveLength(1);
    expect(data.workload[0]).toMatchObject({
      taskId: 't1',
      personId: 'p1',
      date: '2026-07-06',
      plannedHours: 4,
    });

    const filter = data.savedFilters.find((f) => f.id === 'f1')!;
    expect(filter.criteria.priority).toBe('');
    expect(filter.criteria.workCategoryId).toBe('');
    expect(filter.criteria.personId).toBe('p1'); // unchanged
    expect(filter.criteria.paid).toBe('all'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// normalizeDates (PKG-20260712-date-validation-core): the every-load repair
// pass that guarantees no invalid calendar-date string reaches render (where
// parseDate('') throws a blank-screen RangeError). Runs BEFORE
// ensureStartMinutes in loadData, so a workload entry it converts to a bin row
// is picked up by the existing bin one-row-per-(task,person) merge.
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    clientId: 'c1',
    name: 'Project',
    description: '',
    statusId: 's1',
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

function makeFullTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1',
    statusId: 's1',
    title: 'Task',
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

function makeMilestone(overrides: Partial<Milestone> & { id: string }): Milestone {
  return { projectId: 'proj1', name: 'Milestone', date: '2026-07-07', ...overrides };
}

function makeComment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    entityType: 'task',
    entityId: 't1',
    authorId: 'p1',
    body: 'Hello',
    mentionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeActivityEvent(overrides: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    entityType: 'task',
    entityId: 't1',
    actorId: 'p1',
    message: 'did something',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSavedFilter(overrides: Partial<SavedFilter> & { id: string }): SavedFilter {
  return {
    name: 'Filter',
    page: 'tasks',
    criteria: { ...DEFAULT_FILTER_CRITERIA },
    ...overrides,
  };
}

describe('normalizeDates', () => {
  it("the blank-screen repro loads repaired via loadData: a project with startDate '' and a valid endDate gets its start set to the end date", () => {
    const payload = {
      ...emptyData(),
      projects: [makeProject({ id: 'proj1', startDate: '', endDate: '2026-07-12' })],
    };
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    const project = data.projects.find((p) => p.id === 'proj1')!;
    expect(project.startDate).toBe('2026-07-12');
    expect(project.endDate).toBe('2026-07-12');
  });

  it('a task with both dates garbage gets both set to today; a valid-but-reversed pair gets swapped', () => {
    const garbageTask = makeFullTask({ id: 't1', startDate: 'garbage', endDate: 'also-garbage' });
    const reversedTask = makeFullTask({ id: 't2', startDate: '2026-07-10', endDate: '2026-07-05' });
    const data = { ...emptyData(), tasks: [garbageTask, reversedTask] };
    const next = normalizeDates(data);

    const repairedGarbage = next.tasks.find((t) => t.id === 't1')!;
    expect(repairedGarbage.startDate).toBe(todayStr());
    expect(repairedGarbage.endDate).toBe(todayStr());

    const repairedReversed = next.tasks.find((t) => t.id === 't2')!;
    expect(repairedReversed.startDate).toBe('2026-07-05');
    expect(repairedReversed.endDate).toBe('2026-07-10');
  });

  it("a milestone with a garbage date is repaired to its project's POST-repair startDate", () => {
    // Project's own startDate is invalid too, so it first repairs to its endDate
    // ('2026-07-15') — the milestone must pick up that repaired value, not the
    // original invalid ''.
    const project = makeProject({ id: 'proj1', startDate: '', endDate: '2026-07-15' });
    const milestone = makeMilestone({ id: 'm1', projectId: 'proj1', date: 'garbage' });
    const data = { ...emptyData(), projects: [project], milestones: [milestone] };
    const next = normalizeDates(data);

    const repairedProject = next.projects.find((p) => p.id === 'proj1')!;
    expect(repairedProject.startDate).toBe('2026-07-15');

    const repairedMilestone = next.milestones.find((m) => m.id === 'm1')!;
    expect(repairedMilestone.date).toBe('2026-07-15');
  });

  it('a milestone with a garbage date falls back to today when its project no longer exists', () => {
    const milestone = makeMilestone({ id: 'm1', projectId: 'ghost-project', date: 'garbage' });
    const data = { ...emptyData(), milestones: [milestone] };
    const next = normalizeDates(data);
    expect(next.milestones[0].date).toBe(todayStr());
  });

  it('a workload entry with an invalid date lands in the bin after loadData and its hours merge into a single (task, person) bin row; a pre-existing bin entry for a DIFFERENT (task, person) pair is untouched', () => {
    const invalidDateEntry = makeEntry({
      id: 'e1',
      taskId: 't1',
      personId: 'p1',
      date: 'not-a-date',
      plannedHours: 2,
      startMinutes: 480,
      sortIndex: 0,
    });
    const existingSameBin = makeEntry({
      id: 'binSame',
      taskId: 't1',
      personId: 'p1',
      date: BIN_DATE,
      startMinutes: 0,
      plannedHours: 3,
      sortIndex: 0,
    });
    const untouchedOtherBin = makeEntry({
      id: 'binOther',
      taskId: 't2',
      personId: 'p2',
      date: BIN_DATE,
      startMinutes: 0,
      plannedHours: 1,
      sortIndex: 1,
    });
    const payload = {
      ...emptyData(),
      workload: [invalidDateEntry, existingSameBin, untouchedOtherBin],
    };
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    const mergedBin = data.workload.filter((w) => w.taskId === 't1' && w.personId === 'p1');
    expect(mergedBin).toHaveLength(1); // one-bin-row invariant merged the repaired entry in
    expect(mergedBin[0].date).toBe(BIN_DATE);
    expect(mergedBin[0].startMinutes).toBe(0);
    expect(mergedBin[0].plannedHours).toBe(5); // 3h existing + 2h repaired-to-bin

    const otherBin = data.workload.find((w) => w.id === 'binOther')!;
    expect(otherBin.date).toBe(BIN_DATE);
    expect(otherBin.startMinutes).toBe(0);
    expect(otherBin.plannedHours).toBe(1); // untouched — different (task, person) pair
  });

  it("a saved filter's invalid criteria.from becomes ''; a valid from/to is kept unchanged", () => {
    const badFrom = makeSavedFilter({
      id: 'f1',
      criteria: { ...DEFAULT_FILTER_CRITERIA, from: 'garbage', to: '2026-07-20' },
    });
    const goodFrom = makeSavedFilter({
      id: 'f2',
      criteria: { ...DEFAULT_FILTER_CRITERIA, from: '2026-07-01', to: '' },
    });
    const data = { ...emptyData(), savedFilters: [badFrom, goodFrom] };
    const next = normalizeDates(data);

    const repaired = next.savedFilters.find((f) => f.id === 'f1')!;
    expect(repaired.criteria.from).toBe('');
    expect(repaired.criteria.to).toBe('2026-07-20'); // valid, untouched

    const kept = next.savedFilters.find((f) => f.id === 'f2')!;
    expect(kept.criteria.from).toBe('2026-07-01');
    expect(kept.criteria.to).toBe('');
  });

  it('a comment/activity event with a garbage createdAt is repaired to the epoch sentinel', () => {
    const comment = makeComment({ id: 'cm1', createdAt: 'garbage' });
    const event = makeActivityEvent({ id: 'ev1', createdAt: 'garbage' });
    const data = { ...emptyData(), comments: [comment], activity: [event] };
    const next = normalizeDates(data);
    expect(next.comments[0].createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(next.activity[0].createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('normalizeDates(normalizeDates(x)) deep-equals normalizeDates(x) (idempotent)', () => {
    const messyData: AppData = {
      ...emptyData(),
      projects: [makeProject({ id: 'proj1', startDate: '', endDate: '2026-07-12' })],
      tasks: [makeFullTask({ id: 't1', startDate: 'garbage', endDate: 'garbage' })],
      milestones: [makeMilestone({ id: 'm1', projectId: 'proj1', date: 'garbage' })],
      workload: [makeEntry({ id: 'e1', date: 'not-a-date' })],
      savedFilters: [makeSavedFilter({ id: 'f1', criteria: { ...DEFAULT_FILTER_CRITERIA, from: 'garbage' } })],
      comments: [makeComment({ id: 'cm1', createdAt: 'garbage' })],
      activity: [makeActivityEvent({ id: 'ev1', createdAt: 'garbage' })],
    };
    const once = normalizeDates(messyData);
    const twice = normalizeDates(once);
    expect(twice).toEqual(once);
  });

  it('a fully-valid payload passes through normalizeDates unchanged (same reference — the pass short-circuits)', () => {
    const validData: AppData = {
      ...emptyData(),
      projects: [makeProject({ id: 'proj1' })],
      tasks: [makeFullTask({ id: 't1' })],
      milestones: [makeMilestone({ id: 'm1' })],
      workload: [makeEntry({ id: 'e1', date: '2026-07-08' })],
      savedFilters: [makeSavedFilter({ id: 'f1' })],
      comments: [makeComment({ id: 'cm1' })],
      activity: [makeActivityEvent({ id: 'ev1' })],
    };
    const next = normalizeDates(validData);
    expect(next).toEqual(validData);
    expect(next).toBe(validData); // no repair needed -> same reference
  });
});

// ---------------------------------------------------------------------------
// SAVE_TASK identity-preserving workload round-trip (PKG-20260712b-savetask-tests):
// a multi-block day is a normal, valid payload shape now — loadData()'s
// per-load repair passes (ensureStartMinutes, normalizeDates) must leave it
// untouched.
// ---------------------------------------------------------------------------

describe('loadData round-trip — multi-block day (PKG-20260712b-savetask-tests)', () => {
  it('a valid two-block day (same task+person, distinct startMinutes) survives loadData() exactly: ids, hours, startMinutes and sortIndex all unchanged', () => {
    const e1 = makeEntry({ id: 'e1', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 2, startMinutes: 480, sortIndex: 0 });
    const e2 = makeEntry({ id: 'e2', taskId: 't1', personId: 'p1', date: '2026-07-08', plannedHours: 3, startMinutes: 840, sortIndex: 1 });
    const payload = {
      ...emptyData(),
      tasks: [makeFullTask({ id: 't1' })],
      workload: [e1, e2],
    };

    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    const loaded = data.workload.slice().sort((a, b) => a.id.localeCompare(b.id));
    expect(loaded).toEqual([e1, e2]);
  });
});

// ---------------------------------------------------------------------------
// normalizeStatusFlags / v6->v7 done semantics (PKG-20260712c-status-tests).
// Implementation shipped by PKG-20260712c-status-done-core: every status gains
// a stored `isDone` boolean; when none is set, the LAST ACTIVE status by
// `order` defaults to done (the value the removed `doneStatusId` selector used
// to compute). When every status is archived, the deterministic done status is
// also restored so Kanban has a usable column. Runs on EVERY load, same
// idempotent-by-value philosophy as
// ensureStartMinutes / normalizeTaskMeta.
// ---------------------------------------------------------------------------

function makeRawStatus(overrides: Partial<Status> & { id: string; order: number }): Record<string, unknown> {
  return {
    name: `Status ${overrides.order}`,
    slug: `status-${overrides.order}`,
    color: '#123456',
    archived: false,
    // isDone deliberately omitted by default -> exercises the v6 (pre-flag) shape.
    ...overrides,
  };
}

function v6Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 6,
    clients: [],
    departments: [],
    serviceTypes: [],
    workCategories: [],
    statuses: [],
    projects: [],
    milestones: [],
    tasks: [],
    people: [],
    assignments: [],
    workload: [],
    comments: [],
    activity: [],
    currentUserId: '',
    impersonatorId: '',
    sampleBannerDismissed: false,
    savedFilters: [],
    ...overrides,
  };
}

function makeStatus(overrides: Partial<Status> & { id: string }): Status {
  return {
    name: 'Status',
    slug: 'status',
    color: '#000000',
    order: 0,
    archived: false,
    isDone: false,
    ...overrides,
  };
}

describe('normalizeStatusFlags / v6→v7 done semantics', () => {
  it('v6 payload, 4 statuses none archived, no isDone fields -> loadData marks exactly the LAST status by order isDone, all others false, and bumps the version to 7', () => {
    const statuses = [
      makeRawStatus({ id: 's0', order: 0 }),
      makeRawStatus({ id: 's1', order: 1 }),
      makeRawStatus({ id: 's2', order: 2 }),
      makeRawStatus({ id: 's3', order: 3 }),
    ];
    const payload = v6Payload({ statuses });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    expect(data.version).toBe(7);
    expect(DATA_VERSION).toBe(7);
    const byId = new Map(data.statuses.map((s) => [s.id, s]));
    expect(byId.get('s0')!.isDone).toBe(false);
    expect(byId.get('s1')!.isDone).toBe(false);
    expect(byId.get('s2')!.isDone).toBe(false);
    expect(byId.get('s3')!.isDone).toBe(true);
  });

  it('when the last-by-order status is ARCHIVED, the last ACTIVE status becomes done instead (preserves the old doneStatusId value)', () => {
    const statuses = [
      makeRawStatus({ id: 's0', order: 0 }),
      makeRawStatus({ id: 's1', order: 1 }), // last ACTIVE
      makeRawStatus({ id: 's2', order: 2, archived: true }), // last by order, but archived
    ];
    const payload = v6Payload({ statuses });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    const byId = new Map(data.statuses.map((s) => [s.id, s]));
    expect(byId.get('s1')!.isDone).toBe(true);
    expect(byId.get('s0')!.isDone).toBe(false);
    expect(byId.get('s2')!.isDone).toBe(false);
  });

  it('when ALL statuses are archived, the last status by order becomes done (deliberate repair of a pathological all-archived pipeline)', () => {
    const statuses = [
      makeRawStatus({ id: 's0', order: 0, archived: true }),
      makeRawStatus({ id: 's1', order: 1, archived: true }),
      makeRawStatus({ id: 's2', order: 2, archived: true }),
    ];
    const payload = v6Payload({ statuses });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    const byId = new Map(data.statuses.map((s) => [s.id, s]));
    expect(byId.get('s2')!.isDone).toBe(true);
    expect(byId.get('s2')!.archived).toBe(false);
    expect(byId.get('s0')!.isDone).toBe(false);
    expect(byId.get('s1')!.isDone).toBe(false);
  });

  it('v6 to v7 does not translate a user-created English status name that matches an old seed label', () => {
    const payload = v6Payload({
      statuses: [makeRawStatus({ id: 'custom', order: 0, name: 'Done' })],
    });

    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    expect(data.statuses[0].name).toBe('Done');
    expect(data.statuses[0].slug).toBe('status-0');
    expect(data.statuses[0].isDone).toBe(true);
  });

  it('a payload with zero statuses loads without crashing and marks nothing done', () => {
    const payload = v6Payload({ statuses: [] });
    const data = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());

    expect(data.version).toBe(7);
    expect(data.statuses).toEqual([]);
  });

  it('a status that ALREADY has isDone: true on a NON-last status is preserved untouched (no re-defaulting)', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false });
    const s2 = makeStatus({ id: 's2', order: 2, isDone: false }); // last by order, stays false
    const data = { ...emptyData(), statuses: [s0, s1, s2] };

    const next = normalizeStatusFlags(data);
    const byId = new Map(next.statuses.map((s) => [s.id, s]));
    expect(byId.get('s0')!.isDone).toBe(true);
    expect(byId.get('s1')!.isDone).toBe(false);
    expect(byId.get('s2')!.isDone).toBe(false); // no re-defaulting even though it's last
  });

  it('a pre-set isDone: true on a non-last status is preserved even when that status is ARCHIVED', () => {
    const s0 = makeStatus({ id: 's0', order: 0, isDone: true, archived: true });
    const s1 = makeStatus({ id: 's1', order: 1, isDone: false }); // last by order
    const data = { ...emptyData(), statuses: [s0, s1] };

    const next = normalizeStatusFlags(data);
    const byId = new Map(next.statuses.map((s) => [s.id, s]));
    expect(byId.get('s0')!.isDone).toBe(true);
    expect(byId.get('s0')!.archived).toBe(true);
    expect(byId.get('s1')!.isDone).toBe(false);
  });

  it('normalizeStatusFlags(normalizeStatusFlags(x)) deep-equals normalizeStatusFlags(x) (idempotent), and a full save->load->load round-trip changes nothing', () => {
    const statuses = [
      makeStatus({ id: 's0', order: 0 }),
      makeStatus({ id: 's1', order: 1 }),
      makeStatus({ id: 's2', order: 2 }),
    ];
    const data = { ...emptyData(), statuses };

    const once = normalizeStatusFlags(data);
    const twice = normalizeStatusFlags(once);
    expect(twice).toEqual(once);

    // Full save -> load -> load round-trip through loadData().
    const payload = v6Payload({ statuses });
    const loadedOnce = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () => loadData());
    const loadedTwice = withLocalStorage(
      { [STORAGE_KEY]: JSON.stringify(loadedOnce) },
      () => loadData(),
    );
    expect(loadedTwice).toEqual(loadedOnce);
  });

  it("non-boolean isDone garbage ('yes', 1, null) coerces to false, and the no-done default then applies since none remain true", () => {
    const s0 = makeRawStatus({ id: 's0', order: 0, isDone: 'yes' as unknown as boolean });
    const s1 = makeRawStatus({ id: 's1', order: 1, isDone: 1 as unknown as boolean });
    const s2 = makeRawStatus({ id: 's2', order: 2, isDone: null as unknown as boolean }); // last by order
    const data = { ...emptyData(), statuses: [s0, s1, s2] } as unknown as AppData;

    const next = normalizeStatusFlags(data);
    const byId = new Map(next.statuses.map((s) => [s.id, s]));
    // Garbage values coerce to false first...
    expect(byId.get('s0')!.isDone).toBe(false);
    expect(byId.get('s1')!.isDone).toBe(false);
    // ...then, since none remained true, the last-by-order default kicks in.
    expect(byId.get('s2')!.isDone).toBe(true);
  });
});
