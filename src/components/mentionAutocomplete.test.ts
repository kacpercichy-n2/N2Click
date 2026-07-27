// Testy czystej logiki podpowiedzi @wzmianek (bez renderu Reacta).
// Kontrakt, który tu pilnujemy: token wstawiony przez autouzupełnianie musi
// nadal być rozpoznawany przez parseMentions — to ono wypełnia
// ADD_COMMENT.mentionIds.
import { describe, expect, it } from 'vitest';
import {
  MAX_MENTION_SUGGESTIONS,
  applyMention,
  filterMentionPeople,
  mentionQueryAt,
} from './mentionAutocomplete';
import { parseMentions } from './CommentsPanel';
import type { Person } from '../types';

function person(id: string, firstName: string, lastName = ''): Person {
  return {
    id,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
  };
}

const anna = person('p1', 'Anna', 'Nowak');
const lukasz = person('p2', 'Łukasz', 'Kowalski');
const ola = person('p3', 'Ola', 'Anders');

describe('mentionQueryAt', () => {
  it('otwiera listę na samym @ na początku tekstu', () => {
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('zwraca zapytanie po @ poprzedzonym spacją', () => {
    expect(mentionQueryAt('Hej @an', 7)).toEqual({ start: 4, end: 7, query: 'an' });
  });

  it('zwraca null, gdy kursor stoi przed znakiem @', () => {
    expect(mentionQueryAt('Hej @an', 4)).toBeNull();
  });

  it('zwraca częściowe zapytanie, gdy kursor jest w środku tokenu', () => {
    expect(mentionQueryAt('Hej @anna', 7)).toEqual({ start: 4, end: 7, query: 'an' });
  });

  it('nie otwiera listy w adresie e-mail', () => {
    expect(mentionQueryAt('mail@firma.pl', 13)).toBeNull();
  });

  it('zwraca null, gdy w drodze wstecz napotkamy spację', () => {
    expect(mentionQueryAt('@Ala kolejne', 12)).toBeNull();
  });

  it('otwiera listę po znaku nowej linii', () => {
    expect(mentionQueryAt('Pierwsza\n@an', 12)).toEqual({ start: 9, end: 12, query: 'an' });
  });

  it('zwraca null dla zapytania dłuższego niż 32 znaki', () => {
    const text = `@${'a'.repeat(33)}`;
    expect(mentionQueryAt(text, 34)).toBeNull();
    expect(mentionQueryAt(`@${'a'.repeat(32)}`, 33)).not.toBeNull();
  });

  it('zwraca null dla kursora poza zakresem tekstu', () => {
    expect(mentionQueryAt('@an', -1)).toBeNull();
    expect(mentionQueryAt('@an', 4)).toBeNull();
  });
});

describe('filterMentionPeople', () => {
  it('dla pustego zapytania zwraca wszystkich w oryginalnej kolejności, z limitem', () => {
    const many = Array.from({ length: 10 }, (_, i) => person(`m${i}`, `Osoba${i}`));
    const out = filterMentionPeople(many, '');
    expect(out).toHaveLength(MAX_MENTION_SUGGESTIONS);
    expect(out.map((p) => p.id)).toEqual(many.slice(0, MAX_MENTION_SUGGESTIONS).map((p) => p.id));
  });

  it('dopasowania po początku imienia są przed dopasowaniami w nazwie, bez duplikatów', () => {
    // 'an' -> prefiks: Anna; zawiera: Ola Anders. Anna nie może się powtórzyć.
    const out = filterMentionPeople([ola, anna, lukasz], 'an');
    expect(out.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('ignoruje wielkość liter i znaki diakrytyczne w obie strony', () => {
    expect(filterMentionPeople([anna, lukasz], 'lu').map((p) => p.id)).toEqual(['p2']);
    expect(filterMentionPeople([anna, person('p4', 'Lukasz')], 'Ł').map((p) => p.id)).toEqual([
      'p4',
    ]);
    expect(filterMentionPeople([anna, lukasz], 'ANN').map((p) => p.id)).toEqual(['p1']);
  });

  it('pomija osoby bez imienia', () => {
    const empty = person('p9', '', 'Bezimienny');
    expect(filterMentionPeople([empty, anna], '')).toEqual([anna]);
    expect(filterMentionPeople([empty, anna], 'bez')).toEqual([]);
  });

  it('zwraca pustą listę, gdy nic nie pasuje', () => {
    expect(filterMentionPeople([anna, lukasz], 'xyz')).toEqual([]);
  });
});

describe('applyMention', () => {
  it('podmienia token na @Imię ze spacją i ustawia kursor na końcu', () => {
    const range = mentionQueryAt('Hej @an', 7)!;
    expect(applyMention('Hej @an', range, anna)).toEqual({ text: 'Hej @Anna ', caret: 10 });
  });

  it('zachowuje tekst po kursorze i stawia kursor przed nim', () => {
    const text = 'Hej @an, co tam?';
    const range = mentionQueryAt(text, 7)!;
    const out = applyMention(text, range, anna);
    expect(out.text).toBe('Hej @Anna , co tam?');
    expect(out.caret).toBe(10);
    expect(out.text.slice(out.caret)).toBe(', co tam?');
  });

  it('wstawiony token jest rozpoznawany przez parseMentions', () => {
    const people = [anna, lukasz, ola];
    const text = 'Hej @łuk';
    const range = mentionQueryAt(text, text.length)!;
    const out = applyMention(text, range, lukasz);
    expect(out.text).toBe('Hej @Łukasz ');
    expect(parseMentions(out.text, people)).toEqual([lukasz.id]);
  });
});
