// Czysta logika widoku kalendarza Content Planu: wybór marki, rozłożenie
// publikacji na dni, liczniki nagłówka, model karty i ładunki kopiuj/wklej.
import { describe, expect, it } from 'vitest';
import {
  contentPlanBrandOptions,
  contentPlanCardView,
  contentPlanDaysWithPosts,
  contentPlanDecisionMetric,
  contentPlanEmptyDraft,
  contentPlanPasteDraft,
  contentPlanPlatformBreakdown,
  contentPlanReviewCount,
  resolveContentPlanBrandId,
} from './contentPlanCalendar';
import { monthKeyDays } from '../contentplan/domain';
import type { ContentPlanMonthStats } from '../store/selectors';
import type { ContentPlanBrand, ContentPlanPost, ContentPlanStatus } from '../types';

const BRAND_ID = 'tetra-wave';

function brand(overrides: Partial<ContentPlanBrand> = {}): ContentPlanBrand {
  return {
    id: BRAND_ID,
    name: 'Tetra Wave',
    industry: '',
    contact: '',
    accent: '',
    platforms: [
      { id: 'facebook', name: 'Facebook', color: '#1f6fe5' },
      { id: 'instagram', name: 'Instagram', color: '#7b4cc2' },
    ],
    topics: ['Edukacyjne', 'Sprzedażowe'],
    formats: ['Post', 'Rolka'],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function post(overrides: Partial<ContentPlanPost> = {}): ContentPlanPost {
  return {
    id: 'p1',
    brandId: BRAND_ID,
    date: '2026-08-10',
    title: 'Premiera platformy',
    topic: 'Edukacyjne',
    format: 'Post',
    status: 'Zaplanowane',
    visibility: 'draft',
    baseTags: '',
    channels: [{ id: 'c1', platformId: 'facebook', copy: 'Opis', tags: '', overrideTags: false }],
    comments: [],
    history: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function stats(overrides: Partial<ContentPlanMonthStats> = {}): ContentPlanMonthStats {
  const byStatus = {
    'Do akceptacji': 0,
    Uwagi: 0,
    Akceptacja: 0,
    Zaplanowane: 0,
    'W trakcie tworzenia': 0,
    'Wdrażane poprawki': 0,
    Opublikowano: 0,
  } as Record<ContentPlanStatus, number>;
  return { total: 0, published: 0, drafts: 0, byStatus, ...overrides };
}

describe('wybór marki', () => {
  it('sortuje marki polską kolacją', () => {
    const brands = [brand({ id: 'z', name: 'Żubr' }), brand({ id: 'l', name: 'Łosoś' }), brand({ id: 'a', name: 'Alfa' })];
    expect(contentPlanBrandOptions(brands).map((o) => o.name)).toEqual(['Alfa', 'Łosoś', 'Żubr']);
  });

  it('zostaje przy żądanej marce, dopóki istnieje', () => {
    const brands = [brand({ id: 'a', name: 'Alfa' }), brand({ id: 'b', name: 'Beta' })];
    expect(resolveContentPlanBrandId(brands, 'b')).toBe('b');
  });

  it('spada na pierwszą markę przy braku żądania albo po jej usunięciu', () => {
    const brands = [brand({ id: 'b', name: 'Beta' }), brand({ id: 'a', name: 'Alfa' })];
    expect(resolveContentPlanBrandId(brands, '')).toBe('a');
    expect(resolveContentPlanBrandId(brands, 'usunieta')).toBe('a');
  });

  it('bez marek zwraca pusty identyfikator', () => {
    expect(resolveContentPlanBrandId([], 'cokolwiek')).toBe('');
  });
});

describe('contentPlanDaysWithPosts', () => {
  it('rozkłada publikacje na dni miesiąca, zachowując kolejność wejścia', () => {
    const days = monthKeyDays('2026-08');
    const grid = contentPlanDaysWithPosts(days, [
      post({ id: 'drugi', date: '2026-08-10' }),
      post({ id: 'pierwszy', date: '2026-08-10' }),
      post({ id: 'inny', date: '2026-08-01' }),
    ]);
    expect(grid).toHaveLength(31);
    expect(grid[0].posts.map((p) => p.id)).toEqual(['inny']);
    expect(grid[9].posts.map((p) => p.id)).toEqual(['drugi', 'pierwszy']);
    expect(grid[9].day).toBe(10);
  });

  it('dzień bez publikacji dostaje pustą listę, a publikacja spoza siatki nie gubi dnia', () => {
    const grid = contentPlanDaysWithPosts(monthKeyDays('2026-08'), [
      post({ id: 'wrzesien', date: '2026-09-01' }),
    ]);
    expect(grid).toHaveLength(31);
    expect(grid.every((day) => day.posts.length === 0)).toBe(true);
  });

  it('niepoprawny klucz miesiąca => brak dni', () => {
    expect(contentPlanDaysWithPosts(monthKeyDays('2026-13'), [post()])).toEqual([]);
  });
});

describe('liczniki miesiąca', () => {
  it('liczy publikacje czekające na decyzję klienta', () => {
    const s = stats({
      byStatus: { ...stats().byStatus, 'Do akceptacji': 2, Uwagi: 1, Zaplanowane: 5 },
    });
    expect(contentPlanReviewCount(s)).toBe(3);
  });

  it('trzeci licznik pokazuje decyzje, gdy jakiekolwiek są', () => {
    const s = stats({
      total: 6,
      drafts: 4,
      byStatus: { ...stats().byStatus, Uwagi: 2 },
    });
    expect(contentPlanDecisionMetric(s)).toEqual({ value: 2, label: 'wymaga decyzji' });
  });

  it('bez decyzji trzeci licznik pokazuje szkice', () => {
    const s = stats({ total: 6, drafts: 4 });
    expect(contentPlanDecisionMetric(s)).toEqual({ value: 4, label: 'robocze' });
  });

  it('rozkład kanałów liczy KANAŁY i pomija platformy bez ani jednego', () => {
    const rows = contentPlanPlatformBreakdown(brand(), [
      post({
        id: 'a',
        channels: [
          { id: 'c1', platformId: 'facebook', copy: '', tags: '', overrideTags: false },
          { id: 'c2', platformId: 'instagram', copy: '', tags: '', overrideTags: false },
        ],
      }),
      post({ id: 'b' }),
    ]);
    expect(rows.map(({ platform, count }) => [platform.id, count])).toEqual([
      ['facebook', 2],
      ['instagram', 1],
    ]);
  });
});

describe('contentPlanCardView', () => {
  it('zbiera platformy bez powtórzeń, pierwszy niepusty opis i obecność tagów', () => {
    const view = contentPlanCardView(
      brand(),
      post({
        baseTags: '#tetra',
        channels: [
          { id: 'c1', platformId: 'facebook', copy: '   ', tags: '', overrideTags: false },
          { id: 'c2', platformId: 'facebook', copy: 'Drugi opis', tags: '', overrideTags: false },
          { id: 'c3', platformId: 'instagram', copy: 'Trzeci', tags: '', overrideTags: false },
        ],
      }),
    );
    expect(view.platforms.map((p) => p.id)).toEqual(['facebook', 'instagram']);
    expect(view.primaryCopy).toBe('Drugi opis');
    expect(view.hasTags).toBe(true);
  });

  it('bez opisu i bez tagów zwraca puste wartości', () => {
    const view = contentPlanCardView(brand(), post({ baseTags: '  ', channels: [] }));
    expect(view.platforms).toEqual([]);
    expect(view.primaryCopy).toBe('');
    expect(view.hasTags).toBe(false);
    expect(view.mediaFileId).toBe('');
    expect(view.ratioLabel).toBeNull();
  });

  it('bierze plik pierwszego kanału z mediami wraz z proporcją', () => {
    const view = contentPlanCardView(
      brand(),
      post({
        format: 'Rolka',
        channels: [
          { id: 'c1', platformId: 'facebook', copy: '', tags: '', overrideTags: false },
          {
            id: 'c2',
            platformId: 'instagram',
            copy: '',
            tags: '',
            overrideTags: false,
            media: { source: 'gdrive', fileId: 'plik-1', width: 1080, height: 1350, type: 'image' },
          },
        ],
      }),
    );
    expect(view.mediaFileId).toBe('plik-1');
    expect(view.isVideo).toBe(false);
    expect(view.ratioLabel).toBe('4:5');
    expect(view.aspectRatio).toBe('1080 / 1350');
  });

  it('bez wymiarów proporcja spada na format publikacji', () => {
    const view = contentPlanCardView(
      brand(),
      post({
        format: 'Rolka',
        channels: [
          {
            id: 'c1',
            platformId: 'facebook',
            copy: '',
            tags: '',
            overrideTags: false,
            media: { source: 'gdrive', fileId: 'film', type: 'video' },
          },
        ],
      }),
    );
    expect(view.isVideo).toBe(true);
    expect(view.ratioLabel).toBeNull();
    expect(view.aspectRatio).toBe('9 / 16');
  });

  it('kanał osierocony przez zmianę słownika nadal ma pigułkę platformy', () => {
    const view = contentPlanCardView(
      brand(),
      post({
        channels: [{ id: 'c1', platformId: 'znikla', copy: '', tags: '', overrideTags: false }],
      }),
    );
    expect(view.platforms.map((p) => p.id)).toEqual(['facebook']);
  });
});

describe('drafty kalendarza', () => {
  it('pusty slot bierze pierwszą platformę, temat i format marki', () => {
    const draft = contentPlanEmptyDraft(brand(), '2026-08-07');
    expect(draft.brandId).toBe(BRAND_ID);
    expect(draft.date).toBe('2026-08-07');
    expect(draft.topic).toBe('Edukacyjne');
    expect(draft.format).toBe('Post');
    expect(draft.status).toBe('W trakcie tworzenia');
    expect(draft.visibility).toBe('draft');
    expect(draft.channels.map((c) => c.platformId)).toEqual(['facebook']);
  });

  it('wklejenie przenosi treść na nowy dzień ze świeżymi id kanałów', () => {
    let n = 0;
    const draft = contentPlanPasteDraft(
      post({
        status: 'Opublikowano',
        visibility: 'published',
        baseTags: '#tetra',
        channels: [
          { id: 'c1', platformId: 'facebook', copy: 'Opis FB', tags: '', overrideTags: false },
          { id: 'c2', platformId: 'instagram', copy: 'Opis IG', tags: '#ig', overrideTags: true },
        ],
      }),
      brand(),
      '2026-08-20',
      () => `nowe-${(n += 1)}`,
    );
    expect(draft.date).toBe('2026-08-20');
    expect(draft.title).toBe('Premiera platformy');
    expect(draft.baseTags).toBe('#tetra');
    expect(draft.channels.map((c) => [c.id, c.platformId, c.copy])).toEqual([
      ['nowe-1', 'facebook', 'Opis FB'],
      ['nowe-2', 'instagram', 'Opis IG'],
    ]);
  });

  it('kopia zawsze startuje jako szkic w statusie roboczym', () => {
    const draft = contentPlanPasteDraft(
      post({ status: 'Opublikowano', visibility: 'published' }),
      brand(),
      '2026-08-20',
      () => 'x',
    );
    expect(draft.status).toBe('W trakcie tworzenia');
    expect(draft.visibility).toBe('draft');
  });

  it('temat i format spoza słownika marki spadają na pierwszą wartość', () => {
    const draft = contentPlanPasteDraft(
      post({ topic: 'Nieistniejący', format: 'Nieznany' }),
      brand(),
      '2026-08-20',
      () => 'x',
    );
    expect(draft.topic).toBe('Edukacyjne');
    expect(draft.format).toBe('Post');
  });

  it('kanał spoza słownika marki odpada, a pusty wynik zastępuje pierwsza platforma', () => {
    let n = 0;
    const draft = contentPlanPasteDraft(
      post({
        channels: [
          { id: 'c1', platformId: 'tiktok', copy: 'Opis TikTok', tags: '', overrideTags: false },
        ],
      }),
      brand(),
      '2026-08-20',
      () => `nowe-${(n += 1)}`,
    );
    expect(draft.channels).toEqual([
      {
        id: 'nowe-1',
        platformId: 'facebook',
        copy: 'Opis TikTok',
        tags: '',
        overrideTags: false,
      },
    ]);
  });

  it('marka bez platform daje draft bez kanałów (nie da się go udostępnić)', () => {
    const draft = contentPlanPasteDraft(post(), brand({ platforms: [], topics: [], formats: [] }), '2026-08-20', () => 'x');
    expect(draft.channels).toEqual([]);
    expect(draft.topic).toBe('');
    expect(draft.format).toBe('');
  });
});
