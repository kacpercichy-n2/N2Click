// Kanały Realtime czatu (BACKLOG 4): „pisze…” nadawane i słuchane WYŁĄCZNIE na
// prywatnym `chat:typing:<id>` otwartych rozmów, `chat:conv:<id>` tylko do
// słuchania. Atrapa klienta Supabase zapisuje dołączenia, słuchaczy, wysyłki
// i wyjścia; zdarzenia idą przez prawdziwą bramkę (`chatRealtime.ts`).
import { describe, expect, it } from 'vitest';
import {
  chatConvTopic,
  chatTypingTopic,
  createTypingChannels,
  subscribeConversationChannel,
  type ChatChannelClient,
  type ChatChannelLike,
} from './chatChannels';
import { createChatRealtimeGate, type ChatRealtimeGateDeps } from './chatRealtime';

const SELF = 'user-self';
const PEER = 'user-peer';
const OUTSIDER = 'user-outsider';
const CONV = 'conv-task';
const OTHER = 'conv-other';

interface FakeChannel extends ChatChannelLike {
  topic: string;
  private: boolean;
  listeners: Map<string, (payload: unknown) => void>;
  sent: Array<{ event: string; payload: Record<string, unknown> }>;
  subscribed: boolean;
  removed: boolean;
  emit(event: string, payload: unknown): void;
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const client: ChatChannelClient<FakeChannel> = {
    channel(topic, options) {
      const channel: FakeChannel = {
        topic,
        private: options.config.private,
        listeners: new Map(),
        sent: [],
        subscribed: false,
        removed: false,
        on(_type, filter, callback) {
          channel.listeners.set(filter.event, callback);
          return channel;
        },
        subscribe(callback) {
          channel.subscribed = true;
          callback?.('SUBSCRIBED');
          return channel;
        },
        async send(message) {
          channel.sent.push({ event: message.event, payload: message.payload });
          return 'ok';
        },
        emit(event, payload) {
          channel.listeners.get(event)?.({ type: 'broadcast', event, payload });
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      channel.removed = true;
      return 'ok';
    },
  };
  const live = () => channels.filter((c) => !c.removed);
  const byTopic = (topic: string) => live().find((c) => c.topic === topic);
  return { client, channels, live, byTopic };
}

/** Bramka z rozmowami CONV (SELF, PEER) i OTHER (SELF, OUTSIDER). */
function typingGate() {
  const members: Record<string, string[]> = { [CONV]: [SELF, PEER], [OTHER]: [SELF, OUTSIDER] };
  const typing: Array<[string, string]> = [];
  const never = async () => ({ ok: false as const, error: 'nie w tym teście' });
  const deps: ChatRealtimeGateDeps = {
    selfId: () => SELF,
    isMember: (conversationId, userId) => (members[conversationId] ?? []).includes(userId),
    hasThread: () => true,
    knownRevision: () => null,
    fetchMessages: never,
    fetchMembers: never,
    fetchReactions: never,
    onMessages: () => {},
    onMembers: () => {},
    onReactions: () => {},
    onThemeHint: () => {},
    onTyping: (conversationId, userId) => typing.push([conversationId, userId]),
    schedule: () => () => {},
  };
  const gate = createChatRealtimeGate(deps);
  return { gate, typing, handle: gate.handle.bind(gate) };
}

describe('kanał rozmowy chat:conv', () => {
  it('jest prywatny, słucha wiadomości, odczytów, reakcji i motywu, ale nie „pisze…”', () => {
    const fake = fakeClient();
    const statuses: string[] = [];
    subscribeConversationChannel(fake.client, CONV, () => {}, (status) => statuses.push(status));
    const channel = fake.byTopic(chatConvTopic(CONV));
    expect(channel?.private).toBe(true);
    expect(Array.from(channel?.listeners.keys() ?? []).sort()).toEqual(
      ['INSERT', 'UPDATE', 'reaction', 'read', 'theme_changed'].sort(),
    );
    expect(channel?.listeners.has('typing')).toBe(false);
    expect(statuses).toEqual(['SUBSCRIBED']);
  });

  it('podrobione „pisze…” na chat:conv nie dociera do UI', () => {
    const fake = fakeClient();
    const { typing, handle } = typingGate();
    subscribeConversationChannel(fake.client, CONV, handle, () => {});
    fake.byTopic(chatConvTopic(CONV))?.emit('typing', { userId: PEER, conversationId: CONV });
    expect(typing).toEqual([]);
  });
});

describe('kanały „pisze…” chat:typing', () => {
  it('wysyłka idzie na chat:typing otwartej rozmowy, nigdy na chat:conv', () => {
    const fake = fakeClient();
    subscribeConversationChannel(fake.client, CONV, () => {}, () => {});
    const typing = createTypingChannels(fake.client, () => {});
    typing.reconcile([CONV]);

    expect(typing.send(CONV, SELF)).toBe(true);
    const typingChannel = fake.byTopic(chatTypingTopic(CONV));
    expect(typingChannel?.private).toBe(true);
    expect(typingChannel?.sent).toEqual([{ event: 'typing', payload: { userId: SELF, conversationId: CONV } }]);
    expect(fake.byTopic(chatConvTopic(CONV))?.sent).toEqual([]);
    // Na kanale „pisze…” słuchamy wyłącznie `typing`.
    expect(Array.from(typingChannel?.listeners.keys() ?? [])).toEqual(['typing']);
  });

  it('nieotwarta rozmowa nie ma kanału: nic nie leci i nic nie słuchamy', () => {
    const fake = fakeClient();
    const typing = createTypingChannels(fake.client, () => {});
    typing.reconcile([CONV]);
    expect(typing.send(OTHER, SELF)).toBe(false);
    expect(fake.byTopic(chatTypingTopic(OTHER))).toBeUndefined();
    expect(fake.channels.every((c) => c.topic.startsWith('chat:typing:'))).toBe(true);
  });

  it('członek rozmowy topicu dociera; obca rozmowa w ładunku, nie-członek i własne echo nie', () => {
    const fake = fakeClient();
    const gate = typingGate();
    const typing = createTypingChannels(fake.client, gate.handle);
    typing.reconcile([CONV, OTHER]);
    const conv = fake.byTopic(chatTypingTopic(CONV));
    const other = fake.byTopic(chatTypingTopic(OTHER));

    conv?.emit('typing', { userId: PEER });
    conv?.emit('typing', { userId: PEER, conversationId: CONV });
    // Ładunek wskazuje inną rozmowę niż topic.
    conv?.emit('typing', { userId: PEER, conversationId: OTHER });
    // Członek OTHER, ale nie CONV: na topicu CONV się nie liczy.
    conv?.emit('typing', { userId: OUTSIDER });
    // PEER na topicu OTHER, w której nie jest członkiem.
    other?.emit('typing', { userId: PEER, conversationId: OTHER });
    conv?.emit('typing', { userId: SELF });
    other?.emit('typing', { userId: OUTSIDER, conversationId: OTHER });

    expect(gate.typing).toEqual([
      [CONV, PEER],
      [CONV, PEER],
      [OTHER, OUTSIDER],
    ]);
  });

  it('zamknięcie rozmowy opuszcza jej kanał, ponowne otwarcie dołącza od nowa', () => {
    const fake = fakeClient();
    const typing = createTypingChannels(fake.client, () => {});
    typing.reconcile([CONV, OTHER]);
    expect(fake.live().map((c) => c.topic).sort()).toEqual([chatTypingTopic(CONV), chatTypingTopic(OTHER)].sort());

    typing.reconcile([CONV]);
    expect(fake.live().map((c) => c.topic)).toEqual([chatTypingTopic(CONV)]);
    expect(typing.send(OTHER, SELF)).toBe(false);

    // Powtórne uzgodnienie tego samego zbioru nie dołącza drugi raz.
    typing.reconcile([CONV]);
    expect(fake.channels).toHaveLength(2);

    typing.reconcile([CONV, OTHER]);
    expect(fake.channels).toHaveLength(3);
    expect(fake.live()).toHaveLength(2);
  });

  it('dispose (wylogowanie) opuszcza wszystkie kanały i blokuje dalsze dołączenia i wysyłki', () => {
    const fake = fakeClient();
    const typing = createTypingChannels(fake.client, () => {});
    typing.reconcile([CONV, OTHER]);
    typing.dispose();
    expect(fake.live()).toEqual([]);
    typing.reconcile([CONV]);
    expect(fake.live()).toEqual([]);
    expect(typing.send(CONV, SELF)).toBe(false);
  });

  it('pusty id rozmowy jest pomijany', () => {
    const fake = fakeClient();
    const typing = createTypingChannels(fake.client, () => {});
    typing.reconcile(['', CONV]);
    expect(fake.channels.map((c) => c.topic)).toEqual([chatTypingTopic(CONV)]);
  });
});
