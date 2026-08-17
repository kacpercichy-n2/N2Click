import { describe, expect, it } from 'vitest';
import { normalizeQuery } from './chatDockView';
import {
  EMOJI_CATEGORIES,
  MAX_RECENT_EMOJI,
  emojiLabel,
  filterEmoji,
  insertAtCaret,
  pushRecentEmoji,
} from './chatEmoji';

const ALL = EMOJI_CATEGORIES.flatMap((category) => category.emojis);

/** Zestaw reakcji, który picker MUSI mieć pod ręką (wymóg pakietu). */
const REQUIRED = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
  '🎉',
  '🔥',
  '✅',
  '❌',
  '🚀',
  '👀',
  '💪',
  '🙌',
  '🤔',
  '😅',
  '🤣',
  '😍',
  '🥰',
  '😎',
  '🤯',
  '😴',
  '🤢',
  '☕',
  '🍻',
];

describe('katalog emoji', () => {
  it('ma osiem niepustych kategorii z polskimi etykietami', () => {
    expect(EMOJI_CATEGORIES).toHaveLength(8);
    for (const category of EMOJI_CATEGORIES) {
      expect(category.id).not.toBe('');
      expect(category.label).not.toBe('');
      expect(category.emojis.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('nie powtarza żadnego znaku ani identyfikatora kategorii', () => {
    const chars = ALL.map((emoji) => emoji.char);
    expect(new Set(chars).size).toBe(chars.length);
    const ids = EMOJI_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('liczy około dwustu pozycji', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(180);
  });

  it('każda pozycja ma słowa kluczowe już znormalizowane', () => {
    for (const emoji of ALL) {
      expect(emoji.keywords.length).toBeGreaterThan(0);
      for (const keyword of emoji.keywords) {
        expect(normalizeQuery(keyword)).toBe(keyword);
      }
    }
  });

  it('zawiera standardowy zestaw reakcji', () => {
    const chars = new Set(ALL.map((emoji) => emoji.char));
    for (const char of REQUIRED) expect(chars.has(char)).toBe(true);
  });
});

describe('filterEmoji', () => {
  it('puste zapytanie zwraca wszystkie kategorie', () => {
    const all = filterEmoji('');
    expect(all).toHaveLength(EMOJI_CATEGORIES.length);
    expect(all.flatMap((category) => category.emojis)).toHaveLength(ALL.length);
  });

  it('szuka tak samo z ogonkami i bez', () => {
    const bare = filterEmoji('usmiech');
    const diacritics = filterEmoji('uśmiech');
    expect(bare.flatMap((c) => c.emojis).map((e) => e.char)).toEqual(
      diacritics.flatMap((c) => c.emojis).map((e) => e.char),
    );
    expect(bare.flatMap((c) => c.emojis).length).toBeGreaterThan(0);
  });

  it('ignoruje wielkość liter i spacje na brzegach', () => {
    const chars = filterEmoji('  KAWA ').flatMap((c) => c.emojis).map((e) => e.char);
    expect(chars).toContain('☕');
  });

  it('zwraca tylko kategorie z trafieniami', () => {
    const found = filterEmoji('rakieta');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('obiekty');
    expect(found[0].emojis.map((e) => e.char)).toEqual(['🚀']);
  });

  it('brak trafień daje pustą listę kategorii', () => {
    expect(filterEmoji('zxqwv')).toEqual([]);
  });

  it('nie modyfikuje źródłowego katalogu', () => {
    const before = EMOJI_CATEGORIES[0].emojis.length;
    filterEmoji('kot');
    expect(EMOJI_CATEGORIES[0].emojis.length).toBe(before);
  });
});

describe('emojiLabel', () => {
  it('daje pierwsze słowo kluczowe, a dla obcego znaku zapas', () => {
    expect(emojiLabel('🚀')).toBe('rakieta');
    expect(emojiLabel('🫥')).toBe('emoji');
  });
});

describe('pushRecentEmoji', () => {
  it('dokłada na czoło', () => {
    expect(pushRecentEmoji([], '👍')).toEqual(['👍']);
    expect(pushRecentEmoji(['👍'], '🔥')).toEqual(['🔥', '👍']);
  });

  it('nie duplikuje — przesuwa istniejący na czoło', () => {
    expect(pushRecentEmoji(['🔥', '👍', '🎉'], '👍')).toEqual(['👍', '🔥', '🎉']);
  });

  it('przycina do limitu', () => {
    const many = Array.from({ length: MAX_RECENT_EMOJI }, (_, index) => `x${index}`);
    const next = pushRecentEmoji(many, '👍');
    expect(next).toHaveLength(MAX_RECENT_EMOJI);
    expect(next[0]).toBe('👍');
    expect(next).not.toContain(`x${MAX_RECENT_EMOJI - 1}`);
    expect(pushRecentEmoji(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a']);
  });

  it('pusty znak zwraca kopię listy', () => {
    const list = ['👍'];
    const next = pushRecentEmoji(list, '');
    expect(next).toEqual(list);
    expect(next).not.toBe(list);
  });
});

describe('insertAtCaret', () => {
  it('wstawia na początku', () => {
    expect(insertAtCaret('tekst', 0, 0, '🔥')).toEqual({ value: '🔥tekst', caret: 2 });
  });

  it('wstawia w środku', () => {
    expect(insertAtCaret('ab', 1, 1, '-')).toEqual({ value: 'a-b', caret: 2 });
  });

  it('wstawia na końcu', () => {
    expect(insertAtCaret('ab', 2, 2, '!')).toEqual({ value: 'ab!', caret: 3 });
  });

  it('zastępuje zaznaczenie i radzi sobie z odwróconym', () => {
    expect(insertAtCaret('abcd', 1, 3, 'X')).toEqual({ value: 'aXd', caret: 2 });
    expect(insertAtCaret('abcd', 3, 1, 'X')).toEqual({ value: 'aXd', caret: 2 });
  });

  it('przycina pozycje spoza zakresu i przyjmuje NaN jako koniec', () => {
    expect(insertAtCaret('ab', -5, 99, 'X')).toEqual({ value: 'X', caret: 1 });
    expect(insertAtCaret('ab', Number.NaN, Number.NaN, 'X')).toEqual({ value: 'abX', caret: 3 });
  });
});
