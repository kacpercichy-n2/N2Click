// Task recurrence reducer actions + selector (PKG-20260721-recurrence-core).
// SET_TASK_RECURRENCE / SET_RECURRENCE_OVERRIDE: happy paths, EVERY reject path
// returns the SAME state reference (invariant 6), clear semantics, override
// upsert/remove/no-op, SAVE_TASK startDate re-anchor, and the presentational
// recurrenceOccurrencesForDate selector (draft excluded, filter, no dayTotal).
//
// Pure reducer/selector tests: no React / localStorage — fixtures from emptyData().
import { describe, expect, it } from 'vitest';
import { reducer, type SaveTaskPayload } from './AppStore';
import { emptyData } from './storage';
import { dayTotal, recurrenceOccurrencesForDate } from './selectors';
import type { AppData, Person, Project, Status, Task, TaskAssignment } from '../types';

const ACTIVE: Status = { id: 'active', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const DONE: Status = { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7fbf7f', order: 1, archived: false, isDone: true };
const PROJECT: Project = {
  id: 'proj1', clientId: '', name: 'Projekt', description: '', statusId: 'active',
  paid: false, startDate: '2026-07-01', endDate: '2026-08-31', departmentId: '',
  serviceTypeId: '', documents: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const PERSON: Person = {
  id: 'p1', firstName: 'Ala', lastName: '', name: 'Ala', email: '', phone: '', role: '',
  departmentId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
  workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '',
};
const PERSON2: Person = { ...PERSON, id: 'p2', firstName: 'Bo', name: 'Bo' };

function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'proj1', statusId: 'active', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-31', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

function baseState(tasks: Task[], assignments: TaskAssignment[] = []): AppData {
  return {
    ...emptyData(),
    statuses: [ACTIVE, DONE],
    projects: [PROJECT],
    people: [PERSON, PERSON2],
    tasks,
    assignments,
  };
}

const RULE = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 }; // Mondays 9:00–10:00

describe('SET_TASK_RECURRENCE', () => {
  it('creates a canonical rule on a published task', () => {
    const state = baseState([makeTask({ id: 't1' })]);
    const next = reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: RULE });
    expect(next.tasks[0].recurrence).toEqual(RULE);
    expect(next).not.toBe(state);
  });

  it('re-applying an identical rule is a no-op (same reference)', () => {
    const state = baseState([makeTask({ id: 't1', recurrence: { ...RULE } })]);
    const next = reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: RULE });
    expect(next).toBe(state);
  });

  it('null clears the rule AND its overrides', () => {
    const state = baseState([
      makeTask({ id: 't1', recurrence: { ...RULE, overrides: [{ date: '2026-07-13', skip: true }] } }),
    ]);
    const next = reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: null });
    expect('recurrence' in next.tasks[0]).toBe(false);
    expect(next).not.toBe(state);
  });

  it('clearing a task without a rule is a no-op (same reference)', () => {
    const state = baseState([makeTask({ id: 't1' })]);
    const next = reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: null });
    expect(next).toBe(state);
  });

  it('a rule change preserves and re-canonicalizes overrides against the new rule', () => {
    // Rule spans Mon+Wed with a Monday time-shift and a Wednesday skip; narrowing
    // to Mondays-only must drop the now-stale Wednesday (07-08) skip.
    const seeded = baseState([
      makeTask({
        id: 't1',
        recurrence: {
          daysOfWeek: [1, 3],
          startMinutes: 540,
          durationMinutes: 60,
          overrides: [
            { date: '2026-07-13', startMinutes: 600, durationMinutes: 30 },
            { date: '2026-07-08', skip: true },
          ],
        },
      }),
    ]);
    const next = reducer(seeded, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: RULE });
    expect(next.tasks[0].recurrence!.overrides).toEqual([
      { date: '2026-07-13', startMinutes: 600, durationMinutes: 30 },
    ]);
  });

  it('rejects (same reference) an unknown taskId', () => {
    const state = baseState([makeTask({ id: 't1' })]);
    expect(reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 'ghost', recurrence: RULE })).toBe(state);
  });

  it('rejects (same reference) a draft task', () => {
    const state = baseState([makeTask({ id: 't1', isDraft: true })]);
    expect(reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: RULE })).toBe(state);
  });

  it('rejects (same reference) a task with an invalid startDate', () => {
    const state = baseState([makeTask({ id: 't1', startDate: 'not-a-date' })]);
    expect(reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: RULE })).toBe(state);
  });

  it('rejects (same reference) an invalid rule (empty days / bad until)', () => {
    const state = baseState([makeTask({ id: 't1' })]);
    expect(
      reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: { daysOfWeek: [], startMinutes: 540, durationMinutes: 60 } }),
    ).toBe(state);
    expect(
      reducer(state, { type: 'SET_TASK_RECURRENCE', taskId: 't1', recurrence: { ...RULE, until: '2026-07-01' } }),
    ).toBe(state);
  });
});

describe('SET_RECURRENCE_OVERRIDE', () => {
  const withRule = () => baseState([makeTask({ id: 't1', recurrence: { ...RULE } })]);

  it('adds a skip override on an occurrence date', () => {
    const next = reducer(withRule(), { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: { skip: true } });
    expect(next.tasks[0].recurrence!.overrides).toEqual([{ date: '2026-07-13', skip: true }]);
  });

  it('adds a time-shift override', () => {
    const next = reducer(withRule(), {
      type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13',
      override: { startMinutes: 600, durationMinutes: 30 },
    });
    expect(next.tasks[0].recurrence!.overrides).toEqual([{ date: '2026-07-13', startMinutes: 600, durationMinutes: 30 }]);
  });

  it('upserts by date and keeps overrides sorted', () => {
    let state = withRule();
    state = reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-20', override: { skip: true } });
    state = reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: { skip: true } });
    // Replace the 07-20 skip with a time shift (upsert by date).
    state = reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-20', override: { startMinutes: 660, durationMinutes: 45 } });
    expect(state.tasks[0].recurrence!.overrides).toEqual([
      { date: '2026-07-13', skip: true },
      { date: '2026-07-20', startMinutes: 660, durationMinutes: 45 },
    ]);
  });

  it('null removes the override for a date; the overrides key drops when empty', () => {
    let state = reducer(withRule(), { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: { skip: true } });
    state = reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: null });
    expect('overrides' in state.tasks[0].recurrence!).toBe(false);
  });

  it('removing a nonexistent override is a no-op (same reference)', () => {
    const state = withRule();
    expect(reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: null })).toBe(state);
  });

  it('a time-shift equal to the base rule removes/omits the override (canonical, same reference here)', () => {
    const state = withRule();
    const next = reducer(state, {
      type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13',
      override: { startMinutes: 540, durationMinutes: 60 },
    });
    expect(next).toBe(state); // no override existed and the shift equals the rule
  });

  it('rejects (same reference): unknown task, no rule, non-occurrence date, off-grid, structurally wrong', () => {
    const state = withRule();
    // unknown task
    expect(reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 'ghost', date: '2026-07-13', override: { skip: true } })).toBe(state);
    // task without a rule
    const noRule = baseState([makeTask({ id: 't1' })]);
    expect(reducer(noRule, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: { skip: true } })).toBe(noRule);
    // non-occurrence date (Tuesday)
    expect(reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-07', override: { skip: true } })).toBe(state);
    // off-grid time shift
    expect(reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: { startMinutes: 605, durationMinutes: 30 } })).toBe(state);
    // structurally wrong payload
    expect(reducer(state, { type: 'SET_RECURRENCE_OVERRIDE', taskId: 't1', date: '2026-07-13', override: {} as never })).toBe(state);
  });
});

describe('SAVE_TASK re-anchors recurrence when startDate changes', () => {
  it('keeps the rule and drops overrides before the new start', () => {
    const state = baseState([
      makeTask({
        id: 't1',
        startDate: '2026-07-06',
        endDate: '2026-07-31',
        recurrence: {
          daysOfWeek: [1],
          startMinutes: 540,
          durationMinutes: 60,
          overrides: [
            { date: '2026-07-13', skip: true }, // before the new start → drops
            { date: '2026-07-20', startMinutes: 600, durationMinutes: 30 }, // survives
          ],
        },
      }),
    ]);
    const payload: SaveTaskPayload = {
      taskId: 't1',
      draft: {
        projectId: 'proj1', statusId: 'active', title: 'Zadanie', description: '',
        startDate: '2026-07-14', endDate: '2026-07-31', estimatedHours: null,
        priority: 'normal', workCategoryId: '', departmentId: '', checklist: [],
      },
      assigneeIds: [],
      allocations: [],
    };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    expect(next.tasks[0].startDate).toBe('2026-07-14');
    expect(next.tasks[0].recurrence!.daysOfWeek).toEqual([1]);
    expect(next.tasks[0].recurrence!.overrides).toEqual([
      { date: '2026-07-20', startMinutes: 600, durationMinutes: 30 },
    ]);
  });

  it('leaves recurrence untouched when startDate is unchanged', () => {
    const rec = { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60 };
    const state = baseState([makeTask({ id: 't1', startDate: '2026-07-06', endDate: '2026-07-31', recurrence: { ...rec } })]);
    const payload: SaveTaskPayload = {
      taskId: 't1',
      draft: {
        projectId: 'proj1', statusId: 'active', title: 'Zmieniony tytuł', description: '',
        startDate: '2026-07-06', endDate: '2026-07-31', estimatedHours: null,
        priority: 'normal', workCategoryId: '', departmentId: '', checklist: [],
      },
      assigneeIds: [],
      allocations: [],
    };
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    expect(next.tasks[0].recurrence).toEqual(rec);
  });
});

describe('recurrenceOccurrencesForDate (presentational)', () => {
  const monday = '2026-07-13';

  it('returns published recurring occurrences and never affects dayTotal', () => {
    const state = baseState(
      [makeTask({ id: 't1', recurrence: { ...RULE } })],
      [{ id: 'a1', taskId: 't1', personId: 'p1' }],
    );
    const occ = recurrenceOccurrencesForDate(state, monday);
    expect(occ).toHaveLength(1);
    expect(occ[0].task.id).toBe('t1');
    expect(occ[0].occurrence.date).toBe(monday);
    // Invariant 1: no workload rows, so dayTotal stays 0.
    expect(dayTotal(state, monday)).toBe(0);
  });

  it('excludes draft tasks even if they illegally carry a rule', () => {
    const state = baseState([makeTask({ id: 't1', isDraft: true, recurrence: { ...RULE } })]);
    expect(recurrenceOccurrencesForDate(state, monday)).toHaveLength(0);
  });

  it('applies the person filter by ANY assignee', () => {
    const state = baseState(
      [makeTask({ id: 't1', recurrence: { ...RULE } })],
      [{ id: 'a1', taskId: 't1', personId: 'p1' }],
    );
    expect(recurrenceOccurrencesForDate(state, monday, new Set(['p1']))).toHaveLength(1);
    expect(recurrenceOccurrencesForDate(state, monday, new Set(['p2']))).toHaveLength(0);
    // Empty set = all.
    expect(recurrenceOccurrencesForDate(state, monday, new Set())).toHaveLength(1);
  });
});
