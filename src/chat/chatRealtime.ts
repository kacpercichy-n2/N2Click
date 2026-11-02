// Bramka zdarzeń realtime czatu (R1, znalezisko 1). Kanał `chat:conv:<id>`
// przyjmuje broadcasty od KAŻDEGO członka, więc ładunek zdarzenia jest
// niezaufany: może wskazywać inną rozmowę, podszywać się pod autora, nieść
// fałszywe „Widziane przez” albo reakcję. Zasada tego modułu: ładunek to
// wyłącznie PODPOWIEDŹ, co odświeżyć. Na ekran trafia tylko to, co zwróci
// baza pod RLS.
//
//   * Każde zdarzenie musi wskazywać rozmowę KANAŁU; inne odrzucamy.
//   * INSERT / UPDATE wiadomości: zbieramy id i pobieramy wiersze po id
//     (`loadMessagesByIds`), zlewając serię w jedno zapytanie na rozmowę.
//   * `read`: tylko od członka rozmowy; odświeża autorytatywny skład członków
//     (z `last_read_at`), zlany w jedno zapytanie na okno.
//   * `reaction`: tylko od członka, cudzy, dla wczytanego wątku; odświeża
//     reakcje wskazanych wiadomości z bazy.
//   * `theme_changed`: tylko od członka; odświeża overview (tam żyje motyw).
//   * `typing`: ulotny i nieszkodliwy, zostaje na ładunku, ale tylko od
//     członka rozmowy kanału i nigdy od siebie.
//
// Zero Reacta i SDK: provider wstrzykuje pobrania i odbiorców, testy podają
// atrapy i ręczny zegar (`chatRealtime.test.ts`).
import { extractBroadcastRecord } from './chatData';
import type { ChatMember, ChatMessage, ChatReactionMap, ChatResult } from './types';

export type ChatRealtimeEvent = 'INSERT' | 'UPDATE' | 'read' | 'reaction' | 'theme_changed' | 'typing';

export type ChatMessageEventKind = 'INSERT' | 'UPDATE';

export interface FetchedMessageEvent {
  kind: ChatMessageEventKind;
  /** Wiersz z bazy (RLS), nigdy z ładunku. */
  message: ChatMessage;
}

/** Okna zlewania (ms). Wiadomości krótko: opóźnienie widać na ekranie. */
export const CHAT_REFETCH_WINDOWS = {
  messages: 40,
  reactions: 150,
  members: 400,
} as const;

export interface ChatRealtimeGateDeps {
  selfId(): string | null;
  /** Członkostwo według ostatniego autorytatywnego składu rozmowy. */
  isMember(conversationId: string, userId: string): boolean;
  /** Czy rozmowa ma wczytany wątek (reakcje żyją tylko tam). */
  hasThread(conversationId: string): boolean;
  /**
   * Rewizja wariantu, który już mamy (wątek albo podsumowanie listy); null =
   * nie znamy wiadomości. Pozwala pominąć pobranie echa własnej wysyłki.
   */
  knownRevision(conversationId: string, messageId: string): string | null;
  fetchMessages(conversationId: string, ids: string[]): Promise<ChatResult<ChatMessage[]>>;
  fetchMembers(conversationId: string): Promise<ChatResult<ChatMember[]>>;
  fetchReactions(conversationId: string, messageIds: string[]): Promise<ChatResult<ChatReactionMap>>;
  onMessages(conversationId: string, events: FetchedMessageEvent[]): void;
  onMembers(conversationId: string, members: ChatMember[]): void;
  onReactions(conversationId: string, reactions: ChatReactionMap): void;
  onThemeHint(conversationId: string): void;
  onTyping(conversationId: string, userId: string): void;
  /** Zegar (testy podmieniają). Zwraca funkcję anulowania. */
  schedule?(fn: () => void, ms: number): () => void;
}

export interface ChatRealtimeGate {
  /** Zdarzenie z kanału `chat:conv:<channelConversationId>`. */
  handle(channelConversationId: string, event: ChatRealtimeEvent, raw: unknown): void;
  /** Wylogowanie / odmontowanie: anuluje timery, wyniki w locie przepadają. */
  dispose(): void;
}

// ---- Odczyt ładunku (bez zaufania) ------------------------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Ładunek zdarzeń wysyłanych `realtime.send` (koperta SDK albo goły). */
function eventPayload(raw: unknown): Record<string, unknown> | null {
  const envelope = asObject(raw);
  if (!envelope) return null;
  return asObject(envelope.payload) ?? envelope;
}

export interface MessageHint {
  id: string;
  /** Rewizja deklarowana w ładunku (tylko do pominięcia znanego echa). */
  revision: string;
  deleted: boolean;
}

/**
 * Podpowiedź z INSERT / UPDATE: id wiersza, o ile ładunek wskazuje rozmowę
 * kanału. Inna albo brakująca rozmowa => null (zdarzenie odrzucone).
 */
export function readMessageHint(raw: unknown, channelConversationId: string): MessageHint | null {
  const record = extractBroadcastRecord(raw);
  if (!record) return null;
  const id = str(record.id);
  if (id === '' || channelConversationId === '') return null;
  if (str(record.conversation_id) !== channelConversationId) return null;
  const revision = str(record.revised_at) || str(record.edited_at) || str(record.created_at);
  return { id, revision, deleted: str(record.deleted_at) !== '' };
}

/** Rozmowa i nadawca zdarzenia `read` / `reaction` / `theme_changed` / `typing`. */
function readActor(
  raw: unknown,
  actorKey: 'userId' | 'actorId',
): { conversationId: string; userId: string; messageId: string } | null {
  const payload = eventPayload(raw);
  if (!payload) return null;
  return {
    conversationId: str(payload.conversationId),
    userId: str(payload[actorKey]),
    messageId: str(payload.messageId),
  };
}

// ---- Zlewanie pobrań ---------------------------------------------------------

/**
 * Kolejka per rozmowa: elementy z okna lecą jednym pobraniem; w locie jest
 * najwyżej jedno pobranie na rozmowę, a to, co doszło w trakcie, czeka na
 * następne okno.
 */
function createBatcher<T>(
  delayMs: number,
  schedule: (fn: () => void, ms: number) => () => void,
  run: (key: string, items: T[]) => Promise<void>,
) {
  const pending = new Map<string, T[]>();
  const timers = new Map<string, () => void>();
  const inFlight = new Set<string>();
  let disposed = false;

  const arm = (key: string): void => {
    if (disposed || timers.has(key) || inFlight.has(key)) return;
    timers.set(
      key,
      schedule(() => {
        timers.delete(key);
        void flush(key);
      }, delayMs),
    );
  };

  const flush = async (key: string): Promise<void> => {
    const items = pending.get(key);
    pending.delete(key);
    if (disposed || !items || items.length === 0) return;
    inFlight.add(key);
    try {
      await run(key, items);
    } catch {
      // Pobranie, które rzuciło, zachowuje się jak pobranie z błędem: nic
      // nie nanosimy, kolejne zdarzenie albo catch-up po rejoinie nadrobi.
    } finally {
      inFlight.delete(key);
    }
    if (pending.has(key)) arm(key);
  };

  return {
    add(key: string, item: T): void {
      if (disposed) return;
      const list = pending.get(key);
      if (list) list.push(item);
      else pending.set(key, [item]);
      arm(key);
    },
    dispose(): void {
      disposed = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
      pending.clear();
    },
  };
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

// ---- Bramka ------------------------------------------------------------------

export function createChatRealtimeGate(deps: ChatRealtimeGateDeps): ChatRealtimeGate {
  const schedule = deps.schedule ?? defaultSchedule;
  let disposed = false;

  const messages = createBatcher<{ id: string; kind: ChatMessageEventKind }>(
    CHAT_REFETCH_WINDOWS.messages,
    schedule,
    async (conversationId, items) => {
      // INSERT dominuje: wiersz, który doszedł jako nowy, liczy się jako nowy
      // (licznik, ping), nawet gdy w tym samym oknie przyszła jego edycja.
      const kinds = new Map<string, ChatMessageEventKind>();
      for (const item of items) {
        if (kinds.get(item.id) !== 'INSERT') kinds.set(item.id, item.kind);
      }
      const result = await deps.fetchMessages(conversationId, Array.from(kinds.keys()));
      if (disposed || !result.ok) return;
      const events: FetchedMessageEvent[] = [];
      for (const message of result.value) {
        const kind = kinds.get(message.id);
        if (kind === undefined || message.conversationId !== conversationId) continue;
        events.push({ kind, message });
      }
      if (events.length > 0) deps.onMessages(conversationId, events);
    },
  );

  const members = createBatcher<true>(CHAT_REFETCH_WINDOWS.members, schedule, async (conversationId) => {
    const result = await deps.fetchMembers(conversationId);
    if (disposed || !result.ok) return;
    deps.onMembers(conversationId, result.value);
  });

  const reactions = createBatcher<string>(
    CHAT_REFETCH_WINDOWS.reactions,
    schedule,
    async (conversationId, messageIds) => {
      const ids = Array.from(new Set(messageIds));
      const result = await deps.fetchReactions(conversationId, ids);
      if (disposed || !result.ok || !deps.hasThread(conversationId)) return;
      // Tylko wiadomości, o które pytaliśmy (obrona przed nadmiarowym wierszem).
      const wanted = new Set(ids);
      const filtered: Record<string, ChatReactionMap[string]> = {};
      for (const [id, list] of Object.entries(result.value)) if (wanted.has(id)) filtered[id] = list;
      deps.onReactions(conversationId, filtered);
    },
  );

  /** Nadawca zdarzenia: rozmowa kanału, członek, nie my. */
  const trustedActor = (
    channelConversationId: string,
    raw: unknown,
    actorKey: 'userId' | 'actorId',
  ): { userId: string; messageId: string } | null => {
    const actor = readActor(raw, actorKey);
    if (!actor || actor.conversationId !== channelConversationId) return null;
    if (actor.userId === '' || actor.userId === deps.selfId()) return null;
    if (!deps.isMember(channelConversationId, actor.userId)) return null;
    return actor;
  };

  return {
    handle(channelConversationId, event, raw) {
      if (disposed || channelConversationId === '') return;
      switch (event) {
        case 'INSERT':
        case 'UPDATE': {
          const hint = readMessageHint(raw, channelConversationId);
          if (!hint) return;
          // Znany wariant co najmniej tak świeży jak deklarowany: nic do
          // pobrania (echo własnej wysyłki / edycji). Fałszywy ładunek może
          // w ten sposób najwyżej pominąć SAM SIEBIE; prawdziwa zmiana ma
          // własne zdarzenie.
          const known = deps.knownRevision(channelConversationId, hint.id);
          if (known !== null && !hint.deleted && hint.revision !== '' && hint.revision <= known) {
            return;
          }
          messages.add(channelConversationId, { id: hint.id, kind: event });
          return;
        }
        case 'read': {
          if (!trustedActor(channelConversationId, raw, 'userId')) return;
          members.add(channelConversationId, true);
          return;
        }
        case 'reaction': {
          const actor = trustedActor(channelConversationId, raw, 'userId');
          if (!actor || actor.messageId === '' || !deps.hasThread(channelConversationId)) return;
          reactions.add(channelConversationId, actor.messageId);
          return;
        }
        case 'theme_changed': {
          // Własna zmiana też odświeża: motyw nanieśliśmy optymistycznie.
          const actor = readActor(raw, 'actorId');
          if (!actor || actor.conversationId !== channelConversationId) return;
          if (actor.userId === '' || !deps.isMember(channelConversationId, actor.userId)) return;
          deps.onThemeHint(channelConversationId);
          return;
        }
        case 'typing': {
          const actor = readActor(raw, 'userId');
          if (!actor || actor.userId === '' || actor.userId === deps.selfId()) return;
          // Sygnał bez rozmowy w ładunku (dzisiejszy nadawca jej nie wysyła)
          // przypisujemy kanałowi; inna rozmowa w ładunku = odrzucony.
          if (actor.conversationId !== '' && actor.conversationId !== channelConversationId) return;
          if (!deps.isMember(channelConversationId, actor.userId)) return;
          deps.onTyping(channelConversationId, actor.userId);
          return;
        }
        default:
          return;
      }
    },
    dispose() {
      disposed = true;
      messages.dispose();
      members.dispose();
      reactions.dispose();
    },
  };
}
