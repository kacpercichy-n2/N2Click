// Focused tests for the org-snapshot reload state machine (orgReload.ts). Pure —
// no React, no Supabase. Pins the non-destructive BACKGROUND reload used by the
// realtime dictionary-event path: a background reload keeps the previous 'ready'
// snapshot (no 'loading' flicker that would flip `active` false, clear the queue
// and tear down the channel) and swaps atomically to the new snapshot, while a
// foreground reload (login / manual retry) still flashes 'loading'.
import { describe, expect, it } from 'vitest';
import { planReloadError, planReloadStart, planReloadSuccess } from './orgReload';
import type { OrgSnapshot, OrgState } from './referenceData';

// Distinct snapshots differ only by object reference (content is irrelevant to
// the state machine, which preserves/swaps by reference).
function snapshot(_id: string): OrgSnapshot {
  return {
    profile: null,
    profiles: [],
    departments: [],
    statuses: [],
    serviceTypes: [],
    workCategories: [],
  };
}

const readyOld: OrgState = { status: 'ready', snapshot: snapshot('old') };

describe('planReloadStart', () => {
  it('foreground reload flashes loading (login / manual retry)', () => {
    expect(planReloadStart(readyOld, 'foreground')).toEqual({ status: 'loading' });
    expect(planReloadStart({ status: 'idle' }, 'foreground')).toEqual({ status: 'loading' });
  });

  it('background reload KEEPS the previous ready snapshot (same reference, no flicker)', () => {
    expect(planReloadStart(readyOld, 'background')).toBe(readyOld);
  });

  it('background reload without a usable snapshot falls back to loading', () => {
    expect(planReloadStart({ status: 'idle' }, 'background')).toEqual({ status: 'loading' });
    expect(planReloadStart({ status: 'loading' }, 'background')).toEqual({ status: 'loading' });
    expect(planReloadStart({ status: 'error', message: 'x' }, 'background')).toEqual({
      status: 'loading',
    });
  });
});

describe('planReloadSuccess', () => {
  it('swaps atomically to the new snapshot regardless of mode', () => {
    const next = snapshot('new');
    expect(planReloadSuccess(next)).toEqual({ status: 'ready', snapshot: next });
  });
});

describe('planReloadError', () => {
  it('foreground error surfaces the recovery error', () => {
    expect(planReloadError(readyOld, 'foreground', 'Błąd serwera.')).toEqual({
      status: 'error',
      message: 'Błąd serwera.',
    });
  });

  it('background error keeps the usable ready snapshot (transient network hiccup never destroys data)', () => {
    expect(planReloadError(readyOld, 'background', 'Błąd serwera.')).toBe(readyOld);
  });

  it('background error without a usable snapshot still surfaces the error', () => {
    expect(planReloadError({ status: 'idle' }, 'background', 'Błąd.')).toEqual({
      status: 'error',
      message: 'Błąd.',
    });
  });
});

describe('background reload lifecycle (start -> success stays ready throughout)', () => {
  it('holds the old snapshot on start and swaps to the new one on success', () => {
    const start = planReloadStart(readyOld, 'background');
    expect(start.status).toBe('ready'); // never 'loading' => active never flickers
    expect(start).toBe(readyOld);
    const done = planReloadSuccess(snapshot('new'));
    expect(done.status).toBe('ready');
    expect(done).not.toBe(readyOld); // new reference => snapshot-change effect fires
  });
});
