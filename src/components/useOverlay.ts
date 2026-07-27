// Cienka warstwa DOM-owa wspólnej powłoki popovera. Cała decyzyjność siedzi w
// czystym `overlayShell.ts` (testowanym w node); tutaj zostają wyłącznie:
// jeden portal na aplikację, pomiary (`getBoundingClientRect`/`offsetWidth`),
// nasłuchy okna i `.focus()`.
//
// Hook obsługuje CZTERY sprawy, kopiowane wcześniej osobno w każdym menu:
// 1. pozycję popovera (flip + shift zamiast magicznych clampów) z
//    przeliczeniem przy scrollu/resize — TYLKO styl, bez remountu, więc
//    sfokusowane pole formularza nie traci fokusa ani karetki,
// 2. stos warstw: Escape zamyka WYŁĄCZNIE wierzchni popover (capture +
//    `stopPropagation`, żeby bąbelkowy Escape `useModalShell` nie zamknął przy
//    okazji modala pod spodem),
// 3. zamykanie kliknięciem na zewnątrz na PARZE `pointerdown`+`click`
//    (ciągnięcie paska przewijania i zaznaczanie tekstu nie zamykają),
// 4. opcjonalną klawiaturę menu (roving tabindex, strzałki, Home/End,
//    wyszukiwanie po literach) i powrót fokusa po zamknięciu.
//
// Nasłuchy wskaźnika/kliknięcia są WYŁĄCZNIE obserwatorami: nigdy nie wołają
// `preventDefault`, `stopPropagation` ani nie przejmują wskaźnika, więc żadna
// ścieżka przeciągania kalendarza (inwariant 7) nie zmienia zachowania.
// Rejestrują się w fazie CAPTURE — wtedy widzą też zdarzenia, które React-owe
// handlery zatrzymują (`e.stopPropagation()` na bloku/karcie zasobnika), a
// zamknięcie starego popovera wypada PRZED otwarciem nowego w tym samym
// zdarzeniu (inaczej „zamknij" nadpisałoby świeże „otwórz").
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, ReactPortal, RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  createDismissState,
  createOverlayStack,
  matchTypeahead,
  resolveDismissEvent,
  resolveMenuNavKey,
  resolveOverlayPosition,
  type OverlayDismissEvent,
  type OverlayPlacement,
  type OverlayPosition,
  type OverlayRect,
} from './overlayShell';

const OVERLAY_ROOT_ID = 'n2hub-overlay-root';
/** JEDEN stos na aplikację — jak `scrollLock` w `useModalShell.ts`. */
const overlayStack = createOverlayStack();
let overlayIdSeq = 0;
/** Bufor wyszukiwania po literach kasuje się po tej przerwie w pisaniu. */
const TYPEAHEAD_RESET_MS = 500;
/** Styl przed pierwszym pomiarem — pomiar leci w `useLayoutEffect`, więc
 *  przeglądarka nigdy nie maluje popovera w tym stanie. */
const UNMEASURED_STYLE: CSSProperties = { left: 0, top: 0, visibility: 'hidden' };

/** Jeden leniwie tworzony korzeń portalu na `document.body`. */
export function getOverlayRoot(): HTMLElement {
  const existing = document.getElementById(OVERLAY_ROOT_ID);
  if (existing !== null) return existing;
  const root = document.createElement('div');
  root.id = OVERLAY_ROOT_ID;
  document.body.appendChild(root);
  return root;
}

/**
 * Portal warstwy nakładek. OWIJA `<AnimatePresence>`, a nie odwrotnie — węzeł
 * portalu żyje dalej po zamknięciu, więc animacja wyjścia dogrywa się do końca.
 */
export function OverlayLayer({ children }: { children: ReactNode }): ReactPortal {
  return createPortal(children, getOverlayRoot());
}

export interface UseOverlayOptions {
  open: boolean;
  /** Każda ścieżka zamknięcia z powłoki (Escape, klik na zewnątrz, znikła kotwica). */
  onClose: () => void;
  /** Pozycjonowany element — mierzony i używany do testu „w środku popovera”. */
  overlayRef: RefObject<HTMLElement>;
  /**
   * Prostokąt kotwicy w koordynatach viewportu; `null` = kotwica wypadła z DOM
   * (hook zamyka popover). POMINIĘCIE wyłącza mierzone pozycjonowanie —
   * FilterPanel kotwiczy popover CSS-em i zostaje w normalnym przepływie.
   */
  getAnchorRect?: () => OverlayRect | null;
  /** Przycisk otwierający (opcjonalny) — jego zdarzenia nie zamykają popovera. */
  triggerRef?: RefObject<HTMLElement>;
  /** Klawiatura listy `role="menuitem"`. Wyłączona w krokach formularzy. */
  menuKeyboard?: boolean;
  placement?: OverlayPlacement;
  offset?: number;
  margin?: number;
  /** Element powrotu fokusa, gdy nie ma `triggerRef` (kotwica menu kontekstowego). */
  getFocusReturn?: () => HTMLElement | null;
}

export interface Overlay {
  /** Styl pozycjonowanego elementu (`left`/`top` + `--overlay-avail`). */
  style: CSSProperties | undefined;
}

/** Pozycje menu w kolejności DOM, bez wyłączonych (te i tak nie biorą fokusa). */
function menuItemsIn(overlay: HTMLElement | null): HTMLElement[] {
  if (overlay === null) return [];
  return Array.from(overlay.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (element) => !element.matches(':disabled'),
  );
}

/** Roving tabindex: dokładnie jedna pozycja w cyklu Tab. */
function applyRovingTabIndex(items: HTMLElement[], activeIndex: number): void {
  items.forEach((element, index) => {
    element.tabIndex = index === activeIndex ? 0 : -1;
  });
}

/** Pole tekstowe/wybór poza popoverem — nie odbieramy mu strzałek ani liter. */
function isTextEntry(element: HTMLElement): boolean {
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

/**
 * Element, który faktycznie dostaje `left/top` — bywa RODZICEM refa: przy
 * `AnimatePresence` ref nie może siedzieć na `motion.div`, więc menu
 * kalendarza trzyma go na wewnętrznym, zwykłym `<div>`. `offsetParent` równy
 * rodzicowi znaczy, że to rodzic jest elementem pozycjonowanym.
 */
function positionedBox(element: HTMLElement): HTMLElement {
  const parent = element.parentElement;
  return parent !== null && element.offsetParent === parent ? parent : element;
}

/**
 * Pudełko popovera. Wysokość bierzemy z NATURALNEJ treści (`scrollHeight` +
 * ramki), bo `--overlay-avail` ogranicza `max-height` — pomiar zależałby wtedy
 * od swojego własnego wyniku i decyzja o odbiciu mogłaby oscylować.
 */
function measureBox(element: HTMLElement): { width: number; height: number } {
  const box = positionedBox(element);
  const frame = box.offsetHeight - box.clientHeight;
  return {
    width: box.offsetWidth,
    height: Math.max(box.offsetHeight, box.scrollHeight + frame),
  };
}

function samePosition(a: OverlayPosition | null, b: OverlayPosition): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.placement === b.placement &&
    a.availableHeight === b.availableHeight
  );
}

export function useOverlay(options: UseOverlayOptions): Overlay {
  const { open, overlayRef, triggerRef, menuKeyboard = false } = options;
  const positioned = options.getAnchorRect !== undefined;

  // Bieżące propsy czytamy przez refy — nasłuchy rejestrują się RAZ na
  // otwarcie i nie przepinają się przy każdej zmianie kroku menu.
  const closeRef = useRef(options.onClose);
  const anchorRectRef = useRef(options.getAnchorRect);
  const posOptsRef = useRef({
    placement: options.placement,
    offset: options.offset,
    margin: options.margin,
  });
  // Ostatnia kotwica ZAPAMIĘTANA W CZASIE OTWARCIA — po zamknięciu `menu` jest
  // już `null`, a fokus ma wrócić na element, z którego menu wyszło.
  const focusTargetRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    closeRef.current = options.onClose;
    anchorRectRef.current = options.getAnchorRect;
    posOptsRef.current = {
      placement: options.placement,
      offset: options.offset,
      margin: options.margin,
    };
    if (open) focusTargetRef.current = options.getFocusReturn?.() ?? null;
  });

  const idRef = useRef('');
  if (idRef.current === '') {
    overlayIdSeq += 1;
    idRef.current = `n2hub-overlay-${overlayIdSeq}`;
  }

  const [position, setPosition] = useState<OverlayPosition | null>(null);

  const measure = useCallback(() => {
    const getAnchorRect = anchorRectRef.current;
    if (getAnchorRect === undefined) return;
    const anchor = getAnchorRect();
    if (anchor === null) {
      closeRef.current();
      return;
    }
    const element = overlayRef.current;
    const size = element === null ? { width: 0, height: 0 } : measureBox(element);
    const next = resolveOverlayPosition(
      anchor,
      size,
      { width: window.innerWidth, height: window.innerHeight },
      posOptsRef.current,
    );
    setPosition((prev) => (samePosition(prev, next) ? prev : next));
  }, [overlayRef]);

  // Pomiar po KAŻDYM renderze przy otwartym popoverze (zmiana kotwicy, kroku
  // albo treści), zawsze przed malowaniem. Stabilny wynik nie ustawia stanu,
  // więc pętla renderów jest niemożliwa.
  useLayoutEffect(() => {
    if (open) measure();
  });

  // Przeliczenie zamiast zamykania: scroll siatki i resize okna przesuwają
  // popover razem z kotwicą. Aktualizacja jest czysto stylowa (ten sam
  // element, te same klucze), więc nic się nie przemontowuje.
  useEffect(() => {
    if (!open || !positioned) return;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open, positioned, measure]);

  // Stos warstw + Escape (capture, `stopPropagation` tylko gdy KONSUMUJEMY) i
  // powrót fokusa przy zamknięciu.
  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    overlayStack.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!overlayStack.isTop(id)) return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      overlayStack.remove(id);
      window.removeEventListener('keydown', onKeyDown, true);
      const active = document.activeElement;
      const inOverlay =
        active instanceof HTMLElement && (overlayRef.current?.contains(active) ?? false);
      // Fokus, który w międzyczasie przeszedł na inny element strony, zostaje
      // tam, gdzie jest — przejmujemy go tylko z popovera albo z `<body>`.
      if (!inOverlay && active !== document.body && active !== null) return;
      const target = triggerRef?.current ?? focusTargetRef.current;
      if (target !== null && target !== undefined && target.isConnected) target.focus();
    };
  }, [open, overlayRef, triggerRef]);

  // Zamykanie kliknięciem na zewnątrz. Nasłuchy wstają JEDNĄ TURĘ po otwarciu,
  // więc otwierająca interakcja nie może zamknąć popovera w tej samej klatce.
  useEffect(() => {
    if (!open) return;
    let state = createDismissState();
    let detach: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      const zoneOf = (target: EventTarget | null): 'inside' | 'trigger' | 'outside' => {
        const node = target instanceof Node ? target : null;
        if (node === null) return 'outside';
        const overlay = overlayRef.current;
        if (overlay !== null && overlay.contains(node)) return 'inside';
        const trigger = triggerRef?.current ?? null;
        if (trigger !== null && trigger.contains(node)) return 'trigger';
        return 'outside';
      };
      const feed = (event: OverlayDismissEvent) => {
        const result = resolveDismissEvent(state, event);
        state = result.next;
        if (result.close) closeRef.current();
      };
      const onPointerDown = (event: PointerEvent) => feed(`pointerdown-${zoneOf(event.target)}`);
      const onClick = (event: MouseEvent) => feed(`click-${zoneOf(event.target)}`);
      const onContextMenu = (event: MouseEvent) => {
        // Prawy klik nigdy nie daje `click`, więc pary nie ma na co czekać.
        if (zoneOf(event.target) === 'outside') feed('contextmenu-outside');
      };
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('auxclick', onClick, true);
      window.addEventListener('contextmenu', onContextMenu, true);
      detach = () => {
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('auxclick', onClick, true);
        window.removeEventListener('contextmenu', onContextMenu, true);
      };
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (detach !== null) detach();
    };
  }, [open, overlayRef, triggerRef]);

  // Roving tabindex utrzymywany po każdym renderze listy pozycji.
  useLayoutEffect(() => {
    if (!open || !menuKeyboard) return;
    const items = menuItemsIn(overlayRef.current);
    if (items.length === 0) return;
    const active = document.activeElement;
    const activeIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;
    applyRovingTabIndex(items, activeIndex >= 0 ? activeIndex : 0);
  });

  // Klawiatura menu. Fokusa NIE kradniemy przy otwarciu (menu otwierane
  // wskaźnikiem zachowuje dzisiejsze wrażenie), więc nasłuch siedzi na oknie.
  useEffect(() => {
    if (!open || !menuKeyboard) return;
    let buffer = '';
    let bufferTimer = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Klawisze składania IME nie mogą trafić do bufora typeahead.
      if (event.isComposing) return;
      const overlay = overlayRef.current;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const inOverlay = active !== null && overlay !== null && overlay.contains(active);
      if (!inOverlay && active !== null && isTextEntry(active)) return;
      const items = menuItemsIn(overlay);
      if (items.length === 0) return;
      const currentIndex = active === null ? -1 : items.indexOf(active);
      const navIndex = resolveMenuNavKey(event.key, currentIndex, items.length);
      if (navIndex !== null) {
        event.preventDefault();
        applyRovingTabIndex(items, navIndex);
        items[navIndex].focus();
        return;
      }
      // Spacja aktywuje sfokusowaną pozycję — nie wchodzi do bufora.
      if (event.key.length !== 1 || event.key === ' ') return;
      const fresh = buffer === '';
      buffer += event.key;
      if (bufferTimer !== 0) window.clearTimeout(bufferTimer);
      bufferTimer = window.setTimeout(() => {
        buffer = '';
        bufferTimer = 0;
      }, TYPEAHEAD_RESET_MS);
      const labels = items.map((element) => element.textContent ?? '');
      const match = matchTypeahead(labels, buffer, fresh ? currentIndex + 1 : currentIndex);
      if (match === null) return;
      event.preventDefault();
      applyRovingTabIndex(items, match);
      items[match].focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (bufferTimer !== 0) window.clearTimeout(bufferTimer);
    };
  }, [open, menuKeyboard, overlayRef]);

  const style = useMemo<CSSProperties | undefined>(() => {
    if (!positioned) return undefined;
    if (position === null) return UNMEASURED_STYLE;
    return {
      left: position.left,
      top: position.top,
      ['--overlay-avail']: `${position.availableHeight}px`,
    } as CSSProperties;
  }, [positioned, position]);

  return { style };
}
