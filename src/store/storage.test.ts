// Unit tests for the v3->v4 startMinutes normalize pass (src/store/storage.ts).
// This is the architect's declared riskiest area of the migration — every
// load path (legacy v1, v<4, and same-version loads with stray bad data)
// funnels through ensureStartMinutes, so it's worth covering in isolation
// from localStorage/loadData.
import { describe, expect, it } from 'vitest';
import { ensureStartMinutes, emptyData } from './storage';
import type { AppData, WorkloadEntry } from '../types';

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
