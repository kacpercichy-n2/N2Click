// Focused tests for the durable cloud op queue lifecycle (opQueue.ts). Pure —
// no React, no localStorage: only encode/decode round-trips, restore/deactivate
// plans and the hydration-step decision. The provider is a thin adapter over
// these functions, so this is where the durable-queue invariants are pinned.
import { describe, expect, it } from 'vitest';
import type { CloudOp } from './cloudMirror';
import {
  CLOUD_QUEUE_VERSION,
  HYDRATION_RESTART_ERROR,
  MAX_HYDRATION_RESTARTS,
  QUEUE_FOREIGN_DROPPED,
  QUEUE_HELD_NOTICE,
  QUEUE_RESTORED_NOTICE,
  decodeQueue,
  encodeQueue,
  planDeactivation,
  planHydrationStep,
  planQueueRestore,
} from './opQueue';

const UPSERT: CloudOp = {
  kind: 'upsert',
  table: 'clients',
  row: { id: 'c1', name: 'Klient „ACME”', archived: false },
  sourceId: 'c1',
  label: 'Klient „ACME”',
};

const REMOVE: CloudOp = {
  kind: 'remove',
  table: 'workload_entries',
  match: { id: 'w1' },
  sourceId: 'w1',
  label: 'Blok godzin (usunięcie)',
};

const ASSIGNMENT_UPSERT: CloudOp = {
  kind: 'upsert',
  table: 'task_assignments',
  row: { task_id: 't1', profile_id: 'p1' },
  onConflict: 'task_id,profile_id',
  sourceId: 't1:p1',
  label: 'Przypisanie',
};

describe('encodeQueue / decodeQueue round-trip', () => {
  it('round-trips realistic upsert/remove/assignment ops for the same user', () => {
    const ops = [UPSERT, REMOVE, ASSIGNMENT_UPSERT];
    const decoded = decodeQueue(encodeQueue('user-1', ops));
    expect(decoded).toEqual({ version: CLOUD_QUEUE_VERSION, userId: 'user-1', ops });
  });

  it('round-trips an empty op list', () => {
    const decoded = decodeQueue(encodeQueue('user-1', []));
    expect(decoded).toEqual({ version: CLOUD_QUEUE_VERSION, userId: 'user-1', ops: [] });
  });
});

describe('decodeQueue fail-closed', () => {
  it('returns null for a null raw', () => {
    expect(decodeQueue(null)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(decodeQueue('{not json')).toBeNull();
  });

  it('returns null for the wrong version', () => {
    expect(decodeQueue(JSON.stringify({ version: 2, userId: 'u', ops: [] }))).toBeNull();
  });

  it('returns null for a missing/empty userId', () => {
    expect(decodeQueue(JSON.stringify({ version: 1, userId: '', ops: [] }))).toBeNull();
    expect(decodeQueue(JSON.stringify({ version: 1, ops: [] }))).toBeNull();
  });

  it('returns null when ops is not an array', () => {
    expect(decodeQueue(JSON.stringify({ version: 1, userId: 'u', ops: {} }))).toBeNull();
  });

  it('returns null when any op has a bad kind', () => {
    const raw = JSON.stringify({
      version: 1,
      userId: 'u',
      ops: [UPSERT, { ...REMOVE, kind: 'patch' }],
    });
    expect(decodeQueue(raw)).toBeNull();
  });

  it('returns null when an upsert is missing its row', () => {
    const bad = { kind: 'upsert', table: 'clients', sourceId: 'c1', label: 'x' };
    expect(decodeQueue(JSON.stringify({ version: 1, userId: 'u', ops: [bad] }))).toBeNull();
  });

  it('returns null when a remove is missing its match', () => {
    const bad = { kind: 'remove', table: 'clients', sourceId: 'c1', label: 'x' };
    expect(decodeQueue(JSON.stringify({ version: 1, userId: 'u', ops: [bad] }))).toBeNull();
  });

  it('returns null when an op is missing table/sourceId/label', () => {
    const noTable = { kind: 'upsert', row: {}, sourceId: 'c1', label: 'x' };
    const noSource = { kind: 'upsert', table: 't', row: {}, label: 'x' };
    const noLabel = { kind: 'upsert', table: 't', row: {}, sourceId: 'c1' };
    for (const bad of [noTable, noSource, noLabel]) {
      expect(decodeQueue(JSON.stringify({ version: 1, userId: 'u', ops: [bad] }))).toBeNull();
    }
  });
});

describe('planQueueRestore', () => {
  it('restores same-user ops', () => {
    const env = { version: CLOUD_QUEUE_VERSION as 1, userId: 'u', ops: [UPSERT] };
    expect(planQueueRestore(env, 'u')).toEqual({ kind: 'restore', ops: [UPSERT] });
  });

  it('discards a foreign-user envelope', () => {
    const env = { version: CLOUD_QUEUE_VERSION as 1, userId: 'other', ops: [UPSERT] };
    expect(planQueueRestore(env, 'u')).toEqual({ kind: 'discard-foreign-user' });
  });

  it('is a no-op for a null envelope or an empty same-user op list', () => {
    expect(planQueueRestore(null, 'u')).toEqual({ kind: 'none' });
    const empty = { version: CLOUD_QUEUE_VERSION as 1, userId: 'u', ops: [] };
    expect(planQueueRestore(empty, 'u')).toEqual({ kind: 'none' });
  });
});

describe('planDeactivation', () => {
  it('always keeps the durable copy and warns when ops are pending', () => {
    expect(planDeactivation(3)).toEqual({ keepDurable: true, notice: QUEUE_HELD_NOTICE });
  });

  it('always keeps the durable copy and stays quiet when nothing is pending', () => {
    expect(planDeactivation(0)).toEqual({ keepDurable: true, notice: null });
  });
});

describe('planHydrationStep', () => {
  const base = { pendingOps: 0, stateChanged: false, restarts: 0, maxRestarts: MAX_HYDRATION_RESTARTS };

  it('drains whenever ops are pending (even if state also changed)', () => {
    expect(planHydrationStep({ ...base, pendingOps: 1 })).toBe('drain');
    expect(planHydrationStep({ ...base, pendingOps: 2, stateChanged: true })).toBe('drain');
  });

  it('restarts when state changed and the restart budget remains', () => {
    expect(planHydrationStep({ ...base, stateChanged: true, restarts: 1 })).toBe('restart');
  });

  it('gives up when state changed but the restart budget is exhausted', () => {
    expect(
      planHydrationStep({ ...base, stateChanged: true, restarts: MAX_HYDRATION_RESTARTS }),
    ).toBe('give-up');
  });

  it('merges only when both pendingOps and stateChanged are clear', () => {
    expect(planHydrationStep(base)).toBe('merge');
    // A clean state with an exhausted restart count still merges (nothing to redo).
    expect(planHydrationStep({ ...base, restarts: MAX_HYDRATION_RESTARTS })).toBe('merge');
  });
});

describe('exported Polish strings are the exact constants', () => {
  it('matches the package-specified copy', () => {
    expect(QUEUE_RESTORED_NOTICE).toBe(
      'Przywrócono niewysłane zmiany z poprzedniej sesji — wysyłamy je teraz.',
    );
    expect(QUEUE_HELD_NOTICE).toBe(
      'Masz niewysłane zmiany — zachowano je w tej przeglądarce i zostaną wysłane po ponownym zalogowaniu.',
    );
    expect(QUEUE_FOREIGN_DROPPED).toBe(
      'Odrzucono niewysłane zmiany innego użytkownika zapisane w tej przeglądarce.',
    );
    expect(HYDRATION_RESTART_ERROR).toBe(
      'Nie udało się zsynchronizować zmian podczas wczytywania danych. Spróbuj ponownie.',
    );
  });
});
