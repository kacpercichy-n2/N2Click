// Czysta domena modułu Content Plan — port testów jednostkowych z aplikacji
// źródłowej ("Content plan/tests/unit/domain.test.ts") na model N2Hub.
//
// CO ZNIKŁO W PORCIE (świadomie): asercje wokół base64 — `readFileAsDataUrl`,
// `readAssetFile`, `validateAssetFile` i limit 4 MB nie mają odpowiednika, bo
// media są WYŁĄCZNIE referencją do Google Drive. Testy proporcji przeszły na
// nowy kształt `{ source: 'gdrive', fileId, width?, height?, type }`.
// CO DOSZŁO: klucz miesiąca (walidacja/przesunięcie), normalizacja draftów i
// sanityzacja wczytania — obie granice, na których stoi inwariant 6 i repair.
import { describe, expect, it } from 'vitest';
import type { ContentPlanBrand, ContentPlanChannel, ContentPlanComment, ContentPlanPost } from '../types';
import {
  CONTENT_PLAN_STATUSES,
  DEFAULT_POST_TITLE,
  MAIN_DESCRIPTION_GROUP,
  brandSlug,
  commentRepliesByParent,
  fallbackAspectRatio,
  flattenCommentReplies,
  formatCommentDate,
  gcd,
  getDescriptionGroups,
  groupTags,
  isContentPlanStatus,
  isMonthKey,
  isPostInMonth,
  makeEmptyPost,
  mediaAspectRatio,
  mediaRatioLabel,
  monthKeyDays,
  monthKeyLabel,
  monthKeyOf,
  normalizeContentPlanBrandDraft,
  normalizeContentPlanChannels,
  normalizeContentPlanPostDraft,
  platformFor,
  sanitizeContentPlanBrands,
  sanitizeContentPlanPosts,
  shiftMonthKey,
  uniqueBrandId,
  validatePostForPublication,
} from './domain';

const testBrand: ContentPlanBrand = {
  id: 'marka-testowa',
  name: 'Marka testowa',
  industry: 'Usługi',
  contact: 'test@example.test',
  accent: '#005c99',
  platforms: [
    { id: 'facebook', name: 'Facebook', color: '#1f6fe5' },
    { id: 'instagram', name: 'Instagram', color: '#7b4cc2' },
  ],
  topics: ['Edukacyjne', 'Oferta'],
  formats: ['Post', 'Story', 'Rolka'],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const testChannel = (overrides: Partial<ContentPlanChannel> = {}): ContentPlanChannel => ({
  id: 'kanal-1',
  platformId: 'facebook',
  copy: 'Opis testowy',
  tags: '',
  overrideTags: false,
  ...overrides,
});

const testComment = (overrides: Partial<ContentPlanComment> = {}): ContentPlanComment => ({
  id: 'komentarz-1',
  author: 'Klient',
  body: 'Uwagi klienta',
  at: '2024-02-15T10:00:00.000Z',
  ...overrides,
});

const testPost = (overrides: Partial<ContentPlanPost> = {}): ContentPlanPost => ({
  id: 'post-1',
  brandId: testBrand.id,
  date: '2024-02-15',
  title: 'Post testowy',
  topic: 'Edukacyjne',
  format: 'Post',
  status: 'Do akceptacji',
  visibility: 'draft',
  baseTags: '#marka #test',
  channels: [testChannel()],
  comments: [],
  history: [],
  createdAt: '2024-02-10T10:00:00.000Z',
  updatedAt: '2024-02-10T10:00:00.000Z',
  ...overrides,
});

describe('Statusy publikacji', () => {
  it('ma dokładnie siedem polskich statusów w kolejności prezentacji', () => {
    expect(CONTENT_PLAN_STATUSES).toEqual([
      'Do akceptacji',
      'Uwagi',
      'Akceptacja',
      'Zaplanowane',
      'W trakcie tworzenia',
      'Wdrażane poprawki',
      'Opublikowano',
    ]);
  });

  it('rozpoznaje tylko wartości ze zbioru (także wobec pól prototypu)', () => {
    expect(isContentPlanStatus('Uwagi')).toBe(true);
    expect(isContentPlanStatus('Wymyślony')).toBe(false);
    expect(isContentPlanStatus('toString')).toBe(false);
    expect(isContentPlanStatus(undefined)).toBe(false);
  });
});

describe('Kalendarz publikacji', () => {
  it('wyznacza 29 dni lutego w roku przestępnym wraz z poprawnym ISO', () => {
    const days = monthKeyDays('2024-02');

    expect(days).toHaveLength(29);
    expect(days[0]).toMatchObject({ date: '2024-02-01', day: 1 });
    expect(days[days.length - 1]).toMatchObject({ date: '2024-02-29', day: 29 });
    expect(days[0].weekday).not.toBe('');
  });

  it('wyznacza 28 dni lutego w roku nieprzestępnym', () => {
    expect(monthKeyDays('2023-02')).toHaveLength(28);
  });

  it('formatuje klucz i etykietę miesiąca po polsku', () => {
    expect(monthKeyOf('2024-11-05')).toBe('2024-11');
    expect(monthKeyLabel('2024-11')).toBe('Listopad 2024');
  });

  it('przesuwa klucz miesiąca przez granicę roku', () => {
    expect(shiftMonthKey('2024-01', -1)).toBe('2023-12');
    expect(shiftMonthKey('2024-12', 1)).toBe('2025-01');
  });

  it.each([
    ['2024-13', false],
    ['2024-00', false],
    ['2024-1', false],
    ['2024-02-01', false],
    ['', false],
    ['2024-02', true],
  ])('rozpoznaje klucz miesiąca %s => %s', (value, expected) => {
    expect(isMonthKey(value)).toBe(expected);
  });

  it('niepoprawne wejście nigdy nie rzuca — daje pustą listę albo pusty string', () => {
    expect(monthKeyDays('2024-13')).toEqual([]);
    expect(monthKeyLabel('nie-klucz')).toBe('');
    expect(monthKeyOf('2024-02-31')).toBe('');
    expect(shiftMonthKey('nie-klucz', 1)).toBe('');
  });

  it('przypisuje publikację do miesiąca po prefiksie daty', () => {
    expect(isPostInMonth(testPost({ date: '2024-02-29' }), '2024-02')).toBe(true);
    expect(isPostInMonth(testPost({ date: '2024-03-01' }), '2024-02')).toBe(false);
  });
});

describe('Media i proporcje', () => {
  it('oblicza NWD i skróconą proporcję pliku z Drive', () => {
    expect(gcd(1080, 1350)).toBe(270);
    expect(
      mediaRatioLabel(
        testChannel({
          media: { source: 'gdrive', fileId: 'plik-1', width: 1080, height: 1350, type: 'image' },
        }),
      ),
    ).toBe('4:5');
  });

  it.each([
    ['Story', '9 / 16'],
    ['Rolka', '9 / 16'],
    ['Video', '16 / 9'],
    ['Karuzela', '4 / 5'],
    ['Inny', '1 / 1'],
  ])('dobiera zapasową proporcję dla %s', (format, expected) => {
    expect(fallbackAspectRatio(format)).toBe(expected);
  });

  it('preferuje rzeczywisty wymiar pliku nad formatem', () => {
    expect(
      mediaAspectRatio(
        testChannel({
          media: { source: 'gdrive', fileId: 'plik-1', width: 1920, height: 1080, type: 'video' },
        }),
        'Story',
      ),
    ).toBe('1920 / 1080');
  });

  it('bez wymiarów wraca do formatu, a etykieta proporcji znika', () => {
    const channel = testChannel({ media: { source: 'gdrive', fileId: 'plik-1', type: 'image' } });
    expect(mediaAspectRatio(channel, 'Story')).toBe('9 / 16');
    expect(mediaRatioLabel(channel)).toBeNull();
    expect(mediaRatioLabel(undefined)).toBeNull();
  });
});

describe('Model publikacji', () => {
  it('tworzy roboczy slot z pierwszą platformą marki', () => {
    const post = makeEmptyPost(testBrand, '2024-02-20');

    expect(post).toMatchObject({
      brandId: testBrand.id,
      date: '2024-02-20',
      visibility: 'draft',
      status: 'W trakcie tworzenia',
      title: DEFAULT_POST_TITLE,
      channels: [{ platformId: 'facebook', copy: '' }],
    });
    expect(post.history).toHaveLength(1);
    expect(post.comments).toEqual([]);
    expect(post.id).not.toBe(post.channels[0].id);
    expect(post.createdAt).toBe(post.updatedAt);
  });

  it('marka bez platform daje slot bez kanałów (słownik uzupełnia się później)', () => {
    expect(makeEmptyPost({ ...testBrand, platforms: [] }, '2024-02-20').channels).toEqual([]);
  });

  it('grupuje opis główny i wariant dedykowany', () => {
    const post = testPost({
      channels: [
        testChannel({ id: 'fb', platformId: 'facebook' }),
        testChannel({
          id: 'ig',
          platformId: 'instagram',
          descriptionGroupId: 'opis-instagram',
          copy: 'Inny opis',
          tags: '#ig',
          overrideTags: true,
        }),
      ],
    });

    const groups = getDescriptionGroups(post);
    expect(groups.map((group) => group.id)).toEqual([MAIN_DESCRIPTION_GROUP, 'opis-instagram']);
    expect(groupTags(post, groups[0])).toBe('#marka #test');
    expect(groupTags(post, groups[1])).toBe('#ig');
  });

  it('dziedziczy tagi główne, dopóki wariant ich nie nadpisze', () => {
    const post = testPost({
      channels: [testChannel({ descriptionGroupId: 'wariant', tags: '', overrideTags: false })],
    });
    const [group] = getDescriptionGroups(post);

    expect(groupTags(post, group)).toBe('#marka #test');
  });

  it('zwraca pierwszą platformę jako zachowanie awaryjne', () => {
    expect(platformFor(testBrand, 'nie-istnieje')).toEqual(testBrand.platforms[0]);
    expect(platformFor({ ...testBrand, platforms: [] }, 'facebook')).toBeUndefined();
  });

  it('blokuje publikację bez tytułu, kanału lub opisu', () => {
    const incomplete = testPost({ title: DEFAULT_POST_TITLE, channels: [] });

    expect(validatePostForPublication(incomplete).map((issue) => issue.field)).toEqual([
      'title',
      'channels',
      'copy',
    ]);
    expect(validatePostForPublication(testPost())).toEqual([]);
  });

  it('nadaje kolejne ID przy zduplikowanej nazwie marki', () => {
    expect(uniqueBrandId('Zażółć', [{ ...testBrand, id: 'zazolc' }])).toBe('zazolc-2');
    expect(uniqueBrandId('Zażółć', [])).toBe('zazolc');
  });

  it('nazwa bez znaków alfanumerycznych dostaje losowe id zamiast pustego', () => {
    expect(brandSlug('!!!')).not.toBe('');
  });
});

describe('Komentarze i historia', () => {
  it('spłaszcza odpowiedzi w kolejności drzewa', () => {
    const second = testComment({ id: 'b', parentId: 'a' });
    const third = testComment({ id: 'c', parentId: 'b' });
    const map = new Map([
      ['a', [second]],
      ['b', [third]],
    ]);

    expect(flattenCommentReplies('a', map).map((comment) => comment.id)).toEqual(['b', 'c']);
  });

  it('nie zapętla się na cyklicznej relacji komentarzy', () => {
    const first = testComment({ id: 'a' });
    const second = testComment({ id: 'b', parentId: 'a' });
    const map = new Map([
      ['a', [second]],
      ['b', [first]],
    ]);

    expect(flattenCommentReplies('a', map).map((comment) => comment.id)).toEqual(['b']);
  });

  it('grupuje odpowiedzi po rodzicu, pomijając wątki główne', () => {
    const map = commentRepliesByParent([
      testComment({ id: 'a' }),
      testComment({ id: 'b', parentId: 'a' }),
      testComment({ id: 'c', parentId: 'a' }),
    ]);
    expect(map.get('a')?.map((c) => c.id)).toEqual(['b', 'c']);
    expect(map.has('b')).toBe(false);
  });

  it('zachowuje czytelny oryginał dla niepoprawnej daty komentarza', () => {
    expect(formatCommentDate('nie-data')).toBe('nie-data');
    expect(formatCommentDate('2026-08-03T12:05:00.000Z')).not.toBe('2026-08-03T12:05:00.000Z');
  });
});

describe('Normalizacja draftu marki (STRICT)', () => {
  const draft = (overrides: Record<string, unknown> = {}) => ({
    name: '  Tetra Wave  ',
    industry: ' Technologie ',
    contact: ' kontakt@tetra.pl ',
    accent: ' #0f5fb8 ',
    platforms: [{ id: ' instagram ', name: ' Instagram ', color: ' #7b4cc2 ' }],
    topics: [' Edukacyjne ', 'Edukacyjne', '  '],
    formats: ['Post'],
    ...overrides,
  });

  it('przycina pola, deduplikuje słowniki i normalizuje platformy', () => {
    expect(normalizeContentPlanBrandDraft(draft())).toEqual({
      name: 'Tetra Wave',
      industry: 'Technologie',
      contact: 'kontakt@tetra.pl',
      accent: '#0f5fb8',
      platforms: [{ id: 'instagram', name: 'Instagram', color: '#7b4cc2' }],
      topics: ['Edukacyjne'],
      formats: ['Post'],
    });
  });

  it.each([
    ['pusta nazwa', draft({ name: '   ' })],
    ['platformy nie-tablica', draft({ platforms: 'facebook' })],
    ['platforma bez id', draft({ platforms: [{ id: '', name: 'X' }] })],
    ['platforma bez nazwy', draft({ platforms: [{ id: 'x', name: '  ' }] })],
    [
      'duplikat platformy',
      draft({
        platforms: [
          { id: 'x', name: 'X' },
          { id: 'x', name: 'Y' },
        ],
      }),
    ],
    ['temat nie-string', draft({ topics: [1] })],
    ['formaty nie-tablica', draft({ formats: null })],
    ['nie-obiekt', 'marka'],
  ])('odrzuca (%s)', (_label, bad) => {
    expect(normalizeContentPlanBrandDraft(bad)).toBeNull();
  });
});

describe('Normalizacja kanałów i mediów (STRICT)', () => {
  it('zwija grupę główną do braku klucza i przepuszcza media z Drive', () => {
    const channels = normalizeContentPlanChannels([
      {
        id: 'c1',
        platformId: 'facebook',
        copy: 'Opis',
        tags: '',
        overrideTags: false,
        descriptionGroupId: MAIN_DESCRIPTION_GROUP,
        media: { source: 'gdrive', fileId: 'plik-1', width: 1080, height: 1350, type: 'image' },
      },
    ]);
    expect(channels).toEqual([
      {
        id: 'c1',
        platformId: 'facebook',
        copy: 'Opis',
        tags: '',
        overrideTags: false,
        media: { source: 'gdrive', fileId: 'plik-1', width: 1080, height: 1350, type: 'image' },
      },
    ]);
  });

  const channel = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1',
    platformId: 'facebook',
    copy: 'Opis',
    tags: '',
    overrideTags: false,
    ...overrides,
  });

  it.each([
    ['nie-tablica', 'kanaly'],
    ['wiersz nie-obiekt', [null]],
    ['bez id', [channel({ id: ' ' })]],
    ['bez platformy', [channel({ platformId: '' })]],
    ['duplikat id', [channel(), channel({ platformId: 'instagram' })]],
    ['copy nie-string', [channel({ copy: 5 })]],
    ['overrideTags nie-boolean', [channel({ overrideTags: 'tak' })]],
    ['media innego źródła', [channel({ media: { source: 'local', fileId: 'x', type: 'image' } })]],
    ['media bez fileId', [channel({ media: { source: 'gdrive', fileId: '', type: 'image' } })]],
    ['media złego typu', [channel({ media: { source: 'gdrive', fileId: 'x', type: 'audio' } })]],
    [
      'media z niecałkowitym wymiarem',
      [channel({ media: { source: 'gdrive', fileId: 'x', type: 'image', width: 10.5 } })],
    ],
  ])('odrzuca (%s)', (_label, bad) => {
    expect(normalizeContentPlanChannels(bad)).toBeNull();
  });

  it('base64 z aplikacji źródłowej nie ma jak wejść do kanału', () => {
    const withBase64 = normalizeContentPlanChannels([
      channel({ assetPreview: 'data:image/png;base64,AA==', assetName: 'plik.png' }),
    ]);
    expect(withBase64).toEqual([
      { id: 'c1', platformId: 'facebook', copy: 'Opis', tags: '', overrideTags: false },
    ]);
    expect(JSON.stringify(withBase64)).not.toContain('base64');
  });
});

describe('Normalizacja draftu publikacji (STRICT)', () => {
  const brands = [testBrand];
  const draft = (overrides: Record<string, unknown> = {}) => ({
    brandId: testBrand.id,
    date: '2026-08-10',
    title: '  Premiera  ',
    topic: ' Edukacyjne ',
    format: ' Post ',
    status: 'Zaplanowane',
    visibility: 'draft',
    baseTags: '#marka',
    channels: [
      { id: 'c1', platformId: 'facebook', copy: 'Opis', tags: '', overrideTags: false },
    ],
    ...overrides,
  });

  it('przycina tytuł/temat/format i zachowuje resztę', () => {
    expect(normalizeContentPlanPostDraft(draft(), brands)).toMatchObject({
      title: 'Premiera',
      topic: 'Edukacyjne',
      format: 'Post',
      status: 'Zaplanowane',
      visibility: 'draft',
    });
  });

  it('przepuszcza udostępnienie kompletnej publikacji', () => {
    expect(normalizeContentPlanPostDraft(draft({ visibility: 'published' }), brands)).not.toBeNull();
  });

  it.each([
    ['nieznana marka', draft({ brandId: 'inna' })],
    ['pusty brandId', draft({ brandId: '' })],
    ['zła data', draft({ date: '2026-02-31' })],
    ['pusty tytuł', draft({ title: '   ' })],
    ['status spoza zbioru', draft({ status: 'Wymyślony' })],
    ['widoczność spoza zbioru', draft({ visibility: 'client' })],
    ['tagi nie-string', draft({ baseTags: 42 })],
    ['zły kanał', draft({ channels: [{ id: 'c1' }] })],
    ['udostępnienie bez kanałów', draft({ visibility: 'published', channels: [] })],
    [
      'udostępnienie z roboczym tytułem',
      draft({ visibility: 'published', title: DEFAULT_POST_TITLE }),
    ],
    [
      'udostępnienie bez opisu',
      draft({
        visibility: 'published',
        channels: [{ id: 'c1', platformId: 'facebook', copy: '   ', tags: '', overrideTags: false }],
      }),
    ],
  ])('odrzuca (%s)', (_label, bad) => {
    expect(normalizeContentPlanPostDraft(bad, brands)).toBeNull();
  });
});

describe('Sanityzacja wczytania (ŁAGODNA)', () => {
  it('odrzuca marki bez id/nazwy i duplikaty, resztę koercjonuje', () => {
    const brands = sanitizeContentPlanBrands([
      { id: '', name: 'Bez id' },
      { id: 'a', name: '   ' },
      { id: 'b', name: '  Marka  ', platforms: 'zle', topics: null, formats: [' Post ', 'Post'] },
      { id: 'b', name: 'Duplikat' },
      null,
      'nie-obiekt',
    ]);
    expect(brands).toEqual([
      {
        id: 'b',
        name: 'Marka',
        industry: '',
        contact: '',
        accent: '',
        platforms: [],
        topics: [],
        formats: ['Post'],
        createdAt: '',
        updatedAt: '',
      },
    ]);
  });

  it('odrzuca publikacje bez id/marki/tytułu oraz z niepoprawną datą', () => {
    const posts = sanitizeContentPlanPosts([
      { id: '', brandId: 'b', title: 'X', date: '2026-08-01' },
      { id: 'p1', brandId: '', title: 'X', date: '2026-08-01' },
      { id: 'p2', brandId: 'b', title: '  ', date: '2026-08-01' },
      { id: 'p3', brandId: 'b', title: 'X', date: '2026-02-31' },
      { id: 'p4', brandId: 'b', title: 'X', date: '2026-08-01' },
    ]);
    expect(posts.map((p) => p.id)).toEqual(['p4']);
  });

  it('zachowuje osieroconą markę i sprowadza nieznany status/widoczność do domyślnych', () => {
    const [post] = sanitizeContentPlanPosts([
      {
        id: 'p1',
        brandId: 'usunieta-marka',
        title: 'X',
        date: '2026-08-01',
        status: 'Wymyślony',
        visibility: 'client',
      },
    ]);
    expect(post).toMatchObject({
      brandId: 'usunieta-marka',
      status: 'W trakcie tworzenia',
      visibility: 'draft',
    });
  });

  it('zdejmuje base64 i zły kształt mediów, zostawiając sam kanał', () => {
    const [post] = sanitizeContentPlanPosts([
      {
        id: 'p1',
        brandId: 'b',
        title: 'X',
        date: '2026-08-01',
        channels: [
          {
            id: 'c1',
            platformId: 'facebook',
            assetPreview: 'data:image/png;base64,AA==',
            media: { source: 'local', fileId: 'x', type: 'image' },
          },
          { id: '', platformId: 'facebook' },
        ],
      },
    ]);
    expect(post.channels).toEqual([
      { id: 'c1', platformId: 'facebook', copy: '', tags: '', overrideTags: false },
    ]);
    expect(JSON.stringify(post)).not.toContain('base64');
  });

  it('komentarz z rodzicem spoza publikacji wraca do wątku głównego zamiast zniknąć', () => {
    const [post] = sanitizeContentPlanPosts([
      {
        id: 'p1',
        brandId: 'b',
        title: 'X',
        date: '2026-08-01',
        comments: [
          { id: 'k1', author: 'Klient', body: 'Pierwszy', at: 'x' },
          { id: 'k2', author: 'Klient', body: 'Odpowiedź', at: 'x', parentId: 'k1' },
          { id: 'k3', author: 'Klient', body: 'Sierota', at: 'x', parentId: 'nie-ma' },
          { id: 'k4', author: 'Klient', body: '   ', at: 'x' },
        ],
        history: [{ id: 'h1', label: 'Utworzono', at: 'x' }, { id: 'h2', label: '  ' }],
      },
    ]);
    expect(post.comments.map((c) => [c.id, c.parentId])).toEqual([
      ['k1', undefined],
      ['k2', 'k1'],
      ['k3', undefined],
    ]);
    expect(post.history.map((h) => h.id)).toEqual(['h1']);
  });

  it('jest idempotentna (drugi przebieg nic nie zmienia)', () => {
    const rawBrands = [{ id: 'b', name: ' Marka ', topics: [' A ', 'A'] }, { id: '' }];
    const rawPosts = [
      {
        id: 'p1',
        brandId: 'b',
        title: ' X ',
        date: '2026-08-01',
        status: 'zly',
        channels: [{ id: 'c1', platformId: 'facebook', descriptionGroupId: 'main' }],
      },
    ];
    const brandsOnce = sanitizeContentPlanBrands(rawBrands);
    const postsOnce = sanitizeContentPlanPosts(rawPosts);
    expect(sanitizeContentPlanBrands(brandsOnce)).toEqual(brandsOnce);
    expect(sanitizeContentPlanPosts(postsOnce)).toEqual(postsOnce);
  });
});
