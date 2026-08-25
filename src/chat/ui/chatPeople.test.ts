import { describe, expect, it } from 'vitest';
import type { ChatConversation } from '../types';
import {
  UNKNOWN_PERSON_LABEL,
  buildDirectory,
  conversationInitials,
  conversationTitle,
  directPeerId,
  isConversationOnline,
  labelInitials,
  otherMemberIds,
  personFirstName,
  personInitials,
  personLabel,
} from './chatPeople';

const ME = 'u-me';
const OLA = 'u-ola';
const MAREK = 'u-marek';

const directory = buildDirectory([
  { id: ME, firstName: 'Kacper', lastName: 'Cichy', email: 'kacper@n2.pl' },
  { id: OLA, firstName: 'Ola', lastName: 'Kowalska', email: 'ola@n2.pl' },
  { id: MAREK, firstName: '', lastName: '', email: 'marek.nowak@n2.pl' },
]);

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
    themeId: 'lawenda',
    lastMessageAt: null,
    lastMessage: null,
    unreadCount: 0,
    ...patch,
  };
}

describe('personLabel / personFirstName', () => {
  it('składa imię i nazwisko', () => {
    expect(personLabel(directory, OLA)).toBe('Ola Kowalska');
    expect(personFirstName(directory, OLA)).toBe('Ola');
  });

  it('spada na e-mail, gdy profil nie ma nazwiska', () => {
    expect(personLabel(directory, MAREK)).toBe('marek.nowak@n2.pl');
    expect(personFirstName(directory, MAREK)).toBe('marek.nowak@n2.pl');
  });

  it('nieznane uuid dostaje etykietę zastępczą, nigdy surowego id', () => {
    expect(personLabel(directory, 'u-obcy')).toBe(UNKNOWN_PERSON_LABEL);
    expect(personInitials(directory, 'u-obcy')).toBe('?');
  });
});

describe('labelInitials', () => {
  it('bierze pierwsze litery dwóch pierwszych słów', () => {
    expect(labelInitials('Ola Kowalska')).toBe('OK');
    expect(labelInitials('Zespół projektowy N2')).toBe('ZP');
  });

  it('tnie e-mail po kropkach i podkreśleniach', () => {
    expect(labelInitials('marek.nowak@n2.pl')).toBe('MN');
  });

  it('pustka daje znak zapytania', () => {
    expect(labelInitials('   ')).toBe('?');
  });
});

describe('uczestnicy i obecność', () => {
  it('pomija zalogowanego na liście uczestników', () => {
    expect(otherMemberIds(conversation(), ME)).toEqual([OLA]);
  });

  it('rozmówca DM-u to jedyny inny uczestnik', () => {
    expect(directPeerId(conversation(), ME)).toBe(OLA);
  });

  it('grupa nie ma rozmówcy', () => {
    expect(directPeerId(conversation({ kind: 'group' }), ME)).toBeNull();
  });

  it('DM bez drugiego uczestnika (niedokończony insert) nie wywraca widoku', () => {
    const broken = conversation({ members: [{ userId: ME, role: 'owner', lastReadAt: null }] });
    expect(directPeerId(broken, ME)).toBeNull();
    expect(conversationTitle(broken, ME, directory)).toBe('Rozmowa');
  });

  it('kropka obecności zapala się od KTÓREGOKOLWIEK innego uczestnika', () => {
    const group = conversation({
      kind: 'group',
      title: 'Projekt X',
      members: [
        { userId: ME, role: 'owner', lastReadAt: null },
        { userId: OLA, role: 'member', lastReadAt: null },
        { userId: MAREK, role: 'member', lastReadAt: null },
      ],
    });
    expect(isConversationOnline(group, ME, new Set([MAREK]))).toBe(true);
    expect(isConversationOnline(group, ME, new Set())).toBe(false);
  });

  it('własna obecność nigdy nie zapala kropki', () => {
    expect(isConversationOnline(conversation(), ME, new Set([ME]))).toBe(false);
  });
});

describe('tytuł i inicjały rozmowy', () => {
  it('DM bierze nazwisko rozmówcy', () => {
    expect(conversationTitle(conversation(), ME, directory)).toBe('Ola Kowalska');
    expect(conversationInitials(conversation(), ME, directory)).toBe('OK');
  });

  it('grupa bierze tytuł, a pusty tytuł spada na słowo „Grupa"', () => {
    const named = conversation({ kind: 'group', title: 'Projekt X' });
    expect(conversationTitle(named, ME, directory)).toBe('Projekt X');
    expect(conversationInitials(named, ME, directory)).toBe('PX');
    expect(conversationTitle(conversation({ kind: 'group', title: '  ' }), ME, directory)).toBe(
      'Grupa',
    );
  });
});
