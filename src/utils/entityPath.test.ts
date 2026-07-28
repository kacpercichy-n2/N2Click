// Testy jednolitej ścieżki adresowej „Klient › Projekt” (SY-06). Bez Reacta.
import { describe, expect, it } from 'vitest';
import { ENTITY_PATH_SEPARATOR, clientProjectPath } from './entityPath';

describe('clientProjectPath', () => {
  it('klient i projekt dają „Klient › Projekt” — w tej kolejności', () => {
    expect(clientProjectPath('Nowa Era', 'Strona WWW')).toBe('Nowa Era › Strona WWW');
  });

  it('separator to `›` otoczony spacjami i pochodzi ze stałej', () => {
    expect(ENTITY_PATH_SEPARATOR).toBe('›');
    expect(clientProjectPath('A', 'B')).toBe(`A ${ENTITY_PATH_SEPARATOR} B`);
    expect(clientProjectPath('A', 'B')).not.toContain('/');
    expect(clientProjectPath('A', 'B')).not.toContain('·');
  });

  it('sam projekt renderuje się bez separatora', () => {
    expect(clientProjectPath(undefined, 'Strona WWW')).toBe('Strona WWW');
  });

  it('sam klient degraduje się do nazwy klienta', () => {
    expect(clientProjectPath('Nowa Era', undefined)).toBe('Nowa Era');
  });

  it('brak obu daje myślnik', () => {
    expect(clientProjectPath(undefined, undefined)).toBe('—');
    expect(clientProjectPath(null, null)).toBe('—');
  });

  it('puste i białe nazwy liczą się jako brak', () => {
    expect(clientProjectPath('', '')).toBe('—');
    expect(clientProjectPath('   ', 'Strona WWW')).toBe('Strona WWW');
    expect(clientProjectPath('Nowa Era', '  ')).toBe('Nowa Era');
  });

  it('degradacja braku projektu należy do wywołującego (Kanban)', () => {
    expect(clientProjectPath('Nowa Era', 'Bez projektu')).toBe('Nowa Era › Bez projektu');
    expect(clientProjectPath(undefined, 'Bez projektu')).toBe('Bez projektu');
  });
});
