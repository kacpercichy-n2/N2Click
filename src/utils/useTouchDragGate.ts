// Reactowa obudowa automatu z touchDrag.ts — jedna bramka dla wszystkich
// czterech wejść do przeciągania (blok tygodnia, karta zasobnika, pasek i
// kamień milowy osi czasu).
//
// Kontrakt (invariant 7 — cykl życia wskaźnika jest wrażliwy na stabilność):
// - mysz nie dotyka bramki w ogóle: żadnych timerów, żadnych nasłuchów;
// - dotyk/pióro przejmuje gest: przez `TOUCH_HOLD_MS` obserwujemy okno
//   PASYWNIE, więc prawdziwe przewijanie (dryf > próg albo `pointercancel`,
//   gdy przeglądarka zabierze gest) po prostu przewija stronę;
// - po uzbrojeniu wchodzi blokada przewijania: `touch-action` jest zatrzaskiwane
//   w chwili `touchstart` i nie da się go już zawęzić w locie, ale `touchmove`
//   wciąż można anulować — przytrzymanie wymagało bezruchu, więc przeglądarka
//   nie zaczęła jeszcze panoramować i zdarzenie pozostaje `cancelable`;
// - razem z nią wchodzi blokada natywnego menu kontekstowego, które przeglądarka
//   wystawia po ~500 ms na tym samym przytrzymaniu (patrz blockNativeContextMenu);
// - sprzątanie jest zawsze pełne (timer + wszystkie nasłuchy) — także przy
//   odmontowaniu w środku gestu.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  IDLE_TOUCH_HOLD,
  TOUCH_HOLD_MS,
  needsTouchHold,
  touchHoldReducer,
  type TouchHoldState,
} from './touchDrag';

/** Blokada natywnego przewijania na czas uzbrojonego przeciągania dotykiem. */
function blockTouchScroll(event: TouchEvent): void {
  if (event.cancelable) event.preventDefault();
}

// Natywne przytrzymanie przeglądarki koliduje z naszym: skoro elementy nie mają
// już `touch-action: none`, Android Chrome / iOS Safari wystawiają na TYM SAMYM
// geście własne menu kontekstowe (~500 ms) — a nasz próg to 350 ms, więc menu
// bloku/karty otwierałoby się NA ŻYWYM przeciąganiu. Po uzbrojeniu gest należy
// do nas, więc `contextmenu` jest tłumione w fazie przechwytywania na
// `document`: `stopPropagation` nie dopuszcza go do korzenia Reacta (tam wiszą
// delegowane `onContextMenu`), a `preventDefault` gasi menu systemowe.
// Uwaga: instalowane WYŁĄCZNIE w fazie `engaged` — krótkie dotknięcie, które
// nie uzbroiło przeciągania, zachowuje dotychczasowe menu kontekstowe.
function blockNativeContextMenu(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export interface TouchDragGate {
  /**
   * Zwraca true, gdy bramka przejęła gest (dotyk) i przeciąganie ma NIE
   * startować teraz — `engage()` zostanie wywołane po przytrzymaniu.
   * Dla myszy zwraca false i nie robi nic.
   */
  arm: (pointerType: string, clientX: number, clientY: number, engage: () => void) => boolean;
}

export function useTouchDragGate(): TouchDragGate {
  const stateRef = useRef<TouchHoldState>(IDLE_TOUCH_HOLD);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Zdejmuje nasłuchy okna i (jeśli weszły) blokady uzbrojonego gestu:
  // przewijania oraz natywnego menu kontekstowego.
  const teardownRef = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (teardownRef.current) {
      const teardown = teardownRef.current;
      teardownRef.current = null;
      teardown();
    }
    stateRef.current = touchHoldReducer(stateRef.current, { type: 'release' });
  }, []);

  // Odmontowanie w środku gestu nie może zostawić timera ani nasłuchu okna.
  useEffect(() => release, [release]);

  const arm = useCallback<TouchDragGate['arm']>(
    (pointerType, clientX, clientY, engage) => {
      if (!needsTouchHold(pointerType)) return false;
      // Nowy gest zaczyna od czystego stanu (resztki po poprzednim palcu).
      release();
      stateRef.current = touchHoldReducer(stateRef.current, {
        type: 'pointerdown',
        pointerType,
        x: clientX,
        y: clientY,
      });

      // Blokady na czas UZBROJONEGO gestu: przewijanie + natywne menu.
      let gestureLocked = false;
      const onMove = (event: PointerEvent) => {
        const next = touchHoldReducer(stateRef.current, {
          type: 'pointermove',
          x: event.clientX,
          y: event.clientY,
        });
        if (next === stateRef.current) return; // dryf w granicach bezruchu
        stateRef.current = next;
        if (next.phase === 'idle') release(); // przewijanie wygrało
      };
      const onEnd = () => release();

      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onEnd, { passive: true });
      window.addEventListener('pointercancel', onEnd, { passive: true });
      teardownRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (gestureLocked) {
          document.removeEventListener('touchmove', blockTouchScroll);
          document.removeEventListener('contextmenu', blockNativeContextMenu, true);
          gestureLocked = false;
        }
      };

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const next = touchHoldReducer(stateRef.current, { type: 'holdElapsed' });
        if (next === stateRef.current) return; // przytrzymanie już przerwane
        stateRef.current = next;
        document.addEventListener('touchmove', blockTouchScroll, { passive: false });
        document.addEventListener('contextmenu', blockNativeContextMenu, true);
        gestureLocked = true;
        engage();
      }, TOUCH_HOLD_MS);

      return true;
    },
    [release],
  );

  // Stabilna referencja — bramka bywa czytana z handlerów w zależnościach.
  return useMemo(() => ({ arm }), [arm]);
}
