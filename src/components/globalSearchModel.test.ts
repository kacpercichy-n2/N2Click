// Czysta logika palety wyszukiwania: szybkie akcje (katalog + filtr),
// podświetlanie dopasowań, komunikat o liczbie wyników i „ostatnio otwarte”.
// Środowisko `node` — zero DOM-u, zero Reacta.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  QUICK_ACTIONS_INLINE_LIMIT,
  filterQuickActions,
  highlightSegments,
  inlineQuickActions,
  isQuickActionQuery,
  openedRefsSnapshot,
  quickActionCatalog,
  quickActionTerm,
  recentPaletteRefs,
  rememberOpenedRef,
  resetOpenedRefs,
  resultsAnnouncement,
} from './globalSearchModel';
import { emptyData } from '../store/storage';
import type { ActivityEvent, AppData, Project, Task } from '../types';

function makeState(overrides: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...overrides };
}

function makeProject(id: string, name = `Projekt ${id}`): Project {
  return {
    id,
    clientId: '',
    name,
    description: '',
    statusId: 'status1',
    paid: false,
    startDate: '2026-02-01',
    endDate: '2026-03-05',
    departmentId: '',
    serviceTypeId: '',
    documents: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeTask(id: string, title = `Zadanie ${id}`): Task {
  return {
    id,
    projectId: 'proj1',
    statusId: 'status1',
    title,
    description: '',
    startDate: '2026-07-06',
    endDate: '2026-07-08',
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeActivity(
  overrides: Partial<ActivityEvent> & { id: string; entityType: ActivityEvent['entityType']; entityId: string },
): ActivityEvent {
  return {
    actorId: '',
    message: 'zmienił(a)',
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('quickActionCatalog — tylko istniejące czynności aplikacji', () => {
  it('zaczyna od „Nowe zadanie”, reszta to nawigacja po istniejących trasach', () => {
    const catalog = quickActionCatalog({ canAdmin: true, canTeam: true });
    expect(catalog[0].id).toBe('new-task');
    expect(catalog[0].run).toEqual({ kind: 'new-task' });
    for (const action of catalog.slice(1)) {
      expect(action.run.kind).toBe('navigate');
      expect(action.id.startsWith('nav:')).toBe(true);
    }
    // Żadnych wymyślonych akcji poza nowym zadaniem + nawigacją.
    expect(new Set(catalog.map((a) => a.run.kind))).toEqual(new Set(['new-task', 'navigate']));
  });

  it('bramkuje /admin i /team dokładnie tak jak menu', () => {
    const paths = (opts: { canAdmin: boolean; canTeam: boolean }) =>
      quickActionCatalog(opts)
        .map((a) => (a.run.kind === 'navigate' ? a.run.path : ''))
        .filter(Boolean);

    expect(paths({ canAdmin: true, canTeam: true })).toContain('/admin');
    expect(paths({ canAdmin: true, canTeam: true })).toContain('/team');
    expect(paths({ canAdmin: false, canTeam: false })).not.toContain('/admin');
    expect(paths({ canAdmin: false, canTeam: false })).not.toContain('/team');
    // Pozostałe trasy zostają niezależnie od bramek.
    expect(paths({ canAdmin: false, canTeam: false })).toContain('/calendar');
  });
});

describe('filterQuickActions', () => {
  const catalog = quickActionCatalog({ canAdmin: true, canTeam: true });

  it('pusta fraza zwraca początek katalogu w granicach limitu', () => {
    expect(filterQuickActions('', catalog)).toHaveLength(QUICK_ACTIONS_INLINE_LIMIT);
    expect(filterQuickActions('', catalog, 2).map((a) => a.id)).toEqual([
      catalog[0].id,
      catalog[1].id,
    ]);
    expect(filterQuickActions('   ', catalog, Number.POSITIVE_INFINITY)).toHaveLength(
      catalog.length,
    );
  });

  it('dopasowuje po etykiecie i po haśle, bez oglądania się na diakrytyki', () => {
    expect(filterQuickActions('kalendarz', catalog).map((a) => a.id)).toEqual(['nav:/calendar']);
    expect(filterQuickActions('nowe zadanie', catalog).map((a) => a.id)).toEqual(['new-task']);
    // „Oś czasu” po znormalizowaniu to „os czasu”.
    expect(filterQuickActions('os czasu', catalog).map((a) => a.id)).toEqual(['nav:/timeline']);
    expect(filterQuickActions('/zgloszenia', catalog).map((a) => a.id)).toEqual([
      'nav:/zgloszenia',
    ]);
  });

  it('przycina wynik do limitu i zwraca pustą listę bez trafień', () => {
    expect(filterQuickActions('e', catalog, 2)).toHaveLength(2);
    expect(filterQuickActions('zzz-nie-ma', catalog)).toEqual([]);
    expect(filterQuickActions('kalendarz', catalog, 0)).toEqual([]);
  });

  it('nie proponuje akcji spoza katalogu (bramka uprawnień działa też w filtrze)', () => {
    const gated = quickActionCatalog({ canAdmin: false, canTeam: false });
    expect(filterQuickActions('administracja', gated)).toEqual([]);
    expect(filterQuickActions('administracja', catalog).map((a) => a.id)).toEqual(['nav:/admin']);
  });
});

describe('inlineQuickActions — akcje nad zwykłymi wynikami', () => {
  const catalog = quickActionCatalog({ canAdmin: true, canTeam: true });

  it('pusta fraza pokazuje domyślne akcje, jedna litera nie pokazuje nic', () => {
    expect(inlineQuickActions('', catalog)).toHaveLength(QUICK_ACTIONS_INLINE_LIMIT);
    expect(inlineQuickActions('  ', catalog)).toHaveLength(QUICK_ACTIONS_INLINE_LIMIT);
    // Jedna litera pasuje do prawie każdej etykiety nawigacji — sam szum.
    expect(inlineQuickActions('a', catalog)).toEqual([]);
    expect(inlineQuickActions(' k ', catalog)).toEqual([]);
  });

  it('od dwóch znaków filtruje normalnie, w granicach limitu', () => {
    const two = inlineQuickActions('ka', catalog);
    expect(two.length).toBeGreaterThan(0);
    expect(two.length).toBeLessThanOrEqual(QUICK_ACTIONS_INLINE_LIMIT);
    expect(two.map((a) => a.id)).toContain('nav:/calendar');
    expect(inlineQuickActions('kanban', catalog).map((a) => a.id)).toEqual(['nav:/kanban']);
  });
});

describe('tryb szybkich akcji (prefiks „>”)', () => {
  it('rozpoznaje prefiks i zdejmuje go z frazy', () => {
    expect(isQuickActionQuery('>')).toBe(true);
    expect(isQuickActionQuery('  > kal')).toBe(true);
    expect(isQuickActionQuery('kal')).toBe(false);
    expect(isQuickActionQuery('')).toBe(false);
    expect(quickActionTerm('> kal ')).toBe('kal');
    expect(quickActionTerm('>')).toBe('');
    expect(quickActionTerm(' zadanie ')).toBe('zadanie');
  });
});

describe('highlightSegments', () => {
  it('tnie tekst na fragmenty dopasowane i niedopasowane', () => {
    expect(highlightSegments('Projekt Alfa', 'alfa')).toEqual([
      { text: 'Projekt ', match: false },
      { text: 'Alfa', match: true },
    ]);
  });

  it('dopasowuje bez diakrytyków, ale zwraca ORYGINALNE znaki', () => {
    expect(highlightSegments('Żółty Łan', 'zolty')).toEqual([
      { text: 'Żółty', match: true },
      { text: ' Łan', match: false },
    ]);
    expect(highlightSegments('Żółty Łan', 'lan')).toEqual([
      { text: 'Żółty ', match: false },
      { text: 'Łan', match: true },
    ]);
  });

  it('podświetla wszystkie rozłączne wystąpienia', () => {
    expect(highlightSegments('aba aba', 'ab')).toEqual([
      { text: 'ab', match: true },
      { text: 'a ', match: false },
      { text: 'ab', match: true },
      { text: 'a', match: false },
    ]);
  });

  it('brak frazy, brak trafienia i pusty tekst mają bezpieczne wyniki', () => {
    expect(highlightSegments('Projekt', '')).toEqual([{ text: 'Projekt', match: false }]);
    expect(highlightSegments('Projekt', '   ')).toEqual([{ text: 'Projekt', match: false }]);
    expect(highlightSegments('Projekt', 'xyz')).toEqual([{ text: 'Projekt', match: false }]);
    expect(highlightSegments('', 'x')).toEqual([]);
  });

  it('złożenie fragmentów odtwarza dokładnie tekst wejściowy', () => {
    for (const text of ['Żółw w łódce', 'Alfa beta ALFA', 'Ćma']) {
      for (const q of ['a', 'zolw', 'ć', 'alfa', '']) {
        expect(highlightSegments(text, q).map((s) => s.text).join('')).toBe(text);
      }
    }
  });
});

describe('resultsAnnouncement', () => {
  it('liczy tylko niepuste grupy i odmienia po polsku', () => {
    expect(resultsAnnouncement([1])).toBe('1 wynik w 1 grupie');
    expect(resultsAnnouncement([2, 3])).toBe('5 wyników w 2 grupach');
    expect(resultsAnnouncement([5, 4, 3])).toBe('12 wyników w 3 grupach');
    expect(resultsAnnouncement([2, 0, 1])).toBe('3 wyniki w 2 grupach');
  });

  it('brak wyników ma własny komunikat', () => {
    expect(resultsAnnouncement([])).toBe('Brak wyników');
    expect(resultsAnnouncement([0, 0])).toBe('Brak wyników');
  });
});

describe('recentPaletteRefs — „ostatnio otwarte”', () => {
  beforeEach(() => {
    resetOpenedRefs();
  });

  const state = makeState({
    projects: [makeProject('p1'), makeProject('p2')],
    tasks: [makeTask('t1'), makeTask('t2')],
    activity: [
      makeActivity({ id: 'a1', entityType: 'task', entityId: 't1', createdAt: '2026-07-01T08:00:00.000Z' }),
      makeActivity({ id: 'a2', entityType: 'project', entityId: 'p2', createdAt: '2026-07-03T08:00:00.000Z' }),
      makeActivity({ id: 'a3', entityType: 'client', entityId: 'c1', createdAt: '2026-07-04T08:00:00.000Z' }),
      makeActivity({ id: 'a4', entityType: 'task', entityId: 'znikniete', createdAt: '2026-07-05T08:00:00.000Z' }),
    ],
  });

  it('pamięć sesji idzie pierwsza, potem dziennik aktywności od najnowszego', () => {
    const refs = recentPaletteRefs(state, [{ kind: 'task', id: 't2' }]);
    expect(refs).toEqual([
      { kind: 'task', id: 't2' },
      { kind: 'project', id: 'p2' },
      { kind: 'task', id: 't1' },
    ]);
  });

  it('pomija wpisy wskazujące na usunięte encje i typy spoza projekt/zadanie', () => {
    const refs = recentPaletteRefs(state, [{ kind: 'project', id: 'nie-ma' }]);
    expect(refs.map((r) => r.id)).not.toContain('nie-ma');
    expect(refs.map((r) => r.id)).not.toContain('znikniete');
    expect(refs.map((r) => r.id)).not.toContain('c1');
  });

  it('deduplikuje i respektuje limit', () => {
    const refs = recentPaletteRefs(
      state,
      [
        { kind: 'task', id: 't1' },
        { kind: 'task', id: 't1' },
      ],
      2,
    );
    expect(refs).toEqual([
      { kind: 'task', id: 't1' },
      { kind: 'project', id: 'p2' },
    ]);
    expect(recentPaletteRefs(state, [], 0)).toEqual([]);
  });

  it('rememberOpenedRef trzyma najnowsze na początku, bez duplikatów', () => {
    rememberOpenedRef({ kind: 'task', id: 't1' });
    rememberOpenedRef({ kind: 'project', id: 'p1' });
    rememberOpenedRef({ kind: 'task', id: 't1' });
    expect(openedRefsSnapshot()).toEqual([
      { kind: 'task', id: 't1' },
      { kind: 'project', id: 'p1' },
    ]);
    // Domyślnie funkcja czyta właśnie tę pamięć sesji.
    expect(recentPaletteRefs(state)[0]).toEqual({ kind: 'task', id: 't1' });
  });

  it('pusty stan i pusta pamięć dają pustą listę', () => {
    expect(recentPaletteRefs(makeState(), [])).toEqual([]);
  });
});
