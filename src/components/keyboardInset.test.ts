// Testy czystej arytmetyki wcięcia klawiatury. Bez DOM-u — wejściem są same
// liczby, więc całość działa w środowisku `node`.
import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_INSET_MIN_PX,
  resolveKeyboardInset,
  shouldScrollFieldIntoView,
} from './keyboardInset';

describe('resolveKeyboardInset', () => {
  it('brak klawiatury (widok równy oknu) daje zero', () => {
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 844, offsetTop: 0 })).toBe(0);
  });

  it('drganie paska adresu (40 px) nie jest klawiaturą', () => {
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 804, offsetTop: 0 })).toBe(0);
  });

  it('próg 80 px jest domknięty od góry', () => {
    const below = { innerHeight: 844, viewportHeight: 844 - (KEYBOARD_INSET_MIN_PX - 1), offsetTop: 0 };
    const at = { innerHeight: 844, viewportHeight: 844 - KEYBOARD_INSET_MIN_PX, offsetTop: 0 };
    expect(resolveKeyboardInset(below)).toBe(0);
    expect(resolveKeyboardInset(at)).toBe(KEYBOARD_INSET_MIN_PX);
  });

  it('klawiatura iOS (336 px) daje pełną wysokość', () => {
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 0 })).toBe(336);
  });

  it('podjechany widok (offsetTop) jest odliczany od różnicy', () => {
    // Przeglądarka podniosła widok o 120 px, żeby pokazać pole nad klawiaturą:
    // 844 - 508 - 120 = 216 px zostaje do skrócenia karty.
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 120 })).toBe(216);
  });

  it('offsetTop pochłaniający całą różnicę schodzi poniżej progu', () => {
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 300 })).toBe(0);
  });

  it('ujemna różnica (odbicie przewijania) daje zero', () => {
    expect(resolveKeyboardInset({ innerHeight: 844, viewportHeight: 900, offsetTop: 0 })).toBe(0);
  });

  it('ułamkowe piksele są zaokrąglane', () => {
    expect(resolveKeyboardInset({ innerHeight: 844.5, viewportHeight: 508.1, offsetTop: 0 })).toBe(336);
  });

  it('wartości nieliczbowe dają zero zamiast NaN w zmiennej CSS', () => {
    expect(resolveKeyboardInset({ innerHeight: Number.NaN, viewportHeight: 508, offsetTop: 0 })).toBe(0);
  });
});

describe('shouldScrollFieldIntoView', () => {
  it('dosuwamy tylko przy otwartej klawiaturze i fokusie w karcie', () => {
    expect(shouldScrollFieldIntoView(336, true)).toBe(true);
  });

  it('bez klawiatury albo z fokusem poza kartą nie ruszamy widoku', () => {
    expect(shouldScrollFieldIntoView(336, false)).toBe(false);
    expect(shouldScrollFieldIntoView(0, true)).toBe(false);
    expect(shouldScrollFieldIntoView(0, false)).toBe(false);
  });
});
