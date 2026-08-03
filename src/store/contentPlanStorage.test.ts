// Granica localStorage dla modułu Content Plan: obecność slice'ów w emptyData,
// pass `repairContentPlan` i pełna ścieżka wczytania. Kolekcje są ADDYTYWNE —
// DATA_VERSION zostaje 7, a zapis sprzed modułu wczytuje się jako puste listy.
import { describe, expect, it } from 'vitest';
import { DATA_VERSION, emptyData, loadDataResult, repairContentPlan } from './storage';
import type { AppData, ContentPlanBrand, ContentPlanPost } from '../types';

const STORAGE_KEY = 'n2hub.data.v1';

function withLocalStorage<T>(initial: Record<string, string>, fn: () => T): T {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = stub;
  try {
    return fn();
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = prev;
  }
}

const withContentPlan = (brands: unknown[], posts: unknown[]): AppData => ({
  ...emptyData(),
  contentPlanBrands: brands as ContentPlanBrand[],
  contentPlanPosts: posts as ContentPlanPost[],
});

describe('emptyData', () => {
  it('zawiera puste kolekcje modułu bez podbijania DATA_VERSION', () => {
    expect(emptyData().contentPlanBrands).toEqual([]);
    expect(emptyData().contentPlanPosts).toEqual([]);
    expect(DATA_VERSION).toBe(7);
  });
});

describe('repairContentPlan', () => {
  it('nie rusza pozostałych kolekcji (zmienia wyłącznie swoje dwa slice’y)', () => {
    const data = emptyData();
    const repaired = repairContentPlan(data);
    expect(repaired.tasks).toBe(data.tasks);
    expect(repaired.events).toBe(data.events);
    expect(repaired.tickets).toBe(data.tickets);
  });

  it('nie-tablica w miejscu kolekcji naprawia się do pustych list', () => {
    const broken = {
      ...emptyData(),
      contentPlanBrands: null as unknown as ContentPlanBrand[],
      contentPlanPosts: 'zepsute' as unknown as ContentPlanPost[],
    };
    const repaired = repairContentPlan(broken);
    expect(repaired.contentPlanBrands).toEqual([]);
    expect(repaired.contentPlanPosts).toEqual([]);
  });

  it('odrzuca uszkodzone wiersze, zostawiając poprawne', () => {
    const repaired = repairContentPlan(
      withContentPlan(
        [{ id: '', name: 'Bez id' }, { id: 'b', name: '  Marka  ' }, null],
        [
          { id: 'p1', brandId: 'b', title: 'Zostaje', date: '2026-08-01' },
          { id: 'p2', brandId: 'b', title: 'Zła data', date: '2026-02-31' },
          'nie-obiekt',
        ],
      ),
    );
    expect(repaired.contentPlanBrands.map((b) => b.id)).toEqual(['b']);
    expect(repaired.contentPlanBrands[0].name).toBe('Marka');
    expect(repaired.contentPlanPosts.map((p) => p.id)).toEqual(['p1']);
  });

  it('nie kaskaduje między kolekcjami — publikacja osieroconej marki zostaje', () => {
    const repaired = repairContentPlan(
      withContentPlan([], [{ id: 'p1', brandId: 'usunieta', title: 'X', date: '2026-08-01' }]),
    );
    expect(repaired.contentPlanPosts).toHaveLength(1);
    expect(repaired.contentPlanPosts[0].brandId).toBe('usunieta');
  });

  it('ZDEJMUJE base64 z zapisu aplikacji źródłowej (żadnego podglądu w stanie)', () => {
    const repaired = repairContentPlan(
      withContentPlan(
        [{ id: 'b', name: 'Marka' }],
        [
          {
            id: 'p1',
            brandId: 'b',
            title: 'X',
            date: '2026-08-01',
            channels: [
              {
                id: 'c1',
                platformId: 'facebook',
                assetName: 'Post_1.jpg',
                assetPreview: 'data:image/png;base64,AAAA',
                assetWidth: 1080,
                assetHeight: 1350,
              },
            ],
          },
        ],
      ),
    );
    expect(JSON.stringify(repaired.contentPlanPosts)).not.toContain('base64');
    expect(repaired.contentPlanPosts[0].channels[0]).toEqual({
      id: 'c1',
      platformId: 'facebook',
      copy: '',
      tags: '',
      overrideTags: false,
    });
  });

  it('jest idempotentny (drugi przebieg nic nie zmienia)', () => {
    const once = repairContentPlan(
      withContentPlan(
        [{ id: 'b', name: ' Marka ', topics: [' A ', 'A'] }],
        [{ id: 'p1', brandId: 'b', title: ' X ', date: '2026-08-01', status: 'nieznany' }],
      ),
    );
    const twice = repairContentPlan(once);
    expect(twice.contentPlanBrands).toEqual(once.contentPlanBrands);
    expect(twice.contentPlanPosts).toEqual(once.contentPlanPosts);
  });
});

describe('ścieżka wczytania', () => {
  it('zapis sprzed modułu (bez slice’ów) wczytuje się z pustymi kolekcjami', () => {
    const { contentPlanBrands: _b, contentPlanPosts: _p, ...legacy } = emptyData();
    const result = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(legacy) }, () =>
      loadDataResult(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentPlanBrands).toEqual([]);
    expect(result.data.contentPlanPosts).toEqual([]);
    expect(result.data.version).toBe(DATA_VERSION);
  });

  it('uszkodzony slice modułu nie wywraca CAŁEGO payloadu', () => {
    const payload = {
      ...emptyData(),
      contentPlanBrands: null,
      contentPlanPosts: [
        { id: 'p1', brandId: 'b', title: 'Zostaje', date: '2026-08-01' },
        { id: 'p2', brandId: 'b', title: '', date: '2026-08-02' },
      ],
      currentUserId: 'p1',
    };
    const result = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(payload) }, () =>
      loadDataResult(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentPlanBrands).toEqual([]);
    expect(result.data.contentPlanPosts.map((p) => p.id)).toEqual(['p1']);
    expect(result.data.currentUserId).toBe('p1'); // reszta payloadu przeżywa
  });

  it('czysty zapis w bieżącej wersji z danymi modułu NIE wymaga echo-write', () => {
    const clean: AppData = {
      ...emptyData(),
      contentPlanBrands: [
        {
          id: 'b',
          name: 'Marka',
          industry: '',
          contact: '',
          accent: '',
          platforms: [{ id: 'facebook', name: 'Facebook', color: '#1f6fe5' }],
          topics: ['Edukacyjne'],
          formats: ['Post'],
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
      contentPlanPosts: [
        {
          id: 'p1',
          brandId: 'b',
          date: '2026-08-01',
          title: 'Tytuł',
          topic: 'Edukacyjne',
          format: 'Post',
          status: 'Zaplanowane',
          visibility: 'draft',
          baseTags: '#marka',
          channels: [
            {
              id: 'c1',
              platformId: 'facebook',
              copy: 'Opis',
              tags: '',
              overrideTags: false,
              media: { source: 'gdrive', fileId: 'plik-1', width: 1080, height: 1350, type: 'image' },
            },
          ],
          comments: [],
          history: [{ id: 'h1', label: 'Utworzono slot publikacji', at: '2026-08-01T10:00:00.000Z' }],
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
    };
    const result = withLocalStorage({ [STORAGE_KEY]: JSON.stringify(clean) }, () =>
      loadDataResult(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsWriteback).toBe(false);
    expect(result.data.contentPlanPosts[0].channels[0].media).toEqual({
      source: 'gdrive',
      fileId: 'plik-1',
      width: 1080,
      height: 1350,
      type: 'image',
    });
  });
});
