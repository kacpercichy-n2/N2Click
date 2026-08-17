import { describe, expect, it } from 'vitest';
import { toDateStr } from '../../utils/dates';
import { CHAT_MESSAGE_MAX_LENGTH, type ChatConversation, type ChatMessage } from '../types';
import { buildDirectory } from './chatPeople';
import {
  buildWindowItems,
  composerState,
  dismissPicker,
  isNearBottom,
  isSendKey,
  togglePicker,
  typingLabel,
  windowSubtitle,
  windowTitle,
} from './chatWindowView';

const ME = 'u-me';
const OLA = 'u-ola';
const MAREK = 'u-marek';

const directory = buildDirectory([
  { id: ME, firstName: 'Kacper', lastName: 'Cichy', email: 'kacper@n2.pl' },
  { id: OLA, firstName: 'Ola', lastName: 'Kowalska', email: 'ola@n2.pl' },
  { id: MAREK, firstName: 'Marek', lastName: 'Żuraw', email: 'marek@n2.pl' },
]);

const TODAY = toDateStr(new Date(2026, 7, 13));
const at = (day: number, h: number, m: number) => new Date(2026, 7, day, h, m).toISOString();

function message(patch: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  return {
    conversationId: 'c1',
    authorId: OLA,
    body: 'Treść',
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    ...patch,
  };
}

function conversation(patch: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'c1',
    kind: 'direct',
    title: null,
    members: [
      { userId: ME, role: 'owner', lastReadAt: null },
      { userId: OLA, role: 'member', lastReadAt: null },
    ],
    createdBy: ME,
    lastMessageAt: null,
    lastMessage: null,
    unreadCount: 0,
    ...patch,
  };
}

describe('buildWindowItems', () => {
  const base = { selfId: ME, directory, isGroup: false, todayStr: TODAY };

  it('otwiera listę separatorem dnia i sklei wiadomości jednego autora', () => {
    const items = buildWindowItems({
      ...base,
      messages: [
        message({ id: 'm1', createdAt: at(13, 9, 0) }),
        message({ id: 'm2', createdAt: at(13, 9, 2) }),
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'day', label: 'Dzisiaj' });
    expect(items[1].kind).toBe('group');
    if (items[1].kind === 'group') {
      expect(items[1].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(items[1].mine).toBe(false);
    }
  });

  it('zmiana autora zaczyna nową grupę', () => {
    const items = buildWindowItems({
      ...base,
      messages: [
        message({ id: 'm1', createdAt: at(13, 9, 0) }),
        message({ id: 'm2', createdAt: at(13, 9, 1), authorId: ME }),
      ],
    });
    expect(items.filter((i) => i.kind === 'group')).toHaveLength(2);
    const last = items[2];
    expect(last.kind === 'group' && last.mine).toBe(true);
  });

  it('przerwa dłuższa niż okno grupowania rozbija dymki', () => {
    const items = buildWindowItems({
      ...base,
      messages: [
        message({ id: 'm1', createdAt: at(13, 9, 0) }),
        message({ id: 'm2', createdAt: at(13, 9, 30) }),
      ],
    });
    expect(items.filter((i) => i.kind === 'group')).toHaveLength(2);
  });

  it('nowy dzień wstawia separator i przerywa grupę', () => {
    const items = buildWindowItems({
      ...base,
      messages: [
        message({ id: 'm1', createdAt: at(12, 23, 59) }),
        message({ id: 'm2', createdAt: at(13, 0, 1) }),
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(['day', 'group', 'day', 'group']);
    expect(items[0]).toMatchObject({ label: 'Wczoraj' });
    expect(items[2]).toMatchObject({ label: 'Dzisiaj' });
  });

  it('wiadomość usunięta gubi treść i dostaje znacznik', () => {
    const items = buildWindowItems({
      ...base,
      messages: [
        message({ id: 'm1', createdAt: at(13, 9, 0), body: 'tajne', deletedAt: at(13, 9, 5) }),
      ],
    });
    const group = items[1];
    expect(group.kind === 'group' && group.messages[0]).toMatchObject({
      body: '',
      deleted: true,
      time: '09:00',
    });
  });

  it('podpis autora pokazuje się tylko nad CUDZYM dymkiem w grupie', () => {
    const items = buildWindowItems({
      ...base,
      isGroup: true,
      messages: [
        message({ id: 'm1', createdAt: at(13, 9, 0) }),
        message({ id: 'm2', createdAt: at(13, 9, 1), authorId: ME }),
      ],
    });
    const theirs = items[1];
    const mine = items[2];
    expect(theirs.kind === 'group' && theirs.showAuthor).toBe(true);
    expect(theirs.kind === 'group' && theirs.authorName).toBe('Ola');
    expect(mine.kind === 'group' && mine.showAuthor).toBe(false);
  });

  it('pusta rozmowa nie produkuje żadnego elementu', () => {
    expect(buildWindowItems({ ...base, messages: [] })).toEqual([]);
  });
});

describe('nagłówek okna', () => {
  it('DM bierze nazwisko, a status tylko przy obecności', () => {
    expect(windowTitle(conversation(), ME, directory)).toBe('Ola Kowalska');
    expect(windowSubtitle(conversation(), ME, new Set([OLA]))).toBe('Aktywna teraz');
    expect(windowSubtitle(conversation(), ME, new Set())).toBe('');
  });

  it('grupa zawsze niesie liczbę osób', () => {
    const group = conversation({
      kind: 'group',
      title: 'Projekt X',
      members: [
        { userId: ME, role: 'owner', lastReadAt: null },
        { userId: OLA, role: 'member', lastReadAt: null },
        { userId: MAREK, role: 'member', lastReadAt: null },
      ],
    });
    expect(windowTitle(group, ME, directory)).toBe('Projekt X');
    expect(windowSubtitle(group, ME, new Set())).toBe('3 osoby');
    expect(windowSubtitle(group, ME, new Set([MAREK]))).toBe('3 osoby, aktywna teraz');
  });
});

describe('typingLabel', () => {
  it('odmienia liczbę piszących', () => {
    expect(typingLabel([], directory)).toBe('');
    expect(typingLabel([OLA], directory)).toBe('Ola pisze…');
    expect(typingLabel([OLA, MAREK], directory)).toBe('Ola i Marek piszą…');
    expect(typingLabel([OLA, MAREK, 'u-x'], directory)).toBe('Kilka osób pisze…');
  });
});

describe('kompozytor', () => {
  it('pusta i sama biała treść nie wysyła', () => {
    expect(composerState('').canSend).toBe(false);
    expect(composerState('   \n ').canSend).toBe(false);
    expect(composerState(' Hej ').canSend).toBe(true);
    expect(composerState(' Hej ').value).toBe('Hej');
  });

  it('przekroczony limit blokuje wysyłkę i tłumaczy o ile', () => {
    const state = composerState('x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 2));
    expect(state.overLimit).toBe(true);
    expect(state.canSend).toBe(false);
    expect(state.hint).toBe('Za długa wiadomość o 2 znaki.');
    expect(composerState('x'.repeat(CHAT_MESSAGE_MAX_LENGTH)).canSend).toBe(true);
  });

  it('Enter wysyła, Shift+Enter i składanie IME nie', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(isSendKey({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('isNearBottom', () => {
  it('dosuwa scroll tylko przy dolnej krawędzi', () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });
});

describe('pickery kompozytora', () => {
  it('klik w przycisk otwiera, ten sam przycisk gasi', () => {
    expect(togglePicker('none', 'emoji')).toBe('emoji');
    expect(togglePicker('emoji', 'emoji')).toBe('none');
    expect(togglePicker('none', 'gif')).toBe('gif');
    expect(togglePicker('gif', 'gif')).toBe('none');
  });

  it('klik w drugi przycisk przełącza panel, nie zamyka wszystkiego', () => {
    expect(togglePicker('emoji', 'gif')).toBe('gif');
    expect(togglePicker('gif', 'emoji')).toBe('emoji');
  });

  it('sygnał zamknięcia gasi TYLKO swój panel', () => {
    expect(dismissPicker('emoji', 'emoji')).toBe('none');
    expect(dismissPicker('gif', 'gif')).toBe('none');
    expect(dismissPicker('none', 'emoji')).toBe('none');
  });

  it('spóźniony sygnał wychodzącego panelu nie gasi świeżo otwartego sąsiada', () => {
    // Wyścig przy przełączaniu: `AnimatePresence` trzyma stary panel przez czas
    // animacji wyjścia, więc jego `useOverlay` widzi klik w NOWY panel jako
    // „na zewnątrz" i woła własne zamknięcie.
    const afterSwitch = togglePicker('emoji', 'gif');
    expect(afterSwitch).toBe('gif');
    expect(dismissPicker(afterSwitch, 'emoji')).toBe('gif');
    expect(dismissPicker(togglePicker('gif', 'emoji'), 'gif')).toBe('emoji');
  });
});
