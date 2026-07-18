// Focused tests for planHydrationOutcome: the merge-result-aware hydration
// decision. A load error surfaces its message; a REJECTED merge (fail-closed,
// same state reference) surfaces the Polish rejection message instead of a silent
// healthy no-op; a valid (even empty) payload yields 'ready'. Pure — no React.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import type { AppData } from '../types';
import type { CloudMergePayload } from './plannerData';
import { HYDRATION_MERGE_REJECTED, planHydrationOutcome } from './hydrationOutcome';

function emptyPayload(): CloudMergePayload {
  return {
    clients: [],
    projects: [],
    milestones: [],
    tasks: [],
    assignments: [],
    workload: [],
    comments: [],
    activity: [],
  };
}

function baseState(): AppData {
  return { ...emptyData() };
}

describe('planHydrationOutcome', () => {
  it('surfaces the load error when the snapshot failed', () => {
    const outcome = planHydrationOutcome(baseState(), { ok: false, error: 'Błąd serwera.' });
    expect(outcome).toEqual({ status: 'error', error: 'Błąd serwera.' });
  });

  it('is ready for a valid empty payload (no silent no-op false negative)', () => {
    const outcome = planHydrationOutcome(baseState(), {
      ok: true,
      payload: emptyPayload(),
      diagnostics: [],
    });
    expect(outcome.status).toBe('ready');
  });

  it('surfaces the Polish rejection error when the merge is fail-closed', () => {
    const state = baseState();
    // A workload row referencing a missing task/person => reducer rejects the whole
    // payload (returns the same state reference). Outcome must be an explicit error.
    const bad: CloudMergePayload = {
      ...emptyPayload(),
      workload: [
        {
          id: 'w-ghost',
          taskId: 'ghost',
          personId: 'ghost',
          date: '2026-07-06',
          plannedHours: 2,
          startMinutes: 480,
          sortIndex: 0,
        },
      ],
    };
    const outcome = planHydrationOutcome(state, { ok: true, payload: bad, diagnostics: [] });
    expect(outcome).toEqual({ status: 'error', error: HYDRATION_MERGE_REJECTED });
  });
});
