// Testy czystej warstwy danych czatu na atrapie granicy bazy (`ChatDb`) — bez
// SDK, bez żywego Supabase, bez jsdom. Pokrywają: łagodne mapowanie wierszy,
// kursor paginacji, atomowe otwarcie DM-u i grupy przez RPC, wysyłkę i zapis
// odczytu.
import { describe, expect, it } from 'vitest';
import {
  buildNewerThanFilter,
  buildOlderThanFilter,
  createGroup,
  extractBroadcastRecord,
  loadMessagesPage,
  loadMessagesSince,
  loadOverview,
  loadReactions,
  markRead,
  openDirect,
  reactionsFromMessageRows,
  reactionsFromRows,
  sendMessage,
  setReaction,
  toChatConversation,
  toChatMessage,
  toChatReactionEvent,
  type ChatDb,
  type ChatDbError,
  type ChatMessagesQuery,
  type ChatRow,
} from './chatData';
import { CHAT_MESSAGES, CHAT_MESSAGE_MAX_LENGTH } from './types';

const SELF = 'aaaa-self';
const PEER = 'bbbb-peer';
const CONV = 'conv-1';
const T1 = '2026-08-13T10:00:00+00:00';
const T2 = '2026-08-13T10:05:00+00:00';
const T3 = '2026-08-13T10:09:00+00:00';

function messageRow(overrides: Partial<Record<string, unknown>> = {}): ChatRow {
  return {
    id: 'm1',
    conversation_id: CONV,
    author_id: PEER,
    body: 'Cześć',
    created_at: T1,
    edited_at: null,
    deleted_at: null,
    reply_to: null,
    ...overrides,
  };
}

interface FakeCall {
  reads: Array<{ conversationId: string; userId: string; atIso: string }>;
  queries: ChatMessagesQuery[];
  directs: string[];
  messages: ChatRow[];
  groups: Array<{ title: string; memberIds: string[] }>;
  reactionQueries: Array<{ conversationId: string; messageIds: string[] }>;
  reactions: Array<{ messageId: string; emoji: string | null }>;
}

class FakeChatDb implements ChatDb {
  overviewRows: ChatRow[] = [];
  overviewError: ChatDbError | null = null;
  /** Kolejne odpowiedzi na `selectMessages` (pierwsza z brzegu, potem ostatnia). */
  messagePages: ChatRow[][] = [[]];
  messagesError: ChatDbError | null = null;
  openedDirectId: string | null = CONV;
  openDirectError: ChatDbError | null = null;
  insertedMessageRow: ChatRow | null = messageRow();
  insertMessageError: ChatDbError | null = null;
  readError: ChatDbError | null = null;
  createdGroupId: string | null = CONV;
  createGroupError: ChatDbError | null = null;
  reactionRows: ChatRow[] = [];
  reactionsError: ChatDbError | null = null;
  setReactionRows: ChatRow[] = [];
  setReactionError: ChatDbError | null = null;

  calls: FakeCall = {
    reads: [],
    queries: [],
    directs: [],
    messages: [],
    groups: [],
    reactionQueries: [],
    reactions: [],
  };

  private next<T>(list: T[], index: number): T {
    return list[Math.min(index, list.length - 1)];
  }

  async overview() {
    return { rows: this.overviewRows, error: this.overviewError };
  }

  async selectMessages(query: ChatMessagesQuery) {
    const index = this.calls.queries.length;
    this.calls.queries.push(query);
    if (this.messagesError) return { rows: [], error: this.messagesError };
    return { rows: this.next(this.messagePages, index), error: null };
  }

  async openDirectAtomic(otherUserId: string) {
    this.calls.directs.push(otherUserId);
    if (this.openDirectError) return { id: null, error: this.openDirectError };
    return { id: this.openedDirectId, error: null };
  }

  async createGroupAtomic(title: string, memberIds: string[]) {
    this.calls.groups.push({ title, memberIds });
    if (this.createGroupError) return { id: null, error: this.createGroupError };
    return { id: this.createdGroupId, error: null };
  }

  async insertMessage(row: ChatRow) {
    this.calls.messages.push(row);
    if (this.insertMessageError) return { row: null, error: this.insertMessageError };
    return { row: this.insertedMessageRow, error: null };
  }

  async updateLastReadAt(conversationId: string, userId: string, atIso: string) {
    this.calls.reads.push({ conversationId, userId, atIso });
    return { error: this.readError };
  }

  async selectReactions(conversationId: string, messageIds: string[]) {
    this.calls.reactionQueries.push({ conversationId, messageIds });
    if (this.reactionsError) return { rows: [], error: this.reactionsError };
    return { rows: this.reactionRows, error: null };
  }

  async setReaction(messageId: string, emoji: string | null) {
    this.calls.reactions.push({ messageId, emoji });
    if (this.setReactionError) return { rows: [], error: this.setReactionError };
    return { rows: this.setReactionRows, error: null };
  }
}

// ---- Mapowanie ---------------------------------------------------------------

describe('mapowanie wierszy', () => {
  it('mapuje wiersz chat_overview z uczestnikami i ostatnią wiadomością', () => {
    const conversation = toChatConversation({
      id: CONV,
      kind: 'group',
      title: 'Zespół',
      created_by: SELF,
      last_message_at: T2,
      members: [
        { user_id: SELF, role: 'owner', last_read_at: T1 },
        { user_id: PEER, role: 'member', last_read_at: null },
      ],
      last_message: { id: 'm2', author_id: PEER, body: 'Hej', created_at: T2, deleted_at: null },
      unread_count: 3,
    });
    expect(conversation).toEqual({
      id: CONV,
      kind: 'group',
      title: 'Zespół',
      createdBy: SELF,
      members: [
        { userId: SELF, role: 'owner', lastReadAt: T1 },
        { userId: PEER, role: 'member', lastReadAt: null },
      ],
      lastMessageAt: T2,
      lastMessage: { id: 'm2', authorId: PEER, body: 'Hej', createdAt: T2, deletedAt: null },
      unreadCount: 3,
    });
  });

  it('przyjmuje jsonb podany jako tekst i zeruje ujemny licznik', () => {
    const conversation = toChatConversation({
      id: CONV,
      kind: 'direct',
      title: null,
      members: JSON.stringify([{ user_id: PEER, role: 'member', last_read_at: null }]),
      last_message: null,
      last_message_at: null,
      unread_count: -4,
    });
    expect(conversation?.members).toEqual([{ userId: PEER, role: 'member', lastReadAt: null }]);
    expect(conversation?.lastMessage).toBeNull();
    expect(conversation?.unreadCount).toBe(0);
  });

  it('pomija wiersz bez id lub o nieznanym rodzaju (nigdy nie rzuca)', () => {
    expect(toChatConversation({ kind: 'direct' })).toBeNull();
    expect(toChatConversation({ id: CONV, kind: 'channel' })).toBeNull();
    expect(toChatMessage({ id: 'm1', conversation_id: CONV })).toBeNull();
    expect(toChatMessage(null)).toBeNull();
    expect(toChatMessage('nie-obiekt')).toBeNull();
  });

  it('pomija zepsuty wiersz uczestnika zamiast wywracać całą rozmowę', () => {
    const conversation = toChatConversation({
      id: CONV,
      kind: 'group',
      members: [{ role: 'member' }, { user_id: PEER, role: 'member' }],
      unread_count: 0,
    });
    expect(conversation?.members).toEqual([{ userId: PEER, role: 'member', lastReadAt: null }]);
  });

  it('mapuje wiersz wiadomości z miękkim usunięciem', () => {
    expect(toChatMessage(messageRow({ deleted_at: T3, edited_at: T2 }))).toEqual({
      id: 'm1',
      conversationId: CONV,
      authorId: PEER,
      body: 'Cześć',
      createdAt: T1,
      editedAt: T2,
      deletedAt: T3,
      replyTo: null,
    });
  });

  it('loadOverview pomija wiersze nie do odczytania', async () => {
    const db = new FakeChatDb();
    db.overviewRows = [
      { id: CONV, kind: 'direct', members: [], unread_count: 1, last_message_at: T1 },
      { kind: 'direct' },
    ];
    const result = await loadOverview(db);
    expect(result.ok && result.value.length).toBe(1);
  });

  it('loadOverview zwraca polski komunikat przy błędzie zapytania', async () => {
    const db = new FakeChatDb();
    db.overviewError = { code: '42501', message: 'denied' };
    const result = await loadOverview(db);
    expect(result).toEqual({ ok: false, error: CHAT_MESSAGES.load });
  });
});

describe('extractBroadcastRecord', () => {
  it('czyta wiersz z koperty SDK i z ładunku podanego wprost', () => {
    const record = { id: 'm1' };
    expect(extractBroadcastRecord({ event: 'INSERT', payload: { operation: 'INSERT', record } })).toEqual(
      record,
    );
    expect(extractBroadcastRecord({ operation: 'INSERT', record })).toEqual(record);
    expect(extractBroadcastRecord({ payload: { record: null } })).toBeNull();
    expect(extractBroadcastRecord(undefined)).toBeNull();
  });
});

// ---- Kursor ------------------------------------------------------------------

describe('kursor paginacji', () => {
  it('buduje filtr PostgREST z rozstrzygnięciem remisu po id', () => {
    expect(buildOlderThanFilter({ createdAt: T2, id: 'm5' })).toBe(
      `created_at.lt."${T2}",and(created_at.eq."${T2}",id.lt."m5")`,
    );
    expect(buildNewerThanFilter({ createdAt: T2, id: 'm5' })).toBe(
      `created_at.gt."${T2}",and(created_at.eq."${T2}",id.gt."m5")`,
    );
  });

  it('usuwa znaki rozbijające drzewo logiczne or=()', () => {
    expect(buildOlderThanFilter({ createdAt: T2, id: 'm5,and(x.eq."y")' })).toBe(
      `created_at.lt."${T2}",and(created_at.eq."${T2}",id.lt."m5andx.eq.y")`,
    );
  });

  it('pierwsza strona: bez filtra, malejąco, wynik rosnąco', async () => {
    const db = new FakeChatDb();
    db.messagePages = [
      [
        messageRow({ id: 'm3', created_at: T3 }),
        messageRow({ id: 'm2', created_at: T2 }),
        messageRow({ id: 'm1', created_at: T1 }),
      ],
    ];
    const result = await loadMessagesPage(db, CONV, null, 3);
    expect(db.calls.queries[0]).toEqual({
      conversationId: CONV,
      orFilter: null,
      ascending: false,
      limit: 3,
    });
    expect(result.ok && result.value.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    // Pełna strona => są starsze; kursor wskazuje najstarszy wiersz strony.
    expect(result.ok && result.value.hasMore).toBe(true);
    expect(result.ok && result.value.cursor).toEqual({ createdAt: T1, id: 'm1' });
  });

  it('niepełna strona kończy paginację', async () => {
    const db = new FakeChatDb();
    db.messagePages = [[messageRow({ id: 'm1', created_at: T1 })]];
    const result = await loadMessagesPage(db, CONV, null, 50);
    expect(result.ok && result.value.hasMore).toBe(false);
  });

  it('kolejna strona przekazuje filtr kursora', async () => {
    const db = new FakeChatDb();
    db.messagePages = [[]];
    await loadMessagesPage(db, CONV, { createdAt: T1, id: 'm1' }, 50);
    expect(db.calls.queries[0].orFilter).toBe(buildOlderThanFilter({ createdAt: T1, id: 'm1' }));
    expect(db.calls.queries[0].ascending).toBe(false);
  });

  it('kursor bierze się z surowego wiersza, nawet gdy nie da się go zmapować', async () => {
    const db = new FakeChatDb();
    db.messagePages = [
      [messageRow({ id: 'm2', created_at: T2 }), { id: 'm1', created_at: T1 }],
    ];
    const result = await loadMessagesPage(db, CONV, null, 2);
    expect(result.ok && result.value.messages.map((m) => m.id)).toEqual(['m2']);
    expect(result.ok && result.value.cursor).toEqual({ createdAt: T1, id: 'm1' });
  });

  it('loadMessagesSince pyta rosnąco o wiersze nowsze od kursora', async () => {
    const db = new FakeChatDb();
    db.messagePages = [[messageRow({ id: 'm9', created_at: T3 })]];
    const result = await loadMessagesSince(db, CONV, { createdAt: T2, id: 'm5' });
    expect(db.calls.queries[0]).toEqual({
      conversationId: CONV,
      orFilter: buildNewerThanFilter({ createdAt: T2, id: 'm5' }),
      ascending: true,
      limit: 50,
    });
    expect(result.ok && result.value.messages.map((m) => m.id)).toEqual(['m9']);
  });

  it('loadMessagesSince bez kursora spada do pierwszej strony', async () => {
    const db = new FakeChatDb();
    db.messagePages = [[messageRow()]];
    const result = await loadMessagesSince(db, CONV, null);
    expect(db.calls.queries[0].ascending).toBe(false);
    expect(result.ok && result.value.messages.length).toBe(1);
  });
});

// ---- DM i grupa --------------------------------------------------------------

describe('openDirect', () => {
  it('otwiera DM JEDNYM atomowym wywołaniem RPC i zwraca id rozmowy', async () => {
    const db = new FakeChatDb();
    const result = await openDirect(db, SELF, PEER);
    expect(result).toEqual({ ok: true, value: CONV });
    // Znajdź-albo-załóż, klucz pary i naprawę składu robi serwer — klient
    // wysyła wyłącznie uuid adresata.
    expect(db.calls.directs).toEqual([PEER]);
  });

  it('błąd RPC mapuje się na polski komunikat otwarcia', async () => {
    const db = new FakeChatDb();
    db.openDirectError = { code: '42501', message: 'denied' };
    expect(await openDirect(db, SELF, PEER)).toEqual({ ok: false, error: CHAT_MESSAGES.open });
  });

  it('brak id w odpowiedzi RPC też jest błędem otwarcia', async () => {
    const db = new FakeChatDb();
    db.openedDirectId = null;
    expect(await openDirect(db, SELF, PEER)).toEqual({ ok: false, error: CHAT_MESSAGES.open });
  });

  it('odmawia rozmowy z samym sobą i pustych identyfikatorów przed wysyłką', async () => {
    const db = new FakeChatDb();
    expect(await openDirect(db, SELF, SELF)).toEqual({
      ok: false,
      error: CHAT_MESSAGES.selfDirect,
    });
    expect(await openDirect(db, SELF, '')).toEqual({ ok: false, error: CHAT_MESSAGES.open });
    expect(db.calls.directs).toHaveLength(0);
  });
});

describe('createGroup', () => {
  it('tworzy grupę JEDNYM atomowym wywołaniem RPC (bez klejenia z insertów)', async () => {
    const db = new FakeChatDb();
    const result = await createGroup(db, SELF, '  Projekt X  ', [PEER, PEER, SELF, 'cccc']);
    expect(result).toEqual({ ok: true, value: CONV });
    // Duplikaty i sam twórca wypadają z listy PRZED wysyłką; tytuł przycięty.
    expect(db.calls.groups).toEqual([{ title: 'Projekt X', memberIds: [PEER, 'cccc'] }]);
  });

  it('błąd RPC mapuje się na komunikat tworzenia grupy', async () => {
    const db = new FakeChatDb();
    db.createGroupError = { code: '42501', message: 'permission denied' };
    expect(await createGroup(db, SELF, 'Grupa', [PEER])).toEqual({
      ok: false,
      error: CHAT_MESSAGES.create,
    });
  });

  it('odrzuca pusty tytuł i pustą listę uczestników przed zapisem', async () => {
    const db = new FakeChatDb();
    expect(await createGroup(db, SELF, '   ', [PEER])).toEqual({
      ok: false,
      error: CHAT_MESSAGES.emptyTitle,
    });
    expect(await createGroup(db, SELF, 'Grupa', [SELF])).toEqual({
      ok: false,
      error: CHAT_MESSAGES.noMembers,
    });
    expect(db.calls.groups).toHaveLength(0);
  });
});

// ---- Wysyłka i odczyt --------------------------------------------------------

describe('sendMessage', () => {
  it('przycina treść i zwraca wiersz z serwera (podstawa dedupu echa)', async () => {
    const db = new FakeChatDb();
    db.insertedMessageRow = messageRow({ id: 'm7', author_id: SELF, body: 'Hej' });
    const result = await sendMessage(db, CONV, SELF, '  Hej  ');
    expect(db.calls.messages[0]).toEqual({
      conversation_id: CONV,
      author_id: SELF,
      body: 'Hej',
    });
    expect(result.ok && result.value.id).toBe('m7');
  });

  it('dokłada reply_to tylko gdy podane', async () => {
    const db = new FakeChatDb();
    await sendMessage(db, CONV, SELF, 'Hej', 'm1');
    expect(db.calls.messages[0].reply_to).toBe('m1');
  });

  it('odrzuca pustą i za długą treść bez zapytania do bazy', async () => {
    const db = new FakeChatDb();
    expect(await sendMessage(db, CONV, SELF, '   ')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.emptyBody,
    });
    expect(await sendMessage(db, CONV, SELF, 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: CHAT_MESSAGES.tooLongBody,
    });
    expect(db.calls.messages).toHaveLength(0);
  });

  it('błąd zapisu i brak zwrotki dają polski komunikat', async () => {
    const db = new FakeChatDb();
    db.insertMessageError = { code: '42501', message: 'denied' };
    expect(await sendMessage(db, CONV, SELF, 'Hej')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.send,
    });
    const silent = new FakeChatDb();
    silent.insertedMessageRow = null;
    expect(await sendMessage(silent, CONV, SELF, 'Hej')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.send,
    });
  });
});

describe('markRead', () => {
  it('przesuwa watermark zalogowanego uczestnika w tej rozmowie', async () => {
    const db = new FakeChatDb();
    const result = await markRead(db, CONV, SELF, T3);
    expect(db.calls.reads).toEqual([{ conversationId: CONV, userId: SELF, atIso: T3 }]);
    expect(result).toEqual({ ok: true, value: T3 });
  });

  it('bez rozmowy lub użytkownika nie rusza bazy', async () => {
    const db = new FakeChatDb();
    expect(await markRead(db, '', SELF, T3)).toEqual({ ok: false, error: CHAT_MESSAGES.markRead });
    expect(await markRead(db, CONV, '', T3)).toEqual({ ok: false, error: CHAT_MESSAGES.markRead });
    expect(db.calls.reads).toHaveLength(0);
  });

  it('błąd zapisu zwraca ok:false', async () => {
    const db = new FakeChatDb();
    db.readError = { code: '42501', message: 'denied' };
    expect(await markRead(db, CONV, SELF, T3)).toEqual({
      ok: false,
      error: CHAT_MESSAGES.markRead,
    });
  });
});

// ---- Reakcje -----------------------------------------------------------------

describe('reakcje: mapowanie', () => {
  it('reactionsFromMessageRows daje wpis KAŻDEJ wiadomości strony, także pusty', () => {
    const map = reactionsFromMessageRows([
      messageRow({
        id: 'm1',
        message_reactions: [
          { user_id: PEER, emoji: '👍', created_at: T1 },
          { user_id: 'zly', emoji: '', created_at: T1 },
        ],
      }),
      messageRow({ id: 'm2', message_reactions: [] }),
      messageRow({ id: 'm3' }),
    ]);
    expect(map).toEqual({
      m1: [{ userId: PEER, emoji: '👍', createdAt: T1 }],
      m2: [],
      m3: [],
    });
  });

  it('reactionsFromRows wypełnia pustą listą wiadomości bez wierszy', () => {
    const map = reactionsFromRows(
      [
        { message_id: 'm1', user_id: PEER, emoji: '❤️', created_at: T1 },
        { message_id: 'm1', user_id: SELF, emoji: '👍', created_at: T2 },
        { message_id: 'obca', user_id: SELF, emoji: '👍', created_at: T2 },
      ],
      ['m1', 'm2'],
    );
    expect(map.m1).toHaveLength(2);
    expect(map.m2).toEqual([]);
    expect(map.obca).toHaveLength(1);
  });

  it('toChatReactionEvent czyta kopertę SDK i ładunek na wierzchu', () => {
    const payload = {
      messageId: 'm1',
      conversationId: CONV,
      userId: PEER,
      emoji: '👍',
      prevEmoji: null,
      op: 'set',
      createdAt: T1,
    };
    expect(toChatReactionEvent({ type: 'broadcast', event: 'reaction', payload })).toEqual({
      messageId: 'm1',
      conversationId: CONV,
      userId: PEER,
      emoji: '👍',
      createdAt: T1,
    });
    expect(toChatReactionEvent(payload)?.emoji).toBe('👍');
    expect(toChatReactionEvent({ payload: { ...payload, emoji: null, op: 'remove' } })?.emoji).toBe(
      null,
    );
    expect(toChatReactionEvent({ payload: { ...payload, messageId: '' } })).toBeNull();
    expect(toChatReactionEvent('śmieci')).toBeNull();
  });
});

describe('reakcje: operacje', () => {
  it('loadMessagesPage zwraca reakcje osadzone w wierszach', async () => {
    const db = new FakeChatDb();
    db.messagePages = [
      [messageRow({ id: 'm1', message_reactions: [{ user_id: PEER, emoji: '👍', created_at: T1 }] })],
    ];
    const page = await loadMessagesPage(db, CONV, null);
    expect(page.ok && page.value.reactions.m1).toEqual([{ userId: PEER, emoji: '👍', createdAt: T1 }]);
  });

  it('loadReactions pyta o wskazane wiadomości i pomija puste id', async () => {
    const db = new FakeChatDb();
    db.reactionRows = [{ message_id: 'm1', user_id: PEER, emoji: '👍', created_at: T1 }];
    const result = await loadReactions(db, CONV, ['m1', '', 'm2']);
    expect(db.calls.reactionQueries).toEqual([{ conversationId: CONV, messageIds: ['m1', 'm2'] }]);
    expect(result.ok && result.value).toEqual({
      m1: [{ userId: PEER, emoji: '👍', createdAt: T1 }],
      m2: [],
    });
    expect((await loadReactions(db, CONV, [])).ok).toBe(true);
    expect(db.calls.reactionQueries).toHaveLength(1);
  });

  it('setReaction wysyła stan docelowy i mapuje odpowiedź RPC', async () => {
    const db = new FakeChatDb();
    db.setReactionRows = [{ user_id: SELF, emoji: '❤️', created_at: T2 }];
    const set = await setReaction(db, 'm1', '❤️');
    expect(db.calls.reactions).toEqual([{ messageId: 'm1', emoji: '❤️' }]);
    expect(set.ok && set.value).toEqual([{ userId: SELF, emoji: '❤️', createdAt: T2 }]);
    db.setReactionRows = [];
    const removed = await setReaction(db, 'm1', null);
    expect(db.calls.reactions[1]).toEqual({ messageId: 'm1', emoji: null });
    expect(removed.ok && removed.value).toEqual([]);
  });

  it('setReaction odrzuca zły znak lokalnie i tłumaczy 23503 na polski komunikat', async () => {
    const db = new FakeChatDb();
    expect(await setReaction(db, 'm1', '')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.reactUnsupported,
    });
    expect(await setReaction(db, 'm1', '👍'.repeat(11))).toEqual({
      ok: false,
      error: CHAT_MESSAGES.reactUnsupported,
    });
    expect(db.calls.reactions).toHaveLength(0);
    db.setReactionError = { code: '23503', message: 'fk' };
    expect(await setReaction(db, 'm1', '🦄')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.reactUnsupported,
    });
    db.setReactionError = { code: '42501', message: 'forbidden' };
    expect(await setReaction(db, 'm1', '👍')).toEqual({ ok: false, error: CHAT_MESSAGES.react });
  });
});
