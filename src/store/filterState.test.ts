// Focused tests for the unified/persistent filter store surface (PKG-A):
//  - SET_LAST_FILTER reducer contract (invariant 6: unknown view / malformed
//    payload / value-identical write all return the SAME state reference);
//  - SAVE_FILTER_PRESET accepting page 'kanban', rejecting unknown pages, and
//    sanitizing dangling projectId/workCategoryId;
//  - deleteProject (via DELETE_PROJECT) + DELETE_WORK_CATEGORY cascades into
//    savedFilters AND lastFilters, keeping unrelated entries by reference;
//  - the shared commandValidation sanitizers.
// Pure — no React, no Supabase.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData, DEFAULT_FILTER_CRITERIA } from './storage';
import {
  isFilterPage,
  isFilterViewKey,
  sanitizeFilterCriteria,
  sanitizeLastViewFilter,
} from './commandValidation';
import type {
  AppData,
  LastViewFilter,
  Project,
  SavedFilter,
  WorkCategory,
} from '../types';

function makeProject(id: string): Project {
  return {
    id,
    clientId: '',
    name: `Projekt ${id}`,
    description: '',
    statusId: '',
    paid: false,
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeFilter(overrides: Partial<LastViewFilter> = {}): LastViewFilter {
  return {
    criteria: { ...DEFAULT_FILTER_CRITERIA },
    personIds: [],
    departmentId: '',
    serviceTypeId: '',
    planning: '',
    ...overrides,
  };
}

function baseState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
}

describe('SET_LAST_FILTER', () => {
  it('lands a valid filter in state.lastFilters[view]', () => {
    const state = baseState({ projects: [makeProject('p1')] });
    const filter = makeFilter({
      criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'p1' },
      personIds: ['a', 'b'],
      planning: 'częściowo',
    });
    const next = reducer(state, { type: 'SET_LAST_FILTER', view: 'tasks', filter });
    expect(next).not.toBe(state);
    expect(next.lastFilters.tasks).toEqual(filter);
  });

  it('returns the SAME state reference for an unknown view', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SET_LAST_FILTER',
      // deliberately unknown view key
      view: 'nope' as never,
      filter: makeFilter(),
    });
    expect(next).toBe(state);
  });

  it('returns the SAME state reference for a structurally malformed filter (non-object criteria)', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SET_LAST_FILTER',
      view: 'tasks',
      filter: { criteria: null, personIds: [] } as never,
    });
    expect(next).toBe(state);
  });

  it('returns the SAME state reference when personIds is not an array', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SET_LAST_FILTER',
      view: 'tasks',
      filter: { criteria: { ...DEFAULT_FILTER_CRITERIA }, personIds: 'x' } as never,
    });
    expect(next).toBe(state);
  });

  it('returns the SAME state reference for a value-identical write (no-op)', () => {
    const filter = makeFilter({ personIds: ['a'] });
    const state = baseState({ lastFilters: { tasks: filter } });
    const next = reducer(state, {
      type: 'SET_LAST_FILTER',
      view: 'tasks',
      filter: makeFilter({ personIds: ['a'] }), // fresh but value-identical
    });
    expect(next).toBe(state);
  });

  it('sanitizes a dangling projectId to "" and dedupes personIds on write', () => {
    const state = baseState({ projects: [makeProject('p1')] });
    const filter = makeFilter({
      criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'ghost' },
      personIds: ['a', 'a', 'b'],
    });
    const next = reducer(state, { type: 'SET_LAST_FILTER', view: 'kanban', filter });
    expect(next.lastFilters.kanban?.criteria.projectId).toBe('');
    expect(next.lastFilters.kanban?.personIds).toEqual(['a', 'b']);
  });

  it('leaves OTHER view entries by reference when writing one view', () => {
    const projectsFilter = makeFilter({ personIds: ['x'] });
    const state = baseState({ lastFilters: { projects: projectsFilter } });
    const next = reducer(state, {
      type: 'SET_LAST_FILTER',
      view: 'tasks',
      filter: makeFilter({ personIds: ['y'] }),
    });
    expect(next.lastFilters.projects).toBe(projectsFilter);
  });
});

describe('SAVE_FILTER_PRESET', () => {
  it("accepts page 'kanban'", () => {
    const state = baseState({ projects: [makeProject('p1')] });
    const next = reducer(state, {
      type: 'SAVE_FILTER_PRESET',
      name: 'Mój',
      page: 'kanban',
      criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'p1' },
    });
    expect(next.savedFilters).toHaveLength(1);
    expect(next.savedFilters[0].page).toBe('kanban');
    expect(next.savedFilters[0].criteria.projectId).toBe('p1');
  });

  it('returns the SAME state reference for an unknown page', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SAVE_FILTER_PRESET',
      name: 'x',
      page: 'bogus' as never,
      criteria: { ...DEFAULT_FILTER_CRITERIA },
    });
    expect(next).toBe(state);
  });

  it('returns the SAME state reference for structurally malformed criteria', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SAVE_FILTER_PRESET',
      name: 'x',
      page: 'tasks',
      criteria: null as never,
    });
    expect(next).toBe(state);
  });

  it('sanitizes a dangling projectId/workCategoryId to "" on save', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SAVE_FILTER_PRESET',
      name: 'x',
      page: 'tasks',
      criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'ghost', workCategoryId: 'ghost' },
    });
    expect(next.savedFilters[0].criteria.projectId).toBe('');
    expect(next.savedFilters[0].criteria.workCategoryId).toBe('');
  });

  it('overwrites an existing preset with the same name+page (unchanged behavior)', () => {
    const existing: SavedFilter = {
      id: 'f1',
      name: 'Mój',
      page: 'tasks',
      criteria: { ...DEFAULT_FILTER_CRITERIA },
    };
    const state = baseState({ savedFilters: [existing] });
    const next = reducer(state, {
      type: 'SAVE_FILTER_PRESET',
      name: 'Mój',
      page: 'tasks',
      criteria: { ...DEFAULT_FILTER_CRITERIA, paid: 'paid' },
    });
    expect(next.savedFilters).toHaveLength(1);
    expect(next.savedFilters[0].id).toBe('f1');
    expect(next.savedFilters[0].criteria.paid).toBe('paid');
  });
});

describe('deleteProject cascade (DELETE_PROJECT)', () => {
  it('clears matching projectId in savedFilters and lastFilters; keeps unrelated by reference', () => {
    const matching: SavedFilter = {
      id: 'f1',
      name: 'A',
      page: 'tasks',
      criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'p1' },
    };
    const unrelated: SavedFilter = {
      id: 'f2',
      name: 'B',
      page: 'tasks',
      criteria: { ...DEFAULT_FILTER_CRITERIA, clientId: 'c1' },
    };
    const lastMatch = makeFilter({ criteria: { ...DEFAULT_FILTER_CRITERIA, projectId: 'p1' } });
    const lastUnrelated = makeFilter({ personIds: ['x'] });
    const state = baseState({
      projects: [makeProject('p1'), makeProject('p2')],
      savedFilters: [matching, unrelated],
      lastFilters: { tasks: lastMatch, kanban: lastUnrelated },
    });
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: 'p1' });
    expect(next.savedFilters.find((f) => f.id === 'f1')!.criteria.projectId).toBe('');
    expect(next.savedFilters.find((f) => f.id === 'f2')).toBe(unrelated);
    expect(next.lastFilters.tasks!.criteria.projectId).toBe('');
    expect(next.lastFilters.kanban).toBe(lastUnrelated);
  });
});

describe('DELETE_WORK_CATEGORY cascade', () => {
  it('clears matching workCategoryId in lastFilters', () => {
    const cat: WorkCategory = { id: 'cat1', name: 'Kreacja' };
    const lastMatch = makeFilter({
      criteria: { ...DEFAULT_FILTER_CRITERIA, workCategoryId: 'cat1' },
    });
    const state = baseState({
      workCategories: [cat],
      lastFilters: { tasks: lastMatch },
    });
    const next = reducer(state, { type: 'DELETE_WORK_CATEGORY', workCategoryId: 'cat1' });
    expect(next.lastFilters.tasks!.criteria.workCategoryId).toBe('');
  });
});

describe('shared sanitizers (commandValidation)', () => {
  it('isFilterViewKey / isFilterPage recognize the canonical values', () => {
    expect(isFilterViewKey('workload')).toBe(true);
    expect(isFilterViewKey('nope')).toBe(false);
    expect(isFilterPage('kanban')).toBe(true);
    expect(isFilterPage('workload')).toBe(false); // workload has no presets
  });

  it('sanitizeFilterCriteria fills defaults and sanitizes enum/dangling/date fields', () => {
    const state = baseState({ projects: [makeProject('p1')] });
    const c = sanitizeFilterCriteria(state, {
      paid: 'weird',
      priority: 'critical',
      projectId: 'ghost',
      workCategoryId: 'ghost',
      clientId: 'c1',
      from: 'garbage',
      to: '2026-07-20',
    });
    expect(c.paid).toBe('all');
    expect(c.priority).toBe('');
    expect(c.projectId).toBe('');
    expect(c.workCategoryId).toBe('');
    expect(c.clientId).toBe('c1');
    expect(c.from).toBe('');
    expect(c.to).toBe('2026-07-20');
  });

  it('sanitizeLastViewFilter coerces personIds, planning and workload dims', () => {
    const state = baseState();
    const f = sanitizeLastViewFilter(state, {
      criteria: { ...DEFAULT_FILTER_CRITERIA },
      personIds: ['a', 'a', 3, 'b'],
      departmentId: 42,
      serviceTypeId: 'srv1',
      planning: 'nieznane',
    });
    expect(f.personIds).toEqual(['a', 'b']);
    expect(f.departmentId).toBe('');
    expect(f.serviceTypeId).toBe('srv1');
    expect(f.planning).toBe('');
  });
});
