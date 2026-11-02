import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { buildDirectory } from './chatPeople';
import {
  applyChatMention,
  canSendWith,
  chatMentionCandidates,
  commentCountLabel,
  mentionSegments,
  messageActions,
  parseChatMentions,
  quoteText,
  seenByLabel,
  seenByTooltip,
  sentAnnouncement,
} from './chatThreadView';

const directory = buildDirectory([
  { id: 'self', firstName: 'Kasia', lastName: 'Kowalska', email: 'k@n2.pl' },
  { id: 'ola', firstName: 'Ola', lastName: 'Nowak', email: 'o@n2.pl' },
  { id: 'olaf', firstName: 'Olaf', lastName: 'Łęcki', email: 'f@n2.pl' },
  { id: 'lukasz', firstName: 'Łukasz', lastName: 'Wiśniewski', email: 'l@n2.pl' },
  { id: 'anon', firstName: '', lastName: '', email: 'x@n2.pl' },
]);

function msg(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm',
    conversationId: 'c',
    authorId: 'ola',
    body: 'Treść',
    kind: 'text',
    meta: null,
    createdAt: '2026-11-02T10:00:00Z',
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

describe('wzmianki z katalogu profili', () => {
  it('podpowiada bez siebie i bez osób bez imienia, prefiks imienia pierwszy, bez ogonków', () => {
    expect(chatMentionCandidates(directory, '', 'self').map((p) => p.id)).toEqual(['lukasz', 'ola', 'olaf']);
    expect(chatMentionCandidates(directory, 'ol', 'self').map((p) => p.id)).toEqual(['ola', 'olaf']);
    expect(chatMentionCandidates(directory, 'lu', 'self').map((p) => p.id)).toEqual(['lukasz']);
    expect(chatMentionCandidates(directory, 'nowak', 'self').map((p) => p.id)).toEqual(['ola']);
  });

  it('wstawia token @Imię ze spacją i ustawia karetkę', () => {
    const person = directory.get('ola')!;
    expect(applyChatMention('Hej @o', { start: 4, end: 6, query: 'o' }, person)).toEqual({
      text: 'Hej @Ola ',
      caret: 9,
    });
  });

  it('parsuje oznaczenia po granicy słowa, bez siebie i bez adresów e-mail', () => {
    expect(parseChatMentions('@Ola zerkniesz?', directory, 'self')).toEqual(['ola']);
    expect(parseChatMentions('cc @olaf', directory, 'self')).toEqual(['olaf']);
    expect(parseChatMentions('@Ola Nowak i @Łukasz', directory, 'self').sort()).toEqual(['lukasz', 'ola']);
    expect(parseChatMentions('@Kasia sama sobie', directory, 'self')).toEqual([]);
    expect(parseChatMentions('ola@Ola.pl', directory, 'self')).toEqual([]);
    expect(parseChatMentions('bez znaczka', directory, 'self')).toEqual([]);
  });

  it('podświetla najdłuższą nazwę i zostawia resztę tekstu', () => {
    expect(mentionSegments('Hej @Ola Nowak, patrz', directory)).toEqual([
      { text: 'Hej ', mention: false },
      { text: '@Ola Nowak', mention: true },
      { text: ', patrz', mention: false },
    ]);
    expect(mentionSegments('@Olaf?', directory)).toEqual([
      { text: '@Olaf', mention: true },
      { text: '?', mention: false },
    ]);
    expect(mentionSegments('mail@Ola', directory)).toEqual([{ text: 'mail@Ola', mention: false }]);
    expect(mentionSegments('zwykły', directory)).toEqual([{ text: 'zwykły', mention: false }]);
  });
});

describe('cytat i akcje wiadomości', () => {
  it('opisuje usuniętą, obraz, GIF, brak w pamięci i przycina długi tekst', () => {
    expect(quoteText(undefined)).toBe('Wcześniejsza wiadomość');
    expect(quoteText(msg({ deletedAt: '2026-11-02T10:01:00Z' }))).toBe('Wiadomość usunięta');
    const image = { path: 'c/a.png', mime: 'image/png' as const, width: 1, height: 1, size: 1, name: 'a' };
    expect(quoteText(msg({ body: '', attachments: [image] }))).toBe('Obraz');
    expect(quoteText(msg({ body: '', attachments: [image, image, image] }))).toBe('3 obrazy');
    expect(quoteText(msg({ body: 'https://media.giphy.com/media/x/giphy.gif' }))).toBe('GIF');
    const long = quoteText(msg({ body: 'a '.repeat(80) }));
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith('…')).toBe(true);
  });

  it('menu: wszystkim odpowiedz, reakcja, przypnij; autorowi edytuj i usuń', () => {
    expect(messageActions(msg({ authorId: 'ola' }), 'self').map((a) => a.id)).toEqual(['reply', 'react', 'pin']);
    const own = messageActions(msg({ authorId: 'self', pinnedAt: '2026-11-02T10:00:00Z' }), 'self');
    expect(own.map((a) => a.label)).toEqual(['Odpowiedz', 'Reakcja', 'Odepnij', 'Edytuj', 'Usuń']);
    expect(own.find((a) => a.id === 'delete')?.danger).toBe(true);
    expect(messageActions(msg({ deletedAt: '2026-11-02T10:01:00Z' }), 'self')).toEqual([]);
    expect(messageActions(msg({ kind: 'system' }), 'self')).toEqual([]);
    expect(
      messageActions(msg({ authorId: 'self', body: 'https://media.giphy.com/media/x/giphy.gif' }), 'self').map((a) => a.id),
    ).toEqual(['reply', 'react', 'pin', 'delete']);
  });
});

describe('etykiety i stan kompozytora', () => {
  it('„Widziane przez” z nazwiskiem i godziną, bez myślników', () => {
    const today = '2026-11-02';
    const at = new Date(2026, 10, 2, 14, 5).toISOString();
    const text = seenByTooltip(directory, { userId: 'ola', lastReadAt: at }, today);
    expect(text).toBe('Ola Nowak, widziane dzisiaj o 14:05');
    expect(text).not.toMatch(/[–—]/);
    const yesterday = new Date(2026, 10, 1, 9, 0).toISOString();
    expect(seenByTooltip(directory, { userId: 'ola', lastReadAt: yesterday }, today)).toBe(
      'Ola Nowak, widziane wczoraj o 09:00',
    );
    expect(seenByLabel(directory, [{ userId: 'ola', lastReadAt: at }, { userId: 'olaf', lastReadAt: at }])).toBe(
      'Widziane przez: Ola Nowak, Olaf Łęcki',
    );
  });

  it('licznik komentarzy pomija systemowe i usunięte, „+” gdy są starsze', () => {
    const list = [msg({ id: 'a' }), msg({ id: 'b', kind: 'system' }), msg({ id: 'c', deletedAt: 'x' })];
    expect(commentCountLabel(list, false)).toBe('1');
    expect(commentCountLabel(list, true)).toBe('1+');
  });

  it('wysyłka: sam obraz wystarczy, nie czekamy na wgrywanie, limit znaków', () => {
    expect(canSendWith('', { ready: 1, allReady: true })).toBe(true);
    expect(canSendWith('', { ready: 0, allReady: true })).toBe(false);
    expect(canSendWith('hej', { ready: 0, allReady: false })).toBe(false);
    expect(canSendWith('x'.repeat(4001), { ready: 0, allReady: true })).toBe(false);
    expect(sentAnnouncement(0)).toBe('Wiadomość wysłana.');
    expect(sentAnnouncement(2)).toBe('Wiadomość wysłana z 2 obrazami.');
  });
});
