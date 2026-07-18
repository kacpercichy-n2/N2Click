// Focused tests for the pure mirror suppression gate (mirrorGate.ts). Node, no
// React / no jsdom (matches the src/supabase test style). Pins the ORIGIN-based
// decision: suppression is decided solely by `origin` metadata riding on the
// action, never by an action-name denylist — so a hypothetical future bulk
// action tagged 'cloud' is suppressed without being registered anywhere.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import type { AppData } from '../types';
import type { OrgSnapshot } from './referenceData';
import { buildCloudIdMaps, diffToCloudOps } from './cloudMirror';
import { shouldMirrorTransition } from './mirrorGate';

// Cloud ids must be UUID-shaped or the mirror drops the row as unmappable —
// use the same deterministic uuid() helper as cloudMirror.test.ts.
const uuid = (seed: string): string => {
  const hex = Array.from(seed)
    .reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '')
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const CLI = uuid('client-one');
const PR = uuid('project-one');
const TK = uuid('task-one');

// A prev -> next pair that diffs into MANY cloud ops (client + project + task),
// so "gate false => zero queued" is a real proof, not a vacuous empty diff.
const orgSnapshot = (): OrgSnapshot => ({
  profile: null,
  profiles: [],
  departments: [],
  statuses: [],
  serviceTypes: [],
  workCategories: [],
});
const prevState = (): AppData => emptyData();
const nextState = (): AppData => ({
  ...emptyData(),
  clients: [{ id: CLI, name: 'Klient', archived: false }],
  projects: [{
    clientId: CLI, id: PR, name: 'Projekt', description: '', statusId: '', paid: false,
    startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
  tasks: [{
    projectId: PR, id: TK, statusId: '', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', checklist: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
});
const maps = () => buildCloudIdMaps(prevState(), orgSnapshot());

// Simulate the provider's mirror step: gate first, diff only if allowed.
function mirrorStep(last: { type: string; origin: 'cloud' | 'local' } | null) {
  if (!shouldMirrorTransition(last)) return [];
  return diffToCloudOps(prevState(), nextState(), maps()).ops;
}

describe('shouldMirrorTransition', () => {
  it('mirrors a plain local user mutation', () => {
    expect(shouldMirrorTransition({ type: 'SAVE_TASK', origin: 'local' })).toBe(true);
  });

  it('mirrors when there is no last action (null keeps today behavior)', () => {
    expect(shouldMirrorTransition(null)).toBe(true);
  });

  it('suppresses any transition tagged origin:cloud', () => {
    expect(shouldMirrorTransition({ type: 'SAVE_TASK', origin: 'cloud' })).toBe(false);
  });

  it('suppresses each migrated transition tagged cloud, by origin alone', () => {
    for (const type of ['MERGE_CLOUD_ENTITIES', 'REPLACE_FROM_STORAGE', 'LOAD_SAMPLE', 'RESET_ALL']) {
      expect(shouldMirrorTransition({ type, origin: 'cloud' })).toBe(false);
    }
  });
});

describe('denylist independence — the required proof', () => {
  it('an UNLISTED bulk action tagged cloud queues ZERO ops despite a many-entity diff', () => {
    // No name registration anywhere for this type.
    const bulk = { type: 'BULK_HYDRATE_V2', origin: 'cloud' as const };
    expect(shouldMirrorTransition(bulk)).toBe(false);
    expect(mirrorStep(bulk)).toHaveLength(0);
    // Sanity: the underlying diff WOULD emit multiple ops if not gated.
    expect(diffToCloudOps(prevState(), nextState(), maps()).ops.length).toBeGreaterThan(1);
  });

  it('the same diff is mirrored on the default local path (and for null)', () => {
    const local = mirrorStep({ type: 'BULK_HYDRATE_V2', origin: 'local' });
    expect(local.map((o) => o.table)).toEqual(['clients', 'projects', 'tasks']);
    expect(mirrorStep(null).length).toBe(local.length);
  });
});
