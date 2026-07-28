// Cienka warstwa DOM-owa powłoki modala. Cała decyzyjność siedzi w czystym
// `modalShell.ts` (testowanym w node); tutaj zostaje tylko `querySelectorAll`,
// `.focus()`, nasłuch klawiatury i styl `document.body`.
//
// Hook obsługuje CZTERY sprawy naraz, bo w każdym modalu były kopiowane osobno:
// wejście fokusa w dialog, pułapkę Tab, powrót fokusa po zamknięciu (dowolną
// drogą — Escape, tło, przycisk, nawigacja) i blokadę scrolla ze wspólnym
// licznikiem. Escape woła `onRequestClose`, więc semantyka zamknięcia (pytanie
// o niezapisane zmiany, `bypassNavGuardOnce`) zostaje po stronie modala.
// Piąta sprawa dochodzi TYLKO na telefonie: wcięcie klawiatury ekranowej z
// `visualViewport` (czysta arytmetyka w `keyboardInset.ts`).
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { MOBILE_NAV_QUERY } from '../utils/useMediaQuery';
import { resolveKeyboardInset, shouldScrollFieldIntoView } from './keyboardInset';
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

/**
 * Elementy w cyklu Tab wewnątrz kontenera, w kolejności DOM. Wystawione, bo tej
 * samej listy potrzebuje pułapka fokusa arkusza/popovera filtrów — powłoka
 * nakładek (`useOverlay`) nie jest modalem, ale jej panel siedzi w PORTALU na
 * końcu `<body>`, więc Tab musi krążyć w nim tak samo jak w karcie modala.
 */
export function tabbableElementsIn(container: HTMLElement): HTMLElement[] {
  const { elements, described } = focusCandidates(container);
  return tabbableIndexes(described).map((index) => elements[index]);
}

/**
 * Wejście fokusa w kontener: pierwsze `data-autofocus`, potem pierwszy element
 * w cyklu Tab, a przy dialogu bez kontrolek — sam kontener (musi mieć
 * `tabIndex={-1}`). Ta sama decyzja (`resolveInitialFocusIndex`), co w modalu.
 */
export function focusInitialIn(container: HTMLElement): void {
  const { elements, described } = focusCandidates(container);
  const index = resolveInitialFocusIndex(described);
  if (index === null) container.focus();
  else elements[index].focus();
}

/**
 * Blokada scrolla tła na WSPÓLNYM liczniku (ten sam moduł, ten sam zapamiętany
 * styl `body`), więc arkusz filtrów otwarty nad modalem nie przywróci
 * przewijania spod niego. `active === false` nie bierze blokady.
 */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
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
  }, [active]);
}

export interface ModalShellOptions {
  /** Każda ścieżka zamknięcia z powłoki (Escape, tło) idzie tędy. */
  onRequestClose: () => void;
  /** `id` widocznego nagłówka karty (`useId()` w modalu). */
  labelledBy: string;
  /** `id` widocznego opisu/podtytułu — pomijane, gdy modal go nie ma. */
  describedBy?: string;
  /** Rola dialogu; `alertdialog` dla pytań wymagających decyzji. Domyślnie `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /**
   * Dialog LEŻY NA INNYM modalu (potwierdzenie nad TaskModalem). Nasłuch
   * klawiatury idzie wtedy w fazie CAPTURE i zatrzymuje propagację Escape/Tab,
   * więc pułapka spod spodu ani nie zamknie swojego modala, ani nie wyrwie
   * fokusa z wierzchniego dialogu. Ten sam mechanizm co stos nakładek w
   * `overlayShell.ts`.
   */
  stacked?: boolean;
  /**
   * Czy klik w tło (para `pointerdown` + `click`) zamyka dialog. Domyślnie
   * `true` — pytania (potwierdzenie, changelog) traktują tło jak anulowanie.
   * Modale z FORMULARZEM przekazują `false`: przypadkowy klik obok karty nie
   * może porzucić edycji, zamknięcie idzie przyciskiem albo Escape.
   */
  closeOnBackdrop?: boolean;
}

export interface ModalShell {
  cardRef: RefObject<HTMLDivElement>;
  cardProps: {
    role: 'dialog' | 'alertdialog';
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
  role = 'dialog',
  stacked = false,
  closeOnBackdrop = true,
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
    focusInitialIn(card);
  }, []);

  // Escape zamyka, Tab krąży w karcie. W trybie `stacked` nasłuch stoi w fazie
  // capture i konsumuje oba klawisze (`stopPropagation`), więc pułapka modala
  // pod spodem nigdy ich nie zobaczy — także przy `action.type === 'none'`,
  // inaczej Tab w środku listy przeskoczyłby do modala rodzica.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (stacked) event.stopPropagation();
        closeRef.current();
        return;
      }
      if (!shouldHandleTrapKey(event)) return;
      const card = cardRef.current;
      if (card === null) return;
      if (stacked) event.stopPropagation();
      const elements = tabbableElementsIn(card);
      const active = document.activeElement;
      const currentIndex = active instanceof HTMLElement ? elements.indexOf(active) : -1;
      const action = resolveTrapAction(currentIndex, elements.length, event.shiftKey);
      if (action.type === 'none') return;
      event.preventDefault();
      if (action.type === 'card') card.focus();
      else elements[action.index].focus();
    };
    window.addEventListener('keydown', onKey, stacked);
    return () => window.removeEventListener('keydown', onKey, stacked);
  }, [stacked]);

  // Blokada scrolla + kompensacja znikającego paska przewijania (wspólny licznik).
  useBodyScrollLock();

  // Wcięcie klawiatury ekranowej — TYLKO telefon. Klawiatura nie zmienia
  // `window.innerHeight`, więc bez tego karta sięgałaby POD nią i lepki pasek
  // zapisu znikał z ekranu (MO-22). Wysokość klawiatury ląduje w zmiennej
  // `--n2-kb-inset` na karcie, którą konsumuje WYŁĄCZNIE reguła w bloku
  // `@media (max-width: 760px)`. Efekt nic nie robi bez `visualViewport`
  // (jsdom/node) ani powyżej breakpointu, więc desktop zostaje bit w bit taki
  // sam. Dokłada wyłącznie nasłuchy: nigdy nie woła `preventDefault` /
  // `stopPropagation` i nigdy nie przenosi fokusa — kontrakt pułapki fokusa,
  // Escape i blokady scrolla zostaje nietknięty.
  useEffect(() => {
    const viewport = window.visualViewport;
    const card = cardRef.current;
    if (!viewport || card === null) return;
    const isMobile = () => window.matchMedia(MOBILE_NAV_QUERY).matches;
    if (!isMobile()) return;

    let inset = 0;
    const applyInset = (next: number) => {
      inset = next;
      if (next === 0) card.style.removeProperty('--n2-kb-inset');
      else card.style.setProperty('--n2-kb-inset', `${next}px`);
    };
    // Dosunięcie pola do widoku robimy `block: 'nearest'` — pole już widoczne
    // zostaje na miejscu, więc karta nie skacze przy każdym zdarzeniu.
    const scrollActiveIntoView = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (!shouldScrollFieldIntoView(inset, card.contains(active))) return;
      active.scrollIntoView({ block: 'nearest' });
    };
    const sync = () => {
      // Obrót ekranu w trakcie otwartego modala potrafi wyprowadzić okno ponad
      // breakpoint — wtedy zdejmujemy wcięcie zamiast je liczyć.
      if (!isMobile()) {
        applyInset(0);
        return;
      }
      applyInset(
        resolveKeyboardInset({
          innerHeight: window.innerHeight,
          viewportHeight: viewport.height,
          offsetTop: viewport.offsetTop,
        }),
      );
      scrollActiveIntoView();
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    // Pole sfokusowane przy JUŻ otwartej klawiaturze nie generuje zdarzenia
    // widoku, więc dosuwamy je osobno.
    card.addEventListener('focusin', scrollActiveIntoView);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      card.removeEventListener('focusin', scrollActiveIntoView);
      card.style.removeProperty('--n2-kb-inset');
    };
  }, []);

  // Tło zamyka dopiero, gdy `pointerdown` I `click` trafiły w tło — a przy
  // `closeOnBackdrop: false` nie zamyka nigdy (modale z formularzem).
  const armedRef = useRef(false);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    armedRef.current = event.target === event.currentTarget;
  }, []);
  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const armed = armedRef.current;
      armedRef.current = false;
      if (shouldCloseOnBackdrop(armed, event.target === event.currentTarget, closeOnBackdrop)) {
        closeRef.current();
      }
    },
    [closeOnBackdrop],
  );

  return {
    cardRef,
    cardProps: {
      role,
      'aria-modal': true,
      'aria-labelledby': labelledBy,
      ...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {}),
      tabIndex: -1,
    },
    viewportProps: { onPointerDown, onClick },
  };
}
