// Czysta logika powłoki popovera/menu kontekstowego: pozycjonowanie (flip +
// shift) względem kotwicy, stos warstw dla Escape, maszyna stanu zamykania
// kliknięciem na zewnątrz oraz nawigacja klawiaturą po pozycjach menu.
// ZERO DOM-u — wejściem są lekkie prostokąty i nazwy zdarzeń, więc całość
// testuje się w środowisku `node` (vitest.config.ts). Cienką warstwę
// (`getBoundingClientRect`, nasłuchy okna, `.focus()`) trzyma `useOverlay.ts`.
//
// Bliźniak `modalShell.ts` / `useModalShell.ts` — ten sam podział ról.

/** Prostokąt kotwicy w koordynatach viewportu. Punkt = prostokąt 0×0. */
export interface OverlayRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Zmierzone pudełko popovera (bez transformacji — `offsetWidth/Height`). */
export interface OverlaySize {
  readonly width: number;
  readonly height: number;
}

/** Widoczny obszar okna (`innerWidth`/`innerHeight`). */
export interface OverlayViewport {
  readonly width: number;
  readonly height: number;
}

/** Preferowana strona kotwicy (wyrównanie zawsze do jej początku). */
export type OverlayPlacement = 'bottom-start' | 'right-start';

/** Strona faktycznie użyta — po ewentualnym odbiciu na przeciwną. */
export type ResolvedOverlayPlacement = OverlayPlacement | 'top-start' | 'left-start';

export interface OverlayPositionOptions {
  /** Domyślnie `bottom-start` (menu kontekstowe: punkt kliknięcia + 0 px). */
  placement?: OverlayPlacement;
  /** Odstęp od kotwicy w px (domyślnie 0). */
  offset?: number;
  /** Margines bezpieczeństwa przy krawędzi okna (domyślnie 8 px). */
  margin?: number;
}

export interface OverlayPosition {
  left: number;
  top: number;
  placement: ResolvedOverlayPlacement;
  /** Wysokość dostępna od `top` do dolnej krawędzi okna minus margines. */
  availableHeight: number;
}

/**
 * Wciśnięcie wartości w zakres. Gdy popover jest WIĘKSZY niż okno, zakres jest
 * pusty (`max < min`) — wtedy przyklejamy go do marginesu początkowego, a o
 * resztę dba `availableHeight` (CSS `max-height`).
 */
function clamp(value: number, min: number, max: number): number {
  if (!(max > min)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Pozycja popovera: najpierw FLIP (odbicie na przeciwną stronę kotwicy, gdy
 * preferowana nie mieści popovera, a przeciwna daje więcej miejsca), potem
 * SHIFT (wciśnięcie w okno pomniejszone o margines) w obu osiach. Zastępuje
 * dawne magiczne clampy `window.innerWidth - 240/280`.
 */
export function resolveOverlayPosition(
  anchor: OverlayRect,
  size: OverlaySize,
  viewport: OverlayViewport,
  opts: OverlayPositionOptions = {},
): OverlayPosition {
  const placement = opts.placement ?? 'bottom-start';
  const offset = opts.offset ?? 0;
  const margin = opts.margin ?? 8;

  let resolved: ResolvedOverlayPlacement = placement;
  let left: number;
  let top: number;

  if (placement === 'bottom-start') {
    const below = anchor.top + anchor.height + offset;
    const spaceBelow = viewport.height - margin - below;
    const spaceAbove = anchor.top - offset - margin;
    if (size.height > spaceBelow && spaceAbove > spaceBelow) {
      resolved = 'top-start';
      top = anchor.top - offset - size.height;
    } else {
      top = below;
    }
    left = anchor.left;
  } else {
    const after = anchor.left + anchor.width + offset;
    const spaceAfter = viewport.width - margin - after;
    const spaceBefore = anchor.left - offset - margin;
    if (size.width > spaceAfter && spaceBefore > spaceAfter) {
      resolved = 'left-start';
      left = anchor.left - offset - size.width;
    } else {
      left = after;
    }
    top = anchor.top;
  }

  left = clamp(left, margin, viewport.width - margin - size.width);
  top = clamp(top, margin, viewport.height - margin - size.height);

  return {
    left,
    top,
    placement: resolved,
    availableHeight: Math.max(0, viewport.height - margin - top),
  };
}

/** Stos otwartych warstw — decyduje, kto konsumuje Escape. */
export interface OverlayStack {
  /** Dokłada `id` na wierzch; ponowne `push` PRZENOSI istniejące na wierzch. */
  push(id: string): void;
  remove(id: string): void;
  /** Tylko wierzchnia warstwa reaguje na Escape. */
  isTop(id: string): boolean;
  count(): number;
}

/**
 * Fabryka stosu. Warstwa DOM-owa trzyma JEDNĄ instancję na aplikację (tak jak
 * `scrollLock` w `useModalShell.ts`), więc Escape zamyka dokładnie jeden
 * popover, a modal pod spodem zostaje otwarty.
 */
export function createOverlayStack(): OverlayStack {
  let ids: string[] = [];
  return {
    push(id) {
      ids = ids.filter((entry) => entry !== id);
      ids.push(id);
    },
    remove(id) {
      ids = ids.filter((entry) => entry !== id);
    },
    isTop(id) {
      return ids.length > 0 && ids[ids.length - 1] === id;
    },
    count() {
      return ids.length;
    },
  };
}

/**
 * Zdarzenie wejściowe maszyny zamykania. Strefę (`inside` / `trigger` /
 * `outside`) wyznacza warstwa DOM-owa przez `contains(target)`.
 * `auxclick` (środkowy/prawy przycisk) liczy się jako `click-*`.
 */
export type OverlayDismissEvent =
  | 'pointerdown-inside'
  | 'pointerdown-trigger'
  | 'pointerdown-outside'
  | 'click-inside'
  | 'click-trigger'
  | 'click-outside'
  | 'contextmenu-outside';

export interface OverlayDismissState {
  /** `pointerdown` padł na zewnątrz i czeka na sparowany `click`. */
  readonly armed: boolean;
}

export function createDismissState(): OverlayDismissState {
  return { armed: false };
}

const ARMED: OverlayDismissState = { armed: true };
const IDLE: OverlayDismissState = { armed: false };

/**
 * Zamykamy TYLKO na parze `pointerdown-outside` → `click-outside`:
 * - ciągnięcie paska przewijania kończy się `click` bez sparowanego
 *   `pointerdown` w treści → popover zostaje otwarty,
 * - zaznaczanie tekstu zaczęte w popoverze i puszczone na zewnątrz nie zamyka,
 * - cokolwiek w popoverze lub na przycisku otwierającym rozbraja parę, więc
 *   własny `onClick` triggera przełącza stan bez wyścigu zamknij-otwórz,
 * - `contextmenu` na zewnątrz zamyka NATYCHMIAST, bo prawy klik nigdy nie daje
 *   `click` (dawne zamykanie na `mousedown` nie może się cofnąć w zawieszone menu).
 */
export function resolveDismissEvent(
  state: OverlayDismissState,
  event: OverlayDismissEvent,
): { close: boolean; next: OverlayDismissState } {
  switch (event) {
    case 'pointerdown-outside':
      return { close: false, next: ARMED };
    case 'pointerdown-inside':
    case 'pointerdown-trigger':
    case 'click-inside':
    case 'click-trigger':
      return { close: false, next: IDLE };
    case 'click-outside':
      return { close: state.armed, next: IDLE };
    case 'contextmenu-outside':
      return { close: true, next: IDLE };
  }
}

/**
 * Ruch fokusa po liście pozycji menu. `currentIndex === -1` (albo poza
 * zakresem) znaczy „fokus jeszcze nie wszedł w listę”: ArrowDown wchodzi na
 * pierwszą pozycję, ArrowUp na ostatnią. `null` = klawisz nie jest nawigacyjny,
 * warstwa DOM-owa nie rusza wtedy zdarzenia.
 */
export function resolveMenuNavKey(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null;
  const inList = currentIndex >= 0 && currentIndex < count;
  switch (key) {
    case 'ArrowDown':
      return inList ? (currentIndex + 1) % count : 0;
    case 'ArrowUp':
      return inList ? (currentIndex - 1 + count) % count : count - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Wyszukiwanie po pierwszych literach (etykiety są polskie, więc porównujemy
 * po `toLocaleLowerCase('pl')`). Skan rusza OD `fromIndex` włącznie i zawija
 * się na koniec listy; warstwa DOM-owa podaje `currentIndex + 1` dla świeżego
 * bufora i `currentIndex` dla dopisywanej litery. `null` = brak trafienia.
 */
export function matchTypeahead(labels: string[], buffer: string, fromIndex: number): number | null {
  const needle = buffer.trim().toLocaleLowerCase('pl');
  if (needle === '' || labels.length === 0) return null;
  const count = labels.length;
  const start = fromIndex < 0 || fromIndex >= count ? 0 : fromIndex;
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (labels[index].trim().toLocaleLowerCase('pl').startsWith(needle)) return index;
  }
  return null;
}
