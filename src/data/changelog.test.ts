// Etykieta zakresu dat wpisu dziennika zmian + licznik nieprzeczytanych paczek
// na przycisku „Changelog" (jedynym wejściu do dziennika na Panelu).
import { describe, expect, it } from 'vitest';
import { changelogRangeLabel, changelogUnreadCount } from './changelog';
import type { ChangelogEntry } from './changelog';

describe('changelogRangeLabel', () => {
  it('pokazuje jedną datę dla tego samego dnia', () => {
    expect(changelogRangeLabel('2026-07-21', '2026-07-21')).toBe('21.07');
  });

  it('skraca zakres w obrębie jednego miesiąca', () => {
    expect(changelogRangeLabel('2026-07-20', '2026-07-21')).toBe('20–21.07');
  });

  it('rozszerza obie strony przy różnych miesiącach', () => {
    expect(changelogRangeLabel('2026-06-28', '2026-07-02')).toBe('28.06–02.07');
  });

  it('dodaje rok przy zakresie na przełomie roku', () => {
    expect(changelogRangeLabel('2025-12-30', '2026-01-02')).toBe('30.12.2025–02.01.2026');
  });

  it('zwraca pusty tekst dla niepoprawnych dat', () => {
    expect(changelogRangeLabel('', '2026-07-21')).toBe('');
    expect(changelogRangeLabel('2026-13-01', '2026-07-21')).toBe('');
  });
});

describe('changelogUnreadCount', () => {
  const entry = (id: string): ChangelogEntry => ({
    id,
    dateFrom: '2026-07-20',
    dateTo: '2026-07-21',
    summary: 'Podsumowanie.',
    items: [],
  });
  // Najnowszy wpis NA GÓRZE, dokładnie jak w CHANGELOG.
  const entries = [entry('c'), entry('b'), entry('a')];

  it('nic nie potwierdzone => wszystkie wpisy nieprzeczytane', () => {
    expect(changelogUnreadCount(entries, undefined)).toBe(3);
  });

  it('potwierdzony NAJNOWSZY wpis => licznik znika', () => {
    expect(changelogUnreadCount(entries, 'c')).toBe(0);
  });

  it('potwierdzony STARSZY wpis => tylko wpisy przed nim', () => {
    expect(changelogUnreadCount(entries, 'b')).toBe(1);
    expect(changelogUnreadCount(entries, 'a')).toBe(2);
  });

  it('id spoza dziennika => wszystko nieprzeczytane', () => {
    expect(changelogUnreadCount(entries, 'usuniety-wpis')).toBe(3);
  });

  it('pusty dziennik => 0', () => {
    expect(changelogUnreadCount([], undefined)).toBe(0);
    expect(changelogUnreadCount([], 'c')).toBe(0);
  });

  it('„oznacz jako przeczytane": seenId = id najnowszego wpisu => 0', () => {
    const latest = entries[0];
    expect(changelogUnreadCount(entries, undefined)).toBeGreaterThan(0);
    expect(changelogUnreadCount(entries, latest.id)).toBe(0);
  });
});
