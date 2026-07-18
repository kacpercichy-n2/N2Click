// Regression tests for the rejected-save feedback precheck (TaskModal, prompt
// 215): `wouldRejectSaveTask` must mirror the reducer's rejection exactly —
// true whenever SAVE_TASK would preserve the prior state reference (so the
// modal stays open with an explicit error instead of a false "Zapisano"), and
// false for a valid save (no false rejections closing the happy path).
import { describe, expect, it } from 'vitest';
import { reducer, wouldRejectSaveTask } from './AppStore';
import type { SaveTaskPayload } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Person, Project } from '../types';

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Ala', lastName: 'Nowak', name: 'Ala Nowak', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
    ...o,
  };
}

function makeProject(o: Partial<Project> & { id: string; statusId: string }): Project {
  return {
    clientId: '', name: 'Projekt', description: '', paid: false,
    startDate: '2026-07-01', endDate: '2026-07-31', departmentId: '', serviceTypeId: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

function makeState(): AppData {
  const base = emptyData();
  return {
    ...base,
    projects: [makeProject({ id: 'proj1', statusId: base.statuses[0].id })],
    people: [makePerson({ id: 'p1' })],
  };
}

function validPayload(state: AppData): SaveTaskPayload {
  return {
    taskId: null,
    draft: {
      projectId: 'proj1',
      statusId: state.statuses[0].id,
      title: 'Nowe zadanie',
      description: '',
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      estimatedHours: null,
      priority: 'normal',
      workCategoryId: '',
      checklist: [],
    },
    assigneeIds: ['p1'],
    allocations: [{ personId: 'p1', date: '2026-07-06', plannedHours: 2 }],
    newUnassigned: [],
  };
}

describe('wouldRejectSaveTask (rejected-save feedback)', () => {
  it('is false for a valid save — and the reducer really applies it', () => {
    const state = makeState();
    const payload = validPayload(state);
    expect(wouldRejectSaveTask(state, payload)).toBe(false);
    const next = reducer(state, { type: 'SAVE_TASK', payload });
    expect(next).not.toBe(state);
    expect(next.tasks).toHaveLength(1);
  });

  it('is true when the assignee was deleted underneath the open editor', () => {
    const state = makeState();
    const payload = validPayload(state);
    // A cloud merge / another tab removed the person while the modal was open.
    const merged: AppData = { ...state, people: [] };
    expect(wouldRejectSaveTask(merged, payload)).toBe(true);
    expect(reducer(merged, { type: 'SAVE_TASK', payload })).toBe(merged);
  });

  it('is true when the draft status no longer exists', () => {
    const state = makeState();
    const payload = validPayload(state);
    payload.draft.statusId = 'ghost-status';
    expect(wouldRejectSaveTask(state, payload)).toBe(true);
    expect(reducer(state, { type: 'SAVE_TASK', payload })).toBe(state);
  });

  it('is true for a stale task id (task deleted while editing)', () => {
    const state = makeState();
    const payload = { ...validPayload(state), taskId: 'ghost-task' };
    expect(wouldRejectSaveTask(state, payload)).toBe(true);
  });
});
