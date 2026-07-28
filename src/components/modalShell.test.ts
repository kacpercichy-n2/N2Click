// Testy czystej powłoki modala. Bez DOM-u i bez Reacta — wejściem są lekkie
// deskryptory elementów oraz gołe wartości logiczne, więc całość działa w
// środowisku `node`.
import { describe, expect, it } from 'vitest';
import {
  createScrollLockCounter,
  isTabbableCandidate,
  resolveInitialFocusIndex,
  resolveTrapAction,
  scrollbarCompensation,
  shouldCloseOnBackdrop,
  shouldHandleTrapKey,
  tabbableIndexes,
  type FocusCandidate,
} from './modalShell';

const plain: FocusCandidate = {};

describe('isTabbableCandidate', () => {
  it('zwykły element wchodzi w cykl Tab', () => {
    expect(isTabbableCandidate(plain)).toBe(true);
    expect(isTabbableCandidate({ tabIndex: 0 })).toBe(true);
  });

  it('wyłączony, ukryty i tabindex="-1" wypadają z cyklu', () => {
    expect(isTabbableCandidate({ disabled: true })).toBe(false);
    expect(isTabbableCandidate({ hidden: true })).toBe(false);
    expect(isTabbableCandidate({ tabIndex: -1 })).toBe(false);
  });

  it('lista indeksów zachowuje kolejność DOM', () => {
    expect(tabbableIndexes([plain, { disabled: true }, { tabIndex: -1 }, plain])).toEqual([0, 3]);
  });
});

describe('resolveInitialFocusIndex', () => {
  it('pusta lista kandydatów każe sfokusować kartę', () => {
    expect(resolveInitialFocusIndex([])).toBeNull();
    expect(resolveInitialFocusIndex([{ disabled: true }, { hidden: true }])).toBeNull();
  });

  it('data-autofocus wygrywa z kolejnością DOM', () => {
    expect(resolveInitialFocusIndex([plain, { autofocus: true }, plain])).toBe(1);
  });

  it('wyłączone pole z data-autofocus ustępuje pierwszemu w cyklu Tab', () => {
    expect(
      resolveInitialFocusIndex([{ autofocus: true, disabled: true }, { disabled: true }, plain]),
    ).toBe(2);
  });

  it('bez znacznika bierzemy pierwszy element w cyklu Tab', () => {
    expect(resolveInitialFocusIndex([{ tabIndex: -1 }, plain, plain])).toBe(1);
  });

  it('data-autofocus na tabindex="-1" nadal działa (fokus programowy)', () => {
    expect(resolveInitialFocusIndex([plain, { autofocus: true, tabIndex: -1 }])).toBe(1);
  });
});

describe('resolveTrapAction', () => {
  it('brak kontrolek trzyma fokus na karcie', () => {
    expect(resolveTrapAction(-1, 0, false)).toEqual({ type: 'card' });
    expect(resolveTrapAction(-1, 0, true)).toEqual({ type: 'card' });
  });

  it('środek listy zostawiamy przeglądarce', () => {
    expect(resolveTrapAction(1, 3, false)).toEqual({ type: 'none' });
    expect(resolveTrapAction(1, 3, true)).toEqual({ type: 'none' });
  });

  it('Tab z ostatniego wraca na pierwszy, Shift+Tab z pierwszego na ostatni', () => {
    expect(resolveTrapAction(2, 3, false)).toEqual({ type: 'focus', index: 0 });
    expect(resolveTrapAction(0, 3, true)).toEqual({ type: 'focus', index: 2 });
  });

  it('jedna kontrolka zawija się w obie strony na siebie samą', () => {
    expect(resolveTrapAction(0, 1, false)).toEqual({ type: 'focus', index: 0 });
    expect(resolveTrapAction(0, 1, true)).toEqual({ type: 'focus', index: 0 });
  });

  it('fokus poza dialogiem jest wciągany z powrotem', () => {
    expect(resolveTrapAction(-1, 3, false)).toEqual({ type: 'focus', index: 0 });
    expect(resolveTrapAction(-1, 3, true)).toEqual({ type: 'focus', index: 2 });
    // Indeks spoza zakresu traktujemy jak fokus poza dialogiem.
    expect(resolveTrapAction(9, 3, false)).toEqual({ type: 'focus', index: 0 });
  });
});

describe('shouldHandleTrapKey', () => {
  it('czysty Tab i Shift+Tab są obsługiwane', () => {
    expect(shouldHandleTrapKey({ key: 'Tab' })).toBe(true);
    expect(shouldHandleTrapKey({ key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('inny klawisz oraz Ctrl/Alt/Meta są ignorowane', () => {
    expect(shouldHandleTrapKey({ key: 'Escape' })).toBe(false);
    expect(shouldHandleTrapKey({ key: 'Tab', ctrlKey: true })).toBe(false);
    expect(shouldHandleTrapKey({ key: 'Tab', altKey: true })).toBe(false);
    expect(shouldHandleTrapKey({ key: 'Tab', metaKey: true })).toBe(false);
  });
});

describe('shouldCloseOnBackdrop', () => {
  it('para pointerdown + click na tle zamyka', () => {
    expect(shouldCloseOnBackdrop(true, true)).toBe(true);
  });

  it('zaznaczanie tekstu wyprowadzone z karty na tło NIE zamyka', () => {
    // pointerdown padł w karcie, click wypadł na tle (wspólny przodek).
    expect(shouldCloseOnBackdrop(false, true)).toBe(false);
  });

  it('click w karcie nie zamyka, nawet gdy pointerdown był na tle', () => {
    expect(shouldCloseOnBackdrop(true, false)).toBe(false);
    expect(shouldCloseOnBackdrop(false, false)).toBe(false);
  });

  it('domyślnie kanał tła jest włączony (pytania: tło = anulowanie)', () => {
    expect(shouldCloseOnBackdrop(true, true, true)).toBe(true);
  });

  it('`enabled: false` (modale z formularzem) ignoruje nawet pełną parę', () => {
    expect(shouldCloseOnBackdrop(true, true, false)).toBe(false);
    expect(shouldCloseOnBackdrop(false, true, false)).toBe(false);
    expect(shouldCloseOnBackdrop(true, false, false)).toBe(false);
  });
});

describe('scrollbarCompensation', () => {
  it('zwraca szerokość paska przewijania', () => {
    expect(scrollbarCompensation(1000, 985)).toBe(15);
  });

  it('nakładkowy pasek (macOS) i wartości nieliczbowe dają zero', () => {
    expect(scrollbarCompensation(1000, 1000)).toBe(0);
    expect(scrollbarCompensation(1000, 1200)).toBe(0);
    expect(scrollbarCompensation(Number.NaN, 100)).toBe(0);
  });
});

describe('createScrollLockCounter', () => {
  it('styl zapisujemy przy pierwszej blokadzie, przywracamy przy ostatniej', () => {
    const counter = createScrollLockCounter();
    expect(counter.acquire()).toBe(true);
    expect(counter.acquire()).toBe(false);
    expect(counter.count()).toBe(2);
    expect(counter.release()).toBe(false);
    expect(counter.release()).toBe(true);
    expect(counter.count()).toBe(0);
  });

  it('niesparowane zwolnienie nie schodzi poniżej zera i nie przywraca stylu drugi raz', () => {
    const counter = createScrollLockCounter();
    expect(counter.release()).toBe(false);
    expect(counter.count()).toBe(0);
    counter.acquire();
    expect(counter.release()).toBe(true);
    expect(counter.release()).toBe(false);
    expect(counter.count()).toBe(0);
  });

  it('każda instancja liczy osobno', () => {
    const a = createScrollLockCounter();
    const b = createScrollLockCounter();
    a.acquire();
    expect(b.count()).toBe(0);
    expect(b.acquire()).toBe(true);
  });
});
