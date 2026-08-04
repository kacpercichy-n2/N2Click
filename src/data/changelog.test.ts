// Etykieta zakresu dat wpisu dziennika zmian + reguły paska „Nowości" na Panelu:
// czy najnowszy wpis jest jeszcze nieprzeczytany, ile wpisów czeka na liczniku
// przycisku „Zobacz zmiany" i jak brzmi jedyne CTA.
import { describe, expect, it } from 'vitest';
import {
  changelogCtaLabel,
  changelogRangeLabel,
  changelogUnread,
  changelogUnreadCount,
} from './changelog';
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

describe('changelogUnread', () => {
  const entry = (id: string): ChangelogEntry => ({
    id,
    dateFrom: '2026-07-20',
    dateTo: '2026-07-21',
    summary: 'Podsumowanie.',
    items: [],
  });

  it('nic nie potwierdzone => wpis jest nowy', () => {
    expect(changelogUnread(entry('a'), undefined)).toBe(true);
  });

  it('potwierdzony TEN wpis => pasek znika', () => {
    expect(changelogUnread(entry('a'), 'a')).toBe(false);
  });

  it('potwierdzony STARSZY wpis => nowy wpis znów jest nowy', () => {
    expect(changelogUnread(entry('b'), 'a')).toBe(true);
  });

  it('pusty dziennik => nie ma czego pokazywać', () => {
    expect(changelogUnread(undefined, undefined)).toBe(false);
    expect(changelogUnread(undefined, 'a')).toBe(false);
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

describe('changelogCtaLabel', () => {
  const withRange = (dateFrom: string, dateTo: string): ChangelogEntry => ({
    id: 'x',
    dateFrom,
    dateTo,
    summary: '',
    items: [],
  });

  it('jedno CTA z zakresem dat', () => {
    expect(changelogCtaLabel(withRange('2026-07-20', '2026-07-21'))).toBe('Nowości 20–21.07');
  });

  it('pojedynczy dzień', () => {
    expect(changelogCtaLabel(withRange('2026-07-23', '2026-07-23'))).toBe('Nowości 23.07');
  });

  it('niepoprawne daty => samo „Nowości" (nigdy pusty przycisk)', () => {
    expect(changelogCtaLabel(withRange('', ''))).toBe('Nowości');
  });
});
