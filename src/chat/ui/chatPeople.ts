// Tożsamość i obecność w warstwie WIDOKU czatu. Rdzeń (`chatData`/`chatState`)
// zna wyłącznie chmurowe uuid; nazwiska, inicjały i „kto jest online" składamy
// tutaj ze snapshotu organizacji (`OrgSnapshot.profiles`).
//
// GRANICE:
//   * Moduł jest CZYSTY: zero Reacta, zero DOM-u, zero date-fns. Testuje się w
//     node, tak jak `bottomNav.ts` czy `allocationDayListView.ts`.
//   * Nie dotyka rdzenia czatu — bierze jego typy i nic w nich nie zmienia.
import type { ChatConversation } from '../types';

/** Minimum, jakiego widok potrzebuje o osobie (podzbiór `CloudProfile`). */
export interface ChatPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Katalog osób po chmurowym uuid — jedyny sposób, w jaki UI zna nazwiska. */
export type ChatDirectory = ReadonlyMap<string, ChatPerson>;

/** Nazwa zastępcza, gdy o osobie nie wiemy nic (profil poza zasięgiem RLS). */
export const UNKNOWN_PERSON_LABEL = 'Nieznana osoba';

export function buildDirectory(people: readonly ChatPerson[]): ChatDirectory {
  const map = new Map<string, ChatPerson>();
  for (const person of people) {
    if (person.id !== '') map.set(person.id, person);
  }
  return map;
}

/** „Ola Kowalska"; bez nazwiska sam e-mail, bez niczego etykieta zastępcza. */
export function personLabel(directory: ChatDirectory, userId: string): string {
  const person = directory.get(userId);
  if (!person) return UNKNOWN_PERSON_LABEL;
  const full = `${person.firstName} ${person.lastName}`.trim();
  if (full !== '') return full;
  return person.email.trim() !== '' ? person.email.trim() : UNKNOWN_PERSON_LABEL;
}

/** Samo imię (wskaźnik „pisze…", autor nad dymkiem w grupie). */
export function personFirstName(directory: ChatDirectory, userId: string): string {
  const person = directory.get(userId);
  const first = person?.firstName.trim() ?? '';
  return first !== '' ? first : personLabel(directory, userId);
}

/** Pierwsze litery dwóch pierwszych słów etykiety; '?' gdy nie ma z czego. */
export function labelInitials(label: string): string {
  const words = label.split(/[\s._-]+/).filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => word[0]);
  const initials = letters.join('').toUpperCase();
  return initials !== '' ? initials : '?';
}

export function personInitials(directory: ChatDirectory, userId: string): string {
  const person = directory.get(userId);
  if (!person) return '?';
  const full = `${person.firstName} ${person.lastName}`.trim();
  return labelInitials(full !== '' ? full : person.email);
}

/** Uczestnicy bez zalogowanego (dla DM to jedna osoba). */
export function otherMemberIds(
  conversation: ChatConversation,
  selfId: string | null,
): string[] {
  return conversation.members
    .map((member) => member.userId)
    .filter((userId) => userId !== '' && userId !== selfId);
}

/**
 * Rozmówca DM-u. Null dla grupy oraz dla DM-u bez drugiego uczestnika (wiersze
 * członków mogły nie dojechać — leczy je serwerowe RPC `chat_open_direct`).
 */
export function directPeerId(
  conversation: ChatConversation,
  selfId: string | null,
): string | null {
  if (conversation.kind !== 'direct') return null;
  return otherMemberIds(conversation, selfId)[0] ?? null;
}

/**
 * Obecność rozmowy: zielona kropka, gdy KTÓRYKOLWIEK uczestnik poza mną jest
 * online. Dla DM-u to po prostu rozmówca.
 */
export function isConversationOnline(
  conversation: ChatConversation,
  selfId: string | null,
  presence: ReadonlySet<string>,
): boolean {
  return otherMemberIds(conversation, selfId).some((userId) => presence.has(userId));
}

/** Tytuł rozmowy: DM bierze nazwisko rozmówcy, grupa swój `title`. */
export function conversationTitle(
  conversation: ChatConversation,
  selfId: string | null,
  directory: ChatDirectory,
): string {
  if (conversation.kind === 'group') {
    const title = conversation.title?.trim() ?? '';
    return title !== '' ? title : 'Grupa';
  }
  const peerId = directPeerId(conversation, selfId);
  return peerId === null ? 'Rozmowa' : personLabel(directory, peerId);
}

/** Inicjały na bąbelku: rozmówca (DM) albo tytuł grupy. */
export function conversationInitials(
  conversation: ChatConversation,
  selfId: string | null,
  directory: ChatDirectory,
): string {
  const peerId = directPeerId(conversation, selfId);
  if (peerId !== null) return personInitials(directory, peerId);
  return labelInitials(conversationTitle(conversation, selfId, directory));
}
