// Cienki dostawca Reacta dla czatu: spina warstwę danych (`chatData.ts`),
// czystą redukcję stanu (`chatState.ts`) i kanały Realtime. Cała logika, którą
// da się wyrazić bez Reacta, mieszka w tamtych dwóch modułach. Tutaj zostają
// wyłącznie efekty, cykl życia kanałów i sklejenie kontekstu.
//
// GRANICE / DECYZJE:
//   * Czat NIE dotyka reduktora aplikacji ani localStorage. Wyłączony
//     (`enabled === false`) provider przepuszcza dzieci i nie tworzy ANI klienta
//     Supabase, ANI kanału, więc tryb lokalny działa dokładnie jak dotąd. Jedyny
//     wyjątek: preferencja „ping dźwiękowy" to ustawienie URZĄDZENIA czytane
//     i zapisywane przez `store/storage.ts` (dedykowany klucz, nie dane planera).
//   * Ping dźwiękowy (`chatSound.ts`): decyzja w `decideChatPing` przy każdym
//     INSERT z broadcastu; audio gra tylko po geście użytkownika (autoplay).
//   * Realtime idzie przez BROADCAST (nie `postgres_changes`): kanał prywatny
//     `chat:conv:<id>` per rozmowa (tylko słuchanie) i `chat:typing:<id>` per
//     OTWARTA rozmowa (jedyne, co nadajemy: „pisze…”; `chatChannels.ts`,
//     BACKLOG 4), multipleksowane po jednym sockecie. Kanały
//     prywatne autoryzuje token warstwy realtime: `client.realtime.setAuth(...)`
//     MUSI polecieć przed `subscribe` i po każdej rotacji tokenu, inaczej join
//     odbija się o RLS.
//   * Broadcast nie gwarantuje dostarczenia: po każdym POWROCIE do `SUBSCRIBED`
//     dociągamy overview, a dla każdego żywego wątku wiadomości nowsze od
//     ostatniej znanej (ten sam wzorzec „dociągnij po przerwie" co CloudSync).
//   * WĄTKI (karta zadania v2): dok ma JEDNĄ otwartą rozmowę
//     (`openConversationId`), ale panel rozmowy w karcie zadania żyje obok niego.
//     Każda oglądana rozmowa to osobny wątek w `threads` (wiadomości, reakcje,
//     „pisze…", paginacja). Wątek żyje, dopóki rozmowa jest otwarta w doku albo
//     ktoś ją trzyma przez `attachConversation` (panel zadania). Oglądany wątek
//     liczy się jako przeczytany.
//   * Ładunek broadcastu NIE jest źródłem prawdy (R1, znalezisko 1): bramka
//     `chatRealtime.ts` odrzuca zdarzenia obcych rozmów i nie-członków,
//     a wiadomości, odczyty i reakcje pobiera z bazy pod RLS. Klient nadaje
//     sam wyłącznie ulotne `typing`, i to tylko na `chat:typing:<id>`.
//   * Rozmowy zadań są na liście `conversations` (kanały, nieprzeczytane), ale
//     dok ich nie pokazuje (`dockConversations`), a `totalUnread` ich nie liczy.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../auth/SessionProvider';
import {
  createTypingChannels,
  subscribeConversationChannel,
  type ChatTypingChannels,
} from './chatChannels';
import { getSupabaseClient } from '../supabase/client';
import {
  createGroup as createGroupRow,
  createSupabaseChatDb,
  deleteMessage as deleteMessageRow,
  editMessage as editMessageRow,
  loadMembers,
  loadMessagesByIds,
  loadMessagesPage,
  loadMessagesSince,
  loadOverview,
  loadPinnedMessages,
  loadReactions,
  markRead as markReadRow,
  openDirect as openDirectRow,
  openTaskConversation as openTaskRow,
  sendMessage as sendMessageRow,
  setFollow as setFollowRow,
  setPin as setPinRow,
  setReaction as setReactionRow,
  setTheme as setThemeRow,
  type ChatDb,
} from './chatData';
import {
  createChatRealtimeGate,
  type ChatRealtimeEvent,
  type ChatRealtimeGate,
  type FetchedMessageEvent,
} from './chatRealtime';
import {
  applyConversationMembers,
  applyConversationTheme,
  applyFollowState,
  applyIncomingMessage,
  applyLocalPin,
  applyMessageUpdate,
  applyReactionEvent,
  applyTypingSignal,
  carryMemberDetails,
  ensureThread,
  isConversationMember,
  isTaskConversation,
  markConversationRead,
  messageRevision,
  mergeThreadMessages,
  mergeThreadReactions,
  mergeThreadUpdate,
  newestMessageCursor,
  nextReactionIntent,
  patchThread,
  pruneTyping,
  readWatermark,
  removeTyping,
  retainThreads,
  setThreadPinned,
  sortConversations,
  taskConversationUnread,
  totalUnread as sumUnread,
  updateThread,
  type ChatThreadMap,
  type ChatThreadState,
} from './chatState';
import { readChatSoundEnabled, writeChatSoundEnabled } from '../store/storage';
import { armChatSound, decideChatPing, playChatPing, unlockChatSound } from './chatSound';
import {
  CHAT_CATCHUP_MAX_PAGES,
  CHAT_MESSAGES,
  CHAT_PAGE_SIZE,
  CHAT_TYPING_THROTTLE_MS,
  type ChatConversation,
  type ChatMessageCursor,
  type ChatReactionMap,
  type ChatSendOptions,
} from './types';

/** Zlewanie serii zdarzeń w jedno odświeżenie listy rozmów. */
const OVERVIEW_REFRESH_DEBOUNCE_MS = 700;

const EMPTY_PRESENCE: ReadonlySet<string> = new Set<string>();
const EMPTY_THREADS: ChatThreadMap = {};

/** Wynik akcji wątku: UI pokazuje błąd lokalnie (dok i panel zadania osobno). */
export type ChatActionResult = { ok: true } | { ok: false; error: string };

const OK: ChatActionResult = { ok: true };

/** Otwarcie rozmowy zadania: id albo błąd; `forbidden` = brak wglądu (bez ponowień). */
export type TaskConversationOpenAction =
  | { ok: true; conversationId: string }
  | { ok: false; error: string; forbidden: boolean };

/** Reakcja w locie dla jednej wiadomości + ostatni zamiar czekający w kolejce. */
interface PendingReaction {
  /** `undefined` = nic nie czeka; `null` = zdjęcie reakcji. */
  queued?: string | null;
}

export interface ChatContextValue {
  /** `true` wyłącznie w trybie Supabase z zalogowanym użytkownikiem. */
  enabled: boolean;
  /** Chmurowy uuid zalogowanego (auth.users); null gdy `enabled === false`. */
  selfId: string | null;
  /** WSZYSTKIE rozmowy (także zadań). Dok filtruje je przez `dockConversations`. */
  conversations: ChatConversation[];
  /** Pierwsze wczytanie listy rozmów (ciche odświeżenia jej nie podnoszą). */
  conversationsLoading: boolean;
  /** Nieprzeczytane w doku (bez rozmów zadań). */
  totalUnread: number;
  /** Chmurowe uuid osób obecnych online (kanał `chat:presence`). */
  presence: ReadonlySet<string>;
  /** Rozmowa otwarta w DOKU (jedna naraz). */
  openConversationId: string | null;
  openConversation: (conversationId: string) => void;
  closeConversation: () => void;
  /** Otwiera (tworząc w razie potrzeby) DM; zwraca id rozmowy albo null. */
  openDirect: (otherUserId: string) => Promise<string | null>;
  /** Tworzy grupę i ją otwiera; zwraca id rozmowy albo null. */
  createGroup: (title: string, memberIds: string[]) => Promise<string | null>;
  /** Wczytane wątki: id rozmowy → wiadomości, reakcje, „pisze…", paginacja. */
  threads: ChatThreadMap;
  /**
   * Trzyma wątek rozmowy przy życiu poza dokiem (panel zadania). Zwraca
   * funkcję zwolnienia. Licznik referencji: dwa panele tej samej rozmowy nie
   * zamkną sobie nawzajem wątku.
   */
  attachConversation: (conversationId: string) => () => void;
  /** Otwiera (zakładając) rozmowę zadania; NIE rusza okna doku. */
  openTaskConversation: (taskId: string) => Promise<TaskConversationOpenAction>;
  loadOlder: (conversationId: string) => void;
  sendMessage: (
    conversationId: string,
    body: string,
    options?: ChatSendOptions,
  ) => Promise<ChatActionResult>;
  editMessage: (conversationId: string, messageId: string, body: string) => Promise<ChatActionResult>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<ChatActionResult>;
  setPin: (conversationId: string, messageId: string, pinned: boolean) => Promise<ChatActionResult>;
  setFollow: (conversationId: string, follow: boolean) => Promise<ChatActionResult>;
  /**
   * Klik w emoji przy wiadomości: to samo co własna reakcja zdejmuje, inne
   * podmienia, brak ustawia. Optymistycznie od razu, potem RPC; kolejne
   * kliknięcia w trakcie zapisu czekają jako OSTATNI zamiar.
   */
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => void;
  /** Motyw rozmowy (wspólny). Optymistycznie od razu, potem RPC. */
  setTheme: (conversationId: string, themeId: string) => Promise<boolean>;
  markRead: (conversationId: string) => void;
  sendTyping: (conversationId: string) => void;
  /** Ostatni polski komunikat błędu LISTY (wczytanie, DM, grupa) albo null. */
  error: string | null;
  /** Ręczne odświeżenie listy rozmów (retry po błędzie). */
  refresh: () => void;
  /** Ping dźwiękowy nowej wiadomości (preferencja URZĄDZENIA, localStorage). */
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

/**
 * Nieprzeczytane w rozmowie zadania (odznaka „Rozmowa (n)” na karcie, L4).
 * 0 w trybie lokalnym, poza providerem i gdy rozmowy jeszcze nie ma.
 */
export function useTaskConversationUnread(taskId: string): number {
  const ctx = useContext(ChatContext);
  if (!ctx || !ctx.enabled) return 0;
  return taskConversationUnread(ctx.conversations, taskId);
}

/** Zbiera identyfikatory obecnych: metadane `userId`, a w razie braku klucz presence. */
function readPresenceUserIds(channel: RealtimeChannel): ReadonlySet<string> {
  const state = channel.presenceState<{ userId?: unknown }>();
  const ids = new Set<string>();
  for (const [key, metas] of Object.entries(state)) {
    let matched = false;
    for (const meta of metas) {
      if (typeof meta.userId === 'string' && meta.userId !== '') {
        ids.add(meta.userId);
        matched = true;
      }
    }
    if (!matched && key !== '') ids.add(key);
  }
  return ids;
}

/** Klucz zbioru żywych wątków (stabilny string zamiast tablicy w zależnościach). */
function activeKeyOf(openId: string | null, attached: ReadonlyMap<string, number>): string {
  const ids = new Set<string>(attached.keys());
  if (openId) ids.add(openId);
  return Array.from(ids).sort().join(',');
}

function splitKey(key: string): string[] {
  return key === '' ? [] : key.split(',');
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  const signedIn = auth.mode === 'supabase' && auth.state.status === 'signedIn';
  const selfId = signedIn ? auth.state.session?.user?.id ?? null : null;
  const accessToken = signedIn ? auth.state.session?.access_token ?? null : null;
  const active = signedIn && selfId !== null;

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [presence, setPresence] = useState<ReadonlySet<string>>(EMPTY_PRESENCE);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThreadMap>(EMPTY_THREADS);
  /** Zmienia się, gdy zmienia się ZBIÓR rozmów trzymanych przez panele. */
  const [attachedVersion, setAttachedVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(readChatSoundEnabled);

  // Żywe kopie stanu dla callbacków przypiętych do kanałów. Kanał subskrybujemy
  // RAZ na rozmowę, więc handler nie może domykać się po wartościach z renderu.
  const dbRef = useRef<ChatDb | null>(null);
  const selfIdRef = useRef<string | null>(selfId);
  const tokenRef = useRef<string | null>(accessToken);
  const openIdRef = useRef<string | null>(openConversationId);
  const conversationsRef = useRef<ChatConversation[]>(conversations);
  const threadsRef = useRef<ChatThreadMap>(threads);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  /** Rozmowy trzymane przez panele (id → licznik referencji). */
  const attachedRef = useRef<Map<string, number>>(new Map());
  /** Czas ostatniego pinga (dławik w `decideChatPing`). */
  const lastPingAtRef = useRef<number | null>(null);
  selfIdRef.current = selfId;
  soundEnabledRef.current = soundEnabled;
  tokenRef.current = accessToken;
  openIdRef.current = openConversationId;
  conversationsRef.current = conversations;
  threadsRef.current = threads;

  const mountedRef = useRef(true);
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const selfChannelRef = useRef<RealtimeChannel | null>(null);
  /** Kanały `chat:typing:<id>` otwartych rozmów (powstają po `setAuth`). */
  const typingChannelsRef = useRef<ChatTypingChannels | null>(null);
  /** Klucz otwartych rozmów dla kodu asynchronicznego (patrz `activeKey`). */
  const activeKeyRef = useRef('');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Kursor starszej strony per wątek. */
  const olderCursorsRef = useRef<Map<string, ChatMessageCursor | null>>(new Map());
  const loadingOlderRef = useRef<Set<string>>(new Set());
  /** Wersja wątku: zwolniony i ponownie otwarty wątek odrzuca stare odpowiedzi. */
  const threadEpochRef = useRef<Map<string, number>>(new Map());
  const lastTypingSentRef = useRef<Map<string, number>>(new Map());
  /** Reakcje w locie (id wiadomości → kolejka); patrz `toggleReaction`. */
  const pendingReactionsRef = useRef<Map<string, PendingReaction>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Rozmowę ktoś właśnie ogląda (dok albo panel zadania). */
  const isVisible = useCallback((conversationId: string): boolean => {
    return openIdRef.current === conversationId || attachedRef.current.has(conversationId);
  }, []);

  /** Wątek nadal żyje w tej samej wersji, w której ruszyło zapytanie. */
  const threadAlive = useCallback((conversationId: string, epoch: number): boolean => {
    return (
      mountedRef.current &&
      threadsRef.current[conversationId] !== undefined &&
      threadEpochRef.current.get(conversationId) === epoch
    );
  }, []);

  const changeThread = useCallback(
    (conversationId: string, update: (thread: ChatThreadState) => ChatThreadState): void => {
      setThreads((map) => updateThread(map, conversationId, update));
    },
    [],
  );

  // ---- Operacje na danych ----------------------------------------------------

  const refreshOverview = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;
    const result = await loadOverview(db);
    // Wylogowanie / zmiana tożsamości w trakcie fetchu => wynik do kosza.
    if (!mountedRef.current || dbRef.current !== db) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const sorted = sortConversations(result.value);
    const now = new Date().toISOString();
    setConversations((previous) => {
      let next = carryMemberDetails(previous, sorted);
      // Oglądane rozmowy zostają przeczytane także po odświeżeniu listy.
      const visible = new Set<string>(attachedRef.current.keys());
      if (openIdRef.current) visible.add(openIdRef.current);
      for (const id of visible) next = markConversationRead(next, id, selfIdRef.current, now);
      return next;
    });
  }, []);

  const scheduleOverviewRefresh = useCallback((): void => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshOverview();
    }, OVERVIEW_REFRESH_DEBOUNCE_MS);
  }, [refreshOverview]);

  const markReadFor = useCallback(
    async (conversationId: string, newestCreatedAt: string | null = null): Promise<void> => {
    const db = dbRef.current;
    const self = selfIdRef.current;
    if (!db || !self || conversationId === '') return;
    // Ref wątku może jeszcze nie znać wiadomości z tego samego zdarzenia, więc
    // wołający podaje jej znacznik wprost.
    const known = threadsRef.current[conversationId]?.messages ?? [];
    const now = readWatermark(known, new Date().toISOString());
    const at = newestCreatedAt !== null ? readWatermark([{ createdAt: newestCreatedAt }], now) : now;
    setConversations((list) => markConversationRead(list, conversationId, self, at));
    // Błąd zapisu zostawiamy cichy: kolejne overview przywróci prawdę serwera,
    // a baner „nie zapisano odczytu” byłby szumem przy każdym przełączeniu.
    await markReadRow(db, conversationId, self, at);
  }, []);

  /** Pierwsza strona wątku (otwarcie w doku albo przypięcie panelu). */
  const loadFirstPage = useCallback(
    async (conversationId: string, epoch: number): Promise<void> => {
      const db = dbRef.current;
      if (!db) return;
      // Przypięte osobno (pasek „Przypięte” obejmuje też starsze strony).
      // Błąd tego pobrania jest cichy: pasek pokaże przypięte z wczytanej strony.
      void loadPinnedMessages(db, conversationId).then((pinned) => {
        if (!pinned.ok || !threadAlive(conversationId, epoch)) return;
        changeThread(conversationId, (t) => setThreadPinned(t, pinned.value));
      });
      const result = await loadMessagesPage(db, conversationId, null);
      if (!threadAlive(conversationId, epoch)) return;
      if (!result.ok) {
        changeThread(conversationId, (t) => patchThread(t, { loading: false, error: result.error }));
        return;
      }
      // SCALANIE, nie nadpisanie: broadcast albo catch-up mogły dołożyć
      // wiadomości, zanim to pobranie wróciło.
      changeThread(conversationId, (t) =>
        patchThread(
          mergeThreadReactions(mergeThreadMessages(t, result.value.messages), result.value.reactions),
          { loading: false, loaded: true, hasMore: result.value.hasMore, error: null },
        ),
      );
      olderCursorsRef.current.set(conversationId, result.value.cursor);
      void markReadFor(conversationId, newestMessageCursor(result.value.messages)?.createdAt ?? null);
    },
    [changeThread, markReadFor, threadAlive],
  );

  /** Nadrabia lukę w żywym wątku po joinie kanału (pierwszym i każdym kolejnym). */
  const catchUpThread = useCallback(
    async (conversationId: string): Promise<void> => {
      const db = dbRef.current;
      const thread = threadsRef.current[conversationId];
      const epoch = threadEpochRef.current.get(conversationId);
      if (!db || !thread || epoch === undefined) return;
      const cursor = newestMessageCursor(thread.messages);
      if (!cursor) {
        // Brak kursora NIE oznacza „nie ma czego nadrabiać": pierwsza strona
        // może być jeszcze w locie albo rozmowa była pusta w snapshocie. Pobieramy
        // ją ponownie i scalamy (dedup po id, przegląd 2026-08-13).
        const result = await loadMessagesPage(db, conversationId, null);
        if (!result.ok || !threadAlive(conversationId, epoch)) return;
        if (result.value.messages.length === 0) return;
        changeThread(conversationId, (t) =>
          mergeThreadReactions(mergeThreadMessages(t, result.value.messages), result.value.reactions),
        );
        if (!olderCursorsRef.current.get(conversationId)) {
          olderCursorsRef.current.set(conversationId, result.value.cursor);
          changeThread(conversationId, (t) =>
            patchThread(t, { hasMore: result.value.hasMore, loaded: true, loading: false }),
          );
        }
        void markReadFor(conversationId, newestMessageCursor(result.value.messages)?.createdAt ?? null);
        return;
      }
      // PĘTLA, nie jedno pobranie: przerwa bywa dłuższa niż strona, a dziury
      // w środku listy `loadOlder` nigdy by nie zasypał (przegląd 2026-08-13).
      let next: ChatMessageCursor | null = cursor;
      let appended = false;
      let saturated = false;
      for (let page = 0; page < CHAT_CATCHUP_MAX_PAGES; page += 1) {
        const result = await loadMessagesSince(db, conversationId, next);
        if (!result.ok || !threadAlive(conversationId, epoch)) return;
        if (result.value.messages.length === 0) break;
        appended = true;
        changeThread(conversationId, (t) =>
          mergeThreadReactions(mergeThreadMessages(t, result.value.messages), result.value.reactions),
        );
        const advanced = newestMessageCursor(result.value.messages);
        if (result.value.messages.length < CHAT_PAGE_SIZE) {
          next = advanced ?? next;
          break;
        }
        if (!advanced || (next && advanced.id === next.id)) break;
        next = advanced;
        saturated = page === CHAT_CATCHUP_MAX_PAGES - 1;
      }

      if (saturated) {
        // Bardzo długa nieobecność: odtwarzamy wątek od pierwszej strony.
        const fresh = await loadMessagesPage(db, conversationId, null);
        if (!fresh.ok || !threadAlive(conversationId, epoch)) return;
        changeThread(conversationId, (t) => ({
          ...t,
          messages: fresh.value.messages,
          reactions: fresh.value.reactions,
          hasMore: fresh.value.hasMore,
          loaded: true,
          loading: false,
        }));
        olderCursorsRef.current.set(conversationId, fresh.value.cursor);
        void markReadFor(conversationId, newestMessageCursor(fresh.value.messages)?.createdAt ?? null);
        return;
      }

      if (appended) void markReadFor(conversationId, next?.createdAt ?? null);

      // Reakcje na JUŻ WCZYTANYCH wiadomościach (broadcast w martwym oknie przepadł).
      const known = (threadsRef.current[conversationId]?.messages ?? []).map((m) => m.id);
      const refreshed = await loadReactions(db, conversationId, known);
      if (!refreshed.ok || !threadAlive(conversationId, epoch)) return;
      changeThread(conversationId, (t) => mergeThreadReactions(t, refreshed.value));
    },
    [changeThread, markReadFor, threadAlive],
  );

  // ---- Obsługa zdarzeń kanału -------------------------------------------------
  //
  // Ładunek broadcastu jest NIEZAUFANY (R1, znalezisko 1): każdy członek może
  // nadać dowolne zdarzenie na `chat:conv:<id>`. Kanał oddaje surowe zdarzenia
  // bramce (`chatRealtime.ts`), która odrzuca obce rozmowy i nie-członków,
  // a wiadomości, odczyty i reakcje pobiera z bazy. Poniższe funkcje nanoszą
  // WYŁĄCZNIE wiersze z bazy.

  /** Wiadomości pobrane po id (INSERT / UPDATE z kanału). */
  const applyFetchedMessages = useCallback(
    (conversationId: string, events: FetchedMessageEvent[]): void => {
      const self = selfIdRef.current;
      const visible = isVisible(conversationId);
      for (const { kind, message } of events) {
        if (kind === 'UPDATE') {
          setConversations((list) => applyMessageUpdate(list, message));
          changeThread(conversationId, (t) => mergeThreadUpdate(t, message));
          continue;
        }
        const conversation = conversationsRef.current.find((c) => c.id === conversationId);
        // Wiadomość w rozmowie, której jeszcze nie mamy na liście: tylko
        // overview wie, co to jest.
        if (!conversation) scheduleOverviewRefresh();
        const heldInThread =
          threadsRef.current[conversationId]?.messages.some((m) => m.id === message.id) ?? false;
        const selfRead = conversation?.members.find((m) => m.userId === self)?.lastReadAt ?? null;
        const alreadyRead = selfRead !== null && Date.parse(selfRead) >= Date.parse(message.createdAt);
        setConversations((list) =>
          applyIncomingMessage(list, message, {
            selfId: self,
            openConversationId: visible ? conversationId : null,
          }),
        );
        changeThread(conversationId, (t) => {
          const typing = removeTyping(t.typing, message.authorId);
          return typing === t.typing ? t : { ...t, typing };
        });
        changeThread(conversationId, (t) => mergeThreadMessages(t, [message]));

        // Ping dźwiękowy: rozmowy zadań milczą (powiadomienia niesie dzwonek L1),
        // oglądana rozmowa też; znana albo już przeczytana wiadomość też.
        const isTask = conversation ? isTaskConversation(conversation) : false;
        if (self !== null && !isTask && !heldInThread && !alreadyRead) {
          const now = Date.now();
          const decision = decideChatPing({
            authorId: message.authorId,
            selfId: self,
            conversationId,
            openConversationId: visible ? conversationId : openIdRef.current,
            documentHidden: typeof document !== 'undefined' && document.hidden,
            enabled: soundEnabledRef.current,
            lastPingAt: lastPingAtRef.current,
            now,
          });
          if (decision.play && playChatPing(decision.level)) lastPingAtRef.current = now;
        }
        if (visible && message.authorId !== self && !heldInThread) {
          void markReadFor(conversationId, message.createdAt);
        }
      }
    },
    [changeThread, isVisible, markReadFor, scheduleOverviewRefresh],
  );

  /** Bramka zdarzeń kanałów; żyje tyle co klient bazy (patrz efekt cyklu życia). */
  const gateRef = useRef<ChatRealtimeGate | null>(null);

  const createGate = useCallback(
    (db: ChatDb): ChatRealtimeGate =>
      createChatRealtimeGate({
        selfId: () => selfIdRef.current,
        isMember: (conversationId, userId) =>
          isConversationMember(conversationsRef.current, conversationId, userId),
        hasThread: (conversationId) => threadsRef.current[conversationId] !== undefined,
        knownRevision: (conversationId, messageId) => {
          const thread = threadsRef.current[conversationId];
          const held =
            thread?.messages.find((m) => m.id === messageId) ??
            thread?.pinned?.find((m) => m.id === messageId);
          if (held) return messageRevision(held);
          const last = conversationsRef.current.find((c) => c.id === conversationId)?.lastMessage;
          // Podsumowanie listy nie zna rewizji: echo INSERT pomijamy, UPDATE pobieramy.
          return last && last.id === messageId ? last.createdAt : null;
        },
        fetchMessages: (conversationId, ids) => loadMessagesByIds(db, conversationId, ids),
        fetchMembers: (conversationId) => loadMembers(db, conversationId),
        fetchReactions: (conversationId, ids) => loadReactions(db, conversationId, ids),
        onMessages: (conversationId, events) => {
          if (!mountedRef.current || dbRef.current !== db) return;
          applyFetchedMessages(conversationId, events);
        },
        onMembers: (conversationId, members) => {
          if (!mountedRef.current || dbRef.current !== db) return;
          setConversations((list) => applyConversationMembers(list, conversationId, members));
        },
        onReactions: (conversationId, reactions) => {
          if (!mountedRef.current || dbRef.current !== db) return;
          // Wiadomość z własną reakcją w locie: prawdę przyniesie odpowiedź RPC.
          const settled: Record<string, ChatReactionMap[string]> = {};
          for (const [id, list] of Object.entries(reactions)) {
            if (!pendingReactionsRef.current.has(id)) settled[id] = list;
          }
          changeThread(conversationId, (t) => mergeThreadReactions(t, settled));
        },
        onThemeHint: () => scheduleOverviewRefresh(),
        onTyping: (conversationId, userId) => {
          // Wątek istnieje tylko dla oglądanej rozmowy; poza nią sygnał przepada.
          changeThread(conversationId, (t) => ({
            ...t,
            typing: applyTypingSignal(t.typing, userId, Date.now()),
          }));
        },
      }),
    [applyFetchedMessages, changeThread, scheduleOverviewRefresh],
  );

  const forwardToGate = useCallback((conversationId: string, event: ChatRealtimeEvent, raw: unknown): void => {
    gateRef.current?.handle(conversationId, event, raw);
  }, []);

  const subscribeConversation = useCallback(
    (client: SupabaseClient, conversationId: string): RealtimeChannel => {
      // Tylko słuchacze: `chat:conv:<id>` jest dla klienta do odczytu
      // („pisze…” żyje na `chat:typing:<id>`, patrz `chatChannels.ts`).
      return subscribeConversationChannel(client, conversationId, forwardToGate, (status) => {
        if (status !== 'SUBSCRIBED') return;
        // KAŻDY `SUBSCRIBED`, także pierwszy: wiadomość nadana między snapshotem
        // overview a dojściem joinu wpadłaby w szczelinę.
        scheduleOverviewRefresh();
        if (threadsRef.current[conversationId] !== undefined) void catchUpThread(conversationId);
      });
    },
    [forwardToGate, scheduleOverviewRefresh, catchUpThread],
  );

  // ---- Cykl życia: klient, presence, pierwsze wczytanie -----------------------

  // Rotacja tokenu (odświeżenie sesji) musi dojść do warstwy realtime, inaczej
  // kanały prywatne przestaną się autoryzować przy następnym rejoinie.
  useEffect(() => {
    if (!active || !accessToken) return;
    void getSupabaseClient().realtime.setAuth(accessToken);
  }, [active, accessToken]);

  useEffect(() => {
    if (!active || !selfId) {
      // Tryb lokalny / wylogowanie: zero klientów, zero kanałów, czysty stan.
      dbRef.current = null;
      setConversations([]);
      setConversationsLoading(false);
      setThreads(EMPTY_THREADS);
      setOpenConversationId(null);
      setPresence(EMPTY_PRESENCE);
      setError(null);
      olderCursorsRef.current.clear();
      return;
    }

    const client = getSupabaseClient();
    const db = createSupabaseChatDb(client);
    dbRef.current = db;
    const gate = createGate(db);
    gateRef.current = gate;
    let cancelled = false;
    setConversationsLoading(true);

    void (async () => {
      const token = tokenRef.current;
      if (token) await client.realtime.setAuth(token);
      if (cancelled) return;

      // Kanały „pisze…” dopiero po `setAuth` (prywatne). Rozmowy otwarte przed
      // tą chwilą dołączamy od razu; dalej uzgadnia je efekt wątków.
      const typingChannels = createTypingChannels(client, forwardToGate);
      typingChannelsRef.current = typingChannels;
      typingChannels.reconcile(splitKey(activeKeyRef.current));

      const presenceChannel = client
        .channel('chat:presence', {
          config: { private: true, presence: { key: selfId, enabled: true } },
        })
        .on('presence', { event: 'sync' }, () => {
          if (mountedRef.current && !cancelled) setPresence(readPresenceUserIds(presenceChannel));
        });
      presenceChannelRef.current = presenceChannel;
      presenceChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') void presenceChannel.track({ userId: selfId });
      });

      // KANAŁ OSOBISTY `chat:user:<selfId>` (trigger `chat_members_broadcast`):
      // świeżo założona rozmowa (zaproszenie, wzmianka w zadaniu) dociera od
      // razu. Prawdę zna `chat_overview()`, więc tylko planujemy odświeżenie.
      const selfChannel = client
        .channel(`chat:user:${selfId}`, { config: { private: true } })
        .on('broadcast', { event: 'INSERT' }, () => scheduleOverviewRefresh())
        .on('broadcast', { event: 'DELETE' }, () => scheduleOverviewRefresh());
      selfChannelRef.current = selfChannel;
      selfChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') scheduleOverviewRefresh();
      });

      await refreshOverview();
      if (!cancelled && mountedRef.current) setConversationsLoading(false);
    })();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      for (const channel of channelsRef.current.values()) void client.removeChannel(channel);
      channelsRef.current.clear();
      typingChannelsRef.current?.dispose();
      typingChannelsRef.current = null;
      lastTypingSentRef.current.clear();
      if (presenceChannelRef.current) {
        void client.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      if (selfChannelRef.current) {
        void client.removeChannel(selfChannelRef.current);
        selfChannelRef.current = null;
      }
      gate.dispose();
      if (gateRef.current === gate) gateRef.current = null;
      dbRef.current = null;
    };
  }, [active, selfId, refreshOverview, scheduleOverviewRefresh, createGate, forwardToGate]);

  // Uzgodnienie kanałów z listą rozmów (klucz = ZBIÓR id, nie każda wiadomość).
  const conversationIdsKey = useMemo(
    () => conversations.map((conversation) => conversation.id).join(','),
    [conversations],
  );

  useEffect(() => {
    if (!active) return;
    const client = getSupabaseClient();
    const wanted = new Set(conversationIdsKey === '' ? [] : conversationIdsKey.split(','));
    for (const [id, channel] of channelsRef.current) {
      if (!wanted.has(id)) {
        channelsRef.current.delete(id);
        void client.removeChannel(channel);
      }
    }
    for (const id of wanted) {
      if (!channelsRef.current.has(id)) {
        channelsRef.current.set(id, subscribeConversation(client, id));
      }
    }
  }, [active, conversationIdsKey, subscribeConversation]);

  // Uzgodnienie WĄTKÓW z oglądanymi rozmowami: nowy wątek = pierwsza strona,
  // zwolniony = wyrzucony (ponowne otwarcie czyta od nowa, jak dotąd w doku).
  const activeKey = useMemo(
    () => activeKeyOf(openConversationId, attachedRef.current),
    // `attachedVersion` sygnalizuje zmianę zawartości refa.
    [openConversationId, attachedVersion],
  );
  activeKeyRef.current = activeKey;

  useEffect(() => {
    if (!active) return;
    const wanted = new Set(splitKey(activeKey));
    // „Pisze…” słuchamy i nadajemy tylko w otwartych rozmowach.
    typingChannelsRef.current?.reconcile(wanted);
    const current = threadsRef.current;
    const added = Array.from(wanted).filter((id) => current[id] === undefined);
    for (const id of Object.keys(current)) {
      if (!wanted.has(id)) {
        olderCursorsRef.current.delete(id);
        loadingOlderRef.current.delete(id);
        lastTypingSentRef.current.delete(id);
      }
    }
    const reconcile = (map: ChatThreadMap): ChatThreadMap => {
      let next = retainThreads(map, wanted);
      for (const id of added) next = ensureThread(next, id);
      return next;
    };
    if (reconcile(current) === current) return;
    threadsRef.current = reconcile(current);
    setThreads(reconcile);
    for (const id of added) {
      const epoch = (threadEpochRef.current.get(id) ?? 0) + 1;
      threadEpochRef.current.set(id, epoch);
      olderCursorsRef.current.set(id, null);
      void loadFirstPage(id, epoch);
    }
  }, [active, activeKey, loadFirstPage]);

  // Wygaszanie sygnałów „pisze…" (nadawca może zniknąć bez pożegnania).
  const typingDeadline = useMemo(() => {
    let soonest = Number.POSITIVE_INFINITY;
    for (const thread of Object.values(threads)) {
      for (const entry of thread.typing) soonest = Math.min(soonest, entry.expiresAt);
    }
    return soonest;
  }, [threads]);

  useEffect(() => {
    if (!Number.isFinite(typingDeadline)) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setThreads((map) => {
          let next = map;
          for (const id of Object.keys(map)) {
            next = updateThread(next, id, (t) => {
              const typing = pruneTyping(t.typing, now);
              return typing === t.typing ? t : { ...t, typing };
            });
          }
          return next;
        });
      },
      Math.max(typingDeadline - Date.now(), 50),
    );
    return () => clearTimeout(timer);
  }, [typingDeadline]);

  // ---- API kontekstu ----------------------------------------------------------

  const openConversation = useCallback((conversationId: string): void => {
    setOpenConversationId(conversationId === '' ? null : conversationId);
  }, []);

  const closeConversation = useCallback((): void => {
    setOpenConversationId(null);
  }, []);

  const attachConversation = useCallback((conversationId: string): (() => void) => {
    if (conversationId === '') return () => {};
    const counts = attachedRef.current;
    counts.set(conversationId, (counts.get(conversationId) ?? 0) + 1);
    if (counts.get(conversationId) === 1) setAttachedVersion((v) => v + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (counts.get(conversationId) ?? 1) - 1;
      if (left > 0) {
        counts.set(conversationId, left);
        return;
      }
      counts.delete(conversationId);
      setAttachedVersion((v) => v + 1);
    };
  }, []);

  const openDirect = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      const db = dbRef.current;
      const self = selfIdRef.current;
      if (!db || !self) return null;
      const result = await openDirectRow(db, self, otherUserId);
      if (!result.ok) {
        if (mountedRef.current) setError(result.error);
        return null;
      }
      // Nowa rozmowa musi wejść na listę, zanim ją otworzymy, inaczej nie
      // dostanie kanału i wiadomości nie doszłyby na żywo.
      await refreshOverview();
      if (!mountedRef.current) return result.value;
      setError(null);
      setOpenConversationId(result.value);
      return result.value;
    },
    [refreshOverview],
  );

  const createGroup = useCallback(
    async (title: string, memberIds: string[]): Promise<string | null> => {
      const db = dbRef.current;
      const self = selfIdRef.current;
      if (!db || !self) return null;
      const result = await createGroupRow(db, self, title, memberIds);
      if (!result.ok) {
        if (mountedRef.current) setError(result.error);
        return null;
      }
      await refreshOverview();
      if (!mountedRef.current) return result.value;
      setError(null);
      setOpenConversationId(result.value);
      return result.value;
    },
    [refreshOverview],
  );

  const refreshMembers = useCallback(async (conversationId: string): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;
    const result = await loadMembers(db, conversationId);
    if (!result.ok || !mountedRef.current || dbRef.current !== db) return;
    setConversations((list) => applyConversationMembers(list, conversationId, result.value));
  }, []);

  const openTaskConversation = useCallback(
    async (taskId: string): Promise<TaskConversationOpenAction> => {
      const db = dbRef.current;
      if (!db) return { ok: false, error: CHAT_MESSAGES.open, forbidden: false };
      const result = await openTaskRow(db, taskId);
      if (!result.ok) return { ok: false, error: result.error, forbidden: result.forbidden };
      // Rozmowa (i nasze członkostwo) musi być na liście: tam żyje kanał,
      // licznik nieprzeczytanych i skład obserwujących.
      await refreshOverview();
      await refreshMembers(result.value);
      return { ok: true, conversationId: result.value };
    },
    [refreshOverview, refreshMembers],
  );

  const loadOlder = useCallback(
    (conversationId: string): void => {
      const db = dbRef.current;
      const thread = threadsRef.current[conversationId];
      const cursor = olderCursorsRef.current.get(conversationId) ?? null;
      const epoch = threadEpochRef.current.get(conversationId);
      if (!db || !thread || !cursor || epoch === undefined) return;
      if (loadingOlderRef.current.has(conversationId) || !thread.hasMore) return;
      loadingOlderRef.current.add(conversationId);
      changeThread(conversationId, (t) => patchThread(t, { loading: true }));
      void (async () => {
        const result = await loadMessagesPage(db, conversationId, cursor);
        loadingOlderRef.current.delete(conversationId);
        if (!threadAlive(conversationId, epoch)) return;
        if (!result.ok) {
          changeThread(conversationId, (t) => patchThread(t, { loading: false, error: result.error }));
          return;
        }
        changeThread(conversationId, (t) =>
          patchThread(
            mergeThreadReactions(mergeThreadMessages(t, result.value.messages), result.value.reactions),
            { loading: false, hasMore: result.value.hasMore, error: null },
          ),
        );
        olderCursorsRef.current.set(conversationId, result.value.cursor);
      })();
    },
    [changeThread, threadAlive],
  );

  /**
   * Zapis reakcji z KOLEJKĄ per wiadomość: w locie jest najwyżej jedno RPC na
   * wiadomość, a kliknięcia w trakcie nadpisują wyłącznie „ostatni zamiar".
   */
  const runReaction = useCallback(
    async (conversationId: string, messageId: string, intent: string | null): Promise<void> => {
      const db = dbRef.current;
      if (!db) return;
      const pending = pendingReactionsRef.current.get(messageId);
      if (pending) {
        pending.queued = intent;
        return;
      }
      pendingReactionsRef.current.set(messageId, {});
      const result = await setReactionRow(db, messageId, intent);
      const state = pendingReactionsRef.current.get(messageId);
      const queued = state?.queued;
      pendingReactionsRef.current.delete(messageId);
      // Zapis serwera DRENUJEMY niezależnie od widoku; ostatni zamiar nie może
      // przepaść tylko dlatego, że użytkownik zamknął okno.
      if (queued !== undefined) {
        void runReaction(conversationId, messageId, queued);
        return;
      }
      if (!mountedRef.current) return;
      if (result.ok) {
        changeThread(conversationId, (t) => mergeThreadReactions(t, { [messageId]: result.value }));
        return;
      }
      // Cofnięcie optymistycznej zmiany = prawda serwera, nie zgadywanie.
      const refreshed = await loadReactions(db, conversationId, [messageId]);
      if (!refreshed.ok || !mountedRef.current) return;
      changeThread(conversationId, (t) => mergeThreadReactions(t, refreshed.value));
    },
    [changeThread],
  );

  const toggleReaction = useCallback(
    (conversationId: string, messageId: string, emoji: string): void => {
      const self = selfIdRef.current;
      const thread = threadsRef.current[conversationId];
      if (!thread || !self || messageId === '' || emoji === '') return;
      const message = thread.messages.find((entry) => entry.id === messageId);
      if (!message || message.deletedAt !== null) return;
      const intent = nextReactionIntent(thread.reactions[messageId] ?? [], self, emoji);
      changeThread(conversationId, (t) => {
        const reactions = applyReactionEvent(t.reactions, {
          messageId,
          conversationId,
          userId: self,
          emoji: intent,
          createdAt: new Date().toISOString(),
        });
        return reactions === t.reactions ? t : { ...t, reactions };
      });
      void runReaction(conversationId, messageId, intent);
    },
    [changeThread, runReaction],
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      body: string,
      options: ChatSendOptions = {},
    ): Promise<ChatActionResult> => {
      const db = dbRef.current;
      const self = selfIdRef.current;
      if (!db || !self || conversationId === '') return { ok: false, error: CHAT_MESSAGES.send };
      const result = await sendMessageRow(db, conversationId, self, body, null, options);
      if (!result.ok) return { ok: false, error: result.error };
      if (!mountedRef.current) return OK;
      // Wiersz zwrócony przez serwer (id i `created_at` autorytatywne); echo
      // broadcastu trafi w dedup po id.
      changeThread(conversationId, (t) => mergeThreadMessages(t, [result.value]));
      setConversations((list) =>
        applyIncomingMessage(list, result.value, { selfId: self, openConversationId: conversationId }),
      );
      return OK;
    },
    [changeThread],
  );

  /** Wspólna ścieżka edycji i usunięcia WŁASNEJ wiadomości. */
  const changeOwnMessage = useCallback(
    async (
      conversationId: string,
      messageId: string,
      body: string | null,
    ): Promise<ChatActionResult> => {
      const db = dbRef.current;
      const self = selfIdRef.current;
      const message = threadsRef.current[conversationId]?.messages.find((m) => m.id === messageId);
      const failure = body === null ? CHAT_MESSAGES.remove : CHAT_MESSAGES.edit;
      if (!db || !self || !message) return { ok: false, error: failure };
      if (message.authorId !== self || message.deletedAt !== null || message.kind === 'system') {
        return { ok: false, error: failure };
      }
      const result =
        body === null
          ? await deleteMessageRow(db, messageId, self)
          : await editMessageRow(db, messageId, self, body, message.attachments.length > 0);
      if (!result.ok) return { ok: false, error: result.error };
      if (!mountedRef.current) return OK;
      changeThread(conversationId, (t) => mergeThreadMessages(t, [result.value]));
      setConversations((list) => applyMessageUpdate(list, result.value));
      return OK;
    },
    [changeThread],
  );

  const editMessage = useCallback(
    (conversationId: string, messageId: string, body: string) =>
      changeOwnMessage(conversationId, messageId, body),
    [changeOwnMessage],
  );

  const deleteMessage = useCallback(
    (conversationId: string, messageId: string) =>
      changeOwnMessage(conversationId, messageId, null),
    [changeOwnMessage],
  );

  const setPin = useCallback(
    async (conversationId: string, messageId: string, pinned: boolean): Promise<ChatActionResult> => {
      const db = dbRef.current;
      if (!db) return { ok: false, error: CHAT_MESSAGES.pin };
      const result = await setPinRow(db, messageId, pinned);
      if (!result.ok) return { ok: false, error: result.error };
      // RPC nie zwraca wiersza; prawdę (z nową rewizją) niesie broadcast UPDATE.
      // Nanosimy zmianę od razu ze STARĄ rewizją: zgubiony broadcast nie
      // zostawi paska w starym stanie, a prawdziwy UPDATE i tak wygra scalanie.
      if (mountedRef.current) {
        const self = selfIdRef.current;
        changeThread(conversationId, (t) =>
          applyLocalPin(t, messageId, pinned ? new Date().toISOString() : null, pinned ? self : null),
        );
      }
      return OK;
    },
    [changeThread],
  );

  const setFollow = useCallback(
    async (conversationId: string, follow: boolean): Promise<ChatActionResult> => {
      const db = dbRef.current;
      const self = selfIdRef.current;
      if (!db || !self) return { ok: false, error: CHAT_MESSAGES.follow };
      setConversations((list) => applyFollowState(list, conversationId, self, follow));
      const result = await setFollowRow(db, conversationId, follow);
      if (!mountedRef.current) return result.ok ? OK : { ok: false, error: result.error };
      if (!result.ok) {
        // Cofnięcie optymistycznego przełączenia.
        setConversations((list) => applyFollowState(list, conversationId, self, !follow));
        return { ok: false, error: result.error };
      }
      await refreshMembers(conversationId);
      return OK;
    },
    [refreshMembers],
  );

  /** Ostatni zamiar zmiany motywu per rozmowa (numer żądania). */
  const themeIntentRef = useRef<Map<string, number>>(new Map());

  const setTheme = useCallback(async (conversationId: string, themeId: string): Promise<boolean> => {
    const db = dbRef.current;
    if (!db || conversationId === '') return false;
    const previous =
      conversationsRef.current.find((conversation) => conversation.id === conversationId)
        ?.themeId ?? '';
    // Numer zamiaru: starsze żądanie nie może cofnąć nowszego wyboru.
    const intent = (themeIntentRef.current.get(conversationId) ?? 0) + 1;
    themeIntentRef.current.set(conversationId, intent);
    setConversations((list) => applyConversationTheme(list, conversationId, themeId));
    const result = await setThemeRow(db, conversationId, themeId);
    if (!mountedRef.current) return result.ok;
    const latest = themeIntentRef.current.get(conversationId) === intent;
    if (!result.ok) {
      if (!latest) return false;
      setError(result.error);
      setConversations((list) => applyConversationTheme(list, conversationId, previous));
      return false;
    }
    if (latest) setError(null);
    return true;
  }, []);

  const markRead = useCallback(
    (conversationId: string): void => {
      if (conversationId === '') return;
      void markReadFor(conversationId);
    },
    [markReadFor],
  );

  const sendTyping = useCallback((conversationId: string): void => {
    const self = selfIdRef.current;
    if (!conversationId || !self) return;
    const now = Date.now();
    const last = lastTypingSentRef.current.get(conversationId) ?? 0;
    if (now - last < CHAT_TYPING_THROTTLE_MS) return;
    // Wyłącznie `chat:typing:<id>`; nieotwarta rozmowa nie ma kanału, nic nie leci.
    if (typingChannelsRef.current?.send(conversationId, self)) {
      lastTypingSentRef.current.set(conversationId, now);
    }
  }, []);

  const refresh = useCallback((): void => {
    void refreshOverview();
  }, [refreshOverview]);

  // Odblokowanie audio pierwszym gestem (tylko gdy czat działa i dźwięk jest włączony).
  useEffect(() => {
    if (!active || !soundEnabled) return;
    return armChatSound();
  }, [active, soundEnabled]);

  // Włączenie przychodzi z kliknięcia, czyli z gestu: odblokuj audio OD RAZU.
  const setSoundEnabled = useCallback((enabled: boolean): void => {
    writeChatSoundEnabled(enabled);
    setSoundEnabledState(enabled);
    if (enabled) unlockChatSound();
  }, []);

  const unread = useMemo(
    () => sumUnread(conversations.filter((c) => !isTaskConversation(c))),
    [conversations],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      enabled: active,
      selfId,
      conversations,
      conversationsLoading,
      totalUnread: unread,
      presence,
      openConversationId,
      openConversation,
      closeConversation,
      openDirect,
      createGroup,
      threads,
      attachConversation,
      openTaskConversation,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      setPin,
      setFollow,
      toggleReaction,
      setTheme,
      markRead,
      sendTyping,
      error,
      refresh,
      soundEnabled,
      setSoundEnabled,
    }),
    [
      active,
      selfId,
      conversations,
      conversationsLoading,
      unread,
      presence,
      openConversationId,
      openConversation,
      closeConversation,
      openDirect,
      createGroup,
      threads,
      attachConversation,
      openTaskConversation,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      setPin,
      setFollow,
      toggleReaction,
      setTheme,
      markRead,
      sendTyping,
      error,
      refresh,
      soundEnabled,
      setSoundEnabled,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
