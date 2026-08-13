// Czysta redukcja stanu czatu: lista rozmów, lista wiadomości otwartej rozmowy
// i sygnały „pisze…". Zero Reacta, zero SDK — `ChatProvider` tylko woła te
// funkcje w `setState`, dzięki czemu cała logika (dedup, przeliczenie
// nieprzeczytanych, resort) jest testowalna w node.
//
// INVARIANT REFERENCJI: każda funkcja zwraca TĘ SAMĄ tablicę, gdy nic się nie
// zmienia. Provider trzyma je w `useState`, więc nowa referencja = przerenderowanie
// całego drzewa czatu; broadcast, który nic nie wnosi (echo własnej wiadomości,
// powtórka zdarzenia), nie ma prawa go wywoływać.
import {
  CHAT_TYPING_TTL_MS,
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
  type ChatMessageCursor,
} from './types';

/**
 * Porównanie znaczników czasu. Wszystkie pochodzą z jednego źródła (Postgres
 * przez PostgREST), więc mają ten sam format i strefę — porównanie
 * leksykograficzne jest poprawne i nie gubi mikrosekund, które `Date.parse`
 * obcina do milisekund.
 */
function compareTimestamps(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Porządek listy wiadomości: `(created_at, id)` rosnąco — jak kursor bazy. */
function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const byTime = compareTimestamps(a.createdAt, b.createdAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rozmowy od najświeższej. Rozmowa bez `lastMessageAt` (pusta, dopiero
 * utworzona) ląduje na końcu; remis rozstrzyga id, żeby kolejność była stabilna
 * między renderami.
 */
export function sortConversations(list: ChatConversation[]): ChatConversation[] {
  return list.slice().sort((a, b) => {
    if (a.lastMessageAt === b.lastMessageAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return -compareTimestamps(a.lastMessageAt, b.lastMessageAt);
  });
}

/** Suma nieprzeczytanych (odznaka na bąbelku). */
export function totalUnread(list: ChatConversation[]): number {
  return list.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

export interface IncomingMessageContext {
  /** Zalogowany użytkownik — jego własne wiadomości nigdy nie są nieprzeczytane. */
  selfId: string | null;
  /** Otwarta rozmowa — jej wiadomości czytamy od razu, więc licznik nie rośnie. */
  openConversationId: string | null;
}

/**
 * Nowa wiadomość (broadcast INSERT albo echo własnej wysyłki) na liście rozmów:
 * podbija `lastMessage`/`lastMessageAt`, ewentualnie licznik nieprzeczytanych i
 * przesortowuje listę. Nieznana rozmowa => lista bez zmian (provider dociąga
 * wtedy overview — to jedyne źródło prawdy o nowej rozmowie).
 */
export function applyIncomingMessage(
  list: ChatConversation[],
  message: ChatMessage,
  context: IncomingMessageContext,
): ChatConversation[] {
  const index = list.findIndex((conversation) => conversation.id === message.conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  // Dedup echa: ten sam wiersz jest już podsumowaniem rozmowy.
  if (conversation.lastMessage && conversation.lastMessage.id === message.id) return list;

  const isNewer =
    !conversation.lastMessageAt ||
    compareTimestamps(message.createdAt, conversation.lastMessageAt) >= 0;
  const countsAsUnread =
    message.conversationId !== context.openConversationId &&
    message.authorId !== context.selfId &&
    message.deletedAt === null;

  const next: ChatConversation = {
    ...conversation,
    lastMessage: isNewer
      ? {
          id: message.id,
          authorId: message.authorId,
          body: message.body,
          createdAt: message.createdAt,
          deletedAt: message.deletedAt,
        }
      : conversation.lastMessage,
    lastMessageAt: isNewer ? message.createdAt : conversation.lastMessageAt,
    unreadCount: countsAsUnread ? conversation.unreadCount + 1 : conversation.unreadCount,
  };
  const nextList = list.slice();
  nextList[index] = next;
  return sortConversations(nextList);
}

/**
 * Edycja / miękkie usunięcie (broadcast UPDATE): dotyka wyłącznie podsumowania,
 * gdy to wciąż ta sama ostatnia wiadomość. Licznika nieprzeczytanych nie ruszamy
 * — edycja nie jest nową wiadomością.
 */
export function applyMessageUpdate(
  list: ChatConversation[],
  message: ChatMessage,
): ChatConversation[] {
  const index = list.findIndex((conversation) => conversation.id === message.conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  const last = conversation.lastMessage;
  if (!last || last.id !== message.id) return list;
  if (last.body === message.body && last.deletedAt === message.deletedAt) return list;
  const nextList = list.slice();
  nextList[index] = {
    ...conversation,
    lastMessage: { ...last, body: message.body, deletedAt: message.deletedAt },
  };
  return nextList;
}

/**
 * Optymistyczne „przeczytane": zeruje licznik i przesuwa watermark zalogowanego
 * uczestnika. Serwerowy UPDATE leci równolegle; kolejne overview i tak nadpisze
 * wartości autorytatywnie.
 */
export function markConversationRead(
  list: ChatConversation[],
  conversationId: string,
  selfId: string | null,
  atIso: string,
): ChatConversation[] {
  const index = list.findIndex((conversation) => conversation.id === conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  const selfMember = selfId
    ? conversation.members.find((member) => member.userId === selfId)
    : undefined;
  if (conversation.unreadCount === 0 && (!selfMember || selfMember.lastReadAt === atIso)) {
    return list;
  }
  const members: ChatMember[] = selfId
    ? conversation.members.map((member) =>
        member.userId === selfId ? { ...member, lastReadAt: atIso } : member,
      )
    : conversation.members;
  const nextList = list.slice();
  nextList[index] = { ...conversation, unreadCount: 0, members };
  return nextList;
}

/**
 * Scala wiadomości (strona wstecz, nadrobienie luki, broadcast, echo wysyłki)
 * po id: nowszy wiersz wygrywa, wynik zawsze rosnąco. Deduplikacja po id jest
 * powodem, dla którego wysyłka może od razu wstawić swoją wiadomość — późniejszy
 * broadcast INSERT tego samego wiersza niczego nie zdubluje.
 */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((message) => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (!previous) {
      byId.set(message.id, message);
      changed = true;
      continue;
    }
    // Konflikt id rozstrzyga REWIZJA, nie kolejność dojścia: równoległe
    // pobranie strony mogło ruszyć PRZED edycją/skasowaniem, które broadcast
    // zdążył już nanieść — ślepe „przychodzący wygrywa" cofałoby wtedy
    // wiadomość do starszego snapshota (przegląd 2026-08-13).
    const winner = newerMessageVariant(previous, message);
    if (winner !== previous && !sameMessage(previous, winner)) {
      byId.set(message.id, winner);
      changed = true;
    }
  }
  if (!changed) return existing;
  return Array.from(byId.values()).sort(compareMessages);
}

/**
 * Nowszy wariant tej samej wiadomości. Kasowanie miękkie jest TERMINALNE
 * (modelu „odkasowania" nie ma), więc wariant z `deletedAt` wygrywa zawsze.
 * Poza tym rozstrzyga ŚCIŚLE późniejszy `editedAt`, a REMIS zostawia wariant
 * już posiadany. Remis jest bezpieczny wyłącznie dzięki serwerowej gwarancji:
 * trigger `chat_messages_stamp_edit` (20260813200000) podbija `edited_at`
 * z zegara Postgresa przy KAŻDEJ zmianie `body`, więc identyczna rewizja =
 * identyczna treść — bez tej gwarancji remis był nierozstrzygalny (dowolny
 * wybór cofał edycję starym snapshotem albo ją ignorował). Znaczniki zawsze
 * z Postgresa, więc porównanie leksykalne jest poprawne.
 */
function newerMessageVariant(previous: ChatMessage, incoming: ChatMessage): ChatMessage {
  if (previous.deletedAt !== null || incoming.deletedAt !== null) {
    return previous.deletedAt !== null ? previous : incoming;
  }
  return (incoming.editedAt ?? '') > (previous.editedAt ?? '') ? incoming : previous;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.body === b.body &&
    a.createdAt === b.createdAt &&
    a.editedAt === b.editedAt &&
    a.deletedAt === b.deletedAt
  );
}

/** Kursor najnowszej znanej wiadomości — punkt startu nadrabiania luki. */
export function newestMessageCursor(messages: ChatMessage[]): ChatMessageCursor | null {
  if (messages.length === 0) return null;
  const newest = messages[messages.length - 1];
  return { createdAt: newest.createdAt, id: newest.id };
}

/** Kursor najstarszej znanej wiadomości — punkt startu strony wstecz. */
export function oldestMessageCursor(messages: ChatMessage[]): ChatMessageCursor | null {
  if (messages.length === 0) return null;
  const oldest = messages[0];
  return { createdAt: oldest.createdAt, id: oldest.id };
}

// ---- Sygnały „pisze…" --------------------------------------------------------

export interface ChatTypingEntry {
  userId: string;
  /** Znacznik (ms), po którym sygnał wygasa bez odświeżenia. */
  expiresAt: number;
}

/**
 * Odbiór cudzego sygnału: odświeża wpis nadawcy i sprząta wygasłe. Sygnały są
 * ulotne z zasady — nadawca może zamknąć kartę i nigdy nie wysłać „przestałem",
 * więc jedynym pewnym mechanizmem wygaszenia jest TTL po stronie odbiorcy.
 */
export function applyTypingSignal(
  entries: ChatTypingEntry[],
  userId: string,
  now: number,
  ttlMs: number = CHAT_TYPING_TTL_MS,
): ChatTypingEntry[] {
  if (userId === '') return entries;
  const kept = entries.filter((entry) => entry.expiresAt > now && entry.userId !== userId);
  return [...kept, { userId, expiresAt: now + ttlMs }];
}

/** Usuwa wygasłe wpisy; brak wygasłych => ta sama referencja. */
export function pruneTyping(entries: ChatTypingEntry[], now: number): ChatTypingEntry[] {
  const kept = entries.filter((entry) => entry.expiresAt > now);
  return kept.length === entries.length ? entries : kept;
}

/** Usuwa wpis autora (wysłał wiadomość, więc już nie pisze). */
export function removeTyping(entries: ChatTypingEntry[], userId: string): ChatTypingEntry[] {
  const kept = entries.filter((entry) => entry.userId !== userId);
  return kept.length === entries.length ? entries : kept;
}

/** Identyfikatory piszących (bez wygasłych), gotowe dla UI. */
export function typingUserIds(entries: ChatTypingEntry[], now: number): string[] {
  return entries.filter((entry) => entry.expiresAt > now).map((entry) => entry.userId);
}
