// Czysta logika DRAFTU edytora publikacji Content Planu: seed draftu z encji,
// przełączanie kanałów, wydzielanie i scalanie opisów, tagi z dziedziczeniem,
// wątkowanie komentarzy, etykieta historii zapisu i mapowanie braków publikacji
// na pola formularza. Zero Reacta, zero store'u — `ContentPlanPostModal.tsx`
// zostaje cienką warstwą renderu, a całość „co zmienia edycja" testuje się w
// node (ta sama zasada co `contentPlanCalendar.ts`).
//
// GRANICE
// - Model danych, grupy opisów, tagi, media i walidacja publikacji: WYŁĄCZNIE
//   `contentplan/domain.ts`. Tutaj nie ma ani jednej reguły, którą domena już
//   zna — są tylko operacje draftu, których domena nie ma po co znać.
// - Zapis: tylko przez reduktor (`SAVE_CP_POST`), dlatego stąd wychodzą DRAFTY,
//   nigdy encje. Draft odrzucony przez `normalizeContentPlanPostDraft` zostaje w
//   modalu (inwariant 6: reduktor zwróciłby tę samą referencję stanu).
import type {
  ContentPlanBrand,
  ContentPlanChannel,
  ContentPlanComment,
  ContentPlanPost,
} from '../types';
import {
  commentRepliesByParent,
  contentPlanUid,
  descriptionGroupId,
  flattenCommentReplies,
  getDescriptionGroups,
  groupTags,
  MAIN_DESCRIPTION_GROUP,
  mediaAspectRatio,
  mediaRatioLabel,
  platformFor,
  type ContentPlanDescriptionGroup,
  type ContentPlanIssueField,
  type ContentPlanPostDraft,
  type ContentPlanPublicationIssue,
} from '../contentplan/domain';

// ---- Draft: seed i widok grup ---------------------------------------------

/** Draft edytora z zapisanej publikacji. Kanały są KOPIOWANE — edycja draftu
 *  nigdy nie dotyka encji w stanie (jedyną granicą zapisu jest reduktor). */
export function buildPostDraft(post: ContentPlanPost): ContentPlanPostDraft {
  return {
    brandId: post.brandId,
    date: post.date,
    title: post.title,
    topic: post.topic,
    format: post.format,
    status: post.status,
    visibility: post.visibility,
    baseTags: post.baseTags,
    channels: post.channels.map((channel) => ({ ...channel })),
  };
}

/** Draft w kształcie encji — helpery domeny czytają wyłącznie `channels`
 *  i `baseTags`, ale ich sygnatura mówi o publikacji. Zero rzutowań: puste
 *  kolekcje i znaczniki są tu jawnie dopisane. */
function asPostShape(draft: ContentPlanPostDraft): ContentPlanPost {
  return {
    ...draft,
    id: '',
    comments: [],
    history: [],
    createdAt: '',
    updatedAt: '',
  };
}

/** Grupy opisów draftu (główna zawsze pierwsza) — `getDescriptionGroups`. */
export function draftDescriptionGroups(
  draft: ContentPlanPostDraft,
): ContentPlanDescriptionGroup[] {
  return getDescriptionGroups(asPostShape(draft));
}

/** Efektywne tagi grupy draftu (dziedziczenie z `baseTags`) — `groupTags`. */
export function draftGroupTags(
  draft: ContentPlanPostDraft,
  group: ContentPlanDescriptionGroup,
): string {
  return groupTags(asPostShape(draft), group);
}

// ---- Platformy (kanały) ----------------------------------------------------

/** Czy pigułkę platformy wolno wyłączyć. Ostatni kanał publikacji ZOSTAJE:
 *  publikacja bez kanału nie ma czego pokazać (parytet ze źródłem). */
export function canTogglePlatformOff(draft: ContentPlanPostDraft, platformId: string): boolean {
  const active = draft.channels.some((channel) => channel.platformId === platformId);
  return !active || draft.channels.length > 1;
}

/**
 * Przełącznik kanału (port `togglePlatform`): wyłączenie usuwa kanały tej
 * platformy, włączenie dokłada kanał w grupie GŁÓWNEJ z opisem tej grupy.
 * Próba wyłączenia OSTATNIEGO kanału zwraca TĘ SAMĄ referencję draftu.
 */
export function togglePlatformInDraft(
  draft: ContentPlanPostDraft,
  platformId: string,
  uid: () => string = contentPlanUid,
): ContentPlanPostDraft {
  const exists = draft.channels.some((channel) => channel.platformId === platformId);
  if (exists && draft.channels.length === 1) return draft;
  if (exists) {
    return {
      ...draft,
      channels: draft.channels.filter((channel) => channel.platformId !== platformId),
    };
  }
  const main = draftDescriptionGroups(draft).find((group) => group.isMain);
  const source = main?.channels[0] ?? draft.channels[0];
  return {
    ...draft,
    channels: [
      ...draft.channels,
      {
        id: uid(),
        platformId,
        // Nowy kanał dziedziczy opis grupy głównej i do niej wchodzi — forma
        // kanoniczna NIE niesie klucza `descriptionGroupId` (brak ≡ 'main').
        copy: source?.copy ?? '',
        tags: '',
        overrideTags: false,
      },
    ],
  };
}

// ---- Warianty opisu --------------------------------------------------------

/** Pozycja listy „Wydziel opis" (platforma, której opis da się wydzielić). */
export interface ContentPlanSplitOption {
  platformId: string;
  label: string;
}

/**
 * Platformy, dla których wydzielenie opisu ma sens (port `splitOptions`):
 * kanał w grupie głównej ALBO w grupie dedykowanej dzielonej z kimś jeszcze.
 * Kanał sam w swojej grupie już ma własny opis, więc odpada.
 */
export function splitDescriptionOptions(
  draft: ContentPlanPostDraft,
  brand: ContentPlanBrand,
): ContentPlanSplitOption[] {
  const groups = draftDescriptionGroups(draft);
  const out: ContentPlanSplitOption[] = [];
  const seen = new Set<string>();
  for (const channel of draft.channels) {
    const group = groups.find((item) => item.id === descriptionGroupId(channel));
    if (group === undefined) continue;
    if (!group.isMain && group.channels.length <= 1) continue;
    if (seen.has(channel.platformId)) continue;
    seen.add(channel.platformId);
    out.push({
      platformId: channel.platformId,
      label: platformFor(brand, channel.platformId)?.name ?? channel.platformId,
    });
  }
  return out;
}

/**
 * Wydzielenie opisu dla platformy: świeży `descriptionGroupId` i PRZEJĘCIE
 * dotychczasowych efektywnych tagów (`overrideTags: true`), żeby wariant nie
 * zgubił tagów w chwili odłączenia od grupy głównej. Nieznana platforma =>
 * ta sama referencja draftu.
 */
export function splitDescriptionForPlatform(
  draft: ContentPlanPostDraft,
  platformId: string,
  uid: () => string = contentPlanUid,
): ContentPlanPostDraft {
  if (!draft.channels.some((channel) => channel.platformId === platformId)) return draft;
  const groupId = `desc-${uid()}`;
  return {
    ...draft,
    channels: draft.channels.map((channel) =>
      channel.platformId === platformId
        ? {
            ...channel,
            descriptionGroupId: groupId,
            tags: channel.overrideTags ? channel.tags : draft.baseTags,
            overrideTags: true,
          }
        : channel,
    ),
  };
}

/** Scalenie wariantu z opisem głównym: powrót do grupy głównej (klucz ZNIKA —
 *  forma kanoniczna), opis i tagi z grupy głównej. */
export function mergeDescriptionGroup(
  draft: ContentPlanPostDraft,
  groupId: string,
): ContentPlanPostDraft {
  if (groupId === MAIN_DESCRIPTION_GROUP) return draft;
  const mainCopy =
    draftDescriptionGroups(draft).find((group) => group.isMain)?.channels[0]?.copy ?? '';
  return {
    ...draft,
    channels: draft.channels.map((channel) => {
      if (descriptionGroupId(channel) !== groupId) return channel;
      const next: ContentPlanChannel = {
        ...channel,
        copy: mainCopy,
        tags: '',
        overrideTags: false,
      };
      delete next.descriptionGroupId;
      return next;
    }),
  };
}

/** Opis grupy (wszystkie jej kanały dzielą treść). */
export function setGroupCopy(
  draft: ContentPlanPostDraft,
  groupId: string,
  value: string,
): ContentPlanPostDraft {
  return {
    ...draft,
    channels: draft.channels.map((channel) =>
      descriptionGroupId(channel) === groupId ? { ...channel, copy: value } : channel,
    ),
  };
}

/**
 * Tagi grupy. Grupa GŁÓWNA zapisuje `baseTags` i CZYŚCI nadpisania swoich
 * kanałów (inaczej po powrocie do dziedziczenia zostałby martwy `tags`);
 * wariant dedykowany zapisuje własne tagi z `overrideTags: true`.
 */
export function setGroupTags(
  draft: ContentPlanPostDraft,
  groupId: string,
  value: string,
): ContentPlanPostDraft {
  if (groupId === MAIN_DESCRIPTION_GROUP) {
    return {
      ...draft,
      baseTags: value,
      channels: draft.channels.map((channel) =>
        descriptionGroupId(channel) === MAIN_DESCRIPTION_GROUP
          ? { ...channel, overrideTags: false, tags: '' }
          : channel,
      ),
    };
  }
  return {
    ...draft,
    channels: draft.channels.map((channel) =>
      descriptionGroupId(channel) === groupId
        ? { ...channel, overrideTags: true, tags: value }
        : channel,
    ),
  };
}

// ---- Media kanału (TYLKO odczyt) -------------------------------------------

/** Wiersz mediów kanału. Pliki wchodzą osobną fazą (Dysk Google), więc tutaj
 *  jest wyłącznie odczyt referencji: nazwa platformy, `fileId` i proporcja. */
export interface ContentPlanChannelMediaView {
  platformName: string;
  platformColor: string;
  fileLabel: string;
  hasFile: boolean;
  ratioLabel: string | null;
  aspectRatio: string;
}

export function channelMediaView(
  brand: ContentPlanBrand,
  channel: ContentPlanChannel,
  format: string,
): ContentPlanChannelMediaView {
  const platform = platformFor(brand, channel.platformId);
  const fileId = channel.media?.fileId ?? '';
  return {
    platformName: platform?.name ?? channel.platformId,
    platformColor: platform?.color ?? '',
    fileLabel: fileId === '' ? 'Nie dodano pliku' : fileId,
    hasFile: fileId !== '',
    ratioLabel: mediaRatioLabel(channel),
    aspectRatio: mediaAspectRatio(channel, format),
  };
}

// ---- Komentarze wątkowane --------------------------------------------------

/** Odpowiedź w wątku wraz z komentarzem, na który odpowiada. */
export interface ContentPlanCommentReply {
  comment: ContentPlanComment;
  repliedTo: ContentPlanComment | null;
}

/** Wątek: korzeń + spłaszczone odpowiedzi w kolejności drzewa. */
export interface ContentPlanCommentThread {
  comment: ContentPlanComment;
  replies: ContentPlanCommentReply[];
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Wątki komentarzy publikacji (port `ThreadedComments`) na helperach domeny:
 * korzenie od NAJNOWSZEGO, odpowiedzi chronologicznie rosnąco, a komentarz
 * wskazujący nieistniejącego rodzica renderuje się jako KORZEŃ (treść klienta
 * nigdy nie znika z widoku — ta sama zasada co w sanitizerze wczytania).
 */
export function threadedComments(
  comments: readonly ContentPlanComment[],
): ContentPlanCommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const childrenByParent = commentRepliesByParent(comments);
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => timeOf(a.at) - timeOf(b.at));
  }
  return comments
    .filter((comment) => comment.parentId === undefined || !byId.has(comment.parentId))
    .slice()
    .sort((a, b) => timeOf(b.at) - timeOf(a.at))
    .map((comment) => ({
      comment,
      replies: flattenCommentReplies(comment.id, childrenByParent).map((reply) => ({
        comment: reply,
        repliedTo: reply.parentId === undefined ? null : (byId.get(reply.parentId) ?? null),
      })),
    }));
}

// ---- Etykieta historii zapisu ----------------------------------------------

function groupPlatformNames(
  brand: ContentPlanBrand,
  group: ContentPlanDescriptionGroup,
): string {
  const names: string[] = [];
  for (const channel of group.channels) {
    const name = platformFor(brand, channel.platformId)?.name ?? channel.platformId;
    if (!names.includes(name)) names.push(name);
  }
  return names.join(', ');
}

/**
 * Polska etykieta wpisu historii JEDNEGO zapisu edytora, np.
 * „Zmieniono: tytuł, opis (Instagram), tagi". Pusty wynik = brak zmian, wtedy
 * reduktor wpisuje własną domyślną etykietę.
 */
export function saveHistoryLabel(
  before: ContentPlanPost,
  draft: ContentPlanPostDraft,
  brand: ContentPlanBrand,
): string {
  const parts: string[] = [];
  if (before.title.trim() !== draft.title.trim()) parts.push('tytuł');
  if (before.date !== draft.date) parts.push('data');
  if (before.topic !== draft.topic) parts.push('temat');
  if (before.format !== draft.format) parts.push('typ');
  if (before.status !== draft.status) parts.push('status');
  if (before.visibility !== draft.visibility) parts.push('widoczność');

  const beforePlatforms = new Set(before.channels.map((channel) => channel.platformId));
  const draftPlatforms = new Set(draft.channels.map((channel) => channel.platformId));
  const platformsChanged =
    beforePlatforms.size !== draftPlatforms.size ||
    [...draftPlatforms].some((id) => !beforePlatforms.has(id));
  if (platformsChanged) parts.push('platformy');

  const beforeGroups = getDescriptionGroups(before);
  const draftGroups = draftDescriptionGroups(draft);
  const beforeCopy = new Map(
    beforeGroups.map((group) => [group.id, group.channels[0]?.copy ?? '']),
  );
  // Wydzielenie i scalenie zmieniają ZBIÓR grup, a nie same treści (świeży
  // wariant startuje z opisem głównym), więc dostają własną pozycję.
  const groupsChanged =
    beforeGroups.length !== draftGroups.length ||
    draftGroups.some((group) => !beforeCopy.has(group.id));
  if (groupsChanged) parts.push('warianty opisu');
  for (const group of draftGroups) {
    const previous = beforeCopy.get(group.id);
    if (previous === undefined) continue; // nowa grupa — niesie ją „warianty opisu"
    if (previous === (group.channels[0]?.copy ?? '')) continue;
    parts.push(group.isMain ? 'opis główny' : `opis (${groupPlatformNames(brand, group)})`);
  }

  let tagsChanged = before.baseTags !== draft.baseTags;
  if (!tagsChanged) {
    const beforeTags = new Map(
      beforeGroups.map((group) => [group.id, groupTags(before, group)]),
    );
    for (const group of draftGroups) {
      const previous = beforeTags.get(group.id);
      if (previous === undefined) continue;
      if (previous !== draftGroupTags(draft, group)) {
        tagsChanged = true;
        break;
      }
    }
  }
  if (tagsChanged) parts.push('tagi');

  return parts.length === 0 ? '' : `Zmieniono: ${parts.join(', ')}`;
}

// ---- Braki publikacji -> pola formularza -----------------------------------

/** Stabilne kotwice fokusa pól edytora (wzorzec `t-title` / `event-date`). */
export const POST_FIELD_IDS = {
  date: 'cp-post-date',
  title: 'cp-post-title',
  topic: 'cp-post-topic',
  format: 'cp-post-format',
  status: 'cp-post-status',
  visibility: 'cp-post-visibility',
  /** Sekcja platform: kotwicą jest PIERWSZA pigułka kanału. */
  platforms: 'cp-post-platforms',
} as const;

export function postCopyFieldId(groupId: string): string {
  return `cp-post-copy-${groupId}`;
}

export function postTagsFieldId(groupId: string): string {
  return `cp-post-tags-${groupId}`;
}

/** Kolejność FORMULARZA — jedno źródło etykiet podsumowania i „pierwszego
 *  złego pola" (ta sama zasada co `EVENT_FIELDS` w EventModal). */
export const POST_ISSUE_ORDER: readonly ContentPlanIssueField[] = ['title', 'channels', 'copy'];

/** Etykiety pól do liczonego podsumowania `saveErrorSummary`. */
export const POST_ISSUE_LABELS: Record<ContentPlanIssueField, string> = {
  title: 'Tytuł',
  channels: 'Platformy',
  copy: 'Opis',
};

/** Braki publikacji zwinięte do mapy „pole => komunikat". */
export function postIssuesByField(
  issues: readonly ContentPlanPublicationIssue[],
): Partial<Record<ContentPlanIssueField, string>> {
  const out: Partial<Record<ContentPlanIssueField, string>> = {};
  for (const issue of issues) {
    if (out[issue.field] === undefined) out[issue.field] = issue.message;
  }
  return out;
}

/** Etykiety złych pól W KOLEJNOŚCI FORMULARZA (wejście do `saveErrorSummary`).
 *  Bierze mapę pól, a nie listę braków — modal trzyma stan błędów właśnie tak. */
export function postIssueLabels(
  byField: Partial<Record<ContentPlanIssueField, string>>,
): string[] {
  return POST_ISSUE_ORDER.filter((field) => byField[field] !== undefined).map(
    (field) => POST_ISSUE_LABELS[field],
  );
}

/** Id grupy z PIERWSZYM pustym opisem (cel komunikatu o braku treści). */
export function firstEmptyCopyGroupId(draft: ContentPlanPostDraft): string | null {
  for (const group of draftDescriptionGroups(draft)) {
    if ((group.channels[0]?.copy ?? '').trim() === '') return group.id;
  }
  return null;
}

/** Kotwica fokusa dla brakującego pola (nieudany zapis MUSI mieć skutek). */
export function postIssueFocusId(
  field: ContentPlanIssueField,
  draft: ContentPlanPostDraft,
): string {
  if (field === 'title') return POST_FIELD_IDS.title;
  if (field === 'channels') return POST_FIELD_IDS.platforms;
  return postCopyFieldId(firstEmptyCopyGroupId(draft) ?? MAIN_DESCRIPTION_GROUP);
}

/** Pierwsze złe pole w kolejności formularza (`null` = brak braków). */
export function firstPostIssueField(
  byField: Partial<Record<ContentPlanIssueField, string>>,
): ContentPlanIssueField | null {
  return POST_ISSUE_ORDER.find((field) => byField[field] !== undefined) ?? null;
}
