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
  normalizeTaskMeta,
} from './storage';
import { BIN_DATE } from '../utils/time';
import type { AppData, SavedFilter, Task, WorkCategory, WorkloadEntry } from '../types';

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
    expect(DATA_VERSION).toBe(6);

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
    expect(twice.version).toBe(6);
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
    expect(DATA_VERSION).toBe(6);

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
