// Cienka warstwa DOM-owa powłoki modala. Cała decyzyjność siedzi w czystym
// `modalShell.ts` (testowanym w node); tutaj zostaje tylko `querySelectorAll`,
// `.focus()`, nasłuch klawiatury i styl `document.body`.
//
// Hook obsługuje CZTERY sprawy naraz, bo w każdym modalu były kopiowane osobno:
// wejście fokusa w dialog, pułapkę Tab, powrót fokusa po zamknięciu (dowolną
// drogą — Escape, tło, przycisk, nawigacja) i blokadę scrolla ze wspólnym
// licznikiem. Escape woła `onRequestClose`, więc semantyka zamknięcia (pytanie
// o niezapisane zmiany, `bypassNavGuardOnce`) zostaje po stronie modala.
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  createScrollLockCounter,
  resolveInitialFocusIndex,
  resolveTrapAction,
  scrollbarCompensation,
  shouldCloseOnBackdrop,
  shouldHandleTrapKey,
  tabbableIndexes,
  type FocusCandidate,
} from './modalShell';

/** Kandydaci na fokus w karcie. Filtr widoczności/`disabled` robi warstwa czysta. */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'details > summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** JEDEN licznik na aplikację — nałożone modale zdejmują blokadę dopiero razem. */
const scrollLock = createScrollLockCounter();
/** Oryginalne style `body` zapamiętane przy PIERWSZEJ blokadzie. */
let bodyStyleBeforeLock: { overflow: string; paddingRight: string } | null = null;

function describeCandidate(element: HTMLElement): FocusCandidate {
  const tabindexAttr = element.getAttribute('tabindex');
  const parsed = tabindexAttr === null ? Number.NaN : Number(tabindexAttr);
  return {
    autofocus: element.hasAttribute('data-autofocus'),
    disabled: element.matches(':disabled'),
    tabIndex: Number.isFinite(parsed) ? parsed : undefined,
    // Widoczność mierzymy pudełkiem w layoucie — jak pułapka szuflady w App.tsx,
    // ale BEZ `getComputedStyle`: siatka alokacji TaskModala potrafi mieć setki
    // pól i styl liczony przy każdym Tabie byłby odczuwalny.
    hidden: element.getClientRects().length === 0 || element.getAttribute('aria-hidden') === 'true',
  };
}

function focusCandidates(card: HTMLElement): { elements: HTMLElement[]; described: FocusCandidate[] } {
  const elements = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
  return { elements, described: elements.map(describeCandidate) };
}

function tabbableElements(card: HTMLElement): HTMLElement[] {
  const { elements, described } = focusCandidates(card);
  return tabbableIndexes(described).map((index) => elements[index]);
}

export interface ModalShellOptions {
  /** Każda ścieżka zamknięcia z powłoki (Escape, tło) idzie tędy. */
  onRequestClose: () => void;
  /** `id` widocznego nagłówka karty (`useId()` w modalu). */
  labelledBy: string;
  /** `id` widocznego opisu/podtytułu — pomijane, gdy modal go nie ma. */
  describedBy?: string;
}

export interface ModalShell {
  cardRef: RefObject<HTMLDivElement>;
  cardProps: {
    role: 'dialog';
    'aria-modal': true;
    'aria-labelledby': string;
    'aria-describedby'?: string;
    tabIndex: -1;
  };
  viewportProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
}

export function useModalShell({
  onRequestClose,
  labelledBy,
  describedBy,
}: ModalShellOptions): ModalShell {
  const cardRef = useRef<HTMLDivElement>(null);
  // Nasłuchy rejestrują się RAZ, a bieżące zamknięcie czytają z refa — inaczej
  // każda zmiana `requestClose` przepinałaby listener w trakcie edycji.
  const closeRef = useRef(onRequestClose);
  useEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  // Powrót fokusa. Efekt jest PIERWSZY, żeby zapamiętać element sprzed wejścia
  // fokusa w dialog. Przy `AnimatePresence` odpala się po animacji wyjścia.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Wejście fokusa w dialog. Gdy modal sam ustawił fokus w karcie (efekty
  // dzieci lecą przed efektami rodzica), nie walczymy z nim o pole.
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && card.contains(active)) return;
    const { elements, described } = focusCandidates(card);
    const index = resolveInitialFocusIndex(described);
    if (index === null) card.focus();
    else elements[index].focus();
  }, []);

  // Escape zamyka, Tab krąży w karcie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (!shouldHandleTrapKey(event)) return;
      const card = cardRef.current;
      if (card === null) return;
      const elements = tabbableElements(card);
      const active = document.activeElement;
      const currentIndex = active instanceof HTMLElement ? elements.indexOf(active) : -1;
      const action = resolveTrapAction(currentIndex, elements.length, event.shiftKey);
      if (action.type === 'none') return;
      event.preventDefault();
      if (action.type === 'card') card.focus();
      else elements[action.index].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Blokada scrolla + kompensacja znikającego paska przewijania.
  useEffect(() => {
    if (scrollLock.acquire()) {
      const body = document.body;
      bodyStyleBeforeLock = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const gap = scrollbarCompensation(window.innerWidth, document.documentElement.clientWidth);
      body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }
    return () => {
      if (!scrollLock.release()) return;
      const previous = bodyStyleBeforeLock;
      bodyStyleBeforeLock = null;
      if (previous === null) return;
      document.body.style.overflow = previous.overflow;
      document.body.style.paddingRight = previous.paddingRight;
    };
  }, []);

  // Tło zamyka dopiero, gdy `pointerdown` I `click` trafiły w tło. Dzięki temu
  // zaznaczanie tekstu wyprowadzone z karty na tło nie kasuje edycji.
  const armedRef = useRef(false);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    armedRef.current = event.target === event.currentTarget;
  }, []);
  const onClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const armed = armedRef.current;
    armedRef.current = false;
    if (shouldCloseOnBackdrop(armed, event.target === event.currentTarget)) {
      closeRef.current();
    }
  }, []);

  return {
    cardRef,
    cardProps: {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': labelledBy,
      ...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {}),
      tabIndex: -1,
    },
    viewportProps: { onPointerDown, onClick },
  };
}
