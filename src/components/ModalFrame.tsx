import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import { resolveTrapAction, shouldHandleTrapKey } from './modalShell';
import { focusInitialIn, tabbableElementsIn } from './useModalShell';

interface ModalFrameProps {
  ariaLabel: string;
  cardClassName?: string;
  children: ReactNode;
  onRequestClose: () => void;
}

// Stos modali: JEDEN globalny nasłuch obsługuje Escape i pułapkę Tab dla
// NAJWYŻSZEGO modala (lekki modal nad edytorem — zdarzenia nie przeciekają do
// spodu). Karta przychodzi przez getter, bo ref montuje się po wpisie na stos.
type ModalStackEntry = { close: () => void; getCard: () => HTMLElement | null };

const modalStack: ModalStackEntry[] = [];
let bodyLockCount = 0;
let bodyOverflowBeforeModal = '';
let rootInertBeforeModal = false;

function onModalKeyDown(event: KeyboardEvent) {
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    top.close();
    return;
  }
  // Pułapka Tab — ta sama decyzja co w useModalShell (wspólne czyste helpery):
  // Tab/Shift+Tab krąży po elementach karty, dialog bez kontrolek trzyma fokus
  // na karcie (tabIndex=-1). Bez tego fokus wypadał na BODY/chrome przeglądarki.
  if (!shouldHandleTrapKey(event)) return;
  const card = top.getCard();
  if (!card) return;
  const elements = tabbableElementsIn(card);
  const active = document.activeElement;
  const currentIndex = active instanceof HTMLElement ? elements.indexOf(active) : -1;
  const action = resolveTrapAction(currentIndex, elements.length, event.shiftKey);
  if (action.type === 'none') return;
  event.preventDefault();
  if (action.type === 'card') card.focus();
  else elements[action.index].focus();
}

function mountModal(entry: ModalStackEntry) {
  if (modalStack.length === 0) window.addEventListener('keydown', onModalKeyDown);
  modalStack.push(entry);

  if (bodyLockCount === 0) {
    const root = document.getElementById('root');
    bodyOverflowBeforeModal = document.body.style.overflow;
    rootInertBeforeModal = root?.inert ?? false;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
  }
  bodyLockCount += 1;
}

function unmountModal(entry: ModalStackEntry) {
  const index = modalStack.lastIndexOf(entry);
  if (index === -1) return;
  modalStack.splice(index, 1);
  if (modalStack.length === 0) window.removeEventListener('keydown', onModalKeyDown);

  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    const root = document.getElementById('root');
    document.body.style.overflow = bodyOverflowBeforeModal;
    if (root) root.inert = rootInertBeforeModal;
  }
}

/**
 * Wspólna, portallowana rama modali aplikacji. Portal odcina overlay od
 * animowanych/transformowanych drzew stron, a jeden stos obsługuje Escape,
 * pułapkę Tab i blokadę scrolla także wtedy, gdy lekki modal otworzy się nad
 * edytorem. Kontrakt fokusa (initial / trap / return) jest ten sam co w
 * `useModalShell` — przez wspólne helpery, nie kopię logiki.
 */
export function ModalFrame({
  ariaLabel,
  cardClassName,
  children,
  onRequestClose,
}: ModalFrameProps) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  const cardRef = useRef<HTMLDivElement>(null);
  const stackEntryRef = useRef<ModalStackEntry>({
    close: () => closeRef.current(),
    getCard: () => cardRef.current,
  });

  // Powrót fokusa: efekt PIERWSZY, żeby zapamiętać element sprzed wejścia
  // fokusa w dialog (jak w useModalShell).
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const entry = stackEntryRef.current;
    mountModal(entry);
    return () => unmountModal(entry);
  }, []);

  // Wejście fokusa: `data-autofocus`, potem pierwszy element cyklu Tab, a przy
  // dialogu bez kontrolek — sama karta. Nie walczymy z fokusem ustawionym
  // wcześniej przez dziecko (efekty dzieci biegną przed efektami rodzica).
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && card.contains(active)) return;
    focusInitialIn(card);
  }, []);

  const cardClasses = cardClassName
    ? `task-modal-card ${cardClassName}`
    : 'task-modal-card';

  return createPortal(
    <>
      {/* Półprzezroczysty scrim — żywy interfejs zostaje widoczny pod spodem
          (decyzja ownera: bez rozmycia i bez podmiany tła na bitmapę). */}
      <m.div
        className="task-modal-scrim"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" onClick={onRequestClose}>
        <m.div
          ref={cardRef}
          className={cardClasses}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </m.div>
      </div>
    </>,
    document.body,
  );
}
