// Czysty model widoku doku bąbelków (wariant „chat heads"): które rozmowy
// dostają bąbelek, w jakiej kolejności, co mówi czytnik ekranu i co pokazuje
// popover lupy. Komponenty `.tsx` obok są cienkie — cała decyzyjność siedzi tu
// i testuje się w node (wzorzec `bottomNav.ts` + test).
import { polishCount } from '../../utils/polishPlural';
import type { ChatConversation, ChatConversationKind } from '../types';
import {
  conversationInitials,
  conversationTitle,
  directPeerId,
  isConversationOnline,
  personLabel,
  type ChatDirectory,
  type ChatPerson,
} from './chatPeople';
import { formatListTime } from './chatTime';
import { messageContentKind } from './chatRichText';

/** Ile bąbelków rozmów mieści kolumna; reszta zostaje w popoverze lupy. */
export const MAX_DOCK_BUBBLES = 5;

/** Powyżej tej wartości odznaka pokazuje „9+" zamiast liczby. */
export const UNREAD_BADGE_CAP = 9;

/** Treść czerwonej odznaki; '' gdy nie ma czego pokazać. */
export function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(Math.trunc(count));
}

/** „3 nieprzeczytane" z polską odmianą; '' gdy zero. */
export function unreadPhrase(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  const rounded = Math.trunc(count);
  return `${rounded} ${polishCount(rounded, 'nieprzeczytana', 'nieprzeczytane', 'nieprzeczytanych')}`;
}

/** Model jednego bąbelka w kolumnie. */
export interface ChatBubbleView {
  conversationId: string;
  kind: ChatConversationKind;
  title: string;
  initials: string;
  /** Chmurowe uuid rozmówcy (DM) — źródło zdjęcia profilowego; null w grupie. */
  peerId: string | null;
  unreadCount: number;
  badge: string;
  online: boolean;
  /** Rozmowa otwarta w oknie (bąbelek dostaje stan aktywny). */
  active: boolean;
  ariaLabel: string;
}

export interface DockBubblesInput {
  conversations: readonly ChatConversation[];
  selfId: string | null;
  directory: ChatDirectory;
  presence: ReadonlySet<string>;
  openConversationId: string | null;
  /** Ostatnio otwierane rozmowy, od najświeższej (pamięć sesji doku). */
  recentIds: readonly string[];
  /**
   * Rozmowy zdjęte X-em: id → id OSTATNIEJ WIADOMOŚCI z chwili zdjęcia. Bąbelek
   * zostaje schowany, dopóki ostatnia wiadomość jest ta sama — czyli WRACA przy
   * pierwszej nowej wiadomości, a nie od licznika nieprzeczytanych (ten bywa
   * jeszcze > 0 tuż po otwarciu, zanim `markRead` dojdzie do serwera). Id, a nie
   * `lastMessageAt`: dwie wiadomości mogą mieć ten sam znacznik czasu, id jest
   * unikalne z definicji.
   */
  dismissed?: ChatDismissed;
  max?: number;
}

/** Zdjęte X-em: id rozmowy → id ostatniej wiadomości (`null` = pusta rozmowa). */
export type ChatDismissed = Readonly<Record<string, string | null>>;

/** Rewizja rozmowy do porównania „czy przyszło coś nowego": id ostatniej wiadomości. */
function lastMessageId(conversation: ChatConversation): string | null {
  return conversation.lastMessage?.id ?? null;
}

/** Czy rozmowa jest zdjęta i od tamtej pory NIC nowego nie przyszło. */
export function isDismissed(dismissed: ChatDismissed, conversation: ChatConversation): boolean {
  return (
    conversation.id in dismissed && dismissed[conversation.id] === lastMessageId(conversation)
  );
}

/** Zdjęcie bąbelka X-em: zapamiętuje id ostatniej wiadomości. */
export function dismissBubble(
  dismissed: ChatDismissed,
  conversation: ChatConversation,
): ChatDismissed {
  if (isDismissed(dismissed, conversation)) return dismissed;
  return { ...dismissed, [conversation.id]: lastMessageId(conversation) };
}

/** Otwarcie rozmowy cofa zdjęcie (ta sama referencja, gdy nie była zdjęta). */
export function undismissBubble(dismissed: ChatDismissed, id: string): ChatDismissed {
  if (!(id in dismissed)) return dismissed;
  const next = { ...dismissed };
  delete next[id];
  return next;
}

/**
 * Etykieta bąbelka dla czytnika ekranu (obecność i licznik doklejane zdaniami).
 *
 * Nazwisko stoi PO DWUKROPKU, a nie po przyimku „z": polszczyzna wymagałaby
 * wtedy narzędnika („z Olą Kowalską"), a odmiana imion i nazwisk bez słownika
 * fleksyjnego kończy się formami typu „z Ola Kowalska". Dwukropek jest
 * poprawny dla każdego wpisu.
 */
export function bubbleAriaLabel(input: {
  kind: ChatConversationKind;
  title: string;
  online: boolean;
  unreadCount: number;
}): string {
  const base =
    input.kind === 'group' ? `Rozmowa grupowa: ${input.title}` : `Rozmowa: ${input.title}`;
  const parts = [base];
  if (input.online) parts.push('aktywna teraz');
  const unread = unreadPhrase(input.unreadCount);
  if (unread !== '') parts.push(unread);
  return parts.join(', ');
}

/**
 * Bąbelki kolumny: rozmowy nieprzeczytane, ostatnio otwierane i ta otwarta w
 * oknie. Kolejność bierzemy z wejścia (rdzeń sortuje malejąco po
 * `last_message_at`), więc świeża rozmowa wchodzi na górę bez drugiego
 * sortowania. Otwarta rozmowa ZAWSZE ma bąbelek — gdy nie mieści się w limicie,
 * wypycha ostatni, bo inaczej okno wisiałoby bez kotwicy.
 */
export function buildDockBubbles(input: DockBubblesInput): ChatBubbleView[] {
  const { conversations, selfId, directory, presence, openConversationId } = input;
  const max = Math.max(1, input.max ?? MAX_DOCK_BUBBLES);
  const recent = new Set(input.recentIds);
  const dismissed = input.dismissed ?? {};

  const toView = (conversation: ChatConversation): ChatBubbleView => {
    const title = conversationTitle(conversation, selfId, directory);
    const online = isConversationOnline(conversation, selfId, presence);
    const unreadCount = Math.max(0, Math.trunc(conversation.unreadCount));
    return {
      conversationId: conversation.id,
      kind: conversation.kind,
      title,
      initials: conversationInitials(conversation, selfId, directory),
      peerId: directPeerId(conversation, selfId),
      unreadCount,
      badge: formatUnreadBadge(unreadCount),
      online,
      active: conversation.id === openConversationId,
      ariaLabel: bubbleAriaLabel({ kind: conversation.kind, title, online, unreadCount }),
    };
  };

  // Otwarta rozmowa ZAWSZE zostaje (kotwica okna); zdjęta X-em znika bez
  // względu na nieprzeczytane, dopóki nie przyjdzie nowa wiadomość.
  const candidates = conversations.filter(
    (conversation) =>
      conversation.id === openConversationId ||
      (!isDismissed(dismissed, conversation) &&
        (conversation.unreadCount > 0 || recent.has(conversation.id))),
  );

  const visible = candidates.slice(0, max);
  const openMissing =
    openConversationId !== null &&
    candidates.some((conversation) => conversation.id === openConversationId) &&
    !visible.some((conversation) => conversation.id === openConversationId);
  if (openMissing) {
    const open = candidates.find((conversation) => conversation.id === openConversationId);
    if (open) visible.splice(max - 1, 1, open);
  }
  return visible.map(toView);
}

/**
 * Lista ostatnio otwieranych: `id` na czoło, bez duplikatów, przycięta do
 * limitu. Ta sama referencja, gdy nic się nie zmienia (bez zbędnego renderu).
 */
export function pushRecent(
  list: readonly string[],
  id: string,
  max: number = MAX_DOCK_BUBBLES,
): string[] {
  if (id === '') return list.slice();
  if (list[0] === id) return list.slice();
  return [id, ...list.filter((entry) => entry !== id)].slice(0, Math.max(1, max));
}

/**
 * Zdjęcie rozmowy z „ostatnio otwieranych" (X w nagłówku okna). Razem z
 * `dismissBubble` sprawia, że bąbelek schodzi z kolumny także przy
 * nieprzeczytanych. Ta sama referencja, gdy wpisu nie było.
 */
export function removeRecent(list: readonly string[], id: string): string[] {
  if (id === '' || !list.includes(id)) return list.slice();
  return list.filter((entry) => entry !== id);
}

/**
 * Szkice kompozytora, per rozmowa. Żyją w DOKU, nie w oknie: minimalizacja to
 * dziś zamknięcie okna (decyzja D1), więc stan lokalny `ChatWindow` znikałby
 * razem z odmontowaniem i wpisany tekst przepadał. Pamięć sesji (`useState`
 * doku) — świadomie NIE localStorage, bo jedyną granicą trwałości jest
 * `store/storage.ts`, a szkic czatu nie jest danymi planera.
 */
export type ChatDrafts = Readonly<Record<string, string>>;

/**
 * Zapis szkicu rozmowy. Pusta treść USUWA klucz (rozmowa bez szkicu nie ma
 * wpisu), a brak faktycznej zmiany oddaje TĘ SAMĄ referencję — dok nie
 * przerysowuje się przy wpisaniu i skasowaniu tego samego znaku.
 */
export function setDraftFor(drafts: ChatDrafts, id: string, value: string): ChatDrafts {
  if (id === '') return drafts;
  if (value === '') return clearDraftFor(drafts, id);
  if (drafts[id] === value) return drafts;
  return { ...drafts, [id]: value };
}

/** Skasowanie szkicu. Ta sama referencja, gdy nie było czego kasować. */
export function clearDraftFor(drafts: ChatDrafts, id: string): ChatDrafts {
  if (id === '' || !(id in drafts)) return drafts;
  const next = { ...drafts };
  delete next[id];
  return next;
}

/**
 * Powrót treści po NIEUDANEJ wysyłce.
 *
 * Pole pustoszeje w chwili naciśnięcia Enter, a nie po odpowiedzi serwera —
 * dzięki temu wysyłka nigdy nie musi zgadywać, co w polu jest jej tekstem, a co
 * dopisał użytkownik. Zgadywanie po treści (kasowanie identycznego szkicu,
 * odejmowanie wspólnego początku) albo gubiło świeże słowa, albo psuło szkic
 * napisany od nowa, który przypadkiem zaczynał się tak samo („no" → „nowy
 * plan").
 *
 * `ChatProvider` po porażce trzyma sam komunikat, nie treść, więc tekst musi
 * wrócić TUTAJ, inaczej przepada. Gdy pole jest puste — wraca dosłownie. Gdy
 * użytkownik zdążył coś napisać — nieudany tekst staje przed nim, oddzielony
 * nową linią: nic nie ginie i nic nie jest przepisywane znak po znaku, a
 * rozdzielenie tego na dwie wiadomości zostaje decyzją użytkownika.
 */
export function restoreFailedDraft(drafts: ChatDrafts, id: string, failed: string): ChatDrafts {
  if (id === '' || failed === '') return drafts;
  const current = drafts[id] ?? '';
  return setDraftFor(drafts, id, current === '' ? failed : `${failed}\n${current}`);
}

/** Wiersz listy rozmów w popoverze lupy. */
export interface ChatListRowView {
  conversationId: string;
  kind: ChatConversationKind;
  title: string;
  initials: string;
  peerId: string | null;
  /** Skrót ostatniej wiadomości z prefiksem autora. */
  preview: string;
  /** Godzina / „Wczoraj" / skrót daty; '' gdy rozmowa jest pusta. */
  time: string;
  unreadCount: number;
  badge: string;
  online: boolean;
  active: boolean;
}

export interface ConversationRowsInput {
  conversations: readonly ChatConversation[];
  selfId: string | null;
  directory: ChatDirectory;
  presence: ReadonlySet<string>;
  openConversationId: string | null;
  /** Dzisiejsza data 'yyyy-MM-dd' (wstrzykiwana — moduł zostaje czysty). */
  todayStr: string;
}

/**
 * Podgląd ostatniej wiadomości: „Ty: …" dla siebie, imię autora w grupie.
 * Wiadomość będąca samym adresem GIF-a pokazuje się jako „GIF" — surowy URL
 * z CDN-u dostawcy zajmowałby cały wiersz i nic nie mówił.
 */
export function previewText(
  conversation: ChatConversation,
  selfId: string | null,
  directory: ChatDirectory,
): string {
  const last = conversation.lastMessage;
  if (!last) return 'Brak wiadomości';
  const body = last.deletedAt !== null ? 'Wiadomość usunięta' : last.body.trim();
  const text =
    body === ''
      ? 'Wiadomość usunięta'
      : last.deletedAt === null && messageContentKind(body) === 'gif'
        ? 'GIF'
        : body.replace(/\s+/g, ' ');
  if (last.authorId === selfId) return `Ty: ${text}`;
  if (conversation.kind === 'group') return `${personLabel(directory, last.authorId)}: ${text}`;
  return text;
}

export function buildConversationRows(input: ConversationRowsInput): ChatListRowView[] {
  const { conversations, selfId, directory, presence, openConversationId, todayStr } = input;
  return conversations.map((conversation) => {
    const unreadCount = Math.max(0, Math.trunc(conversation.unreadCount));
    return {
      conversationId: conversation.id,
      kind: conversation.kind,
      title: conversationTitle(conversation, selfId, directory),
      initials: conversationInitials(conversation, selfId, directory),
      peerId: directPeerId(conversation, selfId),
      preview: previewText(conversation, selfId, directory),
      time: formatListTime(conversation.lastMessageAt, todayStr),
      unreadCount,
      badge: formatUnreadBadge(unreadCount),
      online: isConversationOnline(conversation, selfId, presence),
      active: conversation.id === openConversationId,
    };
  });
}

/** Normalizacja zapytania: bez ogonków, bez wielkości liter, przycięte. */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l');
}

function matches(haystack: string, needle: string): boolean {
  return normalizeQuery(haystack).includes(needle);
}

/** Filtr listy rozmów po tytule i podglądzie; puste zapytanie nie filtruje. */
export function filterConversationRows(
  rows: readonly ChatListRowView[],
  query: string,
): ChatListRowView[] {
  const needle = normalizeQuery(query);
  if (needle === '') return rows.slice();
  return rows.filter((row) => matches(row.title, needle) || matches(row.preview, needle));
}

/**
 * Osoby do rozpoczęcia DM-u: wszyscy poza mną, przefiltrowani zapytaniem
 * (imię, nazwisko, e-mail), posortowani nazwiskiem po polsku.
 */
export function filterPeople(
  people: readonly ChatPerson[],
  query: string,
  selfId: string | null,
): ChatPerson[] {
  const needle = normalizeQuery(query);
  const sorted = people
    .filter((person) => person.id !== '' && person.id !== selfId)
    .filter(
      (person) =>
        needle === '' ||
        matches(`${person.firstName} ${person.lastName}`, needle) ||
        matches(person.email, needle),
    );
  return sorted.sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'pl'),
  );
}
