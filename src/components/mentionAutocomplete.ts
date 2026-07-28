// Czysta logika podpowiedzi @wzmianek w polu komentarza: wykrycie tokenu pod
// kursorem, filtrowanie osób i wstawienie wybranej wzmianki. Bez Reacta, żeby
// dało się to testować jednostkowo (środowisko node).
//
// Token jest JEDNOWYRAZOWY i wstawiamy `firstName` — dokładnie tak, jak robią
// to istniejące chipy pod polem oraz `parseMentions` w CommentsPanel.tsx.
import type { Person } from '../types';

/** Zakres tokenu @wzmianki pod kursorem (bez znaku @ w `query`). */
export interface MentionQuery {
  /** Indeks znaku '@' w tekście. */
  start: number;
  /** Pozycja kursora (koniec tokenu, wyłącznie). */
  end: number;
  /** Tekst po '@' do kursora (może być pusty). */
  query: string;
}

/** Ile podpowiedzi pokazujemy naraz. */
export const MAX_MENTION_SUGGESTIONS = 8;

/** Maksymalna długość zapytania — zabezpieczenie przed „uciekającym” tokenem. */
const MAX_QUERY_LENGTH = 32;

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * Zwraca zakres tokenu `@zapytanie` kończącego się na pozycji kursora albo
 * `null`, gdy w tym miejscu podpowiedzi nie powinny się otwierać.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i];
    // Spacja/tab/nowa linia przed znalezieniem '@' => nie jesteśmy w tokenie.
    if (isWhitespace(ch)) return null;
    if (ch !== '@') continue;
    // '@' musi zaczynać wyraz, żeby `mail@domena` nie otwierało listy.
    if (i > 0 && !isWhitespace(text[i - 1])) return null;
    const query = text.slice(i + 1, caret);
    if (query.length > MAX_QUERY_LENGTH) return null;
    return { start: i, end: caret, query };
  }
  return null;
}

/**
 * Bez znaków diakrytycznych i wielkości liter — polskie imiona inaczej się nie
 * szukają. NFD rozkłada ą/ć/ę/ń/ó/ś/ź/ż, ale NIE rozkłada „ł” (U+0142 to
 * osobna litera z kreską, nie znak łączący), więc mapujemy ją osobno — inaczej
 * „lu” nie znalazłoby „Łukasza”.
 */
const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l');

/**
 * Osoby pasujące do zapytania: najpierw dopasowania po początku imienia,
 * potem pozostałe zawierające zapytanie w pełnej nazwie. Kolejność w obrębie
 * grupy jest kolejnością z `people`; wynik przycięty do MAX_MENTION_SUGGESTIONS.
 */
export function filterMentionPeople(people: readonly Person[], query: string): Person[] {
  // Osoby bez imienia pomija też parseMentions — nie da się ich oznaczyć.
  const named = people.filter((p) => p.firstName !== '');
  if (query === '') return named.slice(0, MAX_MENTION_SUGGESTIONS);
  const needle = normalize(query);
  const prefix = named.filter((p) => normalize(p.firstName).startsWith(needle));
  const rest = named.filter((p) => !prefix.includes(p) && normalize(p.name).includes(needle));
  return [...prefix, ...rest].slice(0, MAX_MENTION_SUGGESTIONS);
}

/**
 * Podmienia token `@zapytanie` na `@Imię ` i zwraca nowy tekst wraz z pozycją
 * kursora tuż za wstawioną spacją.
 */
export function applyMention(
  text: string,
  range: MentionQuery,
  person: Person,
): { text: string; caret: number } {
  const token = `@${person.firstName} `;
  return {
    text: text.slice(0, range.start) + token + text.slice(range.end),
    caret: range.start + token.length,
  };
}
