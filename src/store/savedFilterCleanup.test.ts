// Saved-filter preset cleanup on entity deletion: DELETE_CLIENT, DELETE_STATUS,
// DELETE_PERSON and DELETE_WORK_CATEGORY must clear the deleted id from every
// preset's criteria (never leave a dangling reference), and must not touch
// presets that reference other entities. Pure reducer tests in the fixture
// style of statusActions.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Person, SavedFilter, SavedFilterCriteria } from '../types';

function makeCriteria(overrides: Partial<SavedFilterCriteria> = {}): SavedFilterCriteria {
  return {
    paid: 'all',
    clientId: '',
    statusId: '',
    personId: '',
    priority: '',
    workCategoryId: '',
    from: '',
    to: '',
    ...overrides,
  };
}

function makeFilter(id: string, criteria: Partial<SavedFilterCriteria>): SavedFilter {
  return { id, name: `Preset ${id}`, page: 'tasks', criteria: makeCriteria(criteria) };
}

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Test',
    lastName: '',
    name: 'Test',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

function makeState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
}

describe('saved-filter cleanup on deletion', () => {
  it('DELETE_CLIENT clears the deleted clientId from presets', () => {
    const state = makeState({
      clients: [{ id: 'c1', name: 'Klient', archived: false }],
      savedFilters: [makeFilter('f1', { clientId: 'c1' }), makeFilter('f2', { clientId: 'other' })],
    });
    const next = reducer(state, { type: 'DELETE_CLIENT', clientId: 'c1' });
    expect(next.savedFilters.find((f) => f.id === 'f1')!.criteria.clientId).toBe('');
    expect(next.savedFilters.find((f) => f.id === 'f2')!.criteria.clientId).toBe('other');
  });

  it('DELETE_STATUS clears the deleted statusId from presets', () => {
    const base = makeState();
    // Default statuses: pick a deletable one (not the only active, not the only done).
    const deletable = base.statuses.find(
      (s) => !s.isDone && base.statuses.filter((x) => !x.archived).length > 1,
    )!;
    const state: AppData = {
      ...base,
      savedFilters: [
        makeFilter('f1', { statusId: deletable.id }),
        makeFilter('f2', { statusId: 'other' }),
      ],
    };
    const next = reducer(state, { type: 'DELETE_STATUS', statusId: deletable.id });
    expect(next.statuses.some((s) => s.id === deletable.id)).toBe(false);
    expect(next.savedFilters.find((f) => f.id === 'f1')!.criteria.statusId).toBe('');
    expect(next.savedFilters.find((f) => f.id === 'f2')!.criteria.statusId).toBe('other');
  });

  it('DELETE_PERSON clears the deleted personId from presets', () => {
    const state = makeState({
      people: [
        makePerson({ id: 'p1' }),
        makePerson({ id: 'admin', accessRole: 'administrator' }),
      ],
      savedFilters: [makeFilter('f1', { personId: 'p1' }), makeFilter('f2', { personId: 'admin' })],
    });
    const next = reducer(state, { type: 'DELETE_PERSON', personId: 'p1' });
    expect(next.savedFilters.find((f) => f.id === 'f1')!.criteria.personId).toBe('');
    expect(next.savedFilters.find((f) => f.id === 'f2')!.criteria.personId).toBe('admin');
  });

  it('DELETE_WORK_CATEGORY still clears the deleted workCategoryId from presets', () => {
    const state = makeState({
      workCategories: [{ id: 'w1', name: 'Kreacja' }],
      savedFilters: [makeFilter('f1', { workCategoryId: 'w1' })],
    });
    const next = reducer(state, { type: 'DELETE_WORK_CATEGORY', workCategoryId: 'w1' });
    expect(next.savedFilters[0].criteria.workCategoryId).toBe('');
  });

  it('keeps the savedFilters array reference when no preset references the id', () => {
    const state = makeState({
      clients: [{ id: 'c1', name: 'Klient', archived: false }],
      savedFilters: [makeFilter('f1', { clientId: 'other' })],
    });
    const next = reducer(state, { type: 'DELETE_CLIENT', clientId: 'c1' });
    expect(next.savedFilters).toBe(state.savedFilters);
  });
});
