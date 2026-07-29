import { describe, expect, it } from 'vitest';
import {
  clientPickerOptions,
  effectiveProjectClientId,
  NO_CLIENT_LABEL,
  projectsForClient,
} from './taskClientPicker';

const clients = [
  { id: 'c-z', name: 'Żak Media' },
  { id: 'c-a', name: 'Agencja Alfa' },
  { id: 'c-l', name: 'Łucja Design' },
];

describe('effectiveProjectClientId', () => {
  it('nieznany lub pusty clientId liczy się jak brak klienta', () => {
    const known = new Set(['c-a']);
    expect(effectiveProjectClientId({ clientId: 'c-a' }, known)).toBe('c-a');
    expect(effectiveProjectClientId({ clientId: '' }, known)).toBe('');
    expect(effectiveProjectClientId({ clientId: 'usuniety' }, known)).toBe('');
  });
});

describe('clientPickerOptions', () => {
  it('sortuje klientów alfabetycznie w polskiej kolacji', () => {
    const out = clientPickerOptions(clients, [{ clientId: 'c-a' }]);
    expect(out.map((o) => o.name)).toEqual(['Agencja Alfa', 'Łucja Design', 'Żak Media']);
  });

  it('dokleja „Bez klienta" na końcu tylko gdy istnieje projekt-sierota', () => {
    const withOrphan = clientPickerOptions(clients, [{ clientId: '' }]);
    expect(withOrphan[withOrphan.length - 1]).toEqual({ id: '', name: NO_CLIENT_LABEL });
    const withDeleted = clientPickerOptions(clients, [{ clientId: 'usuniety' }]);
    expect(withDeleted[withDeleted.length - 1]).toEqual({ id: '', name: NO_CLIENT_LABEL });
    const clean = clientPickerOptions(clients, [{ clientId: 'c-z' }]);
    expect(clean.some((o) => o.id === '')).toBe(false);
  });
});

describe('projectsForClient', () => {
  const projects = [
    { name: 'Zima', clientId: 'c-a' },
    { name: 'Świt', clientId: 'c-a' },
    { name: 'Cyfry', clientId: 'c-z' },
    { name: 'Sierota', clientId: 'usuniety' },
    { name: 'Bez', clientId: '' },
  ];

  it('zwraca wyłącznie projekty wybranego klienta, alfabetycznie', () => {
    const out = projectsForClient(projects, clients, 'c-a');
    expect(out.map((p) => p.name)).toEqual(['Świt', 'Zima']);
  });

  it("'' zbiera projekty bez klienta i z usuniętym klientem", () => {
    const out = projectsForClient(projects, clients, '');
    expect(out.map((p) => p.name)).toEqual(['Bez', 'Sierota']);
  });

  it('nie mutuje wejściowej listy projektów', () => {
    const before = projects.map((p) => p.name);
    projectsForClient(projects, clients, 'c-a');
    expect(projects.map((p) => p.name)).toEqual(before);
  });
});
