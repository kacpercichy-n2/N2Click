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

/** Rodzaj rozmowy: DM dwóch osób albo grupa z tytułem. */
export type ChatConversationKind = 'direct' | 'group';

/** Rola uczestnika (`conversation_members.role`). */
export type ChatMemberRole = 'owner' | 'member';

/** Uczestnik rozmowy. `userId` to chmurowy uuid (auth.users / core.profiles). */
export interface ChatMember {
  userId: string;
  role: ChatMemberRole;
  /** Watermark „przeczytane" tego uczestnika; null gdy nigdy nie czytał. */
  lastReadAt: string | null;
}

/** Skrót ostatniej wiadomości renderowany na liście rozmów. */
export interface ChatLastMessage {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  /** Znacznik miękkiego usunięcia; UI pokazuje wtedy „Wiadomość usunięta". */
  deletedAt: string | null;
}

export interface ChatConversation {
  id: string;
  kind: ChatConversationKind;
  /** Tytuł grupy; DM ma `null` (UI składa nazwę z profili uczestników). */
  title: string | null;
  members: ChatMember[];
  /** Autor rozmowy (`conversations.created_by`); null gdy wiersz go nie niesie. */
  createdBy: string | null;
  /** `conversations.last_message_at` — klucz sortowania listy (desc). */
  lastMessageAt: string | null;
  lastMessage: ChatLastMessage | null;
  /** Liczba nieprzeczytanych dla ZALOGOWANEGO użytkownika (z `chat_overview`). */
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Id wiadomości, na którą to jest odpowiedź; null gdy brak. */
  replyTo: string | null;
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
  create: 'Nie udało się utworzyć grupy.',
  markRead: 'Nie udało się zapisać odczytu rozmowy.',
  react: 'Nie udało się zapisać reakcji.',
  reactUnsupported: 'Tego emoji nie da się użyć jako reakcji.',
  emptyBody: 'Wiadomość nie może być pusta.',
  tooLongBody: `Wiadomość może mieć najwyżej ${CHAT_MESSAGE_MAX_LENGTH} znaków.`,
  emptyTitle: 'Podaj nazwę grupy.',
  noMembers: 'Wybierz co najmniej jedną osobę.',
  selfDirect: 'Nie można rozpocząć rozmowy z samym sobą.',
} as const;

export function isChatConversationKind(value: unknown): value is ChatConversationKind {
  return value === 'direct' || value === 'group';
}

export function isChatMemberRole(value: unknown): value is ChatMemberRole {
  return value === 'owner' || value === 'member';
}
