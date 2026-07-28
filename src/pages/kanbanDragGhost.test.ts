// Testy czystej geometrii klona karty Kanban (PKG-20260728-kanban-drag-ghost):
// offset chwytu, pozycja klona dla bieżącego wskaźnika (w tym STABILNOŚĆ —
// punkt startu daje z powrotem prostokąt karty źródłowej), transformacja oraz
// próg kliknięcia myszą, który wpuszcza klon. Czyste — bez Reacta i DOM-u, w
// stylu `kanbanMove.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  GHOST_TILT_DEG,
  exceedsClickSlop,
  ghostGrab,
  ghostPosition,
  ghostTransform,
} from './kanbanDragGhost';

/** Karta w drugiej kolumnie tablicy; szerokość jak realna kolumna Kanbanu. */
const CARD_RECT = { left: 320, top: 180, width: 244 };
/** Chwyt w treści karty, celowo NIE w jej środku. */
const GRAB_POINT = { x: 372, y: 205 };

/** Próg kliknięcia myszą — ta sama wartość co `CLICK_SLOP_PX` w KanbanPage. */
const SLOP = 4;

describe('ghostGrab — offset chwytu', () => {
  it('liczy przesunięcie wskaźnika względem lewego górnego rogu karty', () => {
    expect(ghostGrab(CARD_RECT, GRAB_POINT)).toEqual({ dx: 52, dy: 25, width: 244 });
  });

  it('przenosi ZMIERZONĄ szerokość karty, żeby klon nie zmieniał jej wymiarów', () => {
    expect(ghostGrab({ ...CARD_RECT, width: 197.5 }, GRAB_POINT).width).toBe(197.5);
  });

  it('chwyt w samym rogu daje zerowy offset (klon nie centruje się na kursorze)', () => {
    expect(ghostGrab(CARD_RECT, { x: CARD_RECT.left, y: CARD_RECT.top })).toEqual({
      dx: 0,
      dy: 0,
      width: 244,
    });
  });
});

describe('ghostPosition — pozycja klona', () => {
  const grab = ghostGrab(CARD_RECT, GRAB_POINT);

  it('ten sam punkt co przy podniesieniu daje prostokąt karty źródłowej', () => {
    // Stabilność wejścia: klon pojawia się DOKŁADNIE tam, gdzie leży karta —
    // ścieżka dotykowa rysuje go tak jeszcze przed pierwszym `pointermove`.
    expect(ghostPosition(grab, GRAB_POINT)).toEqual({ left: CARD_RECT.left, top: CARD_RECT.top });
  });

  it('przesuwa klon dokładnie o dryf wskaźnika, zachowując punkt chwytu', () => {
    expect(ghostPosition(grab, { x: GRAB_POINT.x + 130, y: GRAB_POINT.y - 40 })).toEqual({
      left: CARD_RECT.left + 130,
      top: CARD_RECT.top - 40,
    });
  });

  it('jest odwrotnością chwytu dla dowolnego punktu (chwyt zostaje pod palcem)', () => {
    const point = { x: 900, y: 60 };
    const position = ghostPosition(grab, point);
    expect(point.x - position.left).toBe(grab.dx);
    expect(point.y - position.top).toBe(grab.dy);
  });

  it('nie clampuje się do viewportu — klon może wyjechać poza krawędź', () => {
    // Kolumna źródłowa bywa przy lewej krawędzi; obcinanie pozycji zerwałoby
    // punkt chwytu, a klon i tak jest tylko dekoracją (`pointer-events: none`).
    expect(ghostPosition(grab, { x: 10, y: 5 })).toEqual({ left: -42, top: -20 });
  });
});

describe('ghostTransform — transformacja klona', () => {
  it('przesuwa przez translate3d i dokłada przechył PO przesunięciu', () => {
    expect(ghostTransform({ left: 320, top: 180 })).toBe(
      `translate3d(320px, 180px, 0) rotate(${GHOST_TILT_DEG}deg)`,
    );
  });

  it('zaokrągla pozycję do pełnych pikseli (tekst karty nie ma się rozmywać)', () => {
    expect(ghostTransform({ left: 12.4, top: 30.6 })).toBe(
      `translate3d(12px, 31px, 0) rotate(${GHOST_TILT_DEG}deg)`,
    );
  });

  it('nie skaluje klona — wymiary karty zostają 1:1', () => {
    expect(ghostTransform({ left: 0, top: 0 })).not.toContain('scale');
  });
});

// Ta funkcja to JEDYNE wejście do latcha `movedRef` w `KanbanPage`, a latch
// rządzi widocznością klona. Testujemy więc wyłącznie ścieżkę MYSZY: dotyk
// startuje latch wartością `viaHold === true` (`movedRef.current = viaHold` w
// `startDrag`), więc po bramce przytrzymania klon wchodzi natychmiast i nigdy
// nie przechodzi przez ten próg.
describe('exceedsClickSlop — próg kliknięcia myszą wpuszczający klon', () => {
  const origin = GRAB_POINT;

  it('mysz w bezruchu: pod progiem (kliknięcie ma otwierać zadanie)', () => {
    expect(exceedsClickSlop(origin, origin, SLOP)).toBe(false);
  });

  it('mysz z dryfem DOKŁADNIE na progu: wciąż kliknięcie', () => {
    expect(exceedsClickSlop(origin, { x: origin.x + SLOP, y: origin.y }, SLOP)).toBe(false);
  });

  it('mysz POWYŻEJ progu: klon wchodzi', () => {
    const point = { x: origin.x + 3, y: origin.y + 3 }; // hipotenuza ≈ 4,24 px
    expect(exceedsClickSlop(origin, point, SLOP)).toBe(true);
  });

  it('próg jest promieniowy — liczy się odległość, nie sama oś', () => {
    expect(exceedsClickSlop(origin, { x: origin.x - 20, y: origin.y }, SLOP)).toBe(true);
    expect(exceedsClickSlop(origin, { x: origin.x, y: origin.y - 20 }, SLOP)).toBe(true);
  });
});
