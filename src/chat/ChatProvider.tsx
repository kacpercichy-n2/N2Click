// Cienki dostawca Reacta dla czatu: spina warstwę danych (`chatData.ts`),
// czystą redukcję stanu (`chatState.ts`) i kanały Realtime. Cała logika, którą
// da się wyrazić bez Reacta, mieszka w tamtych dwóch modułach — tutaj zostają
// wyłącznie efekty, cykl życia kanałów i sklejenie kontekstu.
//
// GRANICE / DECYZJE:
//   * Czat NIE dotyka reduktora aplikacji ani localStorage. Wyłączony
//     (`enabled === false`) provider przepuszcza dzieci i nie tworzy ANI klienta
//     Supabase, ANI kanału — tryb lokalny działa dokładnie jak dotąd. Jedyny
//     wyjątek: preferencja „ping dźwiękowy" to ustawienie URZĄDZENIA czytane
//     i zapisywane przez `store/storage.ts` (dedykowany klucz, nie dane planera).
//   * Ping dźwiękowy (`chatSound.ts`): decyzja w `decideChatPing` przy każdym
//     INSERT z broadcastu; audio gra tylko po geście użytkownika (autoplay).
//   * Realtime idzie przez BROADCAST (nie `postgres_changes`): kanał prywatny
//     `chat:conv:<id>` per rozmowa, multipleksowany po jednym sockecie. Kanały
//     prywatne autoryzuje token warstwy realtime — `client.realtime.setAuth(...)`
//     MUSI polecieć przed `subscribe` i po każdej rotacji tokenu, inaczej join
//     odbija się o RLS.
//   * Broadcast nie gwarantuje dostarczenia: po każdym POWROCIE do `SUBSCRIBED`
//     dociągamy overview, a dla otwartej rozmowy wiadomości nowsze od ostatniej
//     znanej (ten sam wzorzec „dociągnij po przerwie" co CloudSyncProvider).
//   * Jedna otwarta rozmowa naraz (wariant UI „bąbelki”).
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
import { getSupabaseClient } from '../supabase/client';
import {
  createGroup as createGroupRow,
  createSupabaseChatDb,
  extractBroadcastRecord,
  loadMessagesPage,
  loadMessagesSince,
  loadOverview,
  loadReactions,
  markRead as markReadRow,
  openDirect as openDirectRow,
  sendMessage as sendMessageRow,
  setReaction as setReactionRow,
  toChatMessage,
  toChatReactionEvent,
  type ChatDb,
} from './chatData';
import {
  applyIncomingMessage,
  applyMessageUpdate,
  applyReactionEvent,
  markConversationRead,
  mergeMessages,
  mergeReactions,
  newestMessageCursor,
  nextReactionIntent,
  pruneTyping,
  removeTyping,
  applyTypingSignal,
  sortConversations,
  totalUnread as sumUnread,
  typingUserIds as readTypingUserIds,
  type ChatTypingEntry,
} from './chatState';
import { readChatSoundEnabled, writeChatSoundEnabled } from '../store/storage';
import { armChatSound, decideChatPing, playChatPing, unlockChatSound } from './chatSound';
import {
  CHAT_CATCHUP_MAX_PAGES,
  CHAT_PAGE_SIZE,
  CHAT_TYPING_THROTTLE_MS,
  type ChatConversation,
  type ChatMessage,
  type ChatMessageCursor,
  type ChatReactionMap,
} from './types';

/** Zlewanie serii zdarzeń w jedno odświeżenie listy rozmów. */
const OVERVIEW_REFRESH_DEBOUNCE_MS = 700;

const EMPTY_PRESENCE: ReadonlySet<string> = new Set<string>();
const EMPTY_REACTIONS: ChatReactionMap = {};

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
  conversations: ChatConversation[];
  /** Pierwsze wczytanie listy rozmów (ciche odświeżenia jej nie podnoszą). */
  conversationsLoading: boolean;
  totalUnread: number;
  /** Chmurowe uuid osób obecnych online (kanał `chat:presence`). */
  presence: ReadonlySet<string>;
  openConversationId: string | null;
  openConversation: (conversationId: string) => void;
  closeConversation: () => void;
  /** Otwiera (tworząc w razie potrzeby) DM; zwraca id rozmowy albo null. */
  openDirect: (otherUserId: string) => Promise<string | null>;
  /** Tworzy grupę i ją otwiera; zwraca id rozmowy albo null. */
  createGroup: (title: string, memberIds: string[]) => Promise<string | null>;
  /** Wiadomości OTWARTEJ rozmowy, rosnąco (najstarsza pierwsza). */
  messages: ChatMessage[];
  messagesLoading: boolean;
  /** Są starsze wiadomości do dociągnięcia (`loadOlder`). */
  hasMore: boolean;
  loadOlder: () => void;
  sendMessage: (body: string) => Promise<boolean>;
  /** Reakcje wiadomości OTWARTEJ rozmowy (id wiadomości → lista). */
  reactions: ChatReactionMap;
  /**
   * Klik w emoji przy wiadomości: to samo co własna reakcja zdejmuje, inne
   * podmienia, brak ustawia. Optymistycznie od razu, potem RPC; kolejne
   * kliknięcia w trakcie zapisu czekają jako OSTATNI zamiar.
   */
  toggleReaction: (messageId: string, emoji: string) => void;
  markRead: () => void;
  /** Osoby piszące w otwartej rozmowie (bez zalogowanego, z TTL). */
  typingUserIds: string[];
  sendTyping: () => void;
  /** Ostatni polski komunikat błędu albo null. */
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

/** Nadawca sygnału „pisze…" z ładunku broadcastu (`{ userId }`). */
function readTypingUserId(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const envelope = raw as { payload?: unknown };
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') return '';
  const userId = (payload as { userId?: unknown }).userId;
  return typeof userId === 'string' ? userId : '';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typing, setTyping] = useState<ChatTypingEntry[]>([]);
  const [reactions, setReactions] = useState<ChatReactionMap>(EMPTY_REACTIONS);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(readChatSoundEnabled);

  // Żywe kopie stanu dla callbacków przypiętych do kanałów. Kanał subskrybujemy
  // RAZ na rozmowę, więc handler nie może domykać się po wartościach z renderu.
  const dbRef = useRef<ChatDb | null>(null);
  const selfIdRef = useRef<string | null>(selfId);
  const tokenRef = useRef<string | null>(accessToken);
  const openIdRef = useRef<string | null>(openConversationId);
  const conversationsRef = useRef<ChatConversation[]>(conversations);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const reactionsRef = useRef<ChatReactionMap>(reactions);
  const hasMoreRef = useRef<boolean>(hasMore);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  /** Czas ostatniego pinga (dławik w `decideChatPing`). */
  const lastPingAtRef = useRef<number | null>(null);
  selfIdRef.current = selfId;
  soundEnabledRef.current = soundEnabled;
  tokenRef.current = accessToken;
  openIdRef.current = openConversationId;
  conversationsRef.current = conversations;
  messagesRef.current = messages;
  reactionsRef.current = reactions;
  hasMoreRef.current = hasMore;

  const mountedRef = useRef(true);
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const selfChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const olderCursorRef = useRef<ChatMessageCursor | null>(null);
  const loadingOlderRef = useRef(false);
  const lastTypingSentRef = useRef(0);
  /** Reakcje w locie (id wiadomości → kolejka); patrz `toggleReaction`. */
  const pendingReactionsRef = useRef<Map<string, PendingReaction>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    const openId = openIdRef.current;
    setConversations(
      openId
        ? markConversationRead(sorted, openId, selfIdRef.current, new Date().toISOString())
        : sorted,
    );
  }, []);

  const scheduleOverviewRefresh = useCallback((): void => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshOverview();
    }, OVERVIEW_REFRESH_DEBOUNCE_MS);
  }, [refreshOverview]);

  const markReadFor = useCallback(async (conversationId: string): Promise<void> => {
    const db = dbRef.current;
    const self = selfIdRef.current;
    if (!db || !self || conversationId === '') return;
    const at = new Date().toISOString();
    setConversations((list) => markConversationRead(list, conversationId, self, at));
    // Błąd zapisu zostawiamy cichy: kolejne overview przywróci prawdę serwera,
    // a baner „nie zapisano odczytu” byłby szumem przy każdym przełączeniu.
    await markReadRow(db, conversationId, self, at);
  }, []);

  /** Nadrabia lukę w otwartej rozmowie po joinie kanału (pierwszym i każdym kolejnym). */
  const catchUpOpenConversation = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    const conversationId = openIdRef.current;
    if (!db || !conversationId) return;
    const cursor = newestMessageCursor(messagesRef.current);
    if (!cursor) {
      // Brak kursora NIE oznacza „nie ma czego nadrabiać": pierwsza strona może
      // być jeszcze w locie albo rozmowa była pusta w snapshocie otwarcia —
      // w obu stanach wiadomość nadana przed pierwszym joinem nie ma się skąd
      // wziąć (broadcast przepadł, a `loadMessagesSince` nie ma od czego liczyć).
      // Pobieramy więc pierwszą stronę PONOWNIE i scalamy: `mergeMessages`
      // deduplikuje po id, a efekt otwarcia też scala, nie nadpisuje, więc
      // równoległość obu pobrań jest bezpieczna (przegląd 2026-08-13).
      const result = await loadMessagesPage(db, conversationId, null);
      if (!result.ok || !mountedRef.current || openIdRef.current !== conversationId) return;
      if (result.value.messages.length === 0) return;
      setMessages((previous) => mergeMessages(previous, result.value.messages));
      setReactions((previous) => mergeReactions(previous, result.value.reactions));
      // Stan paginacji ustawiamy tylko, gdy nikt go jeszcze nie ustawił —
      // rozmowa bez kursora nie ma wczytanych starszych stron do ochrony.
      if (olderCursorRef.current === null) {
        olderCursorRef.current = result.value.cursor;
        setHasMore(result.value.hasMore);
      }
      void markReadFor(conversationId);
      return;
    }
    // PĘTLA, nie jedno pobranie: `loadMessagesSince` zwraca najwyżej stronę
    // (50), a przerwa bywa dłuższa. Pojedyncze pobranie zostawiłoby DZIURĘ
    // w środku listy — `loadOlder` idzie wstecz od NAJSTARSZEJ wiadomości,
    // więc ubytku w środku nigdy by nie zasypał (przegląd 2026-08-13).
    let next: ChatMessageCursor | null = cursor;
    let appended = false;
    let saturated = false;
    for (let page = 0; page < CHAT_CATCHUP_MAX_PAGES; page += 1) {
      const result = await loadMessagesSince(db, conversationId, next);
      if (!result.ok || !mountedRef.current || openIdRef.current !== conversationId) return;
      if (result.value.messages.length === 0) break;
      appended = true;
      setMessages((previous) => mergeMessages(previous, result.value.messages));
      setReactions((previous) => mergeReactions(previous, result.value.reactions));
      if (result.value.messages.length < CHAT_PAGE_SIZE) break;
      const advanced = newestMessageCursor(result.value.messages);
      // Brak postępu kursora = pętla i tak nic nie dołoży; wychodzimy.
      if (!advanced || (next && advanced.id === next.id)) break;
      next = advanced;
      saturated = page === CHAT_CATCHUP_MAX_PAGES - 1;
    }

    if (saturated) {
      // Bardzo długa nieobecność: zamiast zostawić listę z ubytkiem, odtwarzamy
      // ją od pierwszej strony (starsze wraca `loadOlder`, `hasMore` to pokaże).
      const fresh = await loadMessagesPage(db, conversationId, null);
      if (!fresh.ok || !mountedRef.current || openIdRef.current !== conversationId) return;
      setMessages(fresh.value.messages);
      setReactions(fresh.value.reactions);
      setHasMore(fresh.value.hasMore);
      olderCursorRef.current = fresh.value.cursor;
      void markReadFor(conversationId);
      return;
    }

    if (appended) void markReadFor(conversationId);

    // Reakcje na JUŻ WCZYTANYCH wiadomościach: broadcast `reaction` w martwym
    // oknie socketu przepadł bezgłośnie, a nadrobienie wyżej dociąga tylko
    // nowe wiadomości. Jedno zapytanie po id wszystkich znanych wiadomości.
    const known = messagesRef.current.map((message) => message.id);
    const refreshed = await loadReactions(db, conversationId, known);
    if (!refreshed.ok || !mountedRef.current || openIdRef.current !== conversationId) return;
    setReactions((previous) => mergeReactions(previous, refreshed.value));
  }, [markReadFor]);

  // ---- Obsługa zdarzeń kanału -------------------------------------------------

  const handleBroadcast = useCallback(
    (event: 'INSERT' | 'UPDATE', raw: unknown): void => {
      const message = toChatMessage(extractBroadcastRecord(raw));
      if (!message) return;
      const openId = openIdRef.current;
      const self = selfIdRef.current;

      if (event === 'UPDATE') {
        setConversations((list) => applyMessageUpdate(list, message));
      } else {
        const known = conversationsRef.current.some(
          (conversation) => conversation.id === message.conversationId,
        );
        // Wiadomość w rozmowie, której jeszcze nie mamy na liście (ktoś dodał
        // nas do grupy) — tylko overview wie, co to za rozmowa.
        if (!known) scheduleOverviewRefresh();
        setConversations((list) =>
          applyIncomingMessage(list, message, { selfId: self, openConversationId: openId }),
        );
        setTyping((entries) => removeTyping(entries, message.authorId));

        // Ping dźwiękowy: decyzja czysta, audio tylko gdy gest już odblokował
        // kontekst. Własne wiadomości i otwarta widoczna rozmowa milczą.
        if (self !== null) {
          const now = Date.now();
          const decision = decideChatPing({
            authorId: message.authorId,
            selfId: self,
            conversationId: message.conversationId,
            openConversationId: openId,
            documentHidden: typeof document !== 'undefined' && document.hidden,
            enabled: soundEnabledRef.current,
            lastPingAt: lastPingAtRef.current,
            now,
          });
          if (decision.play && playChatPing(decision.level)) lastPingAtRef.current = now;
        }
      }

      if (message.conversationId === openId) {
        setMessages((previous) => mergeMessages(previous, [message]));
        if (event === 'INSERT' && message.authorId !== self) void markReadFor(openId);
      }
    },
    [markReadFor, scheduleOverviewRefresh],
  );

  const handleReaction = useCallback((conversationId: string, raw: unknown): void => {
    // Reakcje trzymamy wyłącznie dla OTWARTEJ rozmowy (lista rozmów ich nie
    // pokazuje); po otwarciu innej rozmowy stronę i tak czytamy od nowa.
    if (conversationId !== openIdRef.current) return;
    const event = toChatReactionEvent(raw);
    if (!event || event.conversationId !== conversationId) return;
    setReactions((previous) => applyReactionEvent(previous, event));
  }, []);

  const handleTyping = useCallback((conversationId: string, raw: unknown): void => {
    // „pisze…" pokazujemy wyłącznie w otwartej rozmowie — poza nią sygnał nie ma
    // gdzie się wyrenderować, a trzymanie go tylko rozjeżdżałoby TTL.
    if (conversationId !== openIdRef.current) return;
    const userId = readTypingUserId(raw);
    if (userId === '' || userId === selfIdRef.current) return;
    setTyping((entries) => applyTypingSignal(entries, userId, Date.now()));
  }, []);

  const subscribeConversation = useCallback(
    (client: SupabaseClient, conversationId: string): RealtimeChannel => {
      const channel = client
        .channel(`chat:conv:${conversationId}`, { config: { private: true } })
        .on('broadcast', { event: 'INSERT' }, (raw: unknown) => handleBroadcast('INSERT', raw))
        .on('broadcast', { event: 'UPDATE' }, (raw: unknown) => handleBroadcast('UPDATE', raw))
        .on('broadcast', { event: 'typing' }, (raw: unknown) => handleTyping(conversationId, raw))
        .on('broadcast', { event: 'reaction' }, (raw: unknown) =>
          handleReaction(conversationId, raw),
        );
      channel.subscribe((status: string) => {
        if (status !== 'SUBSCRIBED') return;
        // KAŻDY `SUBSCRIBED`, także pierwszy: wiadomość nadana między snapshotem
        // overview a dojściem joinu wpadłaby w szczelinę (ten sam wyścig co na
        // kanale osobistym). Rejoin po przerwie nadrabia martwe okno tak samo.
        // Debounce skleja serię joinów przy starcie sesji w jedno RPC, a
        // `catchUpOpenConversation` na pustej liście wraca natychmiast (pierwsza
        // strona i tak się wczytuje, `mergeMessages` deduplikuje po id).
        scheduleOverviewRefresh();
        if (openIdRef.current === conversationId) void catchUpOpenConversation();
      });
      return channel;
    },
    [handleBroadcast, handleTyping, handleReaction, scheduleOverviewRefresh, catchUpOpenConversation],
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
      setMessages([]);
      setMessagesLoading(false);
      setHasMore(false);
      setOpenConversationId(null);
      setTyping([]);
      setReactions(EMPTY_REACTIONS);
      setPresence(EMPTY_PRESENCE);
      setError(null);
      olderCursorRef.current = null;
      return;
    }

    const client = getSupabaseClient();
    const db = createSupabaseChatDb(client);
    dbRef.current = db;
    let cancelled = false;
    setConversationsLoading(true);

    void (async () => {
      const token = tokenRef.current;
      if (token) await client.realtime.setAuth(token);
      if (cancelled) return;

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
      // bez niego świeżo założona rozmowa docierała do zaproszonego dopiero przy
      // pełnym odświeżeniu — kanały rozmów subskrybujemy przecież dopiero wtedy,
      // gdy rozmowa jest już na liście. INSERT = zaproszenie, DELETE = usunięcie;
      // w obu przypadkach prawdę zna wyłącznie `chat_overview()`, więc tylko
      // planujemy odświeżenie (uzgadnianie kanałów dołoży/zdejmie subskrypcję).
      const selfChannel = client
        .channel(`chat:user:${selfId}`, { config: { private: true } })
        .on('broadcast', { event: 'INSERT' }, () => scheduleOverviewRefresh())
        .on('broadcast', { event: 'DELETE' }, () => scheduleOverviewRefresh());
      selfChannelRef.current = selfChannel;
      // Broadcast nie gwarantuje dostarczenia, więc zdarzenie nadane w martwym
      // oknie socketu przepada bezgłośnie. Odświeżamy listę rozmów po KAŻDYM
      // `SUBSCRIBED` — także pierwszym: zaproszenie wysłane między snapshotem
      // `refreshOverview()` a dojściem joinu inaczej wpadłoby w szczelinę
      // (wyścig z przeglądu 2026-08-13). Debounce skleja te odświeżenia w jedno
      // RPC, więc start sesji nie drożeje zauważalnie. Dla świeżego konta bez
      // rozmów ten kanał jest JEDYNYM, który może taką lukę nadrobić.
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
      if (presenceChannelRef.current) {
        void client.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      if (selfChannelRef.current) {
        void client.removeChannel(selfChannelRef.current);
        selfChannelRef.current = null;
      }
      dbRef.current = null;
    };
  }, [active, selfId, refreshOverview, scheduleOverviewRefresh]);

  // Uzgodnienie kanałów z listą rozmów: dokładamy kanał nowej rozmowy, zdejmujemy
  // kanał rozmowy, której już nie widzimy. Klucz stringowy zamiast tablicy —
  // efekt ma ruszać przy zmianie ZBIORU id, nie przy każdej nowej wiadomości.
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

  // Pierwsza strona wiadomości po otwarciu rozmowy (+ oznaczenie jako przeczytana).
  useEffect(() => {
    if (!active || !openConversationId) {
      setMessages([]);
      setMessagesLoading(false);
      setHasMore(false);
      setTyping([]);
      setReactions(EMPTY_REACTIONS);
      pendingReactionsRef.current.clear();
      olderCursorRef.current = null;
      return;
    }
    const db = dbRef.current;
    if (!db) return;
    let cancelled = false;
    setMessages([]);
    setTyping([]);
    setReactions(EMPTY_REACTIONS);
    pendingReactionsRef.current.clear();
    setMessagesLoading(true);
    olderCursorRef.current = null;

    void (async () => {
      const result = await loadMessagesPage(db, openConversationId, null);
      if (cancelled || !mountedRef.current) return;
      setMessagesLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // SCALANIE, nie nadpisanie: broadcast albo catch-up mogły dołożyć
      // wiadomości, zanim to pobranie wróciło — REPLACE by je skasował.
      // Efekt zaczyna od `setMessages([])`, więc w zwykłej ścieżce scalenie
      // z pustą listą jest tożsame z podstawieniem wyniku.
      setMessages((previous) => mergeMessages(previous, result.value.messages));
      setReactions((previous) => mergeReactions(previous, result.value.reactions));
      setHasMore(result.value.hasMore);
      olderCursorRef.current = result.value.cursor;
      void markReadFor(openConversationId);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, openConversationId, markReadFor]);

  // Wygaszanie sygnałów „pisze…" — nadawca może zniknąć bez pożegnania.
  useEffect(() => {
    if (typing.length === 0) return;
    const soonest = typing.reduce(
      (min, entry) => (entry.expiresAt < min ? entry.expiresAt : min),
      Number.POSITIVE_INFINITY,
    );
    const delay = Math.max(soonest - Date.now(), 50);
    const timer = setTimeout(() => {
      setTyping((entries) => pruneTyping(entries, Date.now()));
    }, delay);
    return () => clearTimeout(timer);
  }, [typing]);

  // ---- API kontekstu ----------------------------------------------------------

  const openConversation = useCallback((conversationId: string): void => {
    setOpenConversationId(conversationId === '' ? null : conversationId);
  }, []);

  const closeConversation = useCallback((): void => {
    setOpenConversationId(null);
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
      // Nowa rozmowa musi wejść na listę, zanim ją otworzymy — inaczej nie
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

  const loadOlder = useCallback((): void => {
    const db = dbRef.current;
    const conversationId = openIdRef.current;
    const cursor = olderCursorRef.current;
    if (!db || !conversationId || !cursor) return;
    if (loadingOlderRef.current || !hasMoreRef.current) return;
    loadingOlderRef.current = true;
    setMessagesLoading(true);
    void (async () => {
      const result = await loadMessagesPage(db, conversationId, cursor);
      loadingOlderRef.current = false;
      if (!mountedRef.current || openIdRef.current !== conversationId) return;
      setMessagesLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((previous) => mergeMessages(previous, result.value.messages));
      setReactions((previous) => mergeReactions(previous, result.value.reactions));
      setHasMore(result.value.hasMore);
      olderCursorRef.current = result.value.cursor;
    })();
  }, []);

  /**
   * Zapis reakcji z KOLEJKĄ per wiadomość: w locie jest najwyżej jedno RPC na
   * wiadomość, a kliknięcia w trakcie nadpisują wyłącznie „ostatni zamiar".
   * RPC dostaje stan docelowy (nie „przełącz"), więc kolejność dojścia nie ma
   * znaczenia. Odpowiedź serwera podmienia listę tylko wtedy, gdy nic już nie
   * czeka — inaczej cofałaby na moment świeższy stan optymistyczny.
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
      if (!mountedRef.current || openIdRef.current !== conversationId) return;
      if (queued !== undefined) {
        void runReaction(conversationId, messageId, queued);
        return;
      }
      if (result.ok) {
        setError(null);
        setReactions((previous) => mergeReactions(previous, { [messageId]: result.value }));
        return;
      }
      setError(result.error);
      // Cofnięcie optymistycznej zmiany = prawda serwera, nie zgadywanie.
      const refreshed = await loadReactions(db, conversationId, [messageId]);
      if (!refreshed.ok || !mountedRef.current || openIdRef.current !== conversationId) return;
      setReactions((previous) => mergeReactions(previous, refreshed.value));
    },
    [],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string): void => {
      const conversationId = openIdRef.current;
      const self = selfIdRef.current;
      if (!conversationId || !self || messageId === '' || emoji === '') return;
      const message = messagesRef.current.find((entry) => entry.id === messageId);
      if (!message || message.deletedAt !== null) return;
      const intent = nextReactionIntent(reactionsRef.current[messageId] ?? [], self, emoji);
      setReactions((previous) =>
        applyReactionEvent(previous, {
          messageId,
          conversationId,
          userId: self,
          emoji: intent,
          createdAt: new Date().toISOString(),
        }),
      );
      void runReaction(conversationId, messageId, intent);
    },
    [runReaction],
  );

  const sendMessage = useCallback(async (body: string): Promise<boolean> => {
    const db = dbRef.current;
    const conversationId = openIdRef.current;
    const self = selfIdRef.current;
    if (!db || !conversationId || !self) return false;
    const result = await sendMessageRow(db, conversationId, self, body);
    if (!result.ok) {
      if (mountedRef.current) setError(result.error);
      return false;
    }
    if (!mountedRef.current) return true;
    setError(null);
    // Wstawiamy wiersz zwrócony przez serwer (id i `created_at` są już
    // autorytatywne) — echo broadcastu trafi w dedup po id.
    setMessages((previous) => mergeMessages(previous, [result.value]));
    setConversations((list) =>
      applyIncomingMessage(list, result.value, {
        selfId: self,
        openConversationId: conversationId,
      }),
    );
    return true;
  }, []);

  const markRead = useCallback((): void => {
    const conversationId = openIdRef.current;
    if (!conversationId) return;
    void markReadFor(conversationId);
  }, [markReadFor]);

  const sendTyping = useCallback((): void => {
    const conversationId = openIdRef.current;
    const self = selfIdRef.current;
    if (!conversationId || !self) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < CHAT_TYPING_THROTTLE_MS) return;
    const channel = channelsRef.current.get(conversationId);
    if (!channel) return;
    lastTypingSentRef.current = now;
    void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: self } });
  }, []);

  const refresh = useCallback((): void => {
    void refreshOverview();
  }, [refreshOverview]);

  // Odblokowanie audio pierwszym gestem — tylko gdy czat działa i dźwięk jest
  // włączony; wyłączony dźwięk nie zakłada nasłuchów ani nie tworzy kontekstu.
  useEffect(() => {
    if (!active || !soundEnabled) return;
    return armChatSound();
  }, [active, soundEnabled]);

  // Włączenie przychodzi z kliknięcia w przełącznik, czyli z gestu — odblokuj
  // audio OD RAZU, żeby pierwszy ping nie czekał na kolejne kliknięcie gdzieś
  // w aplikacji (efekt `armChatSound` zakłada nasłuchy dopiero po tym geście).
  const setSoundEnabled = useCallback((enabled: boolean): void => {
    writeChatSoundEnabled(enabled);
    setSoundEnabledState(enabled);
    if (enabled) unlockChatSound();
  }, []);

  const typingIds = useMemo(() => readTypingUserIds(typing, Date.now()), [typing]);
  const unread = useMemo(() => sumUnread(conversations), [conversations]);

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
      messages,
      messagesLoading,
      hasMore,
      loadOlder,
      sendMessage,
      reactions,
      toggleReaction,
      markRead,
      typingUserIds: typingIds,
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
      messages,
      messagesLoading,
      hasMore,
      loadOlder,
      sendMessage,
      reactions,
      toggleReaction,
      markRead,
      typingIds,
      sendTyping,
      error,
      refresh,
      soundEnabled,
      setSoundEnabled,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
