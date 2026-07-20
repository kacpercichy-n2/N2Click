// Repair kolekcji zgłoszeń przy wczytaniu + obecność `tickets` w emptyData.
// Kolekcja jest ADDYTYWNA: DATA_VERSION się nie zmienia, a starszy zapis bez
// pola `tickets` wczytuje się jako pusta lista.
import { describe, expect, it } from 'vitest';
import { emptyData, repairTickets } from './storage';
import { can } from './permissions';
import type { AppData, Person, Ticket } from '../types';

const withTickets = (tickets: unknown[]): AppData =>
  ({ ...emptyData(), tickets: tickets as Ticket[] });

function person(accessRole: Person['accessRole']): Person {
  return {
    id: 'p1',
    firstName: 'X',
    lastName: '',
    name: 'X',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole,
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
  };
}

describe('emptyData', () => {
  it('zawiera pustą kolekcję zgłoszeń', () => {
    expect(emptyData().tickets).toEqual([]);
  });
});

describe('repairTickets', () => {
  it('odrzuca wiersze bez id albo bez tytułu', () => {
    const data = withTickets([
      { id: '', title: 'Bez id', description: 'x' },
      { id: 'a', title: '   ', description: 'x' },
      { id: 'b', title: 'Zostaje', description: 'x' },
      null,
      'nie-obiekt',
    ]);
    const repaired = repairTickets(data);
    expect(repaired.tickets.map((t) => t.id)).toEqual(['b']);
  });

  it('normalizuje nieznane kind/priority/status do wartości domyślnych', () => {
    const repaired = repairTickets(
      withTickets([
        { id: 'a', title: 'A', kind: 'wymysl', priority: 'krytyczny', status: 'archiwum' },
      ]),
    );
    expect(repaired.tickets[0]).toMatchObject({
      kind: 'inne',
      priority: 'sredni',
      status: 'nowe',
    });
  });

  it('zachowuje poprawne wartości enumów i przycina tytuł', () => {
    const repaired = repairTickets(
      withTickets([
        {
          id: 'a',
          title: '  Tytuł  ',
          area: 'Kalendarz',
          description: 'Opis',
          kind: 'blad',
          priority: 'wysoki',
          status: 'zrobione',
          reporterId: 'p1',
          createdAt: '2026-07-19T10:00:00.000Z',
          updatedAt: '2026-07-19T11:00:00.000Z',
        },
      ]),
    );
    expect(repaired.tickets[0]).toEqual({
      id: 'a',
      title: 'Tytuł',
      area: 'Kalendarz',
      description: 'Opis',
      kind: 'blad',
      priority: 'wysoki',
      status: 'zrobione',
      reporterId: 'p1',
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-19T11:00:00.000Z',
    });
  });

  it('koercjonuje brakujące pola tekstowe i zachowuje osieroconego zgłaszającego', () => {
    const repaired = repairTickets(withTickets([{ id: 'a', title: 'A', reporterId: 'usunieta' }]));
    expect(repaired.tickets[0]).toMatchObject({
      area: '',
      description: '',
      reporterId: 'usunieta', // historia zgłoszeń przeżywa usunięcie osoby
      createdAt: '',
    });
  });

  it('nie-tablica w miejscu kolekcji naprawia się do pustej listy', () => {
    expect(repairTickets({ ...emptyData(), tickets: null as unknown as Ticket[] }).tickets).toEqual(
      [],
    );
  });

  it('jest idempotentny (drugi przebieg nic nie zmienia)', () => {
    const once = repairTickets(
      withTickets([{ id: 'a', title: 'A', kind: 'zle' }, { id: '', title: 'X' }]),
    );
    expect(repairTickets(once).tickets).toEqual(once.tickets);
  });
});

describe('uprawnienia zgłoszeń', () => {
  it('każda rola może zgłaszać', () => {
    for (const role of ['administrator', 'pm', 'handlowiec', 'pracownik'] as const) {
      expect(can(person(role), 'tickets.create')).toBe(true);
    }
  });

  it('triage (tickets.manage) ma wyłącznie administrator', () => {
    expect(can(person('administrator'), 'tickets.manage')).toBe(true);
    for (const role of ['pm', 'handlowiec', 'pracownik'] as const) {
      expect(can(person(role), 'tickets.manage')).toBe(false);
    }
  });
});
