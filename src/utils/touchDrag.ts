// Bramka „przytrzymaj, żeby przeciągnąć” dla wskaźników dotykowych.
// Celowo czysta i bez Reacta (jak liveSyncGate): sam automat stanu, żeby dało
// się go przetestować jednostkowo bez DOM-u.
//
// Powód: bloki kalendarza, karty zasobnika i paski osi czasu mają
// `touch-action: none`, więc na telefonie KAŻDA próba przewinięcia palcem po
// bloku startowała przeciąganie i przesuwała pracę co 15 minut — cicha utrata
// danych w planie zespołu. Na wskaźniku dotykowym przeciąganie startuje więc
// dopiero po przytrzymaniu w bezruchu; ruch przed czasem = przewijanie strony.
//
// Mysz NIE wchodzi do bramki: `pointerdown` z innym typem wskaźnika zwraca ten
// sam stan, a warstwa Reactowa startuje przeciąganie natychmiast jak dotąd.

/** Czas przytrzymania (ms), po którym gest staje się przeciąganiem. */
export const TOUCH_HOLD_MS = 350;
/** Dopuszczalny dryf palca (px) w trakcie przytrzymania. */
export const TOUCH_HOLD_SLOP_PX = 10;

export type TouchHoldPhase = 'idle' | 'pending' | 'engaged';

export type TouchHoldState = {
  phase: TouchHoldPhase;
  originX: number;
  originY: number;
};

/** Stan spoczynkowy — stała referencja, żeby reset był porównywalny przez `===`. */
export const IDLE_TOUCH_HOLD: TouchHoldState = { phase: 'idle', originX: 0, originY: 0 };

export type TouchHoldEvent =
  | { type: 'pointerdown'; pointerType: string; x: number; y: number }
  | { type: 'pointermove'; x: number; y: number }
  | { type: 'holdElapsed' }
  | { type: 'release' };

/** Czy ten typ wskaźnika wymaga przytrzymania (dotyk i pióro — mysz nie). */
export function needsTouchHold(pointerType: string | undefined): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/** Czy dryf palca przekroczył próg bezruchu (odległość euklidesowa). */
export function exceedsHoldSlop(dx: number, dy: number, slop: number = TOUCH_HOLD_SLOP_PX): boolean {
  return Math.hypot(dx, dy) > slop;
}

/**
 * Reduktor bramki. Jak reduktor sklepu (invariant 6): zdarzenie bez skutku
 * zwraca TĘ SAMĄ referencję stanu, nigdy świeżego obiektu — warstwa Reactowa
 * czyta z tego „czy coś się zmieniło” bez dodatkowego porównywania pól.
 */
export function touchHoldReducer(state: TouchHoldState, event: TouchHoldEvent): TouchHoldState {
  switch (event.type) {
    case 'pointerdown':
      // Mysz (albo brak typu) nigdy nie wchodzi do bramki.
      if (!needsTouchHold(event.pointerType)) return state;
      return { phase: 'pending', originX: event.x, originY: event.y };
    case 'pointermove':
      if (state.phase !== 'pending') return state;
      // Palec ruszył przed czasem → to przewijanie, nie przeciąganie.
      return exceedsHoldSlop(event.x - state.originX, event.y - state.originY)
        ? IDLE_TOUCH_HOLD
        : state;
    case 'holdElapsed':
      // Nośne: timer, który wystrzelił PO przerwaniu przytrzymania, nie może
      // uzbroić przeciągania.
      if (state.phase !== 'pending') return state;
      return { ...state, phase: 'engaged' };
    case 'release':
      return state.phase === 'idle' ? state : IDLE_TOUCH_HOLD;
    default:
      return state;
  }
}
