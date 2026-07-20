// Dokumenty handlowe projektu (odnośniki): reduktor ADD/SAVE/DELETE, walidacja
// adresu (pusty + schemat), repair przy wczytaniu (pole ADDYTYWNE — starszy
// zapis bez `documents` dostaje []) oraz round-trip przez chmurę
// (mirror -> snapshot).
//
// Dwa naciski:
// 1. Inwariant 6 — każda odrzucona komenda zwraca TĘ SAMĄ referencję stanu.
// 2. Schemat adresu na TRZECH granicach (walidacja reduktora, repair wczytania,
//    bramka renderowania href): projekty są danymi współdzielonymi w
//    organizacji, więc `javascript:`/`data:` byłyby przechowywanym XSS-em.
import { describe, expect, it } from 'vitest';
import { reducer, type ProjectDocumentDraft } from './AppStore';
import { isValidProjectDocumentDraft } from './commandValidation';
import { emptyData, loadDataResult, repairProjectDocuments } from './storage';
import { normalizeProjectDocumentUrl } from '../utils/projectDocuments';
import { buildCloudIdMaps, diffToCloudOps } from '../supabase/cloudMirror';
import { loadPlannerSnapshot, type PlannerDb } from '../supabase/plannerData';
import type { AppData, Project, ProjectDocument } from '../types';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_KEY = 'n2hub.data.v1';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    clientId: '',
    name: 'Redesign strony',
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
    ...overrides,
  };
}

function doc(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: DOC_ID,
    kind: 'oferta',
    label: 'Oferta 2026',
    url: 'https://example.test/oferta.pdf',
    ...overrides,
  };
}

function baseState(documents: ProjectDocument[] = []): AppData {
  return { ...emptyData(), projects: [project({ documents })] };
}

function draft(overrides: Partial<ProjectDocumentDraft> = {}): ProjectDocumentDraft {
  return {
    kind: 'wycena',
    label: 'Wycena etapu 1',
    url: 'https://example.test/wycena',
    ...overrides,
  };
}

// ---- Reduktor ---------------------------------------------------------------

describe('ADD_PROJECT_DOCUMENT', () => {
  it('dopisuje dokument z przyciętymi wartościami i nadanym id', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: draft({ label: '  Brief  ', url: '  https://example.test/brief  ', kind: 'brief' }),
    });
    expect(next).not.toBe(state);
    expect(next.projects[0].documents).toHaveLength(1);
    expect(next.projects[0].documents[0]).toMatchObject({
      kind: 'brief',
      label: 'Brief',
      url: 'https://example.test/brief',
    });
    expect(next.projects[0].documents[0].id).not.toBe('');
    // Lista jest osadzona w projekcie, więc zmiana odświeża jego `updatedAt`.
    expect(next.projects[0].updatedAt).not.toBe(state.projects[0].updatedAt);
    expect(next.activity).toHaveLength(1);
  });

  it('odrzuca pusty adres, zachowując TĘ SAMĄ referencję stanu', () => {
    const state = baseState();
    expect(reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: draft({ url: '   ' }),
    })).toBe(state);
    expect(reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: draft({ url: '' }),
    })).toBe(state);
  });

  it('odrzuca nieznany rodzaj i nieistniejący projekt', () => {
    const state = baseState();
    expect(reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: { ...draft(), kind: 'umowa' as ProjectDocumentDraft['kind'] },
    })).toBe(state);
    expect(reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: 'brak-projektu',
      draft: draft(),
    })).toBe(state);
  });
});

describe('SAVE_PROJECT_DOCUMENT', () => {
  it('podmienia rodzaj/nazwę/adres, zachowując id wiersza', () => {
    const state = baseState([doc()]);
    const next = reducer(state, {
      type: 'SAVE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: DOC_ID,
      draft: draft({ kind: 'link', label: 'Panel klienta', url: 'https://example.test/panel' }),
    });
    expect(next.projects[0].documents).toEqual([
      { id: DOC_ID, kind: 'link', label: 'Panel klienta', url: 'https://example.test/panel' },
    ]);
    expect(next.activity).toHaveLength(1);
  });

  it('odrzuca pusty adres, nieznany dokument i nieistniejący projekt (ta sama referencja)', () => {
    const state = baseState([doc()]);
    expect(reducer(state, {
      type: 'SAVE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: DOC_ID,
      draft: draft({ url: '  ' }),
    })).toBe(state);
    expect(reducer(state, {
      type: 'SAVE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: 'brak-dokumentu',
      draft: draft(),
    })).toBe(state);
    expect(reducer(state, {
      type: 'SAVE_PROJECT_DOCUMENT',
      projectId: 'brak-projektu',
      documentId: DOC_ID,
      draft: draft(),
    })).toBe(state);
  });

  it('zapis bez zmiany wartości jest no-opem (ta sama referencja)', () => {
    const state = baseState([doc()]);
    expect(reducer(state, {
      type: 'SAVE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: DOC_ID,
      draft: { kind: 'oferta', label: 'Oferta 2026', url: 'https://example.test/oferta.pdf' },
    })).toBe(state);
  });
});

describe('DELETE_PROJECT_DOCUMENT', () => {
  it('usuwa wskazany wiersz i zostawia pozostałe', () => {
    const other = doc({ id: '55555555-5555-4555-8555-555555555555', label: 'Brief', kind: 'brief' });
    const state = baseState([doc(), other]);
    const next = reducer(state, {
      type: 'DELETE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: DOC_ID,
    });
    expect(next.projects[0].documents).toEqual([other]);
    expect(next.activity).toHaveLength(1);
  });

  it('odrzuca nieznany dokument bez wpisu w dzienniku (ta sama referencja)', () => {
    const state = baseState([doc()]);
    expect(reducer(state, {
      type: 'DELETE_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      documentId: 'brak-dokumentu',
    })).toBe(state);
  });

  it('usunięcie projektu zabiera jego dokumenty (lista jest osadzona)', () => {
    const state = baseState([doc()]);
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: PROJECT_ID });
    expect(next.projects).toEqual([]);
  });
});

describe('isValidProjectDocumentDraft', () => {
  it('wymaga niepustego adresu i znanego rodzaju', () => {
    expect(isValidProjectDocumentDraft(draft())).toBe(true);
    expect(isValidProjectDocumentDraft(draft({ label: '' }))).toBe(true);
    expect(isValidProjectDocumentDraft(draft({ url: '   ' }))).toBe(false);
  });

  it('przepuszcza http(s) i adres bez schematu, odrzuca pozostałe schematy', () => {
    expect(isValidProjectDocumentDraft(draft({ url: 'http://example.test/a' }))).toBe(true);
    expect(isValidProjectDocumentDraft(draft({ url: 'https://example.test/a' }))).toBe(true);
    expect(isValidProjectDocumentDraft(draft({ url: 'example.test/a' }))).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(document.cookie)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'mailto:kto@example.test',
    ]) {
      expect(isValidProjectDocumentDraft(draft({ url })), url).toBe(false);
    }
  });
});

describe('reduktor: schemat adresu', () => {
  it('odrzuca javascript:/data: TĄ SAMĄ referencją stanu (add i save)', () => {
    const state = baseState([doc()]);
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>']) {
      expect(reducer(state, {
        type: 'ADD_PROJECT_DOCUMENT',
        projectId: PROJECT_ID,
        draft: draft({ url }),
      }), url).toBe(state);
      expect(reducer(state, {
        type: 'SAVE_PROJECT_DOCUMENT',
        projectId: PROJECT_ID,
        documentId: DOC_ID,
        draft: draft({ url }),
      }), url).toBe(state);
    }
  });

  it('zapisuje ZNORMALIZOWANY adres: bez schematu dostaje https://', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: draft({ url: '  example.test/oferta.pdf  ' }),
    });
    expect(next.projects[0].documents[0].url).toBe('https://example.test/oferta.pdf');
  });

  it('nie przepisuje adresu, który już ma dozwolony schemat', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_PROJECT_DOCUMENT',
      projectId: PROJECT_ID,
      draft: draft({ url: 'http://example.test/a?x=1' }),
    });
    expect(next.projects[0].documents[0].url).toBe('http://example.test/a?x=1');
  });
});

// ---- Granica renderowania ---------------------------------------------------
// Repo nie ma harnessu DOM-owego, a ProjectDetailPage deleguje decyzję
// „href czy sam tekst” do tej czystej funkcji — testujemy więc dokładnie tę
// bramkę, której używa render.

describe('normalizeProjectDocumentUrl (bramka renderowania href)', () => {
  it('zwraca adres do href dla http(s) i dla adresu bez schematu', () => {
    expect(normalizeProjectDocumentUrl('https://example.test/a')).toBe('https://example.test/a');
    expect(normalizeProjectDocumentUrl('http://example.test/a')).toBe('http://example.test/a');
    expect(normalizeProjectDocumentUrl('  example.test/a  ')).toBe('https://example.test/a');
  });

  it('zwraca null dla adresu zapisanego wcześniej/przez chmurę z niedozwolonym schematem', () => {
    expect(normalizeProjectDocumentUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeProjectDocumentUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(normalizeProjectDocumentUrl('data:text/html,<script>')).toBeNull();
    expect(normalizeProjectDocumentUrl('')).toBeNull();
    expect(normalizeProjectDocumentUrl('   ')).toBeNull();
  });
});

// ---- Repair przy wczytaniu --------------------------------------------------

describe('repairProjectDocuments', () => {
  it('daje [] projektowi z zapisu sprzed pola (legacy) i zachowuje resztę', () => {
    const legacy = { ...project() } as Partial<Project>;
    delete legacy.documents;
    const data = { ...emptyData(), projects: [legacy as Project] };
    const repaired = repairProjectDocuments(data);
    expect(repaired.projects[0].documents).toEqual([]);
    expect(repaired.projects[0].name).toBe('Redesign strony');
  });

  it('koercjonuje wartość niebędącą tablicą do []', () => {
    const data = {
      ...emptyData(),
      projects: [{ ...project(), documents: 'oferta' as unknown as ProjectDocument[] }],
    };
    expect(repairProjectDocuments(data).projects[0].documents).toEqual([]);
  });

  it('odrzuca wiersze z niedozwolonym schematem i normalizuje adres bez schematu', () => {
    const data = {
      ...emptyData(),
      projects: [
        {
          ...project(),
          documents: [
            { id: 'zly', kind: 'link', label: 'XSS', url: 'javascript:alert(1)' },
            { id: 'dane', kind: 'link', label: 'Dane', url: 'data:text/html,<script>' },
            { id: 'plik', kind: 'link', label: 'Plik', url: 'file:///etc/passwd' },
            { id: 'bez', kind: 'link', label: 'Bez schematu', url: 'example.test/a' },
            { id: 'ok', kind: 'oferta', label: 'OK', url: 'https://example.test/b' },
          ] as unknown as ProjectDocument[],
        },
      ],
    };
    const documents = repairProjectDocuments(data).projects[0].documents;
    expect(documents.map((d) => d.id)).toEqual(['bez', 'ok']);
    expect(documents[0].url).toBe('https://example.test/a');
    expect(documents[1].url).toBe('https://example.test/b');
  });

  it('odrzuca wiersze bez adresu, normalizuje nieznany rodzaj i przycina wartości', () => {
    const data = {
      ...emptyData(),
      projects: [
        {
          ...project(),
          documents: [
            { id: 'a', kind: 'oferta', label: '  Oferta  ', url: '  https://x.test/a  ' },
            { id: 'b', kind: 'umowa', label: 'Bez rodzaju', url: 'https://x.test/b' },
            { id: 'c', kind: 'link', label: 'Bez adresu', url: '   ' },
            null,
            'nie-obiekt',
          ] as unknown as ProjectDocument[],
        },
      ],
    };
    const documents = repairProjectDocuments(data).projects[0].documents;
    expect(documents.map((d) => d.id)).toEqual(['a', 'b']);
    expect(documents[0]).toEqual({
      id: 'a',
      kind: 'oferta',
      label: 'Oferta',
      url: 'https://x.test/a',
    });
    expect(documents[1].kind).toBe('link'); // nieznany rodzaj -> domyślny
  });

  it('jest idempotentny po wartości', () => {
    const data = { ...emptyData(), projects: [project({ documents: [doc()] })] };
    const once = repairProjectDocuments(data);
    expect(repairProjectDocuments(once).projects).toEqual(once.projects);
  });

  it('ścieżka wczytania: zapis w bieżącej wersji bez `documents` wychodzi z []', () => {
    const legacy = { ...project() } as Partial<Project>;
    delete legacy.documents;
    const raw = JSON.stringify({ ...emptyData(), projects: [legacy], revision: 1 });
    const store = new Map<string, string>([[STORAGE_KEY, raw]]);
    const stub = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
    const prev = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = stub;
    try {
      const result = loadDataResult();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.projects[0].documents).toEqual([]);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = prev;
    }
  });
});

// ---- Round-trip przez chmurę ------------------------------------------------

describe('mirror + snapshot: round-trip dokumentów', () => {
  const maps = buildCloudIdMaps(emptyData(), {
    profile: null,
    departments: [],
    statuses: [],
    serviceTypes: [],
    workCategories: [],
    profiles: [],
  });

  it('diff wypycha kolumnę `documents`, a snapshot czyta ją z powrotem', async () => {
    const documents = [doc()];
    const prev = { ...emptyData(), projects: [project()] };
    const next = { ...emptyData(), projects: [project({ documents })] };
    const { ops } = diffToCloudOps(prev, next, maps);
    const upsert = ops.find((op) => op.table === 'projects');
    expect(upsert?.kind).toBe('upsert');
    const row = upsert?.kind === 'upsert' ? upsert.row : undefined;
    expect(row?.documents).toEqual(documents);

    // Ta sama wartość wraca ze snapshotu jako lokalna lista dokumentów.
    const db: Pick<PlannerDb, 'select'> = {
      async select(table: string) {
        if (table === 'projects') {
          return { rows: [{ ...row, start_date: '2026-07-06', end_date: '2026-07-12' }], error: null };
        }
        return { rows: [], error: null };
      },
    };
    const result = await loadPlannerSnapshot(db, maps, emptyData());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.projects[0].documents).toEqual(documents);
  });

  it('snapshot bez kolumny (starszy wiersz) czyta pustą listę', async () => {
    const db: Pick<PlannerDb, 'select'> = {
      async select(table: string) {
        if (table === 'projects') {
          return {
            rows: [
              {
                id: PROJECT_ID,
                name: 'P',
                description: '',
                start_date: '2026-07-06',
                end_date: '2026-07-12',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
            error: null,
          };
        }
        return { rows: [], error: null };
      },
    };
    const result = await loadPlannerSnapshot(db, maps, emptyData());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.projects[0].documents).toEqual([]);
  });
});
