// Czysta logika draftu edytora publikacji. PORT PRZEPŁYWÓW z testów RTL
// aplikacji źródłowej („obsługuje wariant opisu, tagi i komentarz z
// odpowiedzią", „edytuje szybkie metadane i otwiera pełny inspector karty"):
// repo testuje w środowisku `node` (`vitest.config.ts`), więc przepływ jest
// sprawdzany tam, gdzie naprawdę mieszka jego logika — w czystym module i w
// reduktorze (`contentPlanActions.test.ts`), a nie w renderze.
import { describe, expect, it } from 'vitest';
import {
  buildPostDraft,
  canTogglePlatformOff,
  channelMediaView,
  draftDescriptionGroups,
  draftGroupTags,
  firstEmptyCopyGroupId,
  firstPostIssueField,
  mergeDescriptionGroup,
  POST_FIELD_IDS,
  postCopyFieldId,
  postIssueFocusId,
  postIssueLabels,
  postIssuesByField,
  saveHistoryLabel,
  setGroupCopy,
  setGroupTags,
  splitDescriptionForPlatform,
  splitDescriptionOptions,
  threadedComments,
  togglePlatformInDraft,
} from './contentPlanPostEditor';
import {
  MAIN_DESCRIPTION_GROUP,
  normalizeContentPlanPostDraft,
  validatePostForPublication,
} from '../contentplan/domain';
import type { ContentPlanBrand, ContentPlanComment, ContentPlanPost } from '../types';

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
      { id: 'linkedin', name: 'LinkedIn', color: '#0a66c2' },
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
    baseTags: '#marka',
    channels: [
      { id: 'c1', platformId: 'facebook', copy: 'Opis główny', tags: '', overrideTags: false },
      { id: 'c2', platformId: 'instagram', copy: 'Opis główny', tags: '', overrideTags: false },
    ],
    comments: [],
    history: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Deterministyczny generator id — test sprawdza WARTOŚCI, nie losowość. */
function seq(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${n}`;
  };
}

describe('buildPostDraft', () => {
  it('przepisuje pola zapisu i KOPIUJE kanały (encja w stanie zostaje nietknięta)', () => {
    const source = post();
    const draft = buildPostDraft(source);

    expect(draft).toEqual({
      brandId: BRAND_ID,
      date: '2026-08-10',
      title: 'Premiera platformy',
      topic: 'Edukacyjne',
      format: 'Post',
      status: 'Zaplanowane',
      visibility: 'draft',
      baseTags: '#marka',
      channels: source.channels,
    });
    expect(draft.channels[0]).not.toBe(source.channels[0]);
  });

  it('draft świeżego seeda przechodzi normalizację reduktora', () => {
    const draft = buildPostDraft(post());
    expect(normalizeContentPlanPostDraft(draft, [brand()])).not.toBeNull();
  });
});

describe('togglePlatformInDraft', () => {
  it('dokłada kanał dziedziczący opis grupy głównej', () => {
    const draft = togglePlatformInDraft(buildPostDraft(post()), 'linkedin', seq('new-'));

    expect(draft.channels).toHaveLength(3);
    expect(draft.channels[2]).toEqual({
      id: 'new-1',
      platformId: 'linkedin',
      copy: 'Opis główny',
      tags: '',
      overrideTags: false,
    });
    // Forma kanoniczna: brak klucza ≡ grupa główna.
    expect(draft.channels[2].descriptionGroupId).toBeUndefined();
    expect(draftDescriptionGroups(draft)).toHaveLength(1);
  });

  it('wyłączenie platformy usuwa jej kanały', () => {
    const draft = togglePlatformInDraft(buildPostDraft(post()), 'instagram');
    expect(draft.channels.map((channel) => channel.platformId)).toEqual(['facebook']);
  });

  it('OSTATNIEGO kanału nie da się wyłączyć (ta sama referencja draftu)', () => {
    const single = buildPostDraft(
      post({
        channels: [
          { id: 'c1', platformId: 'facebook', copy: '', tags: '', overrideTags: false },
        ],
      }),
    );
    expect(canTogglePlatformOff(single, 'facebook')).toBe(false);
    expect(togglePlatformInDraft(single, 'facebook')).toBe(single);
  });

  it('platformę bez kanału zawsze wolno włączyć', () => {
    const draft = buildPostDraft(post());
    expect(canTogglePlatformOff(draft, 'linkedin')).toBe(true);
    expect(canTogglePlatformOff(draft, 'facebook')).toBe(true);
  });
});

describe('warianty opisu (wydziel / scal)', () => {
  it('wydzielenie daje świeżą grupę i PRZEJMUJE dotychczasowe tagi', () => {
    const draft = splitDescriptionForPlatform(
      buildPostDraft(post()),
      'instagram',
      seq('u'),
    );
    const groups = draftDescriptionGroups(draft);

    expect(groups).toHaveLength(2);
    expect(groups[0].isMain).toBe(true);
    expect(groups[1].id).toBe('desc-u1');
    const variant = draft.channels.find((channel) => channel.platformId === 'instagram');
    expect(variant?.overrideTags).toBe(true);
    expect(variant?.tags).toBe('#marka');
    expect(draftGroupTags(draft, groups[1])).toBe('#marka');
  });

  it('scalenie wraca do grupy głównej z jej opisem i bez nadpisania tagów', () => {
    const split = splitDescriptionForPlatform(buildPostDraft(post()), 'instagram', seq('u'));
    const edited = setGroupCopy(split, 'desc-u1', 'Wariant IG');
    expect(draftDescriptionGroups(edited)[1].channels[0].copy).toBe('Wariant IG');

    const merged = mergeDescriptionGroup(edited, 'desc-u1');
    const channel = merged.channels.find((row) => row.platformId === 'instagram');
    expect(draftDescriptionGroups(merged)).toHaveLength(1);
    expect(channel?.copy).toBe('Opis główny');
    expect(channel?.overrideTags).toBe(false);
    expect(channel?.tags).toBe('');
    expect(channel?.descriptionGroupId).toBeUndefined();
  });

  it('scalenie grupy głównej jest zakazane (ta sama referencja draftu)', () => {
    const draft = buildPostDraft(post());
    expect(mergeDescriptionGroup(draft, MAIN_DESCRIPTION_GROUP)).toBe(draft);
  });

  it('lista „Wydziel opis" pomija kanał samotny w swojej grupie', () => {
    const draft = splitDescriptionForPlatform(buildPostDraft(post()), 'instagram', seq('u'));
    expect(splitDescriptionOptions(draft, brand())).toEqual([
      { platformId: 'facebook', label: 'Facebook' },
    ]);
  });

  it('nieznana platforma nie zmienia draftu', () => {
    const draft = buildPostDraft(post());
    expect(splitDescriptionForPlatform(draft, 'tiktok')).toBe(draft);
  });
});

describe('tagi z dziedziczeniem', () => {
  it('tagi grupy głównej idą do baseTags i KASUJĄ nadpisania jej kanałów', () => {
    const withOverride = buildPostDraft(
      post({
        channels: [
          { id: 'c1', platformId: 'facebook', copy: '', tags: '#stare', overrideTags: true },
          { id: 'c2', platformId: 'instagram', copy: '', tags: '', overrideTags: false },
        ],
      }),
    );
    const next = setGroupTags(withOverride, MAIN_DESCRIPTION_GROUP, '#nowe');

    expect(next.baseTags).toBe('#nowe');
    expect(next.channels.every((channel) => !channel.overrideTags)).toBe(true);
    expect(next.channels.every((channel) => channel.tags === '')).toBe(true);
    expect(draftGroupTags(next, draftDescriptionGroups(next)[0])).toBe('#nowe');
  });

  it('tagi wariantu nadpisują dziedziczenie tylko w swojej grupie', () => {
    const split = splitDescriptionForPlatform(buildPostDraft(post()), 'instagram', seq('u'));
    const next = setGroupTags(split, 'desc-u1', '#ig');
    const groups = draftDescriptionGroups(next);

    expect(draftGroupTags(next, groups[0])).toBe('#marka');
    expect(draftGroupTags(next, groups[1])).toBe('#ig');
    expect(next.baseTags).toBe('#marka');
  });
});

describe('walidacja publikacji -> pola formularza', () => {
  it('braki tytułu, kanału i opisu mapują się na pola i podsumowanie', () => {
    const empty = buildPostDraft(
      post({
        title: 'Nowa publikacja',
        channels: [],
      }),
    );
    const issues = validatePostForPublication(empty);
    const byField = postIssuesByField(issues);

    expect(Object.keys(byField).sort()).toEqual(['channels', 'copy', 'title']);
    expect(byField.title).toBe('Uzupełnij roboczy tytuł publikacji.');
    expect(postIssueLabels(byField)).toEqual(['Tytuł', 'Platformy', 'Opis']);
    expect(firstPostIssueField(byField)).toBe('title');
    // Kolejność podsumowania i fokusa jest KOLEJNOŚCIĄ FORMULARZA, nie kolejnością
    // zgłoszenia braków.
    expect(postIssueLabels({ copy: 'x', title: 'y' })).toEqual(['Tytuł', 'Opis']);
    expect(firstPostIssueField({ copy: 'x', channels: 'y' })).toBe('channels');
    expect(firstPostIssueField({})).toBeNull();
  });

  it('kotwica fokusa celuje w tytuł, sekcję platform i PIERWSZY pusty opis', () => {
    const draft = splitDescriptionForPlatform(
      buildPostDraft(
        post({
          channels: [
            { id: 'c1', platformId: 'facebook', copy: 'Jest opis', tags: '', overrideTags: false },
            { id: 'c2', platformId: 'instagram', copy: 'Jest opis', tags: '', overrideTags: false },
          ],
        }),
      ),
      'instagram',
      seq('u'),
    );
    const withEmptyVariant = setGroupCopy(draft, 'desc-u1', '   ');

    expect(postIssueFocusId('title', withEmptyVariant)).toBe(POST_FIELD_IDS.title);
    expect(postIssueFocusId('channels', withEmptyVariant)).toBe(POST_FIELD_IDS.platforms);
    expect(firstEmptyCopyGroupId(withEmptyVariant)).toBe('desc-u1');
    expect(postIssueFocusId('copy', withEmptyVariant)).toBe(postCopyFieldId('desc-u1'));
  });

  it('kompletna publikacja nie ma braków, a jej draft przechodzi normalizację', () => {
    const draft = { ...buildPostDraft(post()), visibility: 'published' as const };
    expect(validatePostForPublication(draft)).toEqual([]);
    expect(normalizeContentPlanPostDraft(draft, [brand()])).not.toBeNull();
  });

  it('LUSTRO reduktora: niekompletna publikacja nie przechodzi normalizacji', () => {
    const draft = {
      ...buildPostDraft(post({ title: 'Nowa publikacja' })),
      visibility: 'published' as const,
    };
    expect(normalizeContentPlanPostDraft(draft, [brand()])).toBeNull();
  });
});

describe('threadedComments', () => {
  const comment = (
    id: string,
    at: string,
    parentId?: string,
  ): ContentPlanComment => ({
    id,
    author: id.toUpperCase(),
    body: `Treść ${id}`,
    at,
    ...(parentId !== undefined ? { parentId } : {}),
  });

  it('korzenie od najnowszego, odpowiedzi chronologicznie rosnąco', () => {
    const threads = threadedComments([
      comment('a', '2026-08-01T10:00:00.000Z'),
      comment('b', '2026-08-03T10:00:00.000Z'),
      comment('a2', '2026-08-02T10:00:00.000Z', 'a'),
      comment('a1', '2026-08-01T12:00:00.000Z', 'a'),
    ]);

    expect(threads.map((thread) => thread.comment.id)).toEqual(['b', 'a']);
    expect(threads[1].replies.map((reply) => reply.comment.id)).toEqual(['a1', 'a2']);
    expect(threads[1].replies[0].repliedTo?.id).toBe('a');
  });

  it('odpowiedź na odpowiedź spłaszcza się w kolejności drzewa', () => {
    const threads = threadedComments([
      comment('a', '2026-08-01T10:00:00.000Z'),
      comment('a1', '2026-08-01T11:00:00.000Z', 'a'),
      comment('a1x', '2026-08-01T12:00:00.000Z', 'a1'),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((reply) => reply.comment.id)).toEqual(['a1', 'a1x']);
    expect(threads[0].replies[1].repliedTo?.id).toBe('a1');
  });

  it('sierota (rodzic spoza listy) renderuje się jako korzeń', () => {
    const threads = threadedComments([comment('x', '2026-08-01T10:00:00.000Z', 'nie-ma')]);
    expect(threads.map((thread) => thread.comment.id)).toEqual(['x']);
    expect(threads[0].replies).toEqual([]);
  });

  it('pusta lista daje pustą listę wątków', () => {
    expect(threadedComments([])).toEqual([]);
  });
});

describe('saveHistoryLabel', () => {
  it('brak zmian => pusta etykieta (reduktor wpisze własną domyślną)', () => {
    const source = post();
    expect(saveHistoryLabel(source, buildPostDraft(source), brand())).toBe('');
  });

  it('wymienia zmienione obszary po polsku', () => {
    const source = post();
    const draft = {
      ...buildPostDraft(source),
      title: 'Nowy tytuł',
      visibility: 'published' as const,
    };
    expect(saveHistoryLabel(source, draft, brand())).toBe('Zmieniono: tytuł, widoczność');
  });

  it('nazywa wariant opisu jego platformą', () => {
    const source = post({
      channels: [
        { id: 'c1', platformId: 'facebook', copy: 'Opis główny', tags: '', overrideTags: false },
        {
          id: 'c2',
          platformId: 'instagram',
          copy: 'Wariant',
          tags: '',
          overrideTags: false,
          descriptionGroupId: 'desc-1',
        },
      ],
    });
    const draft = setGroupCopy(buildPostDraft(source), 'desc-1', 'Wariant v2');
    expect(saveHistoryLabel(source, draft, brand())).toBe('Zmieniono: opis (Instagram)');
  });

  it('wydzielenie opisu i zmiana tagów są osobnymi pozycjami', () => {
    const source = post();
    const split = splitDescriptionForPlatform(buildPostDraft(source), 'instagram', seq('u'));
    expect(saveHistoryLabel(source, split, brand())).toBe('Zmieniono: warianty opisu');

    const tagged = setGroupTags(split, MAIN_DESCRIPTION_GROUP, '#kampania');
    expect(saveHistoryLabel(source, tagged, brand())).toBe('Zmieniono: warianty opisu, tagi');
  });

  it('dodanie kanału wymienia platformy', () => {
    const source = post();
    const draft = togglePlatformInDraft(buildPostDraft(source), 'linkedin', seq('u'));
    expect(saveHistoryLabel(source, draft, brand())).toBe('Zmieniono: platformy');
  });
});

describe('channelMediaView', () => {
  it('bez pliku pisze o jego braku i nie zna proporcji', () => {
    const view = channelMediaView(
      brand(),
      { id: 'c1', platformId: 'instagram', copy: '', tags: '', overrideTags: false },
      'Rolka',
    );
    expect(view).toEqual({
      platformName: 'Instagram',
      platformColor: '#7b4cc2',
      fileLabel: 'Nie dodano pliku',
      hasFile: false,
      ratioLabel: null,
      aspectRatio: '9 / 16',
    });
  });

  it('plik z Dysku niesie id i skróconą proporcję', () => {
    const view = channelMediaView(
      brand(),
      {
        id: 'c1',
        platformId: 'facebook',
        copy: '',
        tags: '',
        overrideTags: false,
        media: { source: 'gdrive', fileId: 'drive-1', width: 1080, height: 1350, type: 'image' },
      },
      'Post',
    );
    expect(view.fileLabel).toBe('drive-1');
    expect(view.hasFile).toBe(true);
    expect(view.ratioLabel).toBe('4:5');
    expect(view.aspectRatio).toBe('1080 / 1350');
  });
});
