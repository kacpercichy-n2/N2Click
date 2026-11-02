// Testy bramki zdarzeń realtime (R1, znalezisko 1): ładunek broadcastu jest
// niezaufany, na ekran trafia tylko wiersz z bazy. Ręczny zegar zamiast
// timerów, atrapy pobrań zamiast Supabase; scalanie przez prawdziwe funkcje
// `chatState`, więc test sprawdza to, co zobaczyłby UI.
import { describe, expect, it } from 'vitest';
import { loadMessagesByIds, type ChatDb, type ChatRow } from './chatData';
import {
  createChatRealtimeGate,
  readMessageHint,
  type ChatRealtimeGateDeps,
  type FetchedMessageEvent,
} from './chatRealtime';
import {
  applyIncomingMessage,
  applyLocalPin,
  ensureThread,
  isConversationMember,
  mergeMessages,
  mergeThreadMessages,
  mergeThreadUpdate,
  messageRevision,
} from './chatState';
import { buildDirectory } from './ui/chatPeople';
import { buildWindowItems, type ChatWindowItem } from './ui/chatWindowView';
import type { ChatConversation, ChatMember, ChatMessage, ChatReactionMap, ChatResult } from './types';

const SELF = 'user-self';
const PEER = 'user-peer';
const MANAGER = 'user-manager';
const OUTSIDER = 'user-outsider';
const CONV = 'conv-task';
const OTHER = 'conv-dm-manager';
const T1 = '2026-11-02T10:00:00+00:00';
const T2 = '2026-11-02T10:05:00+00:00';
const T3 = '2026-11-02T10:09:00+00:00';
const T4 = '2026-11-02T10:12:00+00:00';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: CONV,
    authorId: PEER,
    body: 'Cześć',
    kind: 'text',
    meta: null,
    createdAt: T2,
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachments: [],
    mentionIds: [],
    pinnedAt: null,
    pinnedBy: null,
    revisedAt: null,
    ...overrides,
  };
}

function conversation(id: string, memberIds: string[]): ChatConversation {
  return {
    id,
    kind: 'group',
    contextType: null,
    contextId: null,
    title: 'Rozmowa',
    members: memberIds.map((userId) => ({ userId, role: 'member', lastReadAt: null })),
    createdBy: SELF,
    lastMessageAt: T1,
    themeId: 'lawenda',
    lastMessage: null,
    unreadCount: 0,
  };
}

/** Kanał INSERT/UPDATE w kopercie SDK (`{ type, event, payload: { record } }`). */
function rowEvent(record: Record<string, unknown>): unknown {
  return { type: 'broadcast', event: 'INSERT', payload: { record } };
}

function sendEvent(payload: Record<string, unknown>): unknown {
  return { type: 'broadcast', event: 'x', payload };
}

/** Ręczny zegar: `tick()` odpala wszystkie zaplanowane wywołania. */
function manualClock() {
  let queue: Array<{ fn: () => void; cancelled: boolean }> = [];
  return {
    schedule(fn: () => void): () => void {
      const entry = { fn, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    pending(): number {
      return queue.filter((e) => !e.cancelled).length;
    },
    async tick(): Promise<void> {
      const due = queue;
      queue = [];
      for (const entry of due) if (!entry.cancelled) entry.fn();
      // Pobrania są asynchroniczne: dajemy im dojść.
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    },
  };
}

interface Harness {
  deps: ChatRealtimeGateDeps;
  clock: ReturnType<typeof manualClock>;
  fetchedMessageIds: string[][];
  memberFetches: string[];
  reactionFetches: string[][];
  delivered: FetchedMessageEvent[];
  members: ChatMember[][];
  reactions: ChatReactionMap[];
  themeHints: string[];
  typing: Array<[string, string]>;
}

function harness(options: {
  conversations?: ChatConversation[];
  /** Wiersze „w bazie” (to, co zwróciłby select pod RLS). */
  rows?: ChatMessage[];
  threads?: string[];
  known?: Record<string, string>;
  dbMembers?: ChatMember[];
}): Harness {
  const conversations = options.conversations ?? [
    conversation(CONV, [SELF, PEER]),
    conversation(OTHER, [SELF, MANAGER]),
  ];
  const rows = options.rows ?? [];
  const threads = new Set(options.threads ?? [CONV]);
  const clock = manualClock();
  const h: Harness = {
    clock,
    fetchedMessageIds: [],
    memberFetches: [],
    reactionFetches: [],
    delivered: [],
    members: [],
    reactions: [],
    themeHints: [],
    typing: [],
    deps: {
      selfId: () => SELF,
      isMember: (conversationId, userId) => isConversationMember(conversations, conversationId, userId),
      hasThread: (conversationId) => threads.has(conversationId),
      knownRevision: (_conversationId, messageId) => options.known?.[messageId] ?? null,
      fetchMessages: async (conversationId, ids): Promise<ChatResult<ChatMessage[]>> => {
        h.fetchedMessageIds.push(ids);
        // Jak `select ... where conversation_id = $1 and id in (...)`.
        return {
          ok: true,
          value: rows.filter((r) => r.conversationId === conversationId && ids.includes(r.id)),
        };
      },
      fetchMembers: async (conversationId): Promise<ChatResult<ChatMember[]>> => {
        h.memberFetches.push(conversationId);
        return { ok: true, value: options.dbMembers ?? [] };
      },
      fetchReactions: async (_conversationId, ids): Promise<ChatResult<ChatReactionMap>> => {
        h.reactionFetches.push(ids);
        const map: Record<string, ChatReactionMap[string]> = {};
        for (const id of ids) map[id] = [{ userId: PEER, emoji: '👍', createdAt: T3 }];
        return { ok: true, value: map };
      },
      onMessages: (_conversationId, events) => {
        h.delivered.push(...events);
      },
      onMembers: (_conversationId, list) => {
        h.members.push(list);
      },
      onReactions: (_conversationId, map) => {
        h.reactions.push(map);
      },
      onThemeHint: (conversationId) => {
        h.themeHints.push(conversationId);
      },
      onTyping: (conversationId, userId) => {
        h.typing.push([conversationId, userId]);
      },
      schedule: (fn) => clock.schedule(fn),
    },
  };
  return h;
}

function bubbles(items: ChatWindowItem[]) {
  return items.flatMap((item) =>
    item.kind === 'group' ? item.messages.map((m) => ({ ...m, authorId: item.authorId })) : [],
  );
}

describe('bramka realtime: wiadomości', () => {
  it('odrzuca INSERT wskazujący inną rozmowę niż kanał (bez pobrania)', async () => {
    const forged = message({ id: 'm-forged', conversationId: OTHER, authorId: MANAGER, body: 'forged' });
    const h = harness({ rows: [forged] });
    const gate = createChatRealtimeGate(h.deps);
    // Atakujący nadaje na kanale CONV wiersz „z” rozmowy OTHER.
    gate.handle(
      CONV,
      'INSERT',
      rowEvent({ id: forged.id, conversation_id: OTHER, author_id: MANAGER, body: 'forged', created_at: T2 }),
    );
    gate.handle(CONV, 'UPDATE', rowEvent({ id: forged.id, author_id: MANAGER, created_at: T2 }));
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([]);
    expect(h.delivered).toEqual([]);
  });

  it('podrobiony autor i treść w ładunku nigdy nie trafiają do UI: wygrywa wiersz z bazy', async () => {
    const real = message({ id: 'm1', authorId: PEER, body: 'Prawdziwa treść', createdAt: T2 });
    const h = harness({ rows: [real] });
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(
      CONV,
      'INSERT',
      rowEvent({
        id: 'm1',
        conversation_id: CONV,
        author_id: MANAGER,
        body: 'Przelej pieniądze',
        pinned_at: T2,
        created_at: T2,
      }),
    );
    await h.clock.tick();
    expect(h.delivered).toEqual([{ kind: 'INSERT', message: real }]);

    // Przez prawdziwe scalanie do tego, co renderuje wątek.
    let thread = ensureThread({}, CONV)[CONV];
    for (const event of h.delivered) thread = mergeThreadMessages(thread, [event.message]);
    const items = buildWindowItems({
      messages: thread.messages,
      selfId: SELF,
      directory: buildDirectory([]),
      isGroup: true,
      todayStr: '2026-11-02',
    });
    expect(bubbles(items)).toEqual([
      expect.objectContaining({ id: 'm1', body: 'Prawdziwa treść', authorId: PEER }),
    ]);
    expect(thread.messages[0].pinnedAt).toBeNull();
  });

  it('id, którego baza nie zwraca (zmyślone albo bez wglądu), nie pokazuje niczego', async () => {
    const h = harness({ rows: [] });
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'INSERT', rowEvent({ id: 'm-fake', conversation_id: CONV, author_id: PEER, created_at: T2 }));
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([['m-fake']]);
    expect(h.delivered).toEqual([]);
  });

  it('seria zdarzeń zlewa się w jedno pobranie, INSERT dominuje nad UPDATE', async () => {
    const rows = ['a', 'b', 'c'].map((id) => message({ id }));
    const h = harness({ rows });
    const gate = createChatRealtimeGate(h.deps);
    for (const id of ['a', 'b', 'c']) {
      gate.handle(CONV, 'INSERT', rowEvent({ id, conversation_id: CONV, created_at: T2 }));
    }
    gate.handle(CONV, 'UPDATE', rowEvent({ id: 'a', conversation_id: CONV, created_at: T2, revised_at: T3 }));
    expect(h.clock.pending()).toBe(1);
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([['a', 'b', 'c']]);
    expect(h.delivered.map((e) => [e.message.id, e.kind])).toEqual([
      ['a', 'INSERT'],
      ['b', 'INSERT'],
      ['c', 'INSERT'],
    ]);
  });

  it('zdarzenia w trakcie pobrania czekają na następne okno (jedno pobranie w locie)', async () => {
    const rows = ['a', 'b'].map((id) => message({ id }));
    const h = harness({ rows });
    let release: () => void = () => {};
    const slow = h.deps.fetchMessages;
    h.deps.fetchMessages = async (conversationId, ids) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return slow(conversationId, ids);
    };
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'INSERT', rowEvent({ id: 'a', conversation_id: CONV, created_at: T2 }));
    await h.clock.tick();
    gate.handle(CONV, 'INSERT', rowEvent({ id: 'b', conversation_id: CONV, created_at: T2 }));
    expect(h.clock.pending()).toBe(0);
    release();
    await h.clock.tick();
    expect(h.clock.pending()).toBe(1);
    await h.clock.tick();
    release();
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([['a'], ['b']]);
  });

  it('echo znanego wariantu nie kosztuje pobrania; nowsza rewizja albo kasowanie już tak', async () => {
    const h = harness({ rows: [message({ id: 'm1' })], known: { m1: T2 } });
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'INSERT', rowEvent({ id: 'm1', conversation_id: CONV, created_at: T2 }));
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([]);
    gate.handle(CONV, 'UPDATE', rowEvent({ id: 'm1', conversation_id: CONV, created_at: T2, revised_at: T3 }));
    gate.handle(CONV, 'UPDATE', rowEvent({ id: 'm1', conversation_id: CONV, created_at: T2, deleted_at: T2 }));
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([['m1']]);
  });

  it('po dispose nic nie leci i nic nie dochodzi', async () => {
    const h = harness({ rows: [message({ id: 'm1' })] });
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'INSERT', rowEvent({ id: 'm1', conversation_id: CONV, created_at: T2 }));
    gate.dispose();
    await h.clock.tick();
    expect(h.fetchedMessageIds).toEqual([]);
    expect(h.delivered).toEqual([]);
  });

  it('readMessageHint wymaga rozmowy kanału', () => {
    expect(readMessageHint(rowEvent({ id: 'x', created_at: T2 }), CONV)).toBeNull();
    expect(readMessageHint(rowEvent({ id: 'x', conversation_id: CONV, created_at: T2 }), CONV)).toEqual({
      id: 'x',
      revision: T2,
      deleted: false,
    });
  });
});

describe('bramka realtime: odczyty, reakcje, motyw, pisanie', () => {
  it('„read” od nie-członka albo dla innej rozmowy jest ignorowany', async () => {
    const h = harness({});
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'read', sendEvent({ conversationId: CONV, userId: OUTSIDER, lastReadAt: T4 }));
    gate.handle(CONV, 'read', sendEvent({ conversationId: OTHER, userId: PEER, lastReadAt: T4 }));
    // MANAGER jest członkiem OTHER, ale nie CONV.
    gate.handle(CONV, 'read', sendEvent({ conversationId: CONV, userId: MANAGER, lastReadAt: T4 }));
    await h.clock.tick();
    expect(h.memberFetches).toEqual([]);
    expect(h.members).toEqual([]);
  });

  it('„read” członka to tylko podpowiedź: znacznik przychodzi z bazy, seria = jedno pobranie', async () => {
    const dbMembers: ChatMember[] = [
      { userId: SELF, role: 'member', lastReadAt: T1 },
      { userId: PEER, role: 'member', lastReadAt: T2 },
    ];
    const h = harness({ dbMembers });
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'read', sendEvent({ conversationId: CONV, userId: PEER, lastReadAt: '2099-01-01T00:00:00Z' }));
    gate.handle(CONV, 'read', sendEvent({ conversationId: CONV, userId: PEER, lastReadAt: T3 }));
    await h.clock.tick();
    expect(h.memberFetches).toEqual([CONV]);
    expect(h.members).toEqual([dbMembers]);
  });

  it('reakcja od nie-członka, od siebie albo bez wątku jest ignorowana; członek = pobranie z bazy', async () => {
    const h = harness({ threads: [CONV] });
    const gate = createChatRealtimeGate(h.deps);
    const reaction = (conversationId: string, userId: string, messageId = 'm1') =>
      sendEvent({ conversationId, userId, messageId, emoji: '💀', createdAt: T3 });
    gate.handle(CONV, 'reaction', reaction(CONV, OUTSIDER));
    gate.handle(CONV, 'reaction', reaction(CONV, SELF));
    gate.handle(CONV, 'reaction', reaction(OTHER, PEER));
    gate.handle(OTHER, 'reaction', reaction(OTHER, MANAGER)); // brak wątku OTHER
    await h.clock.tick();
    expect(h.reactionFetches).toEqual([]);

    gate.handle(CONV, 'reaction', reaction(CONV, PEER, 'm1'));
    gate.handle(CONV, 'reaction', reaction(CONV, PEER, 'm1'));
    gate.handle(CONV, 'reaction', reaction(CONV, PEER, 'm2'));
    await h.clock.tick();
    expect(h.reactionFetches).toEqual([['m1', 'm2']]);
    // Emoji z ładunku (💀) nie dochodzi; dochodzi stan z bazy.
    expect(h.reactions).toEqual([
      {
        m1: [{ userId: PEER, emoji: '👍', createdAt: T3 }],
        m2: [{ userId: PEER, emoji: '👍', createdAt: T3 }],
      },
    ]);
  });

  it('motyw: tylko członek tej rozmowy odświeża overview', () => {
    const h = harness({});
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'theme_changed', sendEvent({ conversationId: CONV, actorId: OUTSIDER, themeId: 'x' }));
    gate.handle(CONV, 'theme_changed', sendEvent({ conversationId: OTHER, actorId: PEER, themeId: 'x' }));
    gate.handle(CONV, 'theme_changed', sendEvent({ conversationId: CONV, actorId: PEER, themeId: 'x' }));
    expect(h.themeHints).toEqual([CONV]);
  });

  it('„pisze…” tylko od członka rozmowy kanału, nigdy od siebie', () => {
    const h = harness({});
    const gate = createChatRealtimeGate(h.deps);
    gate.handle(CONV, 'typing', sendEvent({ userId: PEER }));
    gate.handle(CONV, 'typing', sendEvent({ userId: PEER, conversationId: CONV }));
    gate.handle(CONV, 'typing', sendEvent({ userId: OUTSIDER }));
    gate.handle(CONV, 'typing', sendEvent({ userId: MANAGER }));
    gate.handle(CONV, 'typing', sendEvent({ userId: SELF }));
    gate.handle(CONV, 'typing', sendEvent({ userId: PEER, conversationId: OTHER }));
    expect(h.typing).toEqual([
      [CONV, PEER],
      [CONV, PEER],
    ]);
  });
});

describe('rewizja wiadomości (BACKLOG 1: revised_at)', () => {
  it('przypięcie nie oznacza wiadomości jako edytowanej', () => {
    const original = message({ id: 'm1', createdAt: T2, revisedAt: T2 });
    // Serwer po migracji: pin podbija `revised_at`, `edited_at` zostaje null.
    const pinnedRow = { ...original, pinnedAt: T3, pinnedBy: PEER, revisedAt: T3 };
    let thread = mergeThreadMessages(ensureThread({}, CONV)[CONV], [original]);
    thread = mergeThreadUpdate(thread, pinnedRow);
    expect(thread.messages[0]).toMatchObject({ pinnedAt: T3, editedAt: null });
    // Lokalne naniesienie po RPC też nie rusza `editedAt`.
    const local = applyLocalPin(mergeThreadMessages(thread, []), 'm1', null, null);
    expect(local.messages[0].editedAt).toBeNull();
    const view = buildWindowItems({
      messages: thread.messages,
      selfId: SELF,
      directory: buildDirectory([]),
      isGroup: false,
      todayStr: '2026-11-02',
    });
    expect(bubbles(view)[0].edited).toBe(false);
  });

  it('edycja treści nadal pokazuje „(edytowana)”', () => {
    const edited = message({ id: 'm1', body: 'Poprawione', editedAt: T3, revisedAt: T3 });
    const view = buildWindowItems({
      messages: [edited],
      selfId: SELF,
      directory: buildDirectory([]),
      isGroup: false,
      todayStr: '2026-11-02',
    });
    expect(bubbles(view)[0].edited).toBe(true);
  });

  it('scalanie po revised_at: przypięcie po edycji wygrywa, starszy snapshot przegrywa', () => {
    const editedAt = message({ id: 'm1', body: 'v2', editedAt: T3, revisedAt: T3 });
    const pinnedLater = { ...editedAt, pinnedAt: T4, pinnedBy: SELF, revisedAt: T4 };
    expect(mergeMessages([editedAt], [pinnedLater])[0]).toBe(pinnedLater);
    // Spóźniona strona sprzed przypięcia nie cofa go (ta sama `edited_at`!).
    expect(mergeMessages([pinnedLater], [editedAt])[0]).toBe(pinnedLater);
  });

  it('bez kolumny revised_at (baza przed migracją) rewizja to edited_at, potem created_at', () => {
    const plain = message({ id: 'm1', createdAt: T2 });
    const edited = message({ id: 'm1', body: 'v2', createdAt: T2, editedAt: T3 });
    expect(messageRevision(plain)).toBe(T2);
    expect(messageRevision(edited)).toBe(T3);
    expect(messageRevision({ ...edited, revisedAt: T4 })).toBe(T4);
    expect(mergeMessages([plain], [edited])[0]).toBe(edited);
    expect(mergeMessages([edited], [plain])[0]).toBe(edited);
  });
});

describe('licznik nieprzeczytanych nie rośnie od powtórki', () => {
  it('wiadomość starsza niż własny znacznik odczytu nie jest nieprzeczytana', () => {
    const conv: ChatConversation = {
      ...conversation(CONV, [SELF, PEER]),
      members: [
        { userId: SELF, role: 'member', lastReadAt: T3 },
        { userId: PEER, role: 'member', lastReadAt: T1 },
      ],
      lastMessageAt: T3,
    };
    const old = message({ id: 'm-old', createdAt: T2 });
    const fresh = message({ id: 'm-new', createdAt: T4 });
    const ctx = { selfId: SELF, openConversationId: null };
    expect(applyIncomingMessage([conv], old, ctx)[0].unreadCount).toBe(0);
    expect(applyIncomingMessage([conv], fresh, ctx)[0].unreadCount).toBe(1);
  });
});

describe('loadMessagesByIds', () => {
  function db(rows: ChatRow[], calls: string[][]): ChatDb {
    return {
      selectMessagesByIds: async (_conversationId: string, ids: string[]) => {
        calls.push(ids);
        return { rows, error: null };
      },
    } as unknown as ChatDb;
  }

  it('odrzuca wiersze z innej rozmowy i spoza listy id', async () => {
    const calls: string[][] = [];
    const rows: ChatRow[] = [
      { id: 'm1', conversation_id: CONV, author_id: PEER, body: 'ok', created_at: T2 },
      { id: 'm2', conversation_id: OTHER, author_id: MANAGER, body: 'obca', created_at: T2 },
      { id: 'm9', conversation_id: CONV, author_id: PEER, body: 'nieproszona', created_at: T2 },
    ];
    const result = await loadMessagesByIds(db(rows, calls), CONV, ['m1', 'm2', 'm1', '']);
    expect(calls).toEqual([['m1', 'm2']]);
    expect(result.ok && result.value.map((m) => m.id)).toEqual(['m1']);
  });

  it('dzieli długą listę id na porcje po 50', async () => {
    const calls: string[][] = [];
    const ids = Array.from({ length: 120 }, (_, i) => `m${i}`);
    await loadMessagesByIds(db([], calls), CONV, ids);
    expect(calls.map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it('brak metody w atrapie = błąd, nie wyjątek', async () => {
    const result = await loadMessagesByIds({} as ChatDb, CONV, ['m1']);
    expect(result.ok).toBe(false);
  });
});
