// Czysta arytmetyka wcięcia klawiatury ekranowej. ZERO DOM-u — wejściem są
// gołe liczby z `window` i `visualViewport`, więc całość testuje się w
// środowisku `node` (vitest.config.ts). Cienką warstwę nasłuchu (`resize`,
// `scroll`, `focusin`, `style.setProperty`) trzyma hook `useModalShell.ts`.
//
// Na telefonie klawiatura NIE zmienia `window.innerHeight` — zmniejsza tylko
// widoczny obszar `visualViewport`. Różnica tych dwóch wysokości (pomniejszona
// o przesunięcie widoku, gdy przeglądarka sama podjechała do pola) to
// wysokość, o którą karta modala musi się skrócić, żeby lepki pasek zapisu
// został nad klawiaturą.

/**
 * Poniżej tego progu różnica wysokości to drganie chromu przeglądarki
 * (chowający się pasek adresu iOS/Android), a nie klawiatura. Traktujemy je
 * jak zero, bo inaczej karta „oddychałaby" przy każdym przewinięciu.
 */
export const KEYBOARD_INSET_MIN_PX = 80;

/** Pomiary widoku w jednej chwili (podzbiór `window` + `VisualViewport`). */
export interface KeyboardInsetInput {
  /** `window.innerHeight` — wysokość okna układu, niewrażliwa na klawiaturę. */
  innerHeight: number;
  /** `visualViewport.height` — wysokość faktycznie widoczna. */
  viewportHeight: number;
  /** `visualViewport.offsetTop` — o ile przeglądarka podjechała widok w górę. */
  offsetTop: number;
}

/**
 * Wysokość klawiatury w pikselach CSS albo 0, gdy jej nie ma. Wartości ujemne
 * (widok chwilowo wyższy od okna przy odbiciu przewijania) i wartości poniżej
 * progu drgania chromu dają 0. Wynik zaokrąglamy — ułamkowe piksele w zmiennej
 * CSS nic nie wnoszą, a powodują zbędne przeliczenia układu.
 */
export function resolveKeyboardInset(input: KeyboardInsetInput): number {
  const raw = input.innerHeight - input.viewportHeight - input.offsetTop;
  if (!Number.isFinite(raw) || raw < KEYBOARD_INSET_MIN_PX) return 0;
  return Math.round(raw);
}

/**
 * Czy dosunąć aktywne pole do widoku. Tylko przy otwartej klawiaturze i tylko
 * gdy fokus siedzi W KARCIE — nie ruszamy widoku, gdy użytkownik pisze poza
 * modalem (np. w pasku wyszukiwania przeglądarki).
 */
export function shouldScrollFieldIntoView(inset: number, activeInsideCard: boolean): boolean {
  return inset > 0 && activeInsideCard;
}
