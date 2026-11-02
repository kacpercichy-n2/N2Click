// Karta zadania v2 (L3): kontrakt danych rozmowy zadania i czysty stan wątków.
import { describe, expect, it, vi } from 'vitest';
import {
  applyConversationMembers,
  applyFollowState,
  applyReadReceipt,
  carryMemberDetails,
  dockConversations,
  EMPTY_THREAD,
  ensureThread,
  findTaskConversation,
  followerIds,
  isFollowing,
  isTaskConversation,
  mergeMessages,
  mergeThreadMessages,
  patchThread,
  pinnedMessages,
  retainThreads,
  seenByMessage,
  taskConversationUnread,
  updateThread,
} from './chatState';
import {
  deleteMessage,
  editMessage,
  loadMembers,
  openTaskConversation,
  parseAttachments,
  sendMessage,
  setFollow,
  setPin,
  toChatConversation,
  toChatMessage,
  toChatReadEvent,
  type ChatDb,
} from './chatData';
import { CHAT_MESSAGES, type ChatConversation, type ChatMessage } from './types';

const row = {
  id: 'm',
  conversation_id: 'c',
  author_id: 'a',
  body: 'Hej',
  created_at: '2026-11-02T10:00:00+00:00',
};
const image = { path: 'c/a.webp', mime: 'image/webp', width: 10, height: 20, size: 50, name: 'Zrzut' };
const db = (partial: Partial<ChatDb>) => partial as ChatDb;

function msg(patch: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'c',
    authorId: 'a',
    body: 'Treść',
    kind: 'text',
    meta: null,
    createdAt: '2026-11-02T10:00:00+00:00',
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    attachments: [],
    mentionIds: [],
    pinnedAt: null,
    pinnedBy: null,
    revisedAt: null,
    ...patch,
  };
}

function conv(patch: Partial<ChatConversation> & { id: string }): ChatConversation {
  return {
    kind: 'group',
    contextType: null,
    contextId: null,
    title: null,
    members: [],
    createdBy: null,
    lastMessageAt: null,
    themeId: '',
    lastMessage: null,
    unreadCount: 0,
    ...patch,
  };
}

describe('mapowanie: rozmowa zadania i nowe pola wiadomości', () => {
  it('rozpoznaje rozmowę zadania po kontekście (kind zostaje group)', () => {
    const c = toChatConversation({
      id: 'c',
      kind: 'group',
      context_type: 'task',
      context_id: 't1',
      members: [
        { user_id: 'a', last_read_at: null },
        { user_id: 'b', last_read_at: null, muted_until: 'infinity' },
      ],
    })!;
    expect(isTaskConversation(c)).toBe(true);
    expect(c.contextId).toBe('t1');
    expect(c.members[0].mutedUntil).toBeUndefined();
    expect(c.members[1].mutedUntil).toBe('infinity');
    expect(isTaskConversation(toChatConversation({ id: 'd', kind: 'direct' })!)).toBe(false);
  });

  it('mapuje obrazy, wzmianki, przypięcie i odpowiedź; brak kolumn = wartości puste', () => {
    expect(
      toChatMessage({
        ...row,
        attachments: [image],
        mention_ids: ['b', 1, ''],
        pinned_at: row.created_at,
        pinned_by: 'a',
        reply_to: 'r',
      }),
    ).toMatchObject({
      attachments: [image],
      mentionIds: ['b'],
      pinnedAt: row.created_at,
      pinnedBy: 'a',
      replyTo: 'r',
    });
    expect(toChatMessage(row)).toMatchObject({
      attachments: [],
      mentionIds: [],
      pinnedAt: null,
      pinnedBy: null,
      revisedAt: null,
    });
  });

  it('odrzuca złe obrazy i ścieżki z innej rozmowy, tnie do 10', () => {
    expect(
      parseAttachments(
        [
          image,
          { ...image, path: 'inna/a.png' },
          { ...image, width: -1 },
          { ...image, height: 1.5 },
          { ...image, mime: 'text/html' },
          { ...image, name: 3 },
          null,
        ],
        'c',
      ),
    ).toEqual([image]);
    expect(parseAttachments('nie-json', 'c')).toEqual([]);
    expect(parseAttachments(JSON.stringify([image]), 'c')).toEqual([image]);
    expect(parseAttachments(Array(12).fill(image), 'c')).toHaveLength(10);
  });

  it('czyta zdarzenie read z koperty SDK i odrzuca zły ładunek', () => {
    const payload = { conversationId: 'c', userId: 'b', lastReadAt: '2026-11-02T10:05:00+00:00' };
    expect(toChatReadEvent({ event: 'read', payload })).toEqual(payload);
    expect(toChatReadEvent(payload)).toEqual(payload);
    expect(toChatReadEvent({ payload: { ...payload, lastReadAt: 'wczoraj' } })).toBeNull();
    expect(toChatReadEvent({ payload: { ...payload, userId: '' } })).toBeNull();
    expect(toChatReadEvent(null)).toBeNull();
  });
});

describe('operacje danych karty v2', () => {
  it('wysyła sam obraz, odpowiedź i wzmianki bez duplikatów', async () => {
    const insertMessage = vi.fn(async (patch: Record<string, unknown>) => ({
      row: { ...row, ...patch },
      error: null,
    }));
    const result = await sendMessage(db({ insertMessage }), 'c', 'a', '  ', null, {
      replyTo: 'r',
      attachments: [image as never],
      mentionIds: ['b', 'b', ''],
    });
    expect(result.ok).toBe(true);
    expect(insertMessage).toHaveBeenCalledWith({
      conversation_id: 'c',
      author_id: 'a',
      body: '',
      reply_to: 'r',
      attachments: [image],
      mention_ids: ['b'],
    });
  });

  it('nie wysyła pustej wiadomości, obcej ścieżki ani 11 obrazów', async () => {
    const insertMessage = vi.fn();
    expect(await sendMessage(db({ insertMessage }), 'c', 'a', ' ')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.emptyBody,
    });
    expect(
      await sendMessage(db({ insertMessage }), 'c', 'a', 'x', null, {
        attachments: [{ ...image, path: 'inna/x.png' } as never],
      }),
    ).toEqual({ ok: false, error: CHAT_MESSAGES.attachments });
    expect(
      await sendMessage(db({ insertMessage }), 'c', 'a', 'x', null, {
        attachments: Array(11).fill(image),
      }),
    ).toEqual({ ok: false, error: CHAT_MESSAGES.tooManyAttachments });
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('otwiera rozmowę zadania przez RPC i mapuje porażkę na polski komunikat', async () => {
    const openTaskAtomic = vi.fn(async () => ({ id: 'c', error: null }));
    expect(await openTaskConversation(db({ openTaskAtomic }), 't')).toEqual({ ok: true, value: 'c' });
    expect(openTaskAtomic).toHaveBeenCalledWith('t');
    const denied = vi.fn(async () => ({ id: null, error: { code: '42501', message: 'forbidden' } }));
    expect(await openTaskConversation(db({ openTaskAtomic: denied }), 't')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.open,
    });
    expect((await openTaskConversation(db({}), 't')).ok).toBe(false);
    expect((await openTaskConversation(db({ openTaskAtomic }), '')).ok).toBe(false);
  });

  it('edytuje i usuwa wyłącznie przez UPDATE z autorem', async () => {
    const updateMessage = vi.fn(async (_id: string, _author: string, patch: Record<string, unknown>) => ({
      row: { ...row, ...patch, edited_at: '2026-11-02T10:01:00+00:00' },
      error: null,
    }));
    const edited = await editMessage(db({ updateMessage }), 'm', 'a', '  nowa  ');
    expect(edited.ok && edited.value.body).toBe('nowa');
    expect(updateMessage).toHaveBeenLastCalledWith('m', 'a', { body: 'nowa' });
    expect(await editMessage(db({ updateMessage }), 'm', 'a', ' ')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.emptyBody,
    });
    // Wiadomość z obrazem może stracić tekst.
    expect((await editMessage(db({ updateMessage }), 'm', 'a', ' ', true)).ok).toBe(true);
    expect((await editMessage(db({ updateMessage }), 'm', 'a', 'x'.repeat(4001))).ok).toBe(false);

    const removed = await deleteMessage(db({ updateMessage }), 'm', 'a', '2026-11-02T11:00:00Z');
    expect(updateMessage).toHaveBeenLastCalledWith('m', 'a', { deleted_at: '2026-11-02T11:00:00Z' });
    expect(removed.ok).toBe(true);

    // Cudza / już usunięta: 0 wierszy => błąd, nie cichy sukces.
    const none = vi.fn(async () => ({ row: null, error: null }));
    expect(await deleteMessage(db({ updateMessage: none }), 'm', 'a')).toEqual({
      ok: false,
      error: CHAT_MESSAGES.remove,
    });
  });

  it('przypina, obserwuje i czyta członków z muted_until', async () => {
    const setPinDb = vi.fn(async () => ({ error: null }));
    expect(await setPin(db({ setPin: setPinDb }), 'm', false)).toEqual({ ok: true, value: null });
    expect(setPinDb).toHaveBeenCalledWith('m', false);
    const setFollowDb = vi.fn(async () => ({ error: { code: '42501', message: 'denied' } }));
    expect(await setFollow(db({ setFollow: setFollowDb }), 'c', false)).toEqual({
      ok: false,
      error: CHAT_MESSAGES.follow,
    });
    const selectMembers = vi.fn(async () => ({
      rows: [
        { user_id: 'a', role: 'member', last_read_at: null, muted_until: null },
        { user_id: '' },
      ],
      error: null,
    }));
    expect(await loadMembers(db({ selectMembers }), 'c')).toEqual({
      ok: true,
      value: [{ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: null }],
    });
  });
});

describe('scalanie z rewizją przypięcia', () => {
  it('przypięcie z nowszą rewizją wygrywa, starszy snapshot go nie cofa', () => {
    const plain = msg({ id: 'm' });
    const pinned = msg({ id: 'm', pinnedAt: '2026-11-02T10:02:00Z', editedAt: '2026-11-02T10:02:00Z' });
    const merged = mergeMessages([plain], [pinned]);
    expect(merged[0].pinnedAt).not.toBeNull();
    expect(mergeMessages(merged, [plain])).toBe(merged);
  });

  it('revisedAt (gdy L1 doda kolumnę) rozstrzyga przed editedAt', () => {
    const a = msg({ id: 'm', revisedAt: '2026-11-02T10:05:00Z', pinnedAt: '2026-11-02T10:05:00Z' });
    const b = msg({ id: 'm', revisedAt: '2026-11-02T10:06:00Z', pinnedAt: null });
    expect(mergeMessages([a], [b])[0].pinnedAt).toBeNull();
    expect(mergeMessages([b], [a])[0].pinnedAt).toBeNull();
  });
});

describe('odczyty i „Widziane przez”', () => {
  const members = [
    { userId: 'self', role: 'member' as const, lastReadAt: '2026-11-02T10:10:00Z' },
    { userId: 'b', role: 'member' as const, lastReadAt: null },
  ];
  const list = [conv({ id: 'c', members })];

  it('przesuwa watermark tylko do przodu i zachowuje referencję bez zmiany', () => {
    const next = applyReadReceipt(list, { conversationId: 'c', userId: 'b', lastReadAt: '2026-11-02T10:05:00+00:00' });
    expect(next[0].members[1].lastReadAt).toBe('2026-11-02T10:05:00+00:00');
    // Starsze echo (format 'Z') nie cofa.
    expect(applyReadReceipt(next, { conversationId: 'c', userId: 'b', lastReadAt: '2026-11-02T10:04:00Z' })).toBe(next);
    expect(applyReadReceipt(list, { conversationId: 'x', userId: 'b', lastReadAt: '2026-11-02T10:05:00Z' })).toBe(list);
    expect(applyReadReceipt(list, { conversationId: 'c', userId: 'obcy', lastReadAt: '2026-11-02T10:05:00Z' })).toBe(list);
  });

  it('każdy czytelnik raz, pod najnowszą przeczytaną; bez siebie i systemowych', () => {
    const messages = [
      msg({ id: 'm1', authorId: 'self', createdAt: '2026-11-02T10:00:00Z' }),
      msg({ id: 'm2', authorId: 'self', createdAt: '2026-11-02T10:01:00Z' }),
      msg({ id: 's', kind: 'system', createdAt: '2026-11-02T10:02:00Z' }),
      msg({ id: 'm3', authorId: 'self', createdAt: '2026-11-02T10:03:00Z' }),
    ];
    const seen = seenByMessage(
      messages,
      [
        { userId: 'self', role: 'member', lastReadAt: '2026-11-02T10:09:00Z' },
        { userId: 'b', role: 'member', lastReadAt: '2026-11-02T10:02:30Z' },
        { userId: 'c', role: 'member', lastReadAt: '2026-11-02T10:05:00+00:00' },
        { userId: 'd', role: 'member', lastReadAt: null },
        { userId: 'e', role: 'member', lastReadAt: '2026-11-02T09:00:00Z' },
      ],
      'self',
    );
    expect(seen).toEqual({
      m2: [{ userId: 'b', lastReadAt: '2026-11-02T10:02:30Z' }],
      m3: [{ userId: 'c', lastReadAt: '2026-11-02T10:05:00+00:00' }],
    });
  });

  it('czytelnik, którego najnowsza przeczytana wiadomość jest jego własna, nie dostaje awatara', () => {
    const messages = [
      msg({ id: 'm1', authorId: 'self', createdAt: '2026-11-02T10:00:00Z' }),
      msg({ id: 'm2', authorId: 'b', createdAt: '2026-11-02T10:01:00Z' }),
    ];
    expect(
      seenByMessage(messages, [{ userId: 'b', role: 'member', lastReadAt: '2026-11-02T10:02:00Z' }], 'self'),
    ).toEqual({});
  });
});

describe('przypięte, obserwujący, lista doku', () => {
  it('przypięte bez usuniętych, najświeżej przypięta pierwsza', () => {
    const pins = pinnedMessages([
      msg({ id: 'a', pinnedAt: '2026-11-02T10:00:00Z' }),
      msg({ id: 'b', pinnedAt: '2026-11-02T11:00:00Z' }),
      msg({ id: 'c', pinnedAt: '2026-11-02T12:00:00Z', deletedAt: '2026-11-02T12:01:00Z' }),
      msg({ id: 'd' }),
    ]);
    expect(pins.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('obserwowanie: null i nieznane = tak, infinity i przyszłość = nie', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(isFollowing({ userId: 'a', role: 'member', lastReadAt: null }, now)).toBe(true);
    expect(isFollowing({ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: null }, now)).toBe(true);
    expect(isFollowing({ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: 'infinity' }, now)).toBe(false);
    expect(isFollowing({ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: '2026-11-03T00:00:00Z' }, now)).toBe(false);
    expect(isFollowing({ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: '2026-11-01T00:00:00Z' }, now)).toBe(true);
    expect(isFollowing(undefined, now)).toBe(false);
    const c = conv({
      id: 'c',
      members: [
        { userId: 'a', role: 'member', lastReadAt: null, mutedUntil: null },
        { userId: 'b', role: 'member', lastReadAt: null, mutedUntil: 'infinity' },
      ],
    });
    expect(followerIds(c, now)).toEqual(['a']);
  });

  it('optymistyczne obserwuj i powrót; ta sama wartość = ta sama referencja', () => {
    const list = [conv({ id: 'c', members: [{ userId: 'self', role: 'member', lastReadAt: null, mutedUntil: null }] })];
    const off = applyFollowState(list, 'c', 'self', false);
    expect(off[0].members[0].mutedUntil).toBe('infinity');
    expect(applyFollowState(off, 'c', 'self', false)).toBe(off);
    expect(applyFollowState(off, 'c', 'self', true)[0].members[0].mutedUntil).toBeNull();
    expect(applyFollowState(list, 'c', null, false)).toBe(list);
  });

  it('członkowie z osobnego selectu nie cofają świeższego watermarku', () => {
    const list = [conv({ id: 'c', members: [{ userId: 'b', role: 'member', lastReadAt: '2026-11-02T10:05:00Z' }] })];
    const next = applyConversationMembers(list, 'c', [
      { userId: 'b', role: 'member', lastReadAt: '2026-11-02T10:00:00Z', mutedUntil: null },
    ]);
    expect(next[0].members[0]).toEqual({
      userId: 'b',
      role: 'member',
      lastReadAt: '2026-11-02T10:05:00Z',
      mutedUntil: null,
    });
    expect(applyConversationMembers(next, 'c', next[0].members)).toBe(next);
  });

  it('odświeżone overview zachowuje znane muted_until', () => {
    const previous = [conv({ id: 'c', members: [{ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: 'infinity' }] })];
    const fresh = [conv({ id: 'c', members: [{ userId: 'a', role: 'member', lastReadAt: '2026-11-02T10:00:00Z' }] })];
    const carried = carryMemberDetails(previous, fresh);
    expect(carried[0].members[0]).toMatchObject({ mutedUntil: 'infinity', lastReadAt: '2026-11-02T10:00:00Z' });
    expect(carryMemberDetails([], fresh)).toBe(fresh);
    const known = [conv({ id: 'c', members: [{ userId: 'a', role: 'member', lastReadAt: null, mutedUntil: null }] })];
    expect(carryMemberDetails(previous, known)).toBe(known);
  });

  it('dok nie widzi rozmów zadań; karta zna ich nieprzeczytane', () => {
    const chat = conv({ id: 'd', kind: 'direct', unreadCount: 2 });
    const task = conv({ id: 't', contextType: 'task', contextId: 'task-1', unreadCount: 3 });
    const plain = [chat];
    expect(dockConversations(plain)).toBe(plain);
    expect(dockConversations([chat, task])).toEqual([chat]);
    expect(findTaskConversation([chat, task], 'task-1')).toBe(task);
    expect(taskConversationUnread([chat, task], 'task-1')).toBe(3);
    expect(taskConversationUnread([chat, task], 'inne')).toBe(0);
    expect(taskConversationUnread([chat], '')).toBe(0);
  });
});

describe('mapa wątków (dok + panel zadania naraz)', () => {
  it('zakłada, zmienia i zwalnia wątki z zachowaniem referencji', () => {
    const empty = {};
    const one = ensureThread(empty, 'a');
    expect(one.a).toMatchObject({ loading: true, loaded: false, messages: [] });
    expect(ensureThread(one, 'a')).toBe(one);
    expect(ensureThread(one, '')).toBe(one);
    const two = ensureThread(one, 'b');

    // Zdarzenie dla nieoglądanej rozmowy nie zakłada wątku.
    expect(updateThread(two, 'x', (t) => mergeThreadMessages(t, [msg({ id: 'm' })]))).toBe(two);
    const withMessage = updateThread(two, 'a', (t) => mergeThreadMessages(t, [msg({ id: 'm', conversationId: 'a' })]));
    expect(withMessage.a.messages).toHaveLength(1);
    expect(withMessage.b).toBe(two.b);
    // Powtórka (echo) = ta sama mapa.
    expect(
      updateThread(withMessage, 'a', (t) => mergeThreadMessages(t, [msg({ id: 'm', conversationId: 'a' })])),
    ).toBe(withMessage);

    expect(retainThreads(withMessage, new Set(['a', 'b']))).toBe(withMessage);
    expect(Object.keys(retainThreads(withMessage, new Set(['b'])))).toEqual(['b']);
  });

  it('patchThread nie tworzy nowego obiektu bez zmiany', () => {
    const thread = { ...EMPTY_THREAD, loading: true };
    expect(patchThread(thread, { loading: true })).toBe(thread);
    expect(patchThread(thread, { loading: false, loaded: true })).toMatchObject({ loading: false, loaded: true });
  });
});
