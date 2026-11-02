// Typy domenowe modułu czatu (camelCase) — jedyne kształty, które widzi UI.
//
// GRANICE:
//   * Czat NIE wchodzi do reduktora (`src/store/AppStore.tsx`) ani do
//     localStorage (`src/store/storage.ts`). Żyje wyłącznie w chmurze i w stanie
//     `ChatProvider`; w trybie lokalnym moduł jest po prostu wyłączony.
//   * Wiersze bazy są snake_case — mapowanie na te typy żyje w `chatData.ts`.
//   * Znaczniki czasu to surowe stringi ISO z Postgresa (timestamptz). Nie
//     parsujemy ich do `Date` w warstwie danych: porównania (sortowanie,
//     kursor) działają leksykograficznie na kanonicznym ISO z serwera, a
//     formatowanie do UI jest zadaniem widoku.

import type { ChatAttachment } from './attachments';

/**
 * Rodzaj rozmowy: DM dwóch osób albo grupa z tytułem. Rozmowa zadania ma w
 * bazie `kind = 'group'` (decyzja L1) i rozpoznaje się ją po kontekście
 * (`contextType === 'task'`); `'task'` zostaje w unii na wypadek zmiany kontraktu.
 */
export type ChatConversationKind = 'direct' | 'group' | 'task';

/** Rola uczestnika (`conversation_members.role`). */
export type ChatMemberRole = 'owner' | 'member';

/** Uczestnik rozmowy. `userId` to chmurowy uuid (auth.users / core.profiles). */
export interface ChatMember {
  userId: string;
  role: ChatMemberRole;
  /** Watermark „przeczytane" tego uczestnika; null gdy nigdy nie czytał. */
  lastReadAt: string | null;
  /**
   * Wyciszenie (`conversation_members.muted_until`). W rozmowie zadania to
   * obserwowanie: null = obserwuje, 'infinity' = przestał. `undefined` = wiersz
   * nie niósł kolumny (stary `chat_overview`), czyli „nie wiadomo".
   */
  mutedUntil?: string | null;
}

/** Rodzaj wiersza w `messages`: wiadomość osoby albo wiersz systemowy (RPC). */
export type ChatMessageKind = 'text' | 'system';

/** Ładunek wiersza systemowego (`messages.meta`). Jeden typ na razie. */
export type ChatMessageMeta = {
  type: 'theme_changed';
  themeId: string;
  actorId: string;
};

/** Skrót ostatniej wiadomości renderowany na liście rozmów. */
export interface ChatLastMessage {
  id: string;
  authorId: string;
  body: string;
  kind: ChatMessageKind;
  createdAt: string;
  /** Znacznik miękkiego usunięcia; UI pokazuje wtedy „Wiadomość usunięta". */
  deletedAt: string | null;
  /** Liczba obrazów (`attachments_count` z overview); 0 gdy brak lub nieznana. */
  attachmentsCount?: number;
}

export interface ChatConversation {
  id: string;
  /** `conversations.context_type` ('task' dla rozmowy zadania); null = zwykły czat. */
  contextType?: string | null;
  /** `conversations.context_id` (id zadania); null = zwykły czat. */
  contextId?: string | null;
  kind: ChatConversationKind;
  /** Tytuł grupy; DM ma `null` (UI składa nazwę z profili uczestników). */
  title: string | null;
  members: ChatMember[];
  /** Autor rozmowy (`conversations.created_by`); null gdy wiersz go nie niesie. */
  createdBy: string | null;
  /** `conversations.last_message_at` — klucz sortowania listy (desc). */
  lastMessageAt: string | null;
  /** Motyw rozmowy (`conversations.theme_id`); nieznany id => domyślny w UI. */
  themeId: string;
  lastMessage: ChatLastMessage | null;
  /** Liczba nieprzeczytanych dla ZALOGOWANEGO użytkownika (z `chat_overview`). */
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  /** `system` = wiersz zdarzenia (treść buduje UI z `meta`); brak w wierszu = `text`. */
  kind: ChatMessageKind;
  /** Ładunek wiersza systemowego; null dla zwykłej wiadomości. */
  meta: ChatMessageMeta | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Id wiadomości, na którą to jest odpowiedź; null gdy brak. */
  replyTo: string | null;
  /** Obrazy (`messages.attachments`); pusta lista gdy brak. */
  attachments: ChatAttachment[];
  /** Oznaczone osoby (`messages.mention_ids`, chmurowe uuid). */
  mentionIds: string[];
  /** Przypięcie (`messages.pinned_at` / `pinned_by`); null = nieprzypięta. */
  pinnedAt: string | null;
  pinnedBy: string | null;
  /**
   * Rewizja wiersza do scalania wariantów (`messages.revised_at`: INSERT =
   * `created_at`, podbijana przez edycję, pin, odpin i kasowanie). Null na
   * bazie sprzed migracji; scalanie spada wtedy na `editedAt`, potem
   * `createdAt` (`messageRevision`). „(edytowana)” tylko z `editedAt`.
   */
  revisedAt: string | null;
}

/**
 * Reakcja emoji JEDNEJ osoby na JEDNĄ wiadomość (`n2click.message_reactions`).
 * Model Messengera: osoba ma na wiadomości najwyżej jedną reakcję — wybór
 * innego emoji podmienia, ponowny wybór tego samego zdejmuje.
 */
export interface ChatReaction {
  userId: string;
  /** Znak emoji dokładnie w postaci z `chatEmoji.ts` (allowlista `chat_emoji`). */
  emoji: string;
  createdAt: string;
}

/** Reakcje otwartej rozmowy: id wiadomości → lista (rosnąco po `createdAt`). */
export type ChatReactionMap = Readonly<Record<string, readonly ChatReaction[]>>;

/**
 * Zdarzenie `reaction` z kanału rozmowy (`realtime.send` w RPC
 * `chat_set_reaction`). Niesie PRZYPISANIE (osoba → emoji), nigdy liczniki:
 * powtórka, echo własnej zmiany i dowolna kolejność dojścia dają ten sam stan.
 */
export interface ChatReactionEvent {
  messageId: string;
  conversationId: string;
  userId: string;
  /** Nowe emoji; null = reakcja zdjęta. */
  emoji: string | null;
  createdAt: string;
}

/** Jedna „pigułka” pod dymkiem: emoji, liczba i kto (dla etykiety). */
export interface ChatReactionGroup {
  emoji: string;
  count: number;
  /** Zalogowany jest wśród reagujących (pigułka podświetlona, `aria-pressed`). */
  mine: boolean;
  userIds: string[];
}

/**
 * Szybki pasek reakcji (7 domyślnych Messengera + „+” w UI). Każdy znak MUSI
 * być w `EMOJI_CATEGORIES` — pilnuje tego `chatEmoji.test.ts`.
 */
export const CHAT_QUICK_REACTIONS: readonly string[] = ['❤️', '😆', '😮', '😢', '😡', '👍', '👎'];

/**
 * Kursor paginacji wiadomości. Porządek listy to `(created_at, id)` — sam
 * `created_at` nie wystarcza, bo dwie wiadomości mogą trafić w ten sam
 * mikrosekundowy znacznik i wtedy strona gubiłaby albo dublowała wiersz.
 */
export interface ChatMessageCursor {
  createdAt: string;
  id: string;
}

/** Strona wiadomości: zawsze rosnąco (najstarsza pierwsza), gotowa dla UI. */
export interface ChatMessagesPage {
  messages: ChatMessage[];
  /** Reakcje wiadomości tej strony (osadzenie `message_reactions` w select). */
  reactions: ChatReactionMap;
  /** `true` gdy serwer zwrócił pełną stronę — są starsze wiadomości. */
  hasMore: boolean;
  /** Kursor do pobrania KOLEJNEJ (starszej) strony; null gdy nie ma czego. */
  cursor: ChatMessageCursor | null;
}

/** Wynik operacji warstwy danych — nigdy nie rzucamy wyjątkiem do UI. */
export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Maksymalna długość treści (CHECK `body` 1..4000 w migracji). */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;

/** Rozmiar strony wiadomości (kontrakt: limit 50). */
export const CHAT_PAGE_SIZE = 50;

/**
 * Ile stron wolno dociągnąć jednym nadrabianiem luki po powrocie kanału.
 * Przerwa dłuższa niż jedna strona zostawiłaby DZIURĘ w środku listy, której
 * `loadOlder` (idzie wstecz od najstarszej) nigdy by nie zasypał, więc
 * nadrabiamy w pętli. Po przekroczeniu limitu bezpieczniej jest odtworzyć
 * listę od pierwszej strony niż zostawić ją z ubytkiem.
 */
export const CHAT_CATCHUP_MAX_PAGES = 20;

/** Odstęp między kolejnymi sygnałami „pisze…" wysyłanymi przez nas. */
export const CHAT_TYPING_THROTTLE_MS = 3000;

/** Jak długo cudzy sygnał „pisze…" pozostaje ważny bez odświeżenia. */
export const CHAT_TYPING_TTL_MS = 6000;

/** Polskie komunikaty błędów — nigdy nie pokazujemy surowego tekstu z SDK. */
export const CHAT_MESSAGES = {
  load: 'Nie udało się wczytać rozmów.',
  messages: 'Nie udało się wczytać wiadomości.',
  send: 'Nie udało się wysłać wiadomości.',
  open: 'Nie udało się otworzyć rozmowy.',
  taskForbidden: 'Brak dostępu do rozmowy tego zadania.',
  create: 'Nie udało się utworzyć grupy.',
  markRead: 'Nie udało się zapisać odczytu rozmowy.',
  react: 'Nie udało się zapisać reakcji.',
  theme: 'Nie udało się zmienić motywu.',
  reactUnsupported: 'Tego emoji nie da się użyć jako reakcji.',
  emptyBody: 'Wiadomość nie może być pusta.',
  tooLongBody: `Wiadomość może mieć najwyżej ${CHAT_MESSAGE_MAX_LENGTH} znaków.`,
  edit: 'Nie udało się zmienić wiadomości.',
  remove: 'Nie udało się usunąć wiadomości.',
  pin: 'Nie udało się zmienić przypięcia.',
  follow: 'Nie udało się zmienić obserwowania.',
  attachments: 'Nie udało się dołączyć obrazów.',
  tooManyAttachments: 'Wiadomość może mieć najwyżej 10 obrazów.',
  emptyTitle: 'Podaj nazwę grupy.',
  noMembers: 'Wybierz co najmniej jedną osobę.',
  selfDirect: 'Nie można rozpocząć rozmowy z samym sobą.',
} as const;

export function isChatConversationKind(value: unknown): value is ChatConversationKind {
  return value === 'direct' || value === 'group' || value === 'task';
}

export function isChatMemberRole(value: unknown): value is ChatMemberRole {
  return value === 'owner' || value === 'member';
}

export function isChatMessageKind(value: unknown): value is ChatMessageKind {
  return value === 'text' || value === 'system';
}

/** Zdarzenie `theme_changed` z kanału rozmowy (`realtime.send` w RPC). */
export interface ChatThemeChangedEvent {
  conversationId: string;
  themeId: string;
  actorId: string;
}

/** Dodatki wysyłki: odpowiedź, obrazy (już wgrane przez L2) i wzmianki. */
export interface ChatSendOptions {
  replyTo?: string | null;
  attachments?: readonly ChatAttachment[];
  mentionIds?: readonly string[];
}

/** Zdarzenie `read` z kanału rozmowy (trigger `chat_broadcast_read`, L1). */
export interface ChatReadEvent {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}
