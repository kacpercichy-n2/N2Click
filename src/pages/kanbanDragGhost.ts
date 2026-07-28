// Czysta geometria KLONA karty niesionego wskaźnikiem na tablicy Kanban. Bez
// Reacta i bez DOM-u (wzorzec `kanbanBoard.ts` / `kanbanMove.ts`), więc całość
// da się przetestować bez udawania przeglądarki.
//
// Powód istnienia: przeciąganie karty jedzie na Pointer Events, a te — w
// odróżnieniu od porzuconego HTML5 DnD — NIE rysują natywnego drag image.
// Przeglądarka przestała cokolwiek nieść pod kursorem, więc obraz karty w locie
// rysujemy sami: klon w warstwie nakładek + puste gniazdo w kolumnie źródłowej.
//
// Dwie reguły trzymają cały moduł:
// 1. klon nie zmienia POSTRZEGANYCH wymiarów karty (szerokość bierzemy ze
//    zmierzonego prostokąta źródła, żadnego `scale`);
// 2. klon trzyma PUNKT CHWYTU pod wskaźnikiem — miejsce, w którym użytkownik
//    złapał kartę, zostaje pod palcem/kursorem; klon NIE centruje się na nim.

/** Prostokąt karty źródłowej w koordynatach viewportu (`getBoundingClientRect`). */
export interface GhostRect {
  left: number;
  top: number;
  width: number;
}

/** Punkt wskaźnika w koordynatach viewportu (`clientX`/`clientY`). */
export interface GhostPoint {
  x: number;
  y: number;
}

/**
 * Chwyt karty ZMIERZONY raz, na starcie przeciągania: przesunięcie wskaźnika
 * względem lewego górnego rogu karty plus jej szerokość. Wszystko, czego klon
 * potrzebuje do końca gestu — pozycja liczy się już wyłącznie z bieżącego
 * punktu wskaźnika, więc przewinięcie strony w trakcie niczego nie psuje.
 */
export interface GhostGrab {
  dx: number;
  dy: number;
  width: number;
}

/** Lewy górny róg klona w koordynatach viewportu. */
export interface GhostPosition {
  left: number;
  top: number;
}

/** Przechył klona (stopnie) — czysto dekoracyjny sygnał „karta jest w locie”. */
export const GHOST_TILT_DEG = 2;

/** Offset chwytu: gdzie WEWNĄTRZ karty wylądował wskaźnik przy podniesieniu. */
export function ghostGrab(rect: GhostRect, point: GhostPoint): GhostGrab {
  return { dx: point.x - rect.left, dy: point.y - rect.top, width: rect.width };
}

/**
 * Pozycja klona dla bieżącego punktu wskaźnika. Odwrotność `ghostGrab`: ten sam
 * punkt co przy podniesieniu daje DOKŁADNIE prostokąt karty źródłowej, więc
 * klon pojawia się w spoczynkowym miejscu karty i dopiero stamtąd odjeżdża.
 */
export function ghostPosition(grab: GhostGrab, point: GhostPoint): GhostPosition {
  return { left: point.x - grab.dx, top: point.y - grab.dy };
}

/**
 * Transformacja klona. Przesunięcie idzie przez `translate3d` (a nie `left/top`),
 * a pozycja jest zaokrąglana do pełnych pikseli, żeby tekst karty nie rozmywał
 * się na ułamkowych przesunięciach. Przechył dokładamy PO przesunięciu: jest
 * czysto dekoracyjny i nie wchodzi do geometrii upuszczenia (cel kolumny czyta
 * `targetAt()` z punktu wskaźnika, nie z klona).
 */
export function ghostTransform(position: GhostPosition): string {
  const left = Math.round(position.left);
  const top = Math.round(position.top);
  return `translate3d(${left}px, ${top}px, 0) rotate(${GHOST_TILT_DEG}deg)`;
}

/**
 * Czy wskaźnik odjechał od punktu chwytu na tyle, że gest przestaje być
 * kliknięciem otwierającym zadanie. Próg jest promieniowy i wyłączny (`>`).
 *
 * To JEDYNE wejście do latcha `moved` na karcie, a latch rządzi widocznością
 * klona. Dwie ścieżki wchodzą do niego inaczej i dlatego ta funkcja nie zna
 * pojęcia „dotyk”:
 * - mysz startuje latch na `false`, więc klon czeka na ten próg (zwykłe
 *   kliknięcie otwierające zadanie ma ZERO klatek klona);
 * - dotyk startuje latch na `true`, bo przytrzymanie w bramce
 *   (`useTouchDragGate`) jest już deklaracją przeciągania — klon wchodzi
 *   natychmiast po bramce i NIGDY nie przechodzi przez ten próg.
 *
 * Latch jest lepki: raz przekroczony próg nie cofa się, gdy wskaźnik wróci pod
 * niego, więc klon nie mruga przy ruchu tam i z powrotem.
 */
export function exceedsClickSlop(origin: GhostPoint, point: GhostPoint, slop: number): boolean {
  return Math.hypot(point.x - origin.x, point.y - origin.y) > slop;
}
