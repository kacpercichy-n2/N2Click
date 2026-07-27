// Cienka warstwa DOM-owa dymka podpowiedzi. Cała decyzyjność (zwłoka grupowa,
// reakcja na zdarzenie, kontrakt `aria-describedby`) siedzi w czystym
// `tooltipShell.ts` testowanym w node; tutaj zostają wyłącznie: klonowanie
// dziecka, portal, pomiar i nasłuchy okna.
//
// Świadome decyzje:
// 1. ŻADNEGO opakowania wokół dziecka — `cloneElement` dokłada obserwatorów i
//    ref do istniejącego elementu, więc układ strony jest bajt w bajt ten sam
//    (dymek nie może przestawić flexa ani siatki).
// 2. Nasłuchy są WYŁĄCZNIE obserwatorami: nigdy `preventDefault`,
//    `stopPropagation` ani przejęcia wskaźnika — ta sama doktryna co
//    `useOverlay.ts`, żeby nie ruszyć cyklu życia wskaźnika kalendarza
//    (inwariant 7). Escape chowa dymek, ale NIE konsumuje klawisza, więc stos
//    nakładek i modali reaguje tak jak dotąd.
// 3. Karta dymka jest `aria-hidden`; opis dla czytnika ekranu żyje w ZAWSZE
//    zamontowanym, wizualnie ukrytym `<span id>` W PORTALU. Dzięki temu opis
//    działa też przy zamkniętym dymku, a rodzeństwo DOM-owe wyzwalacza nigdy
//    się nie zmienia. Opis podpinamy tylko wtedy, gdy `tooltipDescribes` mówi,
//    że tekst NAPRAWDĘ dodaje coś do nazwy dostępnej.
// 4. Dymek jest efemeryczny: scroll i zmiana rozmiaru okna go CHOWAJĄ (żadnej
//    pętli repozycjonowania), a dotyk nigdy go nie pokazuje.
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  Attributes,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  Ref,
} from 'react';
import { resolveOverlayPosition } from './overlayShell';
import type { OverlayPosition } from './overlayShell';
import { OverlayLayer } from './useOverlay';
import {
  buildTooltipText,
  createTooltipGroup,
  mergeDescribedBy,
  noteHide,
  noteShow,
  resolveTooltipTrigger,
  tooltipDescribes,
} from './tooltipShell';
import type { TooltipTriggerEvent } from './tooltipShell';

/** JEDNA grupa na aplikację — jak stos nakładek w `useOverlay.ts`. */
const group = createTooltipGroup();

/** Styl przed pierwszym pomiarem; pomiar leci w `useLayoutEffect`, więc
 *  przeglądarka nigdy nie maluje dymka w tym miejscu. */
const UNMEASURED_STYLE: CSSProperties = { left: 0, top: 0, visibility: 'hidden' };

type AnyProps = Record<string, unknown>;

function callChildHandler(handler: unknown, event: unknown): void {
  if (typeof handler === 'function') (handler as (arg: unknown) => void)(event);
}

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref !== null && ref !== undefined) (ref as { current: HTMLElement | null }).current = node;
}

/** Nazwa dostępna wyzwalacza — z `aria-label`, a gdy go nie ma, z tekstu. */
function accessibleNameOf(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null) return label;
  return element.textContent ?? '';
}

/** Czy fokus przyszedł z klawiatury? `:focus-visible` bywa nieobsługiwane. */
function isFocusVisible(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
}

export interface TooltipProps {
  /** Treść dymka (po polsku). Pusty tekst = brak dymka. */
  text: string;
  /** Skrót klawiszowy pokazywany jako `<kbd>`, dopisywany słownie do opisu. */
  shortcut?: string;
  /**
   * Wymuszenie dymka CZYSTO WIZUALNEGO (bez `aria-describedby`) — dla ozdób
   * nieinteraktywnych, gdzie opis i tak nie jest ogłaszany, a zawsze
   * zamontowany portal kosztowałby przy setkach powtórzeń (np. plakietki osób
   * na listach).
   */
  visualOnly?: boolean;
  /** DOKŁADNIE jeden element przyjmujący `ref` (np. `<button>`, `<a>`, `<span>`). */
  children: ReactElement;
}

export function Tooltip({ text, shortcut, visualOnly = false, children }: TooltipProps): ReactElement {
  const description = buildTooltipText(text, shortcut);
  const reactId = useId();
  const descriptionId = `tooltip-${reactId}`;
  const anchorRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef(0);
  const shownRef = useRef(false);
  const [shown, setShown] = useState(false);
  const [position, setPosition] = useState<OverlayPosition | null>(null);
  // Nazwę dostępną znamy dopiero z DOM-u (dziecko bywa złożone), więc decyzja o
  // opisie dogrywa się po zamontowaniu. To zmiana atrybutu, nie układu.
  const [describes, setDescribes] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    if (!shownRef.current) return;
    shownRef.current = false;
    noteHide(group, Date.now());
    setShown(false);
    setPosition(null);
  }, [clearTimer]);

  const show = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    noteShow(group, Date.now());
    setShown(true);
  }, []);

  const feed = useCallback(
    (event: TooltipTriggerEvent) => {
      if (description === '') return;
      const action = resolveTooltipTrigger(event, group, Date.now());
      if (action.kind === 'hide') {
        hide();
        return;
      }
      if (action.kind !== 'show') return;
      clearTimer();
      if (action.delayMs === 0) {
        show();
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        show();
      }, action.delayMs);
    },
    [clearTimer, description, hide, show],
  );

  useEffect(() => () => {
    clearTimer();
    if (shownRef.current) {
      shownRef.current = false;
      noteHide(group, Date.now());
    }
  }, [clearTimer]);

  useLayoutEffect(() => {
    const element = anchorRef.current;
    if (element === null || visualOnly) {
      setDescribes(false);
      return;
    }
    setDescribes(description !== '' && tooltipDescribes(accessibleNameOf(element), description));
  }, [description, visualOnly]);

  // Pomiar po pokazaniu: kotwica z DOM-u, karta zmierzona, reszta z czystego
  // `resolveOverlayPosition` (flip + shift przy krawędziach okna).
  useLayoutEffect(() => {
    if (!shown) return;
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (anchor === null || card === null) return;
    const rect = anchor.getBoundingClientRect();
    const next = resolveOverlayPosition(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { placement: 'bottom-start', offset: 6 },
    );
    setPosition((prev) =>
      prev !== null && prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [shown]);

  // Dymek jest efemeryczny: scroll (capture, bo kontener też się przewija) i
  // zmiana rozmiaru okna go chowają. Escape także — BEZ `stopPropagation`.
  useEffect(() => {
    if (!shown) return;
    const onScroll = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [shown, hide]);

  const childRef = (children as ReactElement & { ref?: Ref<HTMLElement> }).ref;
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node;
      assignRef(childRef, node);
    },
    [childRef],
  );

  const childProps = children.props as AnyProps;
  const cloned = cloneElement(children, {
    ref: setRef,
    onPointerEnter: (event: ReactPointerEvent) => {
      callChildHandler(childProps.onPointerEnter, event);
      feed({ type: 'pointerenter', pointerType: event.pointerType });
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      callChildHandler(childProps.onPointerLeave, event);
      feed({ type: 'pointerleave' });
    },
    onPointerDown: (event: ReactPointerEvent) => {
      callChildHandler(childProps.onPointerDown, event);
      feed({ type: 'pointerdown' });
    },
    onFocus: (event: ReactFocusEvent) => {
      callChildHandler(childProps.onFocus, event);
      feed({ type: 'focus', focusVisible: isFocusVisible(event.target) });
    },
    onBlur: (event: ReactFocusEvent) => {
      callChildHandler(childProps.onBlur, event);
      feed({ type: 'blur' });
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      callChildHandler(childProps.onKeyDown, event);
      feed({ type: 'keydown', key: event.key });
    },
    'aria-describedby': describes
      ? mergeDescribedBy(childProps['aria-describedby'] as string | undefined, descriptionId)
      : (childProps['aria-describedby'] as string | undefined),
  } as AnyProps & Attributes);

  const portal = describes || shown;

  return (
    <>
      {cloned}
      {portal ? (
        <OverlayLayer>
          {describes ? (
            <span id={descriptionId} className="sr-only">
              {description}
            </span>
          ) : null}
          {shown ? (
            <div
              ref={cardRef}
              className="tooltip"
              aria-hidden="true"
              style={position === null ? UNMEASURED_STYLE : { left: position.left, top: position.top }}
            >
              <span className="tooltip-text">{text}</span>
              {shortcut !== undefined && shortcut.trim() !== '' ? (
                <kbd className="tooltip-kbd">{shortcut}</kbd>
              ) : null}
            </div>
          ) : null}
        </OverlayLayer>
      ) : null}
    </>
  );
}

export interface DisabledHintProps {
  /** Powód blokady (po polsku) albo `null`, gdy kontrolka jest sprawna. */
  reason: string | null;
  /** Stabilne `id` ukrytego opisu — kontrolka wskazuje je `aria-describedby`. */
  id: string;
  /** NATYWNIE wyłączona kontrolka (jeden element). */
  children: ReactElement;
}

/**
 * Powód blokady dla kontrolki wyłączonej NATYWNIE (`disabled`). Taki element
 * POŁYKA zdarzenia wskaźnika, więc dymek musi wisieć na minimalnym opakowaniu
 * (`.tooltip-holder`, `display: inline-flex` — układ zostaje bez zmian).
 * Opis dla czytnika ekranu idzie osobnym ukrytym `<span>`, bo `aria-describedby`
 * na nieinteraktywnym opakowaniu nie zostałby ogłoszony.
 *
 * Gdy `reason === null`, komponent renderuje samo dziecko — zero opakowań.
 */
export function DisabledHint({ reason, id, children }: DisabledHintProps): ReactElement {
  if (reason === null) return children;
  const child = cloneElement(children, {
    'aria-describedby': mergeDescribedBy(
      (children.props as AnyProps)['aria-describedby'] as string | undefined,
      id,
    ),
  } as AnyProps & Attributes);
  return (
    <>
      <span id={id} className="sr-only">
        {reason}
      </span>
      <Tooltip text={reason} visualOnly>
        <span className="tooltip-holder">{child}</span>
      </Tooltip>
    </>
  );
}
