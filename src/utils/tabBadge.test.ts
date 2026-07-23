// Testy czystej logiki badge'a karty przeglądarki: etykiety, tytuł, licznik
// ze stanu (własne nieprzeczytane vs cudze/przeczytane) oraz maszyna stanu
// apply/restore na fałszywym hoście (bez DOM — środowisko node).
import { describe, expect, it } from 'vitest';
import {
  createTabBadgeApplier,
  titleWithBadge,
  unreadBadgeLabel,
  unreadNotificationCountFor,
  type TabBadgeHost,
} from './tabBadge';

describe('unreadBadgeLabel', () => {
  it('0 i wartości niepoprawne => brak badge’a', () => {
    expect(unreadBadgeLabel(0)).toBe('');
    expect(unreadBadgeLabel(-3)).toBe('');
    expect(unreadBadgeLabel(Number.NaN)).toBe('');
  });

  it('1–9 => cyfra', () => {
    expect(unreadBadgeLabel(1)).toBe('1');
    expect(unreadBadgeLabel(9)).toBe('9');
  });

  it('powyżej 9 => 9+', () => {
    expect(unreadBadgeLabel(10)).toBe('9+');
    expect(unreadBadgeLabel(99)).toBe('9+');
  });
});

describe('titleWithBadge', () => {
  it('licznik 0 => bazowy tytuł bez zmian', () => {
    expect(titleWithBadge('N2Hub Planer', 0)).toBe('N2Hub Planer');
  });

  it('1–9 => prefiks z liczbą', () => {
    expect(titleWithBadge('N2Hub Planer', 1)).toBe('(1) N2Hub Planer');
    expect(titleWithBadge('N2Hub Planer', 9)).toBe('(9) N2Hub Planer');
  });

  it('powyżej 9 => prefiks 9+', () => {
    expect(titleWithBadge('N2Hub Planer', 10)).toBe('(9+) N2Hub Planer');
    expect(titleWithBadge('N2Hub Planer', 99)).toBe('(9+) N2Hub Planer');
  });
});

describe('unreadNotificationCountFor', () => {
  const rows = [
    { recipientId: 'me', readAt: '' },
    { recipientId: 'me', readAt: '' },
    { recipientId: 'me', readAt: '2026-07-20T10:00:00.000Z' },
    { recipientId: 'other', readAt: '' },
  ];

  it('liczy wyłącznie własne nieprzeczytane (cudze i przeczytane pomija)', () => {
    expect(unreadNotificationCountFor(rows, 'me')).toBe(2);
    expect(unreadNotificationCountFor(rows, 'other')).toBe(1);
  });

  it('brak zalogowanej osoby => 0', () => {
    expect(unreadNotificationCountFor(rows, undefined)).toBe(0);
    expect(unreadNotificationCountFor(rows, null)).toBe(0);
    expect(unreadNotificationCountFor(rows, '')).toBe(0);
  });

  it('pusta kolekcja => 0', () => {
    expect(unreadNotificationCountFor([], 'me')).toBe(0);
  });
});

function fakeHost() {
  const calls: string[] = [];
  let title = 'N2Hub Planer';
  const host: TabBadgeHost = {
    getTitle: () => title,
    setTitle: (t) => {
      title = t;
      calls.push(`title:${t}`);
    },
    applyFavicon: (label) => calls.push(`favicon:${label}`),
    restoreFavicon: () => calls.push('restore'),
  };
  return { host, calls, title: () => title };
}

describe('createTabBadgeApplier', () => {
  it('aktywacja ustawia tytuł z licznikiem i faviconę z etykietą', () => {
    const { host, calls, title } = fakeHost();
    const applier = createTabBadgeApplier(host);
    expect(applier.apply(3)).toBe(true);
    expect(title()).toBe('(3) N2Hub Planer');
    expect(calls).toEqual(['title:(3) N2Hub Planer', 'favicon:3']);
  });

  it('ten sam licznik / ta sama etykieta => zero przerysowań (brak migotania)', () => {
    const { host, calls } = fakeHost();
    const applier = createTabBadgeApplier(host);
    applier.apply(10);
    const afterFirst = calls.length;
    expect(applier.apply(10)).toBe(false);
    expect(applier.apply(11)).toBe(false); // 10 i 11 => wciąż `9+`
    expect(calls.length).toBe(afterFirst);
  });

  it('zmiana licznika nadpisuje prefiks od BAZOWEGO tytułu (bez piętrzenia)', () => {
    const { host, title } = fakeHost();
    const applier = createTabBadgeApplier(host);
    applier.apply(2);
    expect(applier.apply(5)).toBe(true);
    expect(title()).toBe('(5) N2Hub Planer');
  });

  it('licznik 0 przywraca bazowy tytuł i oryginalną faviconę', () => {
    const { host, calls, title } = fakeHost();
    const applier = createTabBadgeApplier(host);
    applier.apply(7);
    expect(applier.apply(0)).toBe(true);
    expect(title()).toBe('N2Hub Planer');
    expect(calls[calls.length - 1]).toBe('restore');
  });

  it('nieaktywny badge: apply(0) i dispose() niczego nie dotykają', () => {
    const { host, calls } = fakeHost();
    const applier = createTabBadgeApplier(host);
    expect(applier.apply(0)).toBe(false);
    applier.dispose();
    expect(calls).toEqual([]);
  });

  it('dispose() po aktywacji przywraca stan wyjściowy (cleanup hooka)', () => {
    const { host, calls, title } = fakeHost();
    const applier = createTabBadgeApplier(host);
    applier.apply(4);
    applier.dispose();
    expect(title()).toBe('N2Hub Planer');
    expect(calls[calls.length - 1]).toBe('restore');
  });

  it('ponowna aktywacja po zeru znów zapamiętuje bieżący bazowy tytuł', () => {
    const { host, calls, title } = fakeHost();
    const applier = createTabBadgeApplier(host);
    applier.apply(1);
    applier.apply(0);
    expect(applier.apply(12)).toBe(true);
    expect(title()).toBe('(9+) N2Hub Planer');
    expect(calls[calls.length - 1]).toBe('favicon:9+');
  });
});
