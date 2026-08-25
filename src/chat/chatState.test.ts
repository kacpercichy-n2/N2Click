// Testy czystej redukcji stanu czatu: sortowanie listy rozmów, zastosowanie
// zdarzenia INSERT/UPDATE, deduplikacja echa, licznik nieprzeczytanych, scalanie
// wiadomości i sygnały „pisze…". Wszystko w node, bez Reacta.
import { describe, expect, it } from 'vitest';
import {
  applyConversationTheme,
  applyIncomingMessage,
  applyMessageUpdate,
  applyReactionEvent,
  applyTypingSignal,
  groupReactions,
  markConversationRead,
  mergeMessages,
  mergeReactions,
  newestMessageCursor,
  nextReactionIntent,
  ownReaction,
  oldestMessageCursor,
  pruneTyping,
  removeTyping,
  sortConversations,
  totalUnread,
  typingUserIds,
} from './chatState';
import type { ChatConversation, ChatMessage, ChatReaction, ChatReactionMap } from './types';

const SELF = 'user-self';
const PEER = 'user-peer';
const T1 = '2026-08-13T10:00:00+00:00';
const T2 = '2026-08-13T10:05:00+00:00';
const T3 = '2026-08-13T10:09:00+00:00';

function conversation(overrides: Partial<ChatConversation> & { id: string }): ChatConversation {
  return {
    kind: 'direct',
    title: null,
    createdBy: SELF,
    members: [
      { userId: SELF, role: 'member', lastReadAt: null },
      { userId: PEER, role: 'member', lastReadAt: null },
    ],
    lastMessageAt: null,
    themeId: 'lawenda',
    lastMessage: null,
    unreadCount: 0,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    conversationId: 'c1',
    authorId: PEER,
    body: 'Cześć',
    kind: 'text',
    meta: null,
    createdAt: T2,
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    ...overrides,
  };
}

describe('sortConversations', () => {
  it('układa od najświeższej, puste rozmowy na końcu, remis po id', () => {
    const list = [
      conversation({ id: 'c-empty' }),
      conversation({ id: 'c-old', lastMessageAt: T1 }),
      conversation({ id: 'c-new', lastMessageAt: T3 }),
      conversation({ id: 'a-empty' }),
    ];
    expect(sortConversations(list).map((c) => c.id)).toEqual([
      'c-new',
      'c-old',
      'a-empty',
      'c-empty',
    ]);
  });

  it('sumuje nieprzeczytane', () => {
    expect(
      totalUnread([
        conversation({ id: 'c1', unreadCount: 2 }),
        conversation({ id: 'c2', unreadCount: 3 }),
      ]),
    ).toBe(5);
  });
});

describe('applyIncomingMessage', () => {
  const base = [
    conversation({ id: 'c1', lastMessageAt: T1 }),
    conversation({ id: 'c2', lastMessageAt: T2 }),
  ];

  it('podbija podsumowanie, licznik i przenosi rozmowę na górę', () => {
    const next = applyIncomingMessage(base, message({ id: 'm1', createdAt: T3 }), {
      selfId: SELF,
      openConversationId: null,
    });
    expect(next.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(next[0].unreadCount).toBe(1);
    expect(next[0].lastMessageAt).toBe(T3);
    expect(next[0].lastMessage).toEqual({
      id: 'm1',
      authorId: PEER,
      body: 'Cześć',
      kind: 'text', createdAt: T3,
      deletedAt: null,
    });
  });

  it('nie liczy wiadomości w otwartej rozmowie ani własnych', () => {
    const inOpen = applyIncomingMessage(base, message({ id: 'm1', createdAt: T3 }), {
      selfId: SELF,
      openConversationId: 'c1',
    });
    expect(inOpen[0].unreadCount).toBe(0);
    const mine = applyIncomingMessage(base, message({ id: 'm2', createdAt: T3, authorId: SELF }), {
      selfId: SELF,
      openConversationId: null,
    });
    expect(mine[0].unreadCount).toBe(0);
  });

  it('echo tej samej wiadomości nie zmienia referencji (zero przerenderowań)', () => {
    const first = applyIncomingMessage(base, message({ id: 'm1', createdAt: T3 }), {
      selfId: SELF,
      openConversationId: null,
    });
    const second = applyIncomingMessage(first, message({ id: 'm1', createdAt: T3 }), {
      selfId: SELF,
      openConversationId: null,
    });
    expect(second).toBe(first);
    expect(second[0].unreadCount).toBe(1);
  });

  it('nieznana rozmowa zostawia listę nietkniętą', () => {
    const next = applyIncomingMessage(base, message({ id: 'm1', conversationId: 'c-obca' }), {
      selfId: SELF,
      openConversationId: null,
    });
    expect(next).toBe(base);
  });

  it('spóźniona starsza wiadomość nie cofa podsumowania, ale liczy się jako nieprzeczytana', () => {
    const list = [
      conversation({
        id: 'c1',
        lastMessageAt: T3,
        lastMessage: { id: 'm9', authorId: PEER, body: 'Nowsza', kind: 'text', createdAt: T3, deletedAt: null },
      }),
    ];
    const next = applyIncomingMessage(list, message({ id: 'm1', createdAt: T1 }), {
      selfId: SELF,
      openConversationId: null,
    });
    expect(next[0].lastMessage?.id).toBe('m9');
    expect(next[0].lastMessageAt).toBe(T3);
    expect(next[0].unreadCount).toBe(1);
  });
});

describe('applyMessageUpdate', () => {
  const list = [
    conversation({
      id: 'c1',
      lastMessageAt: T2,
      lastMessage: { id: 'm1', authorId: PEER, body: 'Cześć', kind: 'text', createdAt: T2, deletedAt: null },
      unreadCount: 2,
    }),
  ];

  it('odświeża treść i znacznik usunięcia ostatniej wiadomości', () => {
    const next = applyMessageUpdate(list, message({ id: 'm1', body: '', deletedAt: T3 }));
    expect(next[0].lastMessage).toEqual({
      id: 'm1',
      authorId: PEER,
      body: '',
      kind: 'text', createdAt: T2,
      deletedAt: T3,
    });
    // Edycja nie jest nową wiadomością — licznik zostaje.
    expect(next[0].unreadCount).toBe(2);
  });

  it('edycja starszej wiadomości nie rusza listy', () => {
    expect(applyMessageUpdate(list, message({ id: 'm0', body: 'inna' }))).toBe(list);
  });
});

describe('markConversationRead', () => {
  it('zeruje licznik i przesuwa watermark zalogowanego', () => {
    const list = [conversation({ id: 'c1', unreadCount: 4 })];
    const next = markConversationRead(list, 'c1', SELF, T3);
    expect(next[0].unreadCount).toBe(0);
    expect(next[0].members.find((m) => m.userId === SELF)?.lastReadAt).toBe(T3);
    expect(next[0].members.find((m) => m.userId === PEER)?.lastReadAt).toBeNull();
  });

  it('nic do zrobienia => ta sama referencja', () => {
    const list = [
      conversation({
        id: 'c1',
        unreadCount: 0,
        members: [{ userId: SELF, role: 'member', lastReadAt: T3 }],
      }),
    ];
    expect(markConversationRead(list, 'c1', SELF, T3)).toBe(list);
    expect(markConversationRead(list, 'c-obca', SELF, T3)).toBe(list);
  });
});

describe('mergeMessages', () => {
  const existing = [message({ id: 'm1', createdAt: T1 }), message({ id: 'm2', createdAt: T2 })];

  it('dokłada nowe i trzyma porządek rosnący', () => {
    const next = mergeMessages(existing, [message({ id: 'm3', createdAt: T3 })]);
    expect(next.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('duplikat po id niczego nie dubluje (echo własnej wysyłki)', () => {
    const next = mergeMessages(existing, [message({ id: 'm2', createdAt: T2 })]);
    expect(next).toBe(existing);
  });

  it('nowszy wiersz tej samej wiadomości wygrywa (edycja, usunięcie)', () => {
    const next = mergeMessages(existing, [
      message({ id: 'm2', createdAt: T2, body: 'poprawione', editedAt: T3 }),
    ]);
    expect(next).toHaveLength(2);
    expect(next[1].body).toBe('poprawione');
  });

  it('stary snapshot nie cofa edycji naniesionej broadcastem', () => {
    // Równoległe pobranie strony ruszyło przed edycją: niesie wariant sprzed
    // niej. Wygrywa rewizja, nie kolejność dojścia.
    const edited = [message({ id: 'm2', createdAt: T2, body: 'poprawione', editedAt: T3 })];
    const next = mergeMessages(edited, [message({ id: 'm2', createdAt: T2 })]);
    expect(next).toBe(edited);
  });

  it('stary snapshot nie odkasowuje wiadomości (kasowanie terminalne)', () => {
    const deleted = [message({ id: 'm2', createdAt: T2, deletedAt: T3 })];
    const next = mergeMessages(deleted, [message({ id: 'm2', createdAt: T2 })]);
    expect(next).toBe(deleted);
  });

  it('dociągnięcie z nowszą edycją nadpisuje posiadany wariant', () => {
    const stale = [message({ id: 'm2', createdAt: T2, body: 'stare', editedAt: T1 })];
    const next = mergeMessages(stale, [
      message({ id: 'm2', createdAt: T2, body: 'nowsze', editedAt: T3 }),
    ]);
    expect(next[0].body).toBe('nowsze');
  });

  it('remis rewizji zostawia wariant posiadany (stary snapshot nie cofa treści)', () => {
    // Trigger `chat_messages_stamp_edit` gwarantuje, że każda zmiana `body`
    // podbija `edited_at` — remis rewizji to zatem ta sama edycja, a różnica
    // treści przy remisie może pochodzić wyłącznie ze starego snapshota.
    const held = [message({ id: 'm2', createdAt: T2, body: 'nowe' })];
    const next = mergeMessages(held, [message({ id: 'm2', createdAt: T2, body: 'stare' })]);
    expect(next).toBe(held);
  });

  it('remis po created_at rozstrzyga id', () => {
    const next = mergeMessages([], [
      message({ id: 'm-b', createdAt: T1 }),
      message({ id: 'm-a', createdAt: T1 }),
    ]);
    expect(next.map((m) => m.id)).toEqual(['m-a', 'm-b']);
  });

  it('kursory wskazują skrajne wiadomości', () => {
    expect(newestMessageCursor(existing)).toEqual({ createdAt: T2, id: 'm2' });
    expect(oldestMessageCursor(existing)).toEqual({ createdAt: T1, id: 'm1' });
    expect(newestMessageCursor([])).toBeNull();
    expect(oldestMessageCursor([])).toBeNull();
  });
});

describe('sygnały „pisze…"', () => {
  it('odświeża wpis nadawcy zamiast go dublować', () => {
    const first = applyTypingSignal([], PEER, 1000, 5000);
    const second = applyTypingSignal(first, PEER, 3000, 5000);
    expect(second).toHaveLength(1);
    expect(second[0].expiresAt).toBe(8000);
  });

  it('wygasłe wpisy znikają, świeże zostają przy tej samej referencji', () => {
    const entries = [
      { userId: PEER, expiresAt: 2000 },
      { userId: 'user-c', expiresAt: 9000 },
    ];
    expect(pruneTyping(entries, 5000).map((e) => e.userId)).toEqual(['user-c']);
    expect(pruneTyping(entries, 1000)).toBe(entries);
  });

  it('wysłanie wiadomości zdejmuje nadawcę z listy piszących', () => {
    const entries = [{ userId: PEER, expiresAt: 9000 }];
    expect(removeTyping(entries, PEER)).toEqual([]);
    expect(removeTyping(entries, 'user-c')).toBe(entries);
  });

  it('typingUserIds pomija wygasłych', () => {
    const entries = [
      { userId: PEER, expiresAt: 2000 },
      { userId: 'user-c', expiresAt: 9000 },
    ];
    expect(typingUserIds(entries, 5000)).toEqual(['user-c']);
  });
});

// ---- Reakcje -----------------------------------------------------------------

describe('reakcje', () => {
  const r = (userId: string, emoji: string, createdAt: string): ChatReaction => ({
    userId,
    emoji,
    createdAt,
  });
  const event = (userId: string, emoji: string | null, createdAt = T3) => ({
    messageId: 'm1',
    conversationId: 'conv-1',
    userId,
    emoji,
    createdAt,
  });

  it('mergeReactions podmienia listę wiadomości i zachowuje referencję bez zmian', () => {
    const base: ChatReactionMap = { m1: [r(PEER, '👍', T1)] };
    expect(mergeReactions(base, { m1: [r(PEER, '👍', T1)] })).toBe(base);
    expect(mergeReactions(base, { m2: [] })).toBe(base);
    const next = mergeReactions(base, { m1: [r(SELF, '❤️', T2), r(PEER, '👍', T1)], m2: [] });
    expect(next).not.toBe(base);
    expect(next.m1.map((x) => x.userId)).toEqual([PEER, SELF]);
    // Nieznana wiadomość z pustą listą nie zaśmieca mapy (`?? []` w widoku).
    expect(next.m2).toBeUndefined();
    // Pusta lista dla ZNANEJ wiadomości jest informacją (ktoś zdjął ostatnią).
    expect(mergeReactions(next, { m1: [] }).m1).toEqual([]);
  });

  it('applyReactionEvent: ustawia, podmienia, zdejmuje; powtórka = ta sama referencja', () => {
    const empty: ChatReactionMap = {};
    const set = applyReactionEvent(empty, event(PEER, '👍'));
    expect(set.m1).toEqual([r(PEER, '👍', T3)]);
    expect(applyReactionEvent(set, event(PEER, '👍'))).toBe(set);
    const replaced = applyReactionEvent(set, event(PEER, '❤️'));
    expect(replaced.m1).toEqual([r(PEER, '❤️', T3)]);
    const removed = applyReactionEvent(replaced, event(PEER, null));
    expect(removed.m1).toEqual([]);
    expect(applyReactionEvent(removed, event(PEER, null))).toBe(removed);
    expect(applyReactionEvent(removed, event('', '👍'))).toBe(removed);
  });

  it('applyReactionEvent trzyma porządek po czasie dodania', () => {
    const map = applyReactionEvent(
      applyReactionEvent({}, event(SELF, '👍', T2)),
      event(PEER, '👍', T1),
    );
    expect(map.m1.map((x) => x.userId)).toEqual([PEER, SELF]);
  });

  it('groupReactions: najliczniejsze pierwsze, remis po najwcześniejszej, flaga mine', () => {
    const groups = groupReactions(
      [r(PEER, '❤️', T1), r(SELF, '👍', T2), r('u3', '👍', T3), r('u4', '😆', T1)],
      SELF,
    );
    expect(groups.map((g) => [g.emoji, g.count, g.mine])).toEqual([
      ['👍', 2, true],
      ['❤️', 1, false],
      ['😆', 1, false],
    ]);
    expect(groups[0].userIds).toEqual([SELF, 'u3']);
    expect(groupReactions([], SELF)).toEqual([]);
  });

  it('ownReaction i nextReactionIntent: to samo zdejmuje, inne podmienia', () => {
    const list = [r(SELF, '👍', T1), r(PEER, '❤️', T2)];
    expect(ownReaction(list, SELF)).toBe('👍');
    expect(ownReaction(list, 'nikt')).toBeNull();
    expect(ownReaction(list, null)).toBeNull();
    expect(nextReactionIntent(list, SELF, '👍')).toBeNull();
    expect(nextReactionIntent(list, SELF, '❤️')).toBe('❤️');
    expect(nextReactionIntent([], SELF, '😆')).toBe('😆');
  });
});

describe('applyConversationTheme', () => {
  it('podmienia motyw jednej rozmowy; ta sama wartość i obca rozmowa = ta sama referencja', () => {
    const list = [conversation({ id: 'a' }), conversation({ id: 'b' })];
    const next = applyConversationTheme(list, 'a', 'las');
    expect(next).not.toBe(list);
    expect(next[0].themeId).toBe('las');
    expect(next[1]).toBe(list[1]);
    expect(applyConversationTheme(next, 'a', 'las')).toBe(next);
    expect(applyConversationTheme(next, 'nie-ma', 'las')).toBe(next);
  });
});
