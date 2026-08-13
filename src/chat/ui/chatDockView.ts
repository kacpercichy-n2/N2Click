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
  max?: number;
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

  const candidates = conversations.filter(
    (conversation) =>
      conversation.unreadCount > 0 ||
      recent.has(conversation.id) ||
      conversation.id === openConversationId,
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

/** Podgląd ostatniej wiadomości: „Ty: …" dla siebie, imię autora w grupie. */
export function previewText(
  conversation: ChatConversation,
  selfId: string | null,
  directory: ChatDirectory,
): string {
  const last = conversation.lastMessage;
  if (!last) return 'Brak wiadomości';
  const body = last.deletedAt !== null ? 'Wiadomość usunięta' : last.body.trim();
  const text = body === '' ? 'Wiadomość usunięta' : body.replace(/\s+/g, ' ');
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
