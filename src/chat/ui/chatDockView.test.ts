import { describe, expect, it } from 'vitest';
import { toDateStr } from '../../utils/dates';
import type { ChatConversation } from '../types';
import { buildDirectory } from './chatPeople';
import {
  MAX_DOCK_BUBBLES,
  buildConversationRows,
  buildDockBubbles,
  bubbleAriaLabel,
  filterConversationRows,
  filterPeople,
  formatUnreadBadge,
  normalizeQuery,
  previewText,
  pushRecent,
  unreadPhrase,
} from './chatDockView';

const ME = 'u-me';
const OLA = 'u-ola';
const MAREK = 'u-marek';

const people = [
  { id: ME, firstName: 'Kacper', lastName: 'Cichy', email: 'kacper@n2.pl' },
  { id: OLA, firstName: 'Ola', lastName: 'Kowalska', email: 'ola@n2.pl' },
  { id: MAREK, firstName: 'Marek', lastName: 'Żuraw', email: 'marek@n2.pl' },
];
const directory = buildDirectory(people);

function direct(id: string, peer: string, patch: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id,
    kind: 'direct',
    title: null,
    members: [
      { userId: ME, role: 'owner', lastReadAt: null },
      { userId: peer, role: 'member', lastReadAt: null },
    ],
    createdBy: ME,
    lastMessageAt: null,
    lastMessage: null,
    unreadCount: 0,
    ...patch,
  };
}

describe('odznaka nieprzeczytanych', () => {
  it('pusta przy zerze, liczbowa do dziewięciu, potem 9+', () => {
    expect(formatUnreadBadge(0)).toBe('');
    expect(formatUnreadBadge(3)).toBe('3');
    expect(formatUnreadBadge(9)).toBe('9');
    expect(formatUnreadBadge(10)).toBe('9+');
    expect(formatUnreadBadge(999)).toBe('9+');
  });

  it('odmienia liczebnik po polsku', () => {
    expect(unreadPhrase(0)).toBe('');
    expect(unreadPhrase(1)).toBe('1 nieprzeczytana');
    expect(unreadPhrase(3)).toBe('3 nieprzeczytane');
    expect(unreadPhrase(12)).toBe('12 nieprzeczytanych');
  });
});

describe('bubbleAriaLabel', () => {
  it('DM i grupa mają różne zdania', () => {
    expect(
      bubbleAriaLabel({ kind: 'direct', title: 'Ola Kowalska', online: false, unreadCount: 0 }),
    ).toBe('Rozmowa: Ola Kowalska');
    expect(
      bubbleAriaLabel({ kind: 'group', title: 'Projekt X', online: false, unreadCount: 0 }),
    ).toBe('Rozmowa grupowa: Projekt X');
  });

  it('dokleja obecność i licznik', () => {
    expect(
      bubbleAriaLabel({ kind: 'direct', title: 'Ola Kowalska', online: true, unreadCount: 3 }),
    ).toBe('Rozmowa: Ola Kowalska, aktywna teraz, 3 nieprzeczytane');
  });
});

describe('buildDockBubbles', () => {
  const base = {
    selfId: ME,
    directory,
    presence: new Set<string>(),
    openConversationId: null,
    recentIds: [] as string[],
  };

  it('pokazuje rozmowy nieprzeczytane i ostatnio otwierane, resztę pomija', () => {
    const bubbles = buildDockBubbles({
      ...base,
      conversations: [direct('a', OLA, { unreadCount: 2 }), direct('b', MAREK), direct('c', OLA)],
      recentIds: ['c'],
    });
    expect(bubbles.map((b) => b.conversationId)).toEqual(['a', 'c']);
  });

  it('zachowuje kolejność wejścia (rdzeń sortuje po ostatniej wiadomości)', () => {
    const bubbles = buildDockBubbles({
      ...base,
      conversations: [direct('a', OLA, { unreadCount: 1 }), direct('b', MAREK, { unreadCount: 1 })],
    });
    expect(bubbles.map((b) => b.conversationId)).toEqual(['a', 'b']);
  });

  it('tnie listę do limitu', () => {
    const many = Array.from({ length: 8 }, (_, i) => direct(`c${i}`, OLA, { unreadCount: 1 }));
    expect(buildDockBubbles({ ...base, conversations: many })).toHaveLength(MAX_DOCK_BUBBLES);
  });

  it('otwarta rozmowa ZAWSZE ma bąbelek, nawet poza limitem', () => {
    const many = Array.from({ length: 8 }, (_, i) => direct(`c${i}`, OLA, { unreadCount: 1 }));
    const bubbles = buildDockBubbles({ ...base, conversations: many, openConversationId: 'c7' });
    expect(bubbles).toHaveLength(MAX_DOCK_BUBBLES);
    expect(bubbles.map((b) => b.conversationId)).toContain('c7');
    expect(bubbles.find((b) => b.conversationId === 'c7')?.active).toBe(true);
  });

  it('rozmowa bez nieprzeczytanych i bez historii nie dostaje bąbelka', () => {
    expect(buildDockBubbles({ ...base, conversations: [direct('a', OLA)] })).toEqual([]);
  });

  it('składa etykietę, inicjały, obecność i uuid rozmówcy dla zdjęcia', () => {
    const [bubble] = buildDockBubbles({
      ...base,
      conversations: [direct('a', OLA, { unreadCount: 12 })],
      presence: new Set([OLA]),
    });
    expect(bubble).toMatchObject({
      title: 'Ola Kowalska',
      initials: 'OK',
      peerId: OLA,
      badge: '9+',
      online: true,
      ariaLabel: 'Rozmowa: Ola Kowalska, aktywna teraz, 12 nieprzeczytanych',
    });
  });
});

describe('pushRecent', () => {
  it('wkłada na czoło bez duplikatów', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c']);
  });

  it('nie przekracza limitu i ignoruje puste id', () => {
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(pushRecent(['a'], '')).toEqual(['a']);
  });
});

describe('wiersze listy rozmów', () => {
  const todayStr = toDateStr(new Date(2026, 7, 13));
  const at = (h: number, m: number) => new Date(2026, 7, 13, h, m).toISOString();

  it('podgląd rozróżnia autora, grupę i wiadomość usuniętą', () => {
    const mine = direct('a', OLA, {
      lastMessage: { id: 'm1', authorId: ME, body: 'Cześć', createdAt: at(9, 0), deletedAt: null },
    });
    expect(previewText(mine, ME, directory)).toBe('Ty: Cześć');

    const theirs = direct('a', OLA, {
      lastMessage: { id: 'm1', authorId: OLA, body: 'Hej', createdAt: at(9, 0), deletedAt: null },
    });
    expect(previewText(theirs, ME, directory)).toBe('Hej');

    const group: ChatConversation = {
      ...theirs,
      kind: 'group',
      title: 'Projekt X',
      members: [
        { userId: ME, role: 'owner', lastReadAt: null },
        { userId: OLA, role: 'member', lastReadAt: null },
      ],
    };
    expect(previewText(group, ME, directory)).toBe('Ola Kowalska: Hej');

    const removed = direct('a', OLA, {
      lastMessage: { id: 'm1', authorId: OLA, body: '', createdAt: at(9, 0), deletedAt: at(9, 5) },
    });
    expect(previewText(removed, ME, directory)).toBe('Wiadomość usunięta');
    expect(previewText(direct('a', OLA), ME, directory)).toBe('Brak wiadomości');
  });

  it('składa wiersz z czasem i odznaką', () => {
    const [row] = buildConversationRows({
      conversations: [
        direct('a', OLA, {
          unreadCount: 2,
          lastMessageAt: at(14, 5),
          lastMessage: {
            id: 'm1',
            authorId: OLA,
            body: 'Hej',
            createdAt: at(14, 5),
            deletedAt: null,
          },
        }),
      ],
      selfId: ME,
      directory,
      presence: new Set<string>(),
      openConversationId: 'a',
      todayStr,
    });
    expect(row).toMatchObject({ title: 'Ola Kowalska', time: '14:05', badge: '2', active: true });
  });
});

describe('wyszukiwanie', () => {
  it('normalizuje ogonki i wielkość liter', () => {
    expect(normalizeQuery('  ŻUraw ')).toBe('zuraw');
    expect(normalizeQuery('Łódź')).toBe('lodz');
  });

  it('filtruje rozmowy po tytule i podglądzie', () => {
    const rows = buildConversationRows({
      conversations: [direct('a', OLA), direct('b', MAREK)],
      selfId: ME,
      directory,
      presence: new Set<string>(),
      openConversationId: null,
      todayStr: toDateStr(new Date(2026, 7, 13)),
    });
    expect(filterConversationRows(rows, 'zuraw').map((r) => r.conversationId)).toEqual(['b']);
    expect(filterConversationRows(rows, '')).toHaveLength(2);
  });

  it('lista osób pomija zalogowanego i sortuje po polsku', () => {
    expect(filterPeople(people, '', ME).map((p) => p.id)).toEqual([MAREK, OLA]);
    expect(filterPeople(people, 'ola', ME).map((p) => p.id)).toEqual([OLA]);
    expect(filterPeople(people, 'kacper', ME)).toEqual([]);
  });
});
