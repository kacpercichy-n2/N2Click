// Focused tests for the pure migration-status logic (migrationStatus.ts):
// buildCoverageReport per-family syncability, and runRetirementHandshake step
// sequencing (coverage gate -> snapshot read -> probe write/read/remove ->
// arm the flag). No SDK, no live Supabase — an injected fake PlannerDb.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import type { AppData, Person } from '../types';
import type { CloudProfile, OrgSnapshot } from './referenceData';
import type { CloudWriteError, PlannerDb } from './plannerData';
import { RETIREMENT_SETTING_KEY } from './plannerData';
import { buildCloudIdMaps, type CloudIdMaps } from './cloudMirror';
import { buildCoverageReport, runRetirementHandshake, PROBE_WORK_DATE } from './migrationStatus';

const uuid = (seed: string): string => {
  const hex = Array.from(seed)
    .reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const PA = uuid('person-a');
const CLOUD_PA = uuid('cloud-a');
const PR = uuid('project-one');
const TK = uuid('task-one');

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'administrator', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', ...o,
  };
}
const cloudProfile = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
  firstName: '', lastName: '', email: '', roleTitle: '', cloudRole: 'administrator', departmentId: null, ...o,
});

function localFixture(): AppData {
  return {
    ...emptyData(),
    statuses: [],
    people: [makePerson({ id: PA, email: 'a@x.com' })],
    projects: [
      {
        id: PR, clientId: '', name: 'P', description: '', statusId: '', paid: false,
        startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
        createdAt: '', updatedAt: '',
      },
    ],
    tasks: [
      {
        id: TK, projectId: PR, statusId: '', title: 'T', description: '', startDate: '2026-07-06',
        endDate: '2026-07-08', estimatedHours: null, priority: 'normal', workCategoryId: '',
        checklist: [], createdAt: '', updatedAt: '',
      },
    ],
  };
}
function orgFixture(): OrgSnapshot {
  return {
    profile: cloudProfile({ id: CLOUD_PA, email: 'a@x.com' }),
    profiles: [cloudProfile({ id: CLOUD_PA, email: 'a@x.com' })],
    departments: [], statuses: [], serviceTypes: [], workCategories: [],
  };
}
const maps = (): CloudIdMaps => buildCloudIdMaps(localFixture(), orgFixture());

type Row = Record<string, unknown>;
type Call =
  | { op: 'upsert'; table: string; row: Row; onConflict?: string }
  | { op: 'remove'; table: string; match: Record<string, string> };
class FakePlannerDb implements PlannerDb {
  data = new Map<string, Row[]>();
  calls: Call[] = [];
  failUpsert: (table: string, row: Row) => CloudWriteError | null = () => null;
  failRemove: (table: string, match: Record<string, string>) => CloudWriteError | null = () => null;
  failSelect = new Set<string>();
  async select(table: string, _cols: string, inFilter?: { column: string; values: string[] }) {
    if (this.failSelect.has(table)) return { rows: [] as Row[], error: 'boom' };
    let rows = this.data.get(table) ?? [];
    if (inFilter) rows = rows.filter((r) => inFilter.values.includes(String(r[inFilter.column])));
    return { rows: rows.map((r) => ({ ...r })), error: null };
  }
  async upsert(table: string, row: Row, onConflict?: string) {
    this.calls.push({ op: 'upsert', table, row, onConflict });
    const err = this.failUpsert(table, row);
    if (err) return { error: err };
    const key = onConflict ?? 'id';
    const list = this.data.get(table) ?? [];
    const idx = list.findIndex((r) => r[key] === row[key]);
    if (idx >= 0) list[idx] = { ...row };
    else list.push({ ...row });
    this.data.set(table, list);
    return { error: null };
  }
  async remove(table: string, match: Record<string, string>) {
    this.calls.push({ op: 'remove', table, match });
    const err = this.failRemove(table, match);
    if (err) return { error: err };
    const list = this.data.get(table) ?? [];
    this.data.set(
      table,
      list.filter((r) => !Object.entries(match).every(([k, v]) => String(r[k]) === v)),
    );
    return { error: null };
  }
}

const probe = () => ({ rowId: uuid('probe-row'), taskId: TK, profileId: CLOUD_PA });

describe('buildCoverageReport', () => {
  it('reports a clean coverage for all-syncable data', () => {
    const report = buildCoverageReport(localFixture(), maps());
    expect(report.clean).toBe(true);
    expect(report.families.every((f) => f.unsyncable === 0)).toBe(true);
  });

  it('flags a non-UUID client and an unmappable person', () => {
    const state: AppData = {
      ...localFixture(),
      clients: [{ id: 'legacy-1', name: 'X', archived: false }],
      assignments: [{ id: 'asg', taskId: TK, personId: uuid('ghost-person') }],
    };
    const report = buildCoverageReport(state, maps());
    expect(report.clean).toBe(false);
    const clients = report.families.find((f) => f.key === 'clients')!;
    expect(clients.unsyncable).toBe(1);
    const assignments = report.families.find((f) => f.key === 'assignments')!;
    expect(assignments.unsyncable).toBe(1);
    expect(assignments.reasons.length).toBeGreaterThan(0);
  });
});

describe('runRetirementHandshake', () => {
  it('runs all four steps and arms the flag on success', async () => {
    const db = new FakePlannerDb();
    const result = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.ok)).toEqual([true, true, true, true]);
    // Flag armed in app_settings; probe row removed from workload_entries.
    expect(db.data.get('app_settings')!.find((r) => r.key === RETIREMENT_SETTING_KEY)).toBeDefined();
    expect((db.data.get('workload_entries') ?? []).length).toBe(0);
  });

  it('fails at coverage when a row is unsyncable and arms nothing', async () => {
    const db = new FakePlannerDb();
    const state: AppData = {
      ...localFixture(),
      clients: [{ id: 'legacy', name: 'X', archived: false }],
    };
    const result = await runRetirementHandshake(db, state, maps(), probe());
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(db.data.get('app_settings')).toBeUndefined();
  });

  it('fails when the cloud snapshot read errors', async () => {
    const db = new FakePlannerDb();
    db.failSelect.add('tasks');
    const result = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(result.ok).toBe(false);
    expect(result.steps[result.steps.length - 1].label).toBe('Odczyt z chmury');
  });

  it('fails when the probe write is rejected (and arms nothing)', async () => {
    const db = new FakePlannerDb();
    db.failUpsert = (t) => (t === 'workload_entries' ? { kind: 'permission', message: 'denied' } : null);
    const result = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(result.ok).toBe(false);
    expect(result.steps[result.steps.length - 1].label).toBe('Zapis próbny do chmury');
    expect(db.data.get('app_settings')).toBeUndefined();
  });

  it('probes with a dated row (PROBE_WORK_DATE, onConflict id), cleanup remove first', async () => {
    const db = new FakePlannerDb();
    const result = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(result.ok).toBe(true);
    const wlUpsert = db.calls.find((c) => c.op === 'upsert' && c.table === 'workload_entries');
    expect(wlUpsert).toBeDefined();
    if (wlUpsert && wlUpsert.op === 'upsert') {
      expect(wlUpsert.row.work_date).toBe(PROBE_WORK_DATE);
      expect(wlUpsert.row.work_date).not.toBeNull();
      expect(wlUpsert.onConflict).toBe('id');
    }
    // The pre-probe cleanup remove (task_id/profile_id/work_date) precedes the upsert.
    const upsertIdx = db.calls.findIndex((c) => c.op === 'upsert' && c.table === 'workload_entries');
    const cleanupIdx = db.calls.findIndex(
      (c) =>
        c.op === 'remove' &&
        c.table === 'workload_entries' &&
        c.match.work_date === PROBE_WORK_DATE &&
        c.match.task_id === TK &&
        c.match.profile_id === CLOUD_PA,
    );
    expect(cleanupIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeLessThan(upsertIdx);
  });

  it('does not trip a partial unique index that fires on NULL-work_date bin pairs', async () => {
    const db = new FakePlannerDb();
    // Emulates workload_entries_bin_pair: 23505 only when work_date IS NULL.
    db.failUpsert = (t, row) =>
      t === 'workload_entries' && row.work_date === null
        ? { kind: 'permission', message: '23505 duplicate key' }
        : null;
    const result = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.ok)).toEqual([true, true, true, true]);
  });

  it('failed final remove fails the step; a later run cleans up the orphan', async () => {
    const db = new FakePlannerDb();
    // Fail only the id-only remove (the post-select cleanup), not the pre-probe
    // multi-column cleanup — leaves the probe row orphaned.
    db.failRemove = (t, match) =>
      t === 'workload_entries' && 'id' in match && Object.keys(match).length === 1
        ? { kind: 'transient', message: 'boom' }
        : null;
    const run1 = await runRetirementHandshake(db, localFixture(), maps(), probe());
    expect(run1.ok).toBe(false);
    expect(run1.steps[run1.steps.length - 1].label).toBe('Zapis próbny do chmury');
    // Orphan probe row remains, carrying PROBE_WORK_DATE.
    const orphans = db.data.get('workload_entries') ?? [];
    expect(orphans).toHaveLength(1);
    expect(orphans[0].work_date).toBe(PROBE_WORK_DATE);

    // A subsequent successful run's pre-probe cleanup removes the orphan (a
    // different rowId, so only the multi-column cleanup can clear the old one).
    db.failRemove = () => null;
    const probe2 = { rowId: uuid('probe-row-2'), taskId: TK, profileId: CLOUD_PA };
    const run2 = await runRetirementHandshake(db, localFixture(), maps(), probe2);
    expect(run2.ok).toBe(true);
    expect(db.data.get('workload_entries') ?? []).toHaveLength(0);
  });
});
