// Topiki i cykl życia kanałów Realtime czatu (BACKLOG 4, kontrakt L1 -> L3,
// ZMIANA 2). Baza przyjmuje od klienta broadcast WYŁĄCZNIE jako `typing` na
// prywatnym `chat:typing:<id>`; `chat:conv:<id>` jest dla klienta tylko do
// słuchania (każda próba nadania = brak prawa zapisu przy dołączeniu).
//
//   * `chat:conv:<id>`: kanał na KAŻDĄ rozmowę z listy (nieprzeczytane,
//     podgląd). Słucha `INSERT`, `UPDATE`, `read`, `reaction`, `theme_changed`.
//     Nic na nim nie nadajemy.
//   * `chat:typing:<id>`: kanał tylko dla rozmów OTWARTYCH (wątek w doku albo
//     panel zadania). Nadajemy i słuchamy wyłącznie `typing`. Zamknięcie
//     rozmowy = wyjście z kanału.
//
// Każde zdarzenie idzie do bramki (`chatRealtime.ts`) z id rozmowy TOPICU, więc
// reguły bramki (członek, nie my, rozmowa topicu) obowiązują dalej.
//
// Zero Reacta: klient Supabase wchodzi przez wąski interfejs, testy podają
// atrapę (`chatChannels.test.ts`).
import type { ChatRealtimeEvent } from './chatRealtime';

export const chatConvTopic = (conversationId: string): string => `chat:conv:${conversationId}`;
export const chatTypingTopic = (conversationId: string): string => `chat:typing:${conversationId}`;

/** Zdarzenia słuchane na `chat:conv:<id>` (bez `typing`). */
export const CHAT_CONV_EVENTS = ['INSERT', 'UPDATE', 'read', 'reaction', 'theme_changed'] as const satisfies readonly ChatRealtimeEvent[];

export interface ChatChannelLike {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (payload: unknown) => void,
  ): ChatChannelLike;
  subscribe(callback?: (status: string) => void): unknown;
  send(message: { type: 'broadcast'; event: string; payload: Record<string, unknown> }): Promise<unknown>;
}

export interface ChatChannelClient<C extends ChatChannelLike = ChatChannelLike> {
  channel(topic: string, options: { config: { private: true } }): C;
  removeChannel(channel: C): Promise<unknown>;
}

/** Odbiorca surowych zdarzeń: `gate.handle` z id rozmowy topicu. */
export type ChatChannelHandler = (conversationId: string, event: ChatRealtimeEvent, raw: unknown) => void;

/** Kanał rozmowy: tylko słuchacze, zero nadawania. */
export function subscribeConversationChannel<C extends ChatChannelLike>(
  client: ChatChannelClient<C>,
  conversationId: string,
  handle: ChatChannelHandler,
  onStatus: (status: string) => void,
): C {
  const channel = client.channel(chatConvTopic(conversationId), { config: { private: true } });
  for (const event of CHAT_CONV_EVENTS) {
    channel.on('broadcast', { event }, (raw) => handle(conversationId, event, raw));
  }
  channel.subscribe(onStatus);
  return channel;
}

export interface ChatTypingChannels {
  /** Uzgodnienie z otwartymi rozmowami: brakujące dołącza, zbędne opuszcza. */
  reconcile(conversationIds: Iterable<string>): void;
  /** Nadaje `typing` na `chat:typing:<id>`; false = rozmowa nie jest otwarta. */
  send(conversationId: string, selfId: string): boolean;
  has(conversationId: string): boolean;
  /** Wylogowanie / odmontowanie: opuszcza wszystkie kanały. */
  dispose(): void;
}

export function createTypingChannels<C extends ChatChannelLike>(
  client: ChatChannelClient<C>,
  handle: ChatChannelHandler,
): ChatTypingChannels {
  const channels = new Map<string, C>();
  let disposed = false;

  const join = (conversationId: string): void => {
    const channel = client.channel(chatTypingTopic(conversationId), { config: { private: true } });
    channel.on('broadcast', { event: 'typing' }, (raw) => handle(conversationId, 'typing', raw));
    channel.subscribe();
    channels.set(conversationId, channel);
  };

  const leave = (conversationId: string): void => {
    const channel = channels.get(conversationId);
    if (!channel) return;
    channels.delete(conversationId);
    void client.removeChannel(channel);
  };

  return {
    reconcile(conversationIds) {
      if (disposed) return;
      const wanted = new Set(Array.from(conversationIds).filter((id) => id !== ''));
      for (const id of Array.from(channels.keys())) if (!wanted.has(id)) leave(id);
      for (const id of wanted) if (!channels.has(id)) join(id);
    },
    send(conversationId, selfId) {
      const channel = channels.get(conversationId);
      if (disposed || !channel || selfId === '') return false;
      void channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: selfId, conversationId },
      });
      return true;
    },
    has(conversationId) {
      return channels.has(conversationId);
    },
    dispose() {
      disposed = true;
      for (const id of Array.from(channels.keys())) leave(id);
    },
  };
}
