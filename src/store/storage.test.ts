// Unit tests for the v3->v4 startMinutes normalize pass (src/store/storage.ts).
// This is the architect's declared riskiest area of the migration — every
// load path (legacy v1, v<4, and same-version loads with stray bad data)
// funnels through ensureStartMinutes, so it's worth covering in isolation
// from localStorage/loadData.
import { describe, expect, it } from 'vitest';
import { DATA_VERSION, ensureStartMinutes, emptyData, loadData } from './storage';
import { BIN_DATE } from '../utils/time';
import type { AppData, WorkloadEntry } from '../types';

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
    expect(DATA_VERSION).toBe(5);

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
    expect(twice.version).toBe(5);
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
