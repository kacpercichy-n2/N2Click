// Reduktor zgłoszeń: ADD_TICKET / SAVE_TICKET / SET_TICKET_STATUS / DELETE_TICKET.
// Nacisk na inwariant 6 — każda odrzucona komenda musi zwrócić TĘ SAMĄ
// referencję stanu (nie kopię o równej wartości).
import { describe, expect, it } from 'vitest';
import { reducer, type TicketDraft } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Person, Ticket } from '../types';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';

function person(): Person {
  return {
    id: PERSON_ID,
    firstName: 'Kacper',
    lastName: 'Nowak',
    name: 'Kacper Nowak',
    email: 'kacper@n2.pl',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'administrator',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
  };
}

function baseState(tickets: Ticket[] = []): AppData {
  return { ...emptyData(), people: [person()], tickets };
}

function draft(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    title: 'Kalendarz gubi blok',
    area: 'Kalendarz',
    description: 'Po przeciągnięciu bloku zmiana nie zapisuje się.',
    kind: 'blad',
    priority: 'wysoki',
    reporterId: PERSON_ID,
    ...overrides,
  };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Istniejące zgłoszenie',
    area: 'Projekty',
    description: 'Opis',
    kind: 'usprawnienie',
    priority: 'sredni',
    status: 'nowe',
    reporterId: PERSON_ID,
    createdAt: '2026-07-19T10:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('ADD_TICKET', () => {
  it('dodaje zgłoszenie ze statusem „nowe” i przycina białe znaki', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_TICKET',
      draft: draft({ title: '  Spacja  ', area: '  Kalendarz  ', description: '  Opis  ' }),
    });
    expect(next.tickets).toHaveLength(1);
    const created = next.tickets[0];
    expect(created.title).toBe('Spacja');
    expect(created.area).toBe('Kalendarz');
    expect(created.description).toBe('Opis');
    expect(created.status).toBe('nowe');
    expect(created.reporterId).toBe(PERSON_ID);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.id).not.toBe('');
  });

  it.each([
    ['pusty tytuł', draft({ title: '   ' })],
    ['pusty opis', draft({ description: '' })],
    ['nieznany zgłaszający', draft({ reporterId: 'ktos-inny' })],
    ['nieznany rodzaj', draft({ kind: 'wymyslony' as TicketDraft['kind'] })],
    ['nieznany priorytet', draft({ priority: 'krytyczny' as TicketDraft['priority'] })],
  ])('odrzuca (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, bad) => {
    const state = baseState();
    expect(reducer(state, { type: 'ADD_TICKET', draft: bad })).toBe(state);
  });
});

describe('SAVE_TICKET', () => {
  it('zapisuje zmiany i odświeża updatedAt, nie ruszając createdAt ani statusu', () => {
    const existing = ticket({ status: 'w-trakcie' });
    const state = baseState([existing]);
    const next = reducer(state, {
      type: 'SAVE_TICKET',
      ticketId: existing.id,
      draft: draft({ title: 'Nowa nazwa' }),
    });
    const saved = next.tickets[0];
    expect(saved.title).toBe('Nowa nazwa');
    expect(saved.kind).toBe('blad');
    expect(saved.status).toBe('w-trakcie'); // status zmienia SET_TICKET_STATUS
    expect(saved.createdAt).toBe(existing.createdAt);
    expect(saved.updatedAt).not.toBe(existing.updatedAt);
  });

  it('nieznane id => ta sama referencja stanu', () => {
    const state = baseState([ticket()]);
    expect(reducer(state, { type: 'SAVE_TICKET', ticketId: 'brak', draft: draft() })).toBe(state);
  });

  it('niepoprawny draft => ta sama referencja stanu', () => {
    const existing = ticket();
    const state = baseState([existing]);
    expect(
      reducer(state, {
        type: 'SAVE_TICKET',
        ticketId: existing.id,
        draft: draft({ description: '  ' }),
      }),
    ).toBe(state);
  });
});

describe('SET_TICKET_STATUS', () => {
  it('zmienia status i odświeża updatedAt', () => {
    const existing = ticket();
    const state = baseState([existing]);
    const next = reducer(state, {
      type: 'SET_TICKET_STATUS',
      ticketId: existing.id,
      status: 'zrobione',
    });
    expect(next.tickets[0].status).toBe('zrobione');
    expect(next.tickets[0].updatedAt).not.toBe(existing.updatedAt);
  });

  it('ten sam status, nieznane id i wartość spoza enuma => ta sama referencja', () => {
    const existing = ticket();
    const state = baseState([existing]);
    expect(
      reducer(state, { type: 'SET_TICKET_STATUS', ticketId: existing.id, status: 'nowe' }),
    ).toBe(state);
    expect(reducer(state, { type: 'SET_TICKET_STATUS', ticketId: 'brak', status: 'zrobione' })).toBe(
      state,
    );
    expect(
      reducer(state, {
        type: 'SET_TICKET_STATUS',
        ticketId: existing.id,
        status: 'archiwum' as Ticket['status'],
      }),
    ).toBe(state);
  });
});

describe('DELETE_TICKET', () => {
  it('usuwa wskazane zgłoszenie', () => {
    const existing = ticket();
    const state = baseState([existing]);
    expect(reducer(state, { type: 'DELETE_TICKET', ticketId: existing.id }).tickets).toEqual([]);
  });

  it('nieznane id => ta sama referencja stanu', () => {
    const state = baseState([ticket()]);
    expect(reducer(state, { type: 'DELETE_TICKET', ticketId: 'brak' })).toBe(state);
  });
});
