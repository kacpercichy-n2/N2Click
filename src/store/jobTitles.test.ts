// Reduktor słownika stanowisk (jobTitles): ADD/RENAME/DELETE_JOB_TITLE oraz
// blok MERGE_CLOUD_DICTIONARIES dla jobTitles. Czyste testy reduktora: bez
// Reacta, bez localStorage — fixture'y z emptyData() + literały, wzorem
// taskMeta.test.ts. Kluczowy inwariant 6: każde odrzucenie zwraca TĘ SAMĄ
// referencję stanu (toBe).
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, JobTitle, Person, Status } from '../types';

const ACTIVE: Status = { id: 's-active', name: 'W toku', slug: 'w-toku', color: '#abc', order: 0, archived: false, isDone: false };
const DONE: Status = { id: 's-done', name: 'Zrobione', slug: 'zrobione', color: '#0f0', order: 1, archived: false, isDone: true };

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return { ...base, statuses: [ACTIVE, DONE], ...overrides };
}

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
    birthDate: '', ...overrides,
  };
}

describe('ADD_JOB_TITLE', () => {
  it('dodaje przycięte stanowisko z nowym id', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_JOB_TITLE', name: '  Grafik  ' });
    expect(next.jobTitles).toHaveLength(1);
    expect(next.jobTitles[0].name).toBe('Grafik');
    expect(next.jobTitles[0].id).not.toBe('');
  });

  it('pusta / sama-spacja nazwa => ta sama referencja (inwariant 6)', () => {
    const state = makeState();
    expect(reducer(state, { type: 'ADD_JOB_TITLE', name: '' })).toBe(state);
    expect(reducer(state, { type: 'ADD_JOB_TITLE', name: '   ' })).toBe(state);
  });

  it('duplikat bez rozróżniania wielkości liter => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    expect(reducer(state, { type: 'ADD_JOB_TITLE', name: ' grafik ' })).toBe(state);
  });
});

describe('RENAME_JOB_TITLE', () => {
  it('zmienia przyciętą nazwę istniejącego wiersza', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    const next = reducer(state, { type: 'RENAME_JOB_TITLE', jobTitleId: 'j1', name: '  Senior Grafik ' });
    expect(next.jobTitles[0].name).toBe('Senior Grafik');
  });

  it('pusta nazwa / nieznane id => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    expect(reducer(state, { type: 'RENAME_JOB_TITLE', jobTitleId: 'j1', name: '  ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_JOB_TITLE', jobTitleId: 'nope', name: 'X' })).toBe(state);
  });

  it('duplikat INNEGO wiersza (case-insensitive) => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }, { id: 'j2', name: 'Programista' }] });
    expect(reducer(state, { type: 'RENAME_JOB_TITLE', jobTitleId: 'j2', name: ' grafik ' })).toBe(state);
  });

  it('zmiana na własną dokładną nazwę (no-op) => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    expect(reducer(state, { type: 'RENAME_JOB_TITLE', jobTitleId: 'j1', name: 'Grafik' })).toBe(state);
  });
});

describe('DELETE_JOB_TITLE', () => {
  it('usuwa wiersz i NIE rusza Person.role (wolny tekst)', () => {
    const state = makeState({
      jobTitles: [{ id: 'j1', name: 'Grafik' }, { id: 'j2', name: 'Programista' }],
      people: [makePerson({ id: 'p1', role: 'Grafik' })],
    });
    const next = reducer(state, { type: 'DELETE_JOB_TITLE', jobTitleId: 'j1' });
    expect(next.jobTitles.map((j) => j.id)).toEqual(['j2']);
    expect(next.people[0].role).toBe('Grafik'); // zaszłościowy wpis zachowany
  });

  it('nieznane id => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    expect(reducer(state, { type: 'DELETE_JOB_TITLE', jobTitleId: 'nope' })).toBe(state);
  });
});

describe('MERGE_CLOUD_DICTIONARIES — jobTitles', () => {
  const dictPayload = (jobTitles: JobTitle[]) => ({
    departments: [],
    statuses: [ACTIVE, DONE],
    serviceTypes: [],
    workCategories: [],
    jobTitles,
    companies: [],
  });

  it('zastępuje jobTitles autorytatywnie', () => {
    const state = makeState({ jobTitles: [{ id: 'old', name: 'Stary' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([{ id: 'c1', name: 'Grafik' }]) });
    expect(next.jobTitles).toEqual([{ id: 'c1', name: 'Grafik' }]);
  });

  it('pusta chmurowa tablica jest POPRAWNA (zastępuje pustą)', () => {
    const state = makeState({ jobTitles: [{ id: 'old', name: 'Stary' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([]) });
    expect(next.jobTitles).toEqual([]);
  });

  it('zniekształcony wiersz => ta sama referencja (inwariant 6)', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    const malformed = reducer(state, {
      type: 'MERGE_CLOUD_DICTIONARIES',
      payload: dictPayload([{ id: '', name: 'Zła' } as JobTitle]),
    });
    expect(malformed).toBe(state);
  });

  it('ładunek identyczny wartościowo => ta sama referencja', () => {
    const state = makeState({ jobTitles: [{ id: 'j1', name: 'Grafik' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([{ id: 'j1', name: 'Grafik' }]) });
    expect(next).toBe(state);
  });
});
