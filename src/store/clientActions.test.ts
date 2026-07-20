// SAVE_CLIENT (create/edit with contact fields) and SET_CLIENT_ARCHIVED reducer
// tests. Covers: canonical key-absent-when-empty shape (trim + omit), name
// required + trim, unknown-id rejection returning the PRIOR state reference
// (invariant 6), no cascade on archive, and Polish activity attribution rows.
// Pure reducer tests in the fixture style of savedFilterCleanup.test.ts.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, Client } from '../types';

function makeState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
}

const CLIENT: Client = { id: 'c1', name: 'Klient', archived: false };

/** Assert a rejection: same state reference, no new activity row. */
function expectRejected(state: AppData, next: AppData) {
  expect(next).toBe(state);
  expect(next.activity.length).toBe(state.activity.length);
}

describe('SAVE_CLIENT — create', () => {
  it('creates a client with only the name when no contact data is given', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_CLIENT', clientId: null, draft: { name: 'Acme' } });
    expect(next).not.toBe(state);
    expect(next.clients).toHaveLength(1);
    const c = next.clients[0];
    expect(c.name).toBe('Acme');
    expect(c.archived).toBe(false);
    // Canonical shape: absent contact keys, not '' or undefined-valued.
    expect('contactPerson' in c).toBe(false);
    expect('email' in c).toBe(false);
    expect('phone' in c).toBe(false);
  });

  it('trims name + contact fields and OMITS empty/whitespace ones', () => {
    const state = makeState();
    const next = reducer(state, {
      type: 'SAVE_CLIENT',
      clientId: null,
      draft: { name: '  Acme  ', contactPerson: ' Anna ', email: '  a@b.pl ', phone: '   ' },
    });
    const c = next.clients[0];
    expect(c.name).toBe('Acme');
    expect(c.contactPerson).toBe('Anna');
    expect(c.email).toBe('a@b.pl');
    expect('phone' in c).toBe(false);
  });

  it('rejects an empty / whitespace-only name (prior state reference)', () => {
    const state = makeState();
    expectRejected(state, reducer(state, { type: 'SAVE_CLIENT', clientId: null, draft: { name: '   ' } }));
  });

  it('logs a Polish create activity row on the client entity', () => {
    const state = makeState();
    const next = reducer(state, { type: 'SAVE_CLIENT', clientId: null, draft: { name: 'Acme' } });
    const rows = next.activity.filter((e) => e.entityType === 'client');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('utworzył(a) klienta „Acme”');
    expect(rows[0].entityId).toBe(next.clients[0].id);
  });
});

describe('SAVE_CLIENT — edit', () => {
  it('updates name + contact fields, preserving archived and id', () => {
    const state = makeState({ clients: [{ ...CLIENT, archived: true, email: 'old@x.pl' }] });
    const next = reducer(state, {
      type: 'SAVE_CLIENT',
      clientId: 'c1',
      draft: { name: 'Nowa nazwa', contactPerson: 'Bartek' },
    });
    const c = next.clients.find((x) => x.id === 'c1')!;
    expect(c.name).toBe('Nowa nazwa');
    expect(c.contactPerson).toBe('Bartek');
    expect(c.archived).toBe(true); // preserved
    // Cleared field (email absent in draft) drops to canonical key-absent.
    expect('email' in c).toBe(false);
    const rows = next.activity.filter((e) => e.entityType === 'client');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('zaktualizował(a) klienta „Nowa nazwa”');
  });

  it('rejects an unknown clientId (prior state reference)', () => {
    const state = makeState({ clients: [CLIENT] });
    expectRejected(state, reducer(state, { type: 'SAVE_CLIENT', clientId: 'ghost', draft: { name: 'X' } }));
  });

  it('rejects an empty name on edit (prior state reference)', () => {
    const state = makeState({ clients: [CLIENT] });
    expectRejected(state, reducer(state, { type: 'SAVE_CLIENT', clientId: 'c1', draft: { name: '  ' } }));
  });
});

describe('SET_CLIENT_ARCHIVED', () => {
  it('archives a client and logs a Polish archive row, without cascading to projects', () => {
    const state = makeState({
      clients: [CLIENT],
      projects: [
        {
          id: 'p1', clientId: 'c1', name: 'P', description: '', statusId: 's1', paid: false,
          startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const next = reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'c1', archived: true });
    expect(next.clients.find((c) => c.id === 'c1')!.archived).toBe(true);
    // No cascade: the project survives untouched.
    expect(next.projects).toEqual(state.projects);
    const rows = next.activity.filter((e) => e.entityType === 'client');
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('zarchiwizował(a) klienta „Klient”');
  });

  it('restores a client with a Polish restore row', () => {
    const state = makeState({ clients: [{ ...CLIENT, archived: true }] });
    const next = reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'c1', archived: false });
    expect(next.clients.find((c) => c.id === 'c1')!.archived).toBe(false);
    expect(next.activity.filter((e) => e.entityType === 'client')[0].message).toBe(
      'przywrócił(a) klienta „Klient”',
    );
  });

  it('rejects an unknown clientId (prior state reference)', () => {
    const state = makeState({ clients: [CLIENT] });
    expectRejected(state, reducer(state, { type: 'SET_CLIENT_ARCHIVED', clientId: 'ghost', archived: true }));
  });
});
