// Reduktor modułu Content Plan: SAVE_CP_BRAND / DELETE_CP_BRAND / SAVE_CP_POST
// / DELETE_CP_POST / REVIEW_CP_POST / PUBLISH_CP_MONTH / ADD_CP_COMMENT.
// Nacisk na INWARIANT 6 — każda odrzucona komenda musi zwrócić TĘ SAMĄ
// referencję stanu (nie kopię o równej wartości), a każda przyjęta NOWĄ.
import { describe, expect, it } from 'vitest';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData, ContentPlanBrand, ContentPlanPost } from '../types';
import type { ContentPlanBrandDraft, ContentPlanPostDraft } from '../contentplan/domain';

const BRAND_ID = 'tetra-wave';

function brand(overrides: Partial<ContentPlanBrand> = {}): ContentPlanBrand {
  return {
    id: BRAND_ID,
    name: 'Tetra Wave',
    industry: 'Technologie',
    contact: 'kontakt@tetra.pl',
    accent: '#0f5fb8',
    platforms: [
      { id: 'facebook', name: 'Facebook', color: '#1f6fe5' },
      { id: 'instagram', name: 'Instagram', color: '#7b4cc2' },
    ],
    topics: ['Edukacyjne'],
    formats: ['Post'],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function post(overrides: Partial<ContentPlanPost> = {}): ContentPlanPost {
  return {
    id: 'post-1',
    brandId: BRAND_ID,
    date: '2026-08-10',
    title: 'Premiera platformy',
    topic: 'Edukacyjne',
    format: 'Post',
    status: 'Zaplanowane',
    visibility: 'draft',
    baseTags: '#tetra',
    channels: [
      { id: 'c1', platformId: 'facebook', copy: 'Opis kanału', tags: '', overrideTags: false },
    ],
    comments: [],
    history: [{ id: 'h1', label: 'Utworzono slot publikacji', at: '2026-08-01T10:00:00.000Z' }],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function baseState(
  brands: ContentPlanBrand[] = [brand()],
  posts: ContentPlanPost[] = [],
): AppData {
  return { ...emptyData(), contentPlanBrands: brands, contentPlanPosts: posts };
}

function brandDraft(overrides: Partial<ContentPlanBrandDraft> = {}): ContentPlanBrandDraft {
  return {
    name: 'Tetra Wave',
    industry: 'Technologie',
    contact: 'kontakt@tetra.pl',
    accent: '#0f5fb8',
    platforms: [{ id: 'facebook', name: 'Facebook', color: '#1f6fe5' }],
    topics: ['Edukacyjne'],
    formats: ['Post'],
    ...overrides,
  };
}

function postDraft(overrides: Partial<ContentPlanPostDraft> = {}): ContentPlanPostDraft {
  return {
    brandId: BRAND_ID,
    date: '2026-08-10',
    title: 'Premiera platformy',
    topic: 'Edukacyjne',
    format: 'Post',
    status: 'Zaplanowane',
    visibility: 'draft',
    baseTags: '#tetra',
    channels: [
      { id: 'c1', platformId: 'facebook', copy: 'Opis kanału', tags: '', overrideTags: false },
    ],
    ...overrides,
  };
}

describe('SAVE_CP_BRAND', () => {
  it('tworzy markę ze slugiem z nazwy i znacznikami czasu', () => {
    const state = baseState([]);
    const next = reducer(state, {
      type: 'SAVE_CP_BRAND',
      brandId: null,
      draft: brandDraft({ name: '  Zażółć Gęślą  ' }),
    });
    expect(next).not.toBe(state);
    expect(next.contentPlanBrands).toHaveLength(1);
    const created = next.contentPlanBrands[0];
    expect(created.id).toBe('zazolc-gesla');
    expect(created.name).toBe('Zażółć Gęślą');
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('kolizja slugów daje kolejne id', () => {
    const state = baseState([brand({ id: 'tetra-wave' })]);
    const next = reducer(state, { type: 'SAVE_CP_BRAND', brandId: null, draft: brandDraft() });
    expect(next.contentPlanBrands[1].id).toBe('tetra-wave-2');
  });

  it('edycja zachowuje id i createdAt, odświeża updatedAt', () => {
    const existing = brand();
    const state = baseState([existing]);
    const next = reducer(state, {
      type: 'SAVE_CP_BRAND',
      brandId: existing.id,
      draft: brandDraft({ name: 'Tetra Wave Solutions' }),
    });
    const saved = next.contentPlanBrands[0];
    expect(saved.id).toBe(existing.id); // id nie idzie za nazwą — posty je trzymają
    expect(saved.name).toBe('Tetra Wave Solutions');
    expect(saved.createdAt).toBe(existing.createdAt);
    expect(saved.updatedAt).not.toBe(existing.updatedAt);
  });

  it.each([
    ['pusta nazwa', null, brandDraft({ name: '   ' })],
    ['platforma bez nazwy', null, brandDraft({ platforms: [{ id: 'x', name: '', color: '' }] })],
    ['nieznane id przy edycji', 'brak', brandDraft()],
  ])('odrzuca (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, brandId, draft) => {
    const state = baseState();
    expect(reducer(state, { type: 'SAVE_CP_BRAND', brandId, draft })).toBe(state);
  });
});

describe('DELETE_CP_BRAND', () => {
  it('usuwa markę razem z jej publikacjami, zostawiając cudze', () => {
    const other = post({ id: 'inny', brandId: 'inna-marka' });
    const state = baseState([brand(), brand({ id: 'inna-marka' })], [post(), other]);
    const next = reducer(state, { type: 'DELETE_CP_BRAND', brandId: BRAND_ID });
    expect(next.contentPlanBrands.map((b) => b.id)).toEqual(['inna-marka']);
    expect(next.contentPlanPosts.map((p) => p.id)).toEqual(['inny']);
  });

  it('nieznane id => ta sama referencja stanu', () => {
    const state = baseState();
    expect(reducer(state, { type: 'DELETE_CP_BRAND', brandId: 'brak' })).toBe(state);
  });
});

describe('SAVE_CP_POST', () => {
  it('tworzy publikację z pustymi komentarzami i jednym wpisem historii', () => {
    const state = baseState();
    const next = reducer(state, { type: 'SAVE_CP_POST', postId: null, draft: postDraft() });
    expect(next).not.toBe(state);
    const created = next.contentPlanPosts[0];
    expect(created.comments).toEqual([]);
    expect(created.history).toHaveLength(1);
    expect(created.history[0].label).toBe('Utworzono slot publikacji');
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('edycja zachowuje komentarze, createdAt i dokłada wpis historii na początek', () => {
    const existing = post({
      comments: [{ id: 'k1', author: 'Klient', body: 'Uwaga', at: '2026-08-02T10:00:00.000Z' }],
    });
    const state = baseState([brand()], [existing]);
    const next = reducer(state, {
      type: 'SAVE_CP_POST',
      postId: existing.id,
      draft: postDraft({ title: 'Nowy tytuł' }),
      historyLabel: 'Zmieniono tytuł',
    });
    const saved = next.contentPlanPosts[0];
    expect(saved.title).toBe('Nowy tytuł');
    expect(saved.comments).toBe(existing.comments);
    expect(saved.createdAt).toBe(existing.createdAt);
    expect(saved.history.map((h) => h.label)).toEqual([
      'Zmieniono tytuł',
      'Utworzono slot publikacji',
    ]);
  });

  it('pusta etykieta historii spada na domyślną polską', () => {
    const existing = post();
    const state = baseState([brand()], [existing]);
    const next = reducer(state, {
      type: 'SAVE_CP_POST',
      postId: existing.id,
      draft: postDraft(),
      historyLabel: '   ',
    });
    expect(next.contentPlanPosts[0].history[0].label).toBe('Zaktualizowano publikację');
  });

  it('udostępnia kompletną publikację', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SAVE_CP_POST',
      postId: null,
      draft: postDraft({ visibility: 'published' }),
    });
    expect(next.contentPlanPosts[0].visibility).toBe('published');
  });

  it.each([
    ['nieznana marka', postDraft({ brandId: 'brak' })],
    ['zła data', postDraft({ date: '2026-13-01' })],
    ['pusty tytuł', postDraft({ title: '  ' })],
    ['status spoza zbioru', postDraft({ status: 'Wymyślony' as ContentPlanPost['status'] })],
    [
      'udostępnienie bez opisu',
      postDraft({
        visibility: 'published',
        channels: [{ id: 'c1', platformId: 'facebook', copy: '  ', tags: '', overrideTags: false }],
      }),
    ],
    [
      'media base64 zamiast referencji do Drive',
      postDraft({
        channels: [
          {
            id: 'c1',
            platformId: 'facebook',
            copy: 'Opis',
            tags: '',
            overrideTags: false,
            media: {
              source: 'base64',
              fileId: 'data:image/png;base64,AA==',
              type: 'image',
            } as unknown as ContentPlanPost['channels'][number]['media'],
          },
        ],
      }),
    ],
  ])('odrzuca tworzenie (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, draft) => {
    const state = baseState();
    expect(reducer(state, { type: 'SAVE_CP_POST', postId: null, draft })).toBe(state);
  });

  it('nieznane postId => ta sama referencja stanu', () => {
    const state = baseState([brand()], [post()]);
    expect(reducer(state, { type: 'SAVE_CP_POST', postId: 'brak', draft: postDraft() })).toBe(state);
  });
});

describe('DELETE_CP_POST', () => {
  it('usuwa wskazaną publikację', () => {
    const state = baseState([brand()], [post()]);
    expect(reducer(state, { type: 'DELETE_CP_POST', postId: 'post-1' }).contentPlanPosts).toEqual(
      [],
    );
  });

  it('nieznane id => ta sama referencja stanu', () => {
    const state = baseState([brand()], [post()]);
    expect(reducer(state, { type: 'DELETE_CP_POST', postId: 'brak' })).toBe(state);
  });
});

describe('REVIEW_CP_POST', () => {
  it('ustawia status decyzji i dopisuje wpis historii z autorem', () => {
    const state = baseState([brand()], [post({ visibility: 'published' })]);
    const next = reducer(state, {
      type: 'REVIEW_CP_POST',
      postId: 'post-1',
      decision: 'Uwagi',
      author: 'Klient Tetra',
    });
    const reviewed = next.contentPlanPosts[0];
    expect(reviewed.status).toBe('Uwagi');
    expect(reviewed.history[0].label).toBe('Klient Tetra: zgłoszono uwagi');
    expect(reviewed.visibility).toBe('published'); // decyzja nie zmienia widoczności
  });

  it('akceptacja niesie własną polską etykietę', () => {
    const state = baseState([brand()], [post({ visibility: 'published' })]);
    const next = reducer(state, {
      type: 'REVIEW_CP_POST',
      postId: 'post-1',
      decision: 'Akceptacja',
      author: 'Klient',
    });
    expect(next.contentPlanPosts[0].history[0].label).toBe('Klient: zaakceptowano publikację');
  });

  it.each([
    ['nieznana publikacja', { postId: 'brak', decision: 'Uwagi' as const, author: 'Klient' }],
    [
      'status spoza decyzji',
      {
        postId: 'post-1',
        decision: 'Zaplanowane' as unknown as 'Uwagi',
        author: 'Klient',
      },
    ],
    ['pusty autor', { postId: 'post-1', decision: 'Uwagi' as const, author: '  ' }],
  ])('odrzuca (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, payload) => {
    const state = baseState([brand()], [post({ visibility: 'published' })]);
    expect(reducer(state, { type: 'REVIEW_CP_POST', ...payload })).toBe(state);
  });

  it('szkic nie podlega decyzji klienta => ta sama referencja stanu', () => {
    const state = baseState([brand()], [post({ visibility: 'draft' })]);
    expect(
      reducer(state, {
        type: 'REVIEW_CP_POST',
        postId: 'post-1',
        decision: 'Akceptacja',
        author: 'Klient',
      }),
    ).toBe(state);
  });
});

describe('PUBLISH_CP_MONTH', () => {
  it('udostępnia wszystkie szkice miesiąca i dopisuje historię', () => {
    const state = baseState(
      [brand()],
      [
        post({ id: 'a', date: '2026-08-03' }),
        post({ id: 'b', date: '2026-08-20' }),
        post({ id: 'c', date: '2026-09-01' }), // inny miesiąc
      ],
    );
    const next = reducer(state, {
      type: 'PUBLISH_CP_MONTH',
      brandId: BRAND_ID,
      monthKey: '2026-08',
    });
    expect(next.contentPlanPosts.map((p) => p.visibility)).toEqual([
      'published',
      'published',
      'draft',
    ]);
    expect(next.contentPlanPosts[0].history[0].label).toBe('Udostępniono miesiąc klientowi');
    expect(next.contentPlanPosts[2]).toBe(state.contentPlanPosts[2]); // nietknięty wiersz
  });

  it('jedna niekompletna publikacja blokuje CAŁY miesiąc (atomowo)', () => {
    const state = baseState(
      [brand()],
      [post({ id: 'a', date: '2026-08-03' }), post({ id: 'b', date: '2026-08-04', channels: [] })],
    );
    expect(
      reducer(state, { type: 'PUBLISH_CP_MONTH', brandId: BRAND_ID, monthKey: '2026-08' }),
    ).toBe(state);
  });

  it.each([
    ['nieznana marka', { brandId: 'brak', monthKey: '2026-08' }],
    ['niepoprawny klucz miesiąca', { brandId: BRAND_ID, monthKey: '2026-13' }],
    ['pusty miesiąc', { brandId: BRAND_ID, monthKey: '2026-12' }],
  ])('odrzuca (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, payload) => {
    const state = baseState([brand()], [post({ date: '2026-08-03' })]);
    expect(reducer(state, { type: 'PUBLISH_CP_MONTH', ...payload })).toBe(state);
  });

  it('miesiąc już udostępniony to no-op => ta sama referencja stanu', () => {
    const state = baseState([brand()], [post({ date: '2026-08-03', visibility: 'published' })]);
    expect(
      reducer(state, { type: 'PUBLISH_CP_MONTH', brandId: BRAND_ID, monthKey: '2026-08' }),
    ).toBe(state);
  });
});

describe('ADD_CP_COMMENT', () => {
  const published = () => post({ visibility: 'published' });

  it('dokłada komentarz na początek listy i wpis historii', () => {
    const state = baseState([brand()], [published()]);
    const next = reducer(state, {
      type: 'ADD_CP_COMMENT',
      postId: 'post-1',
      author: '  Klient  ',
      body: '  Proszę powiększyć logotyp.  ',
    });
    const [comment] = next.contentPlanPosts[0].comments;
    expect(comment.author).toBe('Klient');
    expect(comment.body).toBe('Proszę powiększyć logotyp.');
    expect(comment.parentId).toBeUndefined();
    expect(next.contentPlanPosts[0].history[0].label).toBe('Klient: dodał(a) komentarz');
  });

  it('odpowiedź wskazuje istniejący komentarz tej publikacji', () => {
    const withComment = post({
      visibility: 'published',
      comments: [{ id: 'k1', author: 'Klient', body: 'Pierwszy', at: '2026-08-02T10:00:00.000Z' }],
    });
    const state = baseState([brand()], [withComment]);
    const next = reducer(state, {
      type: 'ADD_CP_COMMENT',
      postId: 'post-1',
      author: 'Zespół',
      body: 'Poprawione',
      parentId: 'k1',
    });
    expect(next.contentPlanPosts[0].comments[0].parentId).toBe('k1');
    expect(next.contentPlanPosts[0].history[0].label).toBe('Zespół: dodał(a) odpowiedź');
  });

  it.each([
    ['nieznana publikacja', { postId: 'brak', author: 'Klient', body: 'Treść' }],
    ['pusta treść', { postId: 'post-1', author: 'Klient', body: '   ' }],
    ['pusty autor', { postId: 'post-1', author: '', body: 'Treść' }],
    ['rodzic spoza publikacji', { postId: 'post-1', author: 'Klient', body: 'T', parentId: 'brak' }],
    ['pusty rodzic', { postId: 'post-1', author: 'Klient', body: 'T', parentId: '  ' }],
  ])('odrzuca (%s) i zwraca TĘ SAMĄ referencję stanu', (_label, payload) => {
    const state = baseState([brand()], [published()]);
    expect(reducer(state, { type: 'ADD_CP_COMMENT', ...payload })).toBe(state);
  });

  it('szkic nie zbiera komentarzy => ta sama referencja stanu', () => {
    const state = baseState([brand()], [post({ visibility: 'draft' })]);
    expect(
      reducer(state, { type: 'ADD_CP_COMMENT', postId: 'post-1', author: 'Klient', body: 'T' }),
    ).toBe(state);
  });
});

describe('Izolacja modułu', () => {
  it('akcje Content Planu nie dotykają kolekcji planera ani dziennika aktywności', () => {
    const state = baseState();
    const next = reducer(state, { type: 'SAVE_CP_POST', postId: null, draft: postDraft() });
    expect(next.tasks).toBe(state.tasks);
    expect(next.workload).toBe(state.workload);
    expect(next.activity).toBe(state.activity);
    expect(next.activity).toHaveLength(0);
  });
});
