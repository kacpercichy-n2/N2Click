// Reduktor słownika spółek (companies): ADD/RENAME/DELETE_COMPANY oraz blok
// MERGE_CLOUD_DICTIONARIES dla companies. Czyste testy reduktora: bez Reacta,
// bez localStorage — fixture'y z emptyData() + literały, wzorem jobTitles.test.ts.
// Kluczowy inwariant 6: każde odrzucenie zwraca TĘ SAMĄ referencję stanu (toBe).
// DODATKOWO: DELETE_COMPANY kaskadowo czyści `Person.companyId` (jak dział).
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Company, Person, Status } from '../types';

const ACTIVE: Status = { id: 's-active', name: 'W toku', slug: 'w-toku', color: '#abc', order: 0, archived: false, isDone: false };
const DONE: Status = { id: 's-done', name: 'Zrobione', slug: 'zrobione', color: '#0f0', order: 1, archived: false, isDone: true };

function makeState(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return { ...base, statuses: [ACTIVE, DONE], ...overrides };
}

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'A', lastName: 'B', name: 'A B', email: '', phone: '', role: '',
    departmentId: '', companyId: '', avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
    birthDate: '', ...overrides,
  };
}

describe('ADD_COMPANY', () => {
  it('dodaje przyciętą spółkę z nowym id', () => {
    const state = makeState();
    const next = reducer(state, { type: 'ADD_COMPANY', name: '  Acme  ' });
    expect(next.companies).toHaveLength(1);
    expect(next.companies[0].name).toBe('Acme');
    expect(next.companies[0].id).not.toBe('');
  });

  it('pusta / sama-spacja nazwa => ta sama referencja (inwariant 6)', () => {
    const state = makeState();
    expect(reducer(state, { type: 'ADD_COMPANY', name: '' })).toBe(state);
    expect(reducer(state, { type: 'ADD_COMPANY', name: '   ' })).toBe(state);
  });

  it('duplikat bez rozróżniania wielkości liter => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    expect(reducer(state, { type: 'ADD_COMPANY', name: ' acme ' })).toBe(state);
  });
});

describe('RENAME_COMPANY', () => {
  it('zmienia przyciętą nazwę istniejącego wiersza', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    const next = reducer(state, { type: 'RENAME_COMPANY', companyId: 'c1', name: '  Acme Studio ' });
    expect(next.companies[0].name).toBe('Acme Studio');
  });

  it('pusta nazwa / nieznane id => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    expect(reducer(state, { type: 'RENAME_COMPANY', companyId: 'c1', name: '  ' })).toBe(state);
    expect(reducer(state, { type: 'RENAME_COMPANY', companyId: 'nope', name: 'X' })).toBe(state);
  });

  it('duplikat INNEGO wiersza (case-insensitive) => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Globex' }] });
    expect(reducer(state, { type: 'RENAME_COMPANY', companyId: 'c2', name: ' acme ' })).toBe(state);
  });

  it('zmiana na własną dokładną nazwę (no-op) => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    expect(reducer(state, { type: 'RENAME_COMPANY', companyId: 'c1', name: 'Acme' })).toBe(state);
  });
});

describe('DELETE_COMPANY', () => {
  it('usuwa wiersz i kaskadowo czyści dangling Person.companyId', () => {
    const state = makeState({
      companies: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Globex' }],
      people: [
        makePerson({ id: 'p1', companyId: 'c1' }),
        makePerson({ id: 'p2', companyId: 'c2' }),
      ],
    });
    const next = reducer(state, { type: 'DELETE_COMPANY', companyId: 'c1' });
    expect(next.companies.map((c) => c.id)).toEqual(['c2']);
    expect(next.people.find((p) => p.id === 'p1')!.companyId).toBe(''); // wyczyszczone
    expect(next.people.find((p) => p.id === 'p2')!.companyId).toBe('c2'); // nietknięte
  });

  it('nieznane id => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    expect(reducer(state, { type: 'DELETE_COMPANY', companyId: 'nope' })).toBe(state);
  });
});

describe('MERGE_CLOUD_DICTIONARIES — companies', () => {
  const dictPayload = (companies: Company[]) => ({
    departments: [],
    statuses: [ACTIVE, DONE],
    serviceTypes: [],
    workCategories: [],
    jobTitles: [],
    companies,
  });

  it('zastępuje companies autorytatywnie', () => {
    const state = makeState({ companies: [{ id: 'old', name: 'Stara' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([{ id: 'c1', name: 'Acme' }]) });
    expect(next.companies).toEqual([{ id: 'c1', name: 'Acme' }]);
  });

  it('pusta chmurowa tablica jest POPRAWNA (zastępuje pustą)', () => {
    const state = makeState({ companies: [{ id: 'old', name: 'Stara' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([]) });
    expect(next.companies).toEqual([]);
  });

  it('zniekształcony wiersz => ta sama referencja (inwariant 6)', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    const malformed = reducer(state, {
      type: 'MERGE_CLOUD_DICTIONARIES',
      payload: dictPayload([{ id: '', name: 'Zła' } as Company]),
    });
    expect(malformed).toBe(state);
  });

  it('brak / nie-tablicowy klucz companies => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    const badPayload = { ...dictPayload([]), companies: undefined } as unknown as never;
    expect(reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: badPayload })).toBe(state);
  });

  it('ładunek identyczny wartościowo => ta sama referencja', () => {
    const state = makeState({ companies: [{ id: 'c1', name: 'Acme' }] });
    const next = reducer(state, { type: 'MERGE_CLOUD_DICTIONARIES', payload: dictPayload([{ id: 'c1', name: 'Acme' }]) });
    expect(next).toBe(state);
  });
});
