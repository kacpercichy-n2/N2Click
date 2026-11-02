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
  type ChatReaction,
  type ChatReactionEvent,
  type ChatReactionGroup,
  type ChatReactionMap,
  type ChatReadEvent,
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
          kind: message.kind,
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
  return messageRevision(incoming) > messageRevision(previous) ? incoming : previous;
}

/**
 * Rewizja wariantu: `revisedAt` (gdy L1 doda kolumnę podbijaną przy KAŻDEJ
 * zmianie, także przypięciu), inaczej `editedAt`. Szkic L1 podbija `edited_at`
 * przy przypięciu, więc obie drogi dają monotoniczną rewizję.
 */
function messageRevision(message: ChatMessage): string {
  return message.revisedAt ?? message.editedAt ?? '';
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.body === b.body &&
    a.createdAt === b.createdAt &&
    a.editedAt === b.editedAt &&
    a.deletedAt === b.deletedAt &&
    a.pinnedAt === b.pinnedAt &&
    a.pinnedBy === b.pinnedBy &&
    a.revisedAt === b.revisedAt
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

// ---- Reakcje emoji -----------------------------------------------------------
//
// Stan reakcji to mapa `id wiadomości → lista (osoba, emoji, kiedy)`, trzymana
// OBOK listy wiadomości: broadcast INSERT/UPDATE wiadomości nie niesie reakcji,
// więc gdyby siedziały w `ChatMessage`, każde echo edycji by je wymazywało.
// Każda operacja niżej jest idempotentna (powtórka = ta sama referencja).

function sameReaction(a: ChatReaction, b: ChatReaction): boolean {
  return a.userId === b.userId && a.emoji === b.emoji && a.createdAt === b.createdAt;
}

function sameReactionList(a: readonly ChatReaction[], b: readonly ChatReaction[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((reaction, index) => sameReaction(reaction, b[index]));
}

/** Porządek listy reakcji: kolejność dodania, potem osoba (jak `order by` w RPC). */
function compareReactions(a: ChatReaction, b: ChatReaction): number {
  const byTime = compareTimestamps(a.createdAt, b.createdAt);
  if (byTime !== 0) return byTime;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/**
 * Scala autorytatywne listy z serwera (strona wiadomości, odpowiedź RPC,
 * dociągnięcie po powrocie kanału): wiadomość z `incoming` dostaje DOKŁADNIE
 * podaną listę. Pusta lista też jest informacją (ktoś zdjął ostatnią reakcję).
 */
export function mergeReactions(current: ChatReactionMap, incoming: ChatReactionMap): ChatReactionMap {
  let next: Record<string, readonly ChatReaction[]> | null = null;
  for (const [messageId, list] of Object.entries(incoming)) {
    const previous = current[messageId];
    const sorted = list.slice().sort(compareReactions);
    if (previous !== undefined && sameReactionList(previous, sorted)) continue;
    if (previous === undefined && sorted.length === 0) continue;
    if (next === null) next = { ...current };
    next[messageId] = sorted;
  }
  return next ?? current;
}

/**
 * Zdarzenie `reaction` (broadcast) albo optymistyczna zmiana własna: ustawia
 * lub zdejmuje przypisanie (osoba → emoji) jednej wiadomości. Model Messengera
 * (jedna reakcja na osobę), więc wpis tej osoby jest zawsze najwyżej jeden.
 */
export function applyReactionEvent(current: ChatReactionMap, event: ChatReactionEvent): ChatReactionMap {
  if (event.messageId === '' || event.userId === '') return current;
  const list = current[event.messageId] ?? [];
  const existing = list.find((reaction) => reaction.userId === event.userId);
  if (event.emoji === null) {
    if (!existing) return current;
    // Zdjęcie starsze niż znany wpis (spóźnione echo) nie cofa nowszej reakcji.
    if (event.createdAt !== '' && existing.createdAt > event.createdAt) return current;
    const kept = list.filter((reaction) => reaction.userId !== event.userId);
    return { ...current, [event.messageId]: kept };
  }
  if (existing && existing.emoji === event.emoji) return current;
  // Znaczniki z jednego zegara Postgresa: zdarzenie starsze niż znany wpis tej
  // osoby jest spóźnionym echem i przegrywa z nowszym stanem (przegląd Codex).
  if (existing && event.createdAt !== '' && existing.createdAt > event.createdAt) return current;
  const replaced: ChatReaction = {
    userId: event.userId,
    emoji: event.emoji,
    createdAt: event.createdAt,
  };
  const others = list.filter((reaction) => reaction.userId !== event.userId);
  return {
    ...current,
    [event.messageId]: [...others, replaced].sort(compareReactions),
  };
}

/**
 * Pigułki pod dymkiem: grupowanie po emoji, najliczniejsze pierwsze, remis
 * rozstrzyga najwcześniejsza reakcja (stabilnie między renderami).
 */
export function groupReactions(
  list: readonly ChatReaction[],
  selfId: string | null,
): ChatReactionGroup[] {
  const groups = new Map<string, { group: ChatReactionGroup; firstAt: string }>();
  for (const reaction of list) {
    const entry = groups.get(reaction.emoji);
    if (entry) {
      entry.group.count += 1;
      entry.group.userIds.push(reaction.userId);
      if (reaction.userId === selfId) entry.group.mine = true;
      continue;
    }
    groups.set(reaction.emoji, {
      firstAt: reaction.createdAt,
      group: {
        emoji: reaction.emoji,
        count: 1,
        mine: reaction.userId === selfId,
        userIds: [reaction.userId],
      },
    });
  }
  return Array.from(groups.values())
    .sort((a, b) => {
      if (a.group.count !== b.group.count) return b.group.count - a.group.count;
      const byTime = compareTimestamps(a.firstAt, b.firstAt);
      if (byTime !== 0) return byTime;
      return a.group.emoji < b.group.emoji ? -1 : a.group.emoji > b.group.emoji ? 1 : 0;
    })
    .map((entry) => entry.group);
}

/** Aktualne emoji zalogowanego na wiadomości; null gdy brak reakcji. */
export function ownReaction(list: readonly ChatReaction[], selfId: string | null): string | null {
  if (selfId === null) return null;
  return list.find((reaction) => reaction.userId === selfId)?.emoji ?? null;
}

/**
 * Stan DOCELOWY po kliknięciu emoji (toggle liczony po stronie klienta): to
 * samo co obecne => zdejmij (null), inne albo brak => ustaw. RPC dostaje wynik,
 * nie „przełącz”, więc podwójne kliknięcie nie robi podwójnego przełączenia.
 */
export function nextReactionIntent(
  list: readonly ChatReaction[],
  selfId: string | null,
  clicked: string,
): string | null {
  return ownReaction(list, selfId) === clicked ? null : clicked;
}

// ---- Motyw rozmowy -----------------------------------------------------------

/**
 * Zmiana motywu (event `theme_changed` albo własny zapis): podmienia `themeId`
 * jednej rozmowy. Ta sama wartość / nieznana rozmowa => ta sama referencja.
 */
export function applyConversationTheme(
  list: ChatConversation[],
  conversationId: string,
  themeId: string,
): ChatConversation[] {
  const index = list.findIndex((conversation) => conversation.id === conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  if (conversation.themeId === themeId) return list;
  const nextList = list.slice();
  nextList[index] = { ...conversation, themeId };
  return nextList;
}

// ---- Karta zadania v2 ---------------------------------------------------------

/** Rozmowa zadania (kontekst 'task'); dok jej nie pokazuje. */
export function isTaskConversation(conversation: ChatConversation): boolean {
  return conversation.kind === 'task' || conversation.contextType === 'task';
}

/** Rozmowa zadania o danym id zadania (jedna na zadanie, unikalny indeks L1). */
export function findTaskConversation(
  list: readonly ChatConversation[],
  taskId: string,
): ChatConversation | null {
  if (taskId === '') return null;
  return list.find((c) => isTaskConversation(c) && c.contextId === taskId) ?? null;
}

/** Nieprzeczytane w rozmowie zadania (odznaka na karcie); 0 gdy rozmowy nie ma. */
export function taskConversationUnread(
  list: readonly ChatConversation[],
  taskId: string,
): number {
  return findTaskConversation(list, taskId)?.unreadCount ?? 0;
}

/** Lista doku: rozmowy zadań zostają w kartach zadań (ta sama referencja, gdy nic nie odpada). */
export function dockConversations(list: ChatConversation[]): ChatConversation[] {
  return list.some(isTaskConversation) ? list.filter((c) => !isTaskConversation(c)) : list;
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Zdarzenie `read`: przesuwa watermark JEDNEGO członka, wyłącznie do przodu
 * (spóźnione echo nie cofa). Znaczniki bywają w dwóch formatach ('Z' z klienta,
 * '+00:00' z Postgresa), więc porównujemy liczbowo, nie leksykalnie.
 * Brak zmiany => ta sama referencja listy.
 */
export function applyReadReceipt(
  list: ChatConversation[],
  event: ChatReadEvent,
): ChatConversation[] {
  const index = list.findIndex((c) => c.id === event.conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  const memberIndex = conversation.members.findIndex((m) => m.userId === event.userId);
  if (memberIndex === -1) return list;
  const member = conversation.members[memberIndex];
  if (timestampMs(member.lastReadAt) >= timestampMs(event.lastReadAt)) return list;
  const members = conversation.members.slice();
  members[memberIndex] = { ...member, lastReadAt: event.lastReadAt };
  const next = list.slice();
  next[index] = { ...conversation, members };
  return next;
}

/**
 * Autorytatywny skład jednej rozmowy (osobny select z `muted_until`): podmienia
 * członków, ale watermarku nie cofa (broadcast `read` mógł dojść wcześniej).
 */
export function applyConversationMembers(
  list: ChatConversation[],
  conversationId: string,
  members: readonly ChatMember[],
): ChatConversation[] {
  const index = list.findIndex((c) => c.id === conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  const known = new Map(conversation.members.map((m) => [m.userId, m]));
  const merged = members.map((member) => {
    const previous = known.get(member.userId);
    if (previous && timestampMs(previous.lastReadAt) > timestampMs(member.lastReadAt)) {
      return { ...member, lastReadAt: previous.lastReadAt };
    }
    return member;
  });
  const same =
    merged.length === conversation.members.length &&
    merged.every((m, i) => {
      const p = conversation.members[i];
      return (
        p.userId === m.userId &&
        p.role === m.role &&
        p.lastReadAt === m.lastReadAt &&
        p.mutedUntil === m.mutedUntil
      );
    });
  if (same) return list;
  const next = list.slice();
  next[index] = { ...conversation, members: merged };
  return next;
}

/**
 * Świeże overview niesie członków BEZ `muted_until` (stary `chat_overview`),
 * a osobny select ją zna. Przenosimy znaną wartość, gdy nowa jest nieznana
 * (`undefined`), żeby każde odświeżenie listy nie przełączało dzwonka.
 */
export function carryMemberDetails(
  previous: readonly ChatConversation[],
  next: ChatConversation[],
): ChatConversation[] {
  if (previous.length === 0) return next;
  const byId = new Map(previous.map((c) => [c.id, c]));
  let changed = false;
  const result = next.map((conversation) => {
    const old = byId.get(conversation.id);
    if (!old) return conversation;
    const oldMembers = new Map(old.members.map((m) => [m.userId, m]));
    let touched = false;
    const members = conversation.members.map((member) => {
      const known = oldMembers.get(member.userId);
      if (member.mutedUntil !== undefined || known?.mutedUntil === undefined) return member;
      touched = true;
      return { ...member, mutedUntil: known.mutedUntil };
    });
    if (!touched) return conversation;
    changed = true;
    return { ...conversation, members };
  });
  return changed ? result : next;
}

/**
 * Obserwowanie: wyciszenie bezterminowe (`muted_until` w przyszłości albo
 * 'infinity') = nie obserwuje. `undefined` (kolumna nieznana) liczymy jako
 * obserwuje: domyślny stan każdego członka po dołączeniu.
 */
export function isFollowing(member: ChatMember | undefined, nowMs: number = Date.now()): boolean {
  if (!member) return false;
  const muted = member.mutedUntil;
  if (muted === undefined || muted === null) return true;
  if (muted === 'infinity') return false;
  const until = Date.parse(muted);
  return !Number.isFinite(until) || until <= nowMs;
}

/** Obserwujący rozmowę (awatary w nagłówku panelu zadania), kolejność członków. */
export function followerIds(conversation: ChatConversation, nowMs: number = Date.now()): string[] {
  return conversation.members.filter((m) => isFollowing(m, nowMs)).map((m) => m.userId);
}

/** Optymistyczne obserwuj / przestań obserwować dla zalogowanego. */
export function applyFollowState(
  list: ChatConversation[],
  conversationId: string,
  selfId: string | null,
  follow: boolean,
): ChatConversation[] {
  if (selfId === null) return list;
  const index = list.findIndex((c) => c.id === conversationId);
  if (index === -1) return list;
  const conversation = list[index];
  const memberIndex = conversation.members.findIndex((m) => m.userId === selfId);
  if (memberIndex === -1) return list;
  const member = conversation.members[memberIndex];
  const mutedUntil = follow ? null : 'infinity';
  if (member.mutedUntil === mutedUntil) return list;
  const members = conversation.members.slice();
  members[memberIndex] = { ...member, mutedUntil };
  const next = list.slice();
  next[index] = { ...conversation, members };
  return next;
}

/** Członek z watermarkiem widoczny pod wiadomością („Widziane przez”). */
export interface ChatSeenBy {
  userId: string;
  lastReadAt: string;
}

/**
 * Seen-by w stylu Messengera: KAŻDY członek (poza zalogowanym) pojawia się
 * dokładnie raz, pod najnowszą wczytaną wiadomością (nie systemową), którą
 * przeczytał, czyli `createdAt <= lastReadAt`. Gdy ta wiadomość jest JEGO
 * własna, awatara nie ma wcale: odpowiedź sama mówi, że widział wcześniejsze
 * (jak Messenger, który wtedy zdejmuje „Widziane”). Usunięte też się liczą
 * (placeholder zostaje w liście). Wynik: id wiadomości → osoby.
 */
export function seenByMessage(
  messages: readonly ChatMessage[],
  members: readonly ChatMember[],
  selfId: string | null,
): Record<string, ChatSeenBy[]> {
  const result: Record<string, ChatSeenBy[]> = {};
  for (const member of members) {
    if (member.userId === selfId || member.lastReadAt === null) continue;
    const readMs = timestampMs(member.lastReadAt);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.kind === 'system') continue;
      if (timestampMs(message.createdAt) > readMs) continue;
      if (message.authorId !== member.userId) {
        (result[message.id] ??= []).push({ userId: member.userId, lastReadAt: member.lastReadAt });
      }
      break;
    }
  }
  return result;
}

/** Przypięte (nieusunięte) wiadomości, najświeżej przypięta pierwsza. */
export function pinnedMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.pinnedAt !== null && m.deletedAt === null)
    .sort((a, b) => timestampMs(b.pinnedAt) - timestampMs(a.pinnedAt));
}

// ---- Wątki (kilka rozmów żywych naraz: dok + panel zadania) ---------------------

/** Stan jednej wczytanej rozmowy. Provider trzyma mapę id → wątek. */
export interface ChatThreadState {
  messages: ChatMessage[];
  reactions: ChatReactionMap;
  /** Trwa wczytywanie (pierwsza strona albo starsza). */
  loading: boolean;
  /** Pierwsza strona doszła (odróżnia „pusto” od „jeszcze nie wiadomo”). */
  loaded: boolean;
  hasMore: boolean;
  typing: ChatTypingEntry[];
  /** Polski komunikat nieudanego wczytania; null = w porządku. */
  error: string | null;
}

export const EMPTY_THREAD: ChatThreadState = Object.freeze({
  messages: [],
  reactions: {},
  loading: false,
  loaded: false,
  hasMore: false,
  typing: [],
  error: null,
}) as ChatThreadState;

export type ChatThreadMap = Readonly<Record<string, ChatThreadState>>;

/**
 * Zmiana jednego wątku. `update` dostaje bieżący wątek; zwrócenie tego samego
 * obiektu = brak zmiany = ta sama referencja mapy (invariant referencji).
 * Nieistniejący wątek NIE powstaje (zdarzenie dla rozmowy, której nikt nie
 * ogląda, nie ma gdzie trafić); do zakładania służy `ensureThread`.
 */
export function updateThread(
  threads: ChatThreadMap,
  conversationId: string,
  update: (thread: ChatThreadState) => ChatThreadState,
): ChatThreadMap {
  const current = threads[conversationId];
  if (current === undefined) return threads;
  const next = update(current);
  if (next === current) return threads;
  return { ...threads, [conversationId]: next };
}

/** Zakłada pusty wątek (w trakcie wczytywania), gdy go nie ma. */
export function ensureThread(threads: ChatThreadMap, conversationId: string): ChatThreadMap {
  if (conversationId === '' || threads[conversationId] !== undefined) return threads;
  return { ...threads, [conversationId]: { ...EMPTY_THREAD, loading: true } };
}

/** Zostawia wyłącznie wątki z `keep`; nic do usunięcia => ta sama referencja. */
export function retainThreads(threads: ChatThreadMap, keep: ReadonlySet<string>): ChatThreadMap {
  const ids = Object.keys(threads);
  if (ids.every((id) => keep.has(id))) return threads;
  const next: Record<string, ChatThreadState> = {};
  for (const id of ids) if (keep.has(id)) next[id] = threads[id];
  return next;
}

/** Scalenie wiadomości do wątku (strona, broadcast, echo wysyłki). */
export function mergeThreadMessages(
  thread: ChatThreadState,
  incoming: ChatMessage[],
): ChatThreadState {
  const messages = mergeMessages(thread.messages, incoming);
  return messages === thread.messages ? thread : { ...thread, messages };
}

/** Scalenie autorytatywnych reakcji do wątku. */
export function mergeThreadReactions(
  thread: ChatThreadState,
  incoming: ChatReactionMap,
): ChatThreadState {
  const reactions = mergeReactions(thread.reactions, incoming);
  return reactions === thread.reactions ? thread : { ...thread, reactions };
}

/** Zmiana pól skalarnych wątku; te same wartości => ten sam obiekt. */
export function patchThread(
  thread: ChatThreadState,
  patch: Partial<Pick<ChatThreadState, 'loading' | 'loaded' | 'hasMore' | 'error'>>,
): ChatThreadState {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (keys.every((key) => thread[key] === patch[key])) return thread;
  return { ...thread, ...patch };
}
