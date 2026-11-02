import { describe, expect, it } from 'vitest';
import { createLatestWins, liveSyncRouteFor } from './liveSyncRoute';

describe('liveSyncRouteFor', () => {
  it('zmiana wiersza n2click.notifications = tylko powiadomienia (INSERT, UPDATE, DELETE)', () => {
    for (const eventType of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(liveSyncRouteFor({ schema: 'n2click', table: 'notifications', eventType, new: {}, old: {} })).toBe(
        'notifications',
      );
    }
  });

  it('każda inna tabela planera i tożsamości = pełna synchronizacja', () => {
    for (const [schema, table] of [
      ['n2click', 'tasks'],
      ['n2click', 'workload'],
      ['n2click', 'messages'],
      ['core', 'profiles'],
      ['core', 'notifications'],
      ['public', 'notifications'],
    ]) {
      expect(liveSyncRouteFor({ schema, table, eventType: 'UPDATE' })).toBe('full');
    }
  });

  it('nierozpoznany ładunek = pełna synchronizacja (bezpieczny domyślny)', () => {
    for (const payload of [undefined, null, 'notifications', 42, [], {}, { table: 'notifications' }, { schema: 'n2click' }]) {
      expect(liveSyncRouteFor(payload)).toBe('full');
    }
  });
});

describe('createLatestWins (migawki powiadomień)', () => {
  it('pobrania w kolejności: każde nanosimy', () => {
    const gate = createLatestWins();
    const a = gate.begin();
    expect(gate.claim(a)).toBe(true);
    const b = gate.begin();
    expect(gate.claim(b)).toBe(true);
  });

  it('starsze pobranie dochodzące po nowszym jest odrzucane (lekka ścieżka vs pełna hydracja)', () => {
    const gate = createLatestWins();
    const light = gate.begin(); // lekka synchronizacja rusza pierwsza
    const full = gate.begin(); // pełna hydracja rusza później
    expect(gate.claim(full)).toBe(true);
    expect(gate.claim(light)).toBe(false);
  });

  it('nowsze pobranie po starszym dalej przechodzi', () => {
    const gate = createLatestWins();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.claim(first)).toBe(true);
    expect(gate.claim(second)).toBe(true);
  });

  it('ten sam numer nanosimy raz; numer spoza wydanych odrzucony', () => {
    const gate = createLatestWins();
    const t = gate.begin();
    expect(gate.claim(t)).toBe(true);
    expect(gate.claim(t)).toBe(false);
    expect(gate.claim(t + 5)).toBe(false);
  });
});
