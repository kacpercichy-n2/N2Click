// Selektory modułu Content Plan: publikacje marki w miesiącu + liczniki
// statusów. Poza wartościami sprawdzamy PAMIĘTANIE PO REFERENCJI (ta sama
// referencja stanu ⇒ ten sam wynik), bo na tym stoi memoizacja widoków.
import { describe, expect, it } from 'vitest';
import { contentPlanMonthStats, contentPlanPostsForMonth } from './selectors';
import { emptyData } from './storage';
import { reducer } from './AppStore';
import type { AppData, ContentPlanBrand, ContentPlanPost } from '../types';

const BRAND_ID = 'tetra-wave';

const brand = (id = BRAND_ID): ContentPlanBrand => ({
  id,
  name: 'Tetra Wave',
  industry: '',
  contact: '',
  accent: '',
  platforms: [{ id: 'facebook', name: 'Facebook', color: '#1f6fe5' }],
  topics: ['Edukacyjne'],
  formats: ['Post'],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
});

const post = (overrides: Partial<ContentPlanPost> = {}): ContentPlanPost => ({
  id: 'p1',
  brandId: BRAND_ID,
  date: '2026-08-10',
  title: 'Tytuł',
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
});

function state(posts: ContentPlanPost[]): AppData {
  return { ...emptyData(), contentPlanBrands: [brand(), brand('inna')], contentPlanPosts: posts };
}

describe('contentPlanPostsForMonth', () => {
  it('filtruje po marce i miesiącu, sortując rosnąco po dacie', () => {
    const s = state([
      post({ id: 'b', date: '2026-08-20' }),
      post({ id: 'a', date: '2026-08-02' }),
      post({ id: 'wrzesien', date: '2026-09-01' }),
      post({ id: 'obca', date: '2026-08-05', brandId: 'inna' }),
    ]);
    expect(contentPlanPostsForMonth(s, BRAND_ID, '2026-08').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('sortowanie jest stabilne — ten sam dzień zachowuje kolejność kolekcji', () => {
    const s = state([
      post({ id: 'drugi', date: '2026-08-10' }),
      post({ id: 'pierwszy', date: '2026-08-10' }),
    ]);
    expect(contentPlanPostsForMonth(s, BRAND_ID, '2026-08').map((p) => p.id)).toEqual([
      'drugi',
      'pierwszy',
    ]);
  });

  it.each([
    ['nieznana marka', 'brak', '2026-08'],
    ['pusta marka', '', '2026-08'],
    ['niepoprawny klucz miesiąca', BRAND_ID, '2026-13'],
    ['miesiąc bez publikacji', BRAND_ID, '2026-12'],
  ])('daje pustą listę (%s)', (_label, brandId, monthKey) => {
    expect(contentPlanPostsForMonth(state([post()]), brandId, monthKey)).toEqual([]);
  });

  it('ta sama referencja stanu daje TĘ SAMĄ referencję wyniku', () => {
    const s = state([post()]);
    expect(contentPlanPostsForMonth(s, BRAND_ID, '2026-08')).toBe(
      contentPlanPostsForMonth(s, BRAND_ID, '2026-08'),
    );
  });

  it('odrzucona komenda (inwariant 6) nie wychładza wyniku selektora', () => {
    const s = state([post()]);
    const before = contentPlanPostsForMonth(s, BRAND_ID, '2026-08');
    const after = reducer(s, { type: 'DELETE_CP_POST', postId: 'brak' });
    expect(after).toBe(s);
    expect(contentPlanPostsForMonth(after, BRAND_ID, '2026-08')).toBe(before);
  });

  it('przyjęta komenda przelicza wynik', () => {
    const s = state([post()]);
    const next = reducer(s, { type: 'DELETE_CP_POST', postId: 'p1' });
    expect(contentPlanPostsForMonth(next, BRAND_ID, '2026-08')).toEqual([]);
  });
});

describe('contentPlanMonthStats', () => {
  it('liczy sumy widoczności i każdy z siedmiu statusów', () => {
    const s = state([
      post({ id: 'a', status: 'Do akceptacji', visibility: 'published' }),
      post({ id: 'b', status: 'Do akceptacji' }),
      post({ id: 'c', status: 'Opublikowano', visibility: 'published' }),
      post({ id: 'obcy-miesiac', date: '2026-09-01', status: 'Uwagi' }),
    ]);
    const stats = contentPlanMonthStats(s, BRAND_ID, '2026-08');
    expect(stats).toMatchObject({ total: 3, published: 2, drafts: 1 });
    expect(stats.byStatus['Do akceptacji']).toBe(2);
    expect(stats.byStatus.Opublikowano).toBe(1);
    expect(stats.byStatus.Uwagi).toBe(0);
    expect(Object.keys(stats.byStatus)).toHaveLength(7);
  });

  it('pusty miesiąc daje same zera', () => {
    const stats = contentPlanMonthStats(state([]), BRAND_ID, '2026-08');
    expect(stats).toMatchObject({ total: 0, published: 0, drafts: 0 });
    expect(Object.values(stats.byStatus).every((count) => count === 0)).toBe(true);
  });

  it('ta sama referencja stanu daje TĘ SAMĄ referencję wyniku', () => {
    const s = state([post()]);
    expect(contentPlanMonthStats(s, BRAND_ID, '2026-08')).toBe(
      contentPlanMonthStats(s, BRAND_ID, '2026-08'),
    );
  });
});
