// Czysta logika edytora marki: słowniki po przecinku, dopasowanie platform po
// nazwie i GUARD integralności referencyjnej. PORT PRZEPŁYWÓW z testów RTL
// aplikacji źródłowej („nie pozwala rozłączyć słowników z używanymi
// publikacjami", „dodaje markę i przełącza planner na nową markę") — repo
// testuje w środowisku `node`, więc przepływ sprawdzamy tam, gdzie mieszka
// jego logika.
import { describe, expect, it } from 'vitest';
import {
  brandDeleteConsequence,
  brandFormDictionaries,
  brandFormToDraft,
  brandNameIssue,
  brandPostCount,
  buildBrandForm,
  dictionaryIntegrityIssue,
  EMPTY_DICTIONARY_MESSAGE,
  formatDictionary,
  parseDictionary,
  resolvePlatforms,
} from './contentPlanBrandEditor';
import { normalizeContentPlanBrandDraft } from '../contentplan/domain';
import type { ContentPlanBrand, ContentPlanPost } from '../types';

const BRAND_ID = 'tetra-wave';

function brand(overrides: Partial<ContentPlanBrand> = {}): ContentPlanBrand {
  return {
    id: BRAND_ID,
    name: 'Tetra Wave',
    industry: 'Technologia',
    contact: 'kontakt@tetra.pl',
    accent: '#305f72',
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
    designBrief: '',
    channels: [{ id: 'c1', platformId: 'instagram', copy: 'Opis', tags: '', overrideTags: false }],
    comments: [],
    history: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('parseDictionary', () => {
  it('przycina, odrzuca puste i usuwa powtórzenia', () => {
    expect(parseDictionary(' Post , , Rolka ,Post,  ')).toEqual(['Post', 'Rolka']);
  });

  it('pusty tekst daje pusty słownik', () => {
    expect(parseDictionary('   ')).toEqual([]);
  });

  it('jest odwrotnością formatDictionary dla poprawnego słownika', () => {
    expect(parseDictionary(formatDictionary(['Post', 'Story']))).toEqual(['Post', 'Story']);
  });
});

describe('resolvePlatforms', () => {
  it('dopasowanie po nazwie (bez względu na wielkość liter) ZACHOWUJE id i kolor', () => {
    const platforms = resolvePlatforms(brand().platforms, ['instagram', 'FACEBOOK']);
    expect(platforms).toEqual([
      { id: 'instagram', name: 'Instagram', color: '#7b4cc2' },
      { id: 'facebook', name: 'Facebook', color: '#1f6fe5' },
    ]);
  });

  it('nowa nazwa dostaje slug id i kolor z cyklu', () => {
    const platforms = resolvePlatforms([], ['Facebook', 'Instagram', 'LinkedIn', 'X', 'Wątki']);
    expect(platforms.map((platform) => platform.id)).toEqual([
      'facebook',
      'instagram',
      'linkedin',
      'x',
      'watki',
    ]);
    expect(platforms.map((platform) => platform.color)).toEqual([
      '#1f6fe5',
      '#7b4cc2',
      '#0a66c2',
      '#111827',
      '#1f6fe5',
    ]);
  });

  it('kolizja sluga dostaje sufiks antykolizyjny', () => {
    const platforms = resolvePlatforms(
      [{ id: 'x', name: 'Iks', color: '#111827' }],
      ['Iks', 'X', 'X!'],
    );
    expect(platforms.map((platform) => platform.id)).toEqual(['x', 'x-2', 'x-3']);
    // Istniejąca pozycja zachowuje swoją nazwę i kolor.
    expect(platforms[0]).toEqual({ id: 'x', name: 'Iks', color: '#111827' });
  });
});

describe('dictionaryIntegrityIssue', () => {
  const next = (overrides: Partial<Parameters<typeof dictionaryIntegrityIssue>[2]> = {}) => ({
    platforms: brand().platforms,
    topics: brand().topics,
    formats: brand().formats,
    ...overrides,
  });

  it('komplet słowników z używanymi pozycjami przechodzi', () => {
    expect(dictionaryIntegrityIssue(brand(), [post()], next())).toBeNull();
  });

  it('nie pozwala usunąć używanej PLATFORMY', () => {
    const issue = dictionaryIntegrityIssue(brand(), [post()], next({
      platforms: [{ id: 'facebook', name: 'Facebook', color: '#1f6fe5' }],
    }));
    expect(issue).toBe(
      'Nie można usunąć używanej pozycji (platforma). Najpierw zmień przypisane publikacje.',
    );
  });

  it('nie pozwala usunąć używanego TEMATU', () => {
    const issue = dictionaryIntegrityIssue(brand(), [post()], next({ topics: ['Sprzedażowe'] }));
    expect(issue).toContain('(temat)');
  });

  it('nie pozwala usunąć używanego TYPU publikacji', () => {
    const issue = dictionaryIntegrityIssue(brand(), [post()], next({ formats: ['Rolka'] }));
    expect(issue).toContain('(typ publikacji)');
  });

  it('pusty słownik blokuje zapis niezależnie od publikacji', () => {
    expect(dictionaryIntegrityIssue(brand(), [], next({ topics: [] }))).toBe(
      EMPTY_DICTIONARY_MESSAGE,
    );
    expect(dictionaryIntegrityIssue(brand(), [], next({ platforms: [] }))).toBe(
      EMPTY_DICTIONARY_MESSAGE,
    );
    expect(dictionaryIntegrityIssue(brand(), [], next({ formats: [] }))).toBe(
      EMPTY_DICTIONARY_MESSAGE,
    );
  });

  it('publikacje INNEJ marki nie blokują słowników tej marki', () => {
    const foreign = post({ id: 'p2', brandId: 'inna-marka' });
    expect(
      dictionaryIntegrityIssue(brand(), [foreign], next({ platforms: [], topics: ['A'] })),
    ).toBe(EMPTY_DICTIONARY_MESSAGE);
    expect(
      dictionaryIntegrityIssue(brand(), [foreign], next({ topics: ['Sprzedażowe'] })),
    ).toBeNull();
  });

  it('pusty temat/format publikacji nie liczy się jako użycie', () => {
    const bare = post({ topic: '', format: '' });
    expect(
      dictionaryIntegrityIssue(brand(), [bare], next({ topics: ['Inne'], formats: ['Inne'] })),
    ).toBeNull();
  });
});

describe('formularz marki', () => {
  it('nowa marka startuje z domyślnymi słownikami i akcentem', () => {
    const form = buildBrandForm();
    expect(form.name).toBe('');
    expect(form.accent).toBe('#305f72');
    expect(form.platformsText).toBe('Facebook, Instagram');
    expect(form.topicsText).toBe('Edukacyjne, Oferta, Lifestyle');
    expect(form.formatsText).toBe('Post, Story, Rolka');
  });

  it('istniejąca marka wchodzi do formularza w całości', () => {
    const form = buildBrandForm(brand());
    expect(form).toEqual({
      name: 'Tetra Wave',
      industry: 'Technologia',
      contact: 'kontakt@tetra.pl',
      accent: '#305f72',
      platformsText: 'Facebook, Instagram',
      topicsText: 'Edukacyjne, Sprzedażowe',
      formatsText: 'Post, Rolka',
    });
  });

  it('marka bez akcentu dostaje kolor startowy (kontrolka koloru nie zna pustki)', () => {
    expect(buildBrandForm(brand({ accent: '' })).accent).toBe('#305f72');
  });

  it('draft nowej marki przechodzi normalizację reduktora', () => {
    const form = { ...buildBrandForm(), name: '  Marka QA  ', industry: 'Testy' };
    const draft = brandFormToDraft(form, []);

    expect(draft.name).toBe('Marka QA');
    expect(draft.platforms.map((platform) => platform.id)).toEqual(['facebook', 'instagram']);
    expect(normalizeContentPlanBrandDraft(draft)).not.toBeNull();
  });

  it('zmiana nazwy platformy zachowuje jej id (kanały publikacji nie sierocieją)', () => {
    const form = { ...buildBrandForm(brand()), platformsText: 'Facebook, Instagram, LinkedIn' };
    const dictionaries = brandFormDictionaries(form, brand().platforms);

    expect(dictionaries.platforms.map((platform) => platform.id)).toEqual([
      'facebook',
      'instagram',
      'linkedin',
    ]);
    expect(dictionaryIntegrityIssue(brand(), [post()], dictionaries)).toBeNull();
  });

  it('pusta nazwa blokuje zapis, a odrzucony draft nie przechodzi normalizacji', () => {
    expect(brandNameIssue('   ')).toBe('Nazwa marki jest wymagana.');
    expect(brandNameIssue('Marka')).toBeNull();
    expect(normalizeContentPlanBrandDraft(brandFormToDraft(buildBrandForm(), []))).toBeNull();
  });
});

describe('usunięcie marki', () => {
  it('liczy publikacje wyłącznie tej marki', () => {
    const posts = [post(), post({ id: 'p2' }), post({ id: 'p3', brandId: 'inna' })];
    expect(brandPostCount(BRAND_ID, posts)).toBe(2);
  });

  it('odmienia liczbę publikacji po polsku', () => {
    expect(brandDeleteConsequence(0)).toBe('Ta marka nie ma jeszcze publikacji.');
    expect(brandDeleteConsequence(1)).toBe('To usunie 1 publikację tej marki.');
    expect(brandDeleteConsequence(3)).toBe('To usunie 3 publikacje tej marki.');
    expect(brandDeleteConsequence(12)).toBe('To usunie 12 publikacji tej marki.');
  });
});
