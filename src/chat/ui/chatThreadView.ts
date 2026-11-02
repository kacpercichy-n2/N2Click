// Czysty model widoku wątku (karta zadania v2): wzmianki z katalogu profili,
// cytat odpowiedzi, menu akcji wiadomości, etykiety „Widziane przez”,
// przypięte i liczniki zakładek. Zero Reacta, testowane w node.
//
// WZMIANKI: rdzeń czatu zna wyłącznie chmurowe uuid, więc kandydaci pochodzą
// z `ChatDirectory` (profile organizacji), nie z lokalnych `state.people`
// (lokalne id osoby nie musi być uuid profilu, a `mention_ids` to uuid profili).
// Token jest ten sam co w komentarzach: `@Imię` (mentionAutocomplete.ts).
import type { MentionQuery } from '../../components/mentionAutocomplete';
import { polishCount } from '../../utils/polishPlural';
import type { ChatSeenBy } from '../chatState';
import { CHAT_MESSAGE_MAX_LENGTH, type ChatMessage } from '../types';
import { personLabel, type ChatDirectory, type ChatPerson } from './chatPeople';
import { messageContentKind } from './chatRichText';
import { dayKey, formatClock, formatDaySeparator } from './chatTime';
import { DELETED_MESSAGE_TEXT } from './chatWindowView';

/** Ile podpowiedzi wzmianek naraz (jak w komentarzach). */
export const MAX_CHAT_MENTIONS = 8;

/** Długość cytatu w pasku odpowiedzi, dymku i liście przypiętych. */
export const QUOTE_MAX_CHARS = 90;

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/ł/g, 'l');

function fullName(person: ChatPerson): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * Kandydaci do `@`: najpierw pasujący początkiem imienia, potem zawierający
 * zapytanie w pełnej nazwie. Bez zalogowanego i bez osób bez imienia (nie da
 * się ich oznaczyć tokenem `@Imię`). Kolejność alfabetyczna po imieniu.
 */
export function chatMentionCandidates(
  directory: ChatDirectory,
  query: string,
  selfId: string | null,
): ChatPerson[] {
  const named = Array.from(directory.values())
    .filter((p) => p.id !== selfId && p.firstName.trim() !== '')
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'pl'));
  if (query === '') return named.slice(0, MAX_CHAT_MENTIONS);
  const needle = normalize(query);
  const prefix = named.filter((p) => normalize(p.firstName).startsWith(needle));
  const rest = named.filter((p) => !prefix.includes(p) && normalize(fullName(p)).includes(needle));
  return [...prefix, ...rest].slice(0, MAX_CHAT_MENTIONS);
}

/** Podmienia token `@zapytanie` na `@Imię ` i zwraca nowy tekst i karetkę. */
export function applyChatMention(
  text: string,
  range: MentionQuery,
  person: ChatPerson,
): { text: string; caret: number } {
  const token = `@${person.firstName.trim()} `;
  return {
    text: text.slice(0, range.start) + token + text.slice(range.end),
    caret: range.start + token.length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Id oznaczonych osób z treści. `@Imię` albo `@Imię Nazwisko`, ale nie
 * `@Olaf` dla „Ola” (po tokenie nie może stać litera ani cyfra). Bez siebie.
 */
export function parseChatMentions(
  body: string,
  directory: ChatDirectory,
  selfId: string | null,
): string[] {
  if (!body.includes('@')) return [];
  const ids: string[] = [];
  for (const person of directory.values()) {
    if (person.id === selfId) continue;
    const first = person.firstName.trim();
    if (first === '') continue;
    const names = [fullName(person), first].map(escapeRegExp);
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}@])@(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(body)) ids.push(person.id);
  }
  return ids;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Krótki opis wiadomości do cytatu (odpowiedź, przypięte, pasek odpowiedzi).
 * Brak wiadomości w pamięci = starsza niż wczytana strona.
 */
export function quoteText(message: ChatMessage | undefined): string {
  if (!message) return 'Wcześniejsza wiadomość';
  if (message.deletedAt !== null) return DELETED_MESSAGE_TEXT;
  const body = message.body.trim();
  if (body !== '' && messageContentKind(body) === 'gif') return 'GIF';
  if (body !== '') return clip(body, QUOTE_MAX_CHARS);
  const count = message.attachments.length;
  if (count === 1) return 'Obraz';
  if (count > 1) return `${count} ${polishCount(count, 'obraz', 'obrazy', 'obrazów')}`;
  return 'Wiadomość';
}

export type ChatMessageActionId = 'reply' | 'react' | 'pin' | 'edit' | 'delete';

export interface ChatMessageAction {
  id: ChatMessageActionId;
  label: string;
  danger?: boolean;
}

/**
 * Menu wiadomości: Odpowiedz, Reakcja, Przypnij/Odepnij dla każdej; Edytuj
 * i Usuń tylko dla własnych. Usunięta i systemowa nie mają menu. GIF nie ma
 * „Edytuj” (adres to cała treść, edycja zrobiłaby z niego tekst).
 */
export function messageActions(
  message: Pick<ChatMessage, 'authorId' | 'deletedAt' | 'kind' | 'pinnedAt' | 'body'>,
  selfId: string | null,
): ChatMessageAction[] {
  if (message.deletedAt !== null || message.kind === 'system') return [];
  const actions: ChatMessageAction[] = [
    { id: 'reply', label: 'Odpowiedz' },
    { id: 'react', label: 'Reakcja' },
    { id: 'pin', label: message.pinnedAt !== null ? 'Odepnij' : 'Przypnij' },
  ];
  if (selfId !== null && message.authorId === selfId) {
    if (messageContentKind(message.body) !== 'gif') actions.push({ id: 'edit', label: 'Edytuj' });
    actions.push({ id: 'delete', label: 'Usuń', danger: true });
  }
  return actions;
}

/** Dymek przy awatarze „Widziane przez”: „Ola Nowak, widziane dzisiaj o 14:05”. */
export function seenByTooltip(
  directory: ChatDirectory,
  seen: ChatSeenBy,
  todayStr: string,
): string {
  const name = personLabel(directory, seen.userId);
  const clock = formatClock(seen.lastReadAt);
  if (clock === '') return name;
  const day = dayKey(seen.lastReadAt);
  const when = day === todayStr ? 'dzisiaj' : formatDaySeparator(seen.lastReadAt, todayStr).toLowerCase();
  return `${name}, widziane ${when} o ${clock}`;
}

/** Nazwa dostępna grupki awatarów pod wiadomością. */
export function seenByLabel(directory: ChatDirectory, seen: readonly ChatSeenBy[]): string {
  const names = seen.map((s) => personLabel(directory, s.userId));
  return `Widziane przez: ${names.join(', ')}`;
}

/**
 * Liczba w zakładce „Komentarze (n)”: wiadomości osób (bez systemowych
 * i usuniętych) z wczytanych stron. Gdy są starsze strony, „50+”.
 */
export function commentCountLabel(messages: readonly ChatMessage[], hasMore: boolean): string {
  const count = messages.filter((m) => m.kind !== 'system' && m.deletedAt === null).length;
  return hasMore ? `${count}+` : String(count);
}

/** Stan kompozytora z obrazami: obraz sam też jest treścią. */
export function canSendWith(
  body: string,
  attachments: { ready: number; allReady: boolean },
): boolean {
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) return false;
  if (!attachments.allReady) return false;
  return body.trim() !== '' || attachments.ready > 0;
}

/** Komunikat w regionie na żywo po wysłaniu (bez emoji i bez pauz). */
export function sentAnnouncement(imageCount: number): string {
  if (imageCount === 0) return 'Wiadomość wysłana.';
  return `Wiadomość wysłana z ${imageCount} ${polishCount(imageCount, 'obrazem', 'obrazami', 'obrazami')}.`;
}

export type MentionSegment = { text: string; mention: boolean };

/**
 * Tekst dymka pocięty na zwykłe kawałki i `@Imię` znanych osób (podświetlenie
 * wzmianki). Najdłuższa nazwa wygrywa („@Ola Nowak” przed „@Ola”). Działa na
 * segmencie tekstu z `tokenizeMessage`, więc linki zostają nietknięte.
 */
export function mentionSegments(text: string, directory: ChatDirectory): MentionSegment[] {
  if (!text.includes('@')) return [{ text, mention: false }];
  const names = Array.from(directory.values())
    .flatMap((p) => [fullName(p), p.firstName.trim()])
    .filter((name) => name !== '')
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (names.length === 0) return [{ text, mention: false }];
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}@])(@(?:${names.join('|')}))(?![\\p{L}\\p{N}])`, 'giu');
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[1].length;
    if (start > last) segments.push({ text: text.slice(last, start), mention: false });
    segments.push({ text: match[2], mention: true });
    last = start + match[2].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: false });
  return segments.length > 0 ? segments : [{ text, mention: false }];
}
