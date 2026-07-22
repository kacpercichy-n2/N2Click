import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import {
  mountModalBackdropSnapshot,
  unmountModalBackdropSnapshot,
} from './modalBackdropSnapshot';

interface ModalFrameProps {
  ariaLabel: string;
  cardClassName?: string;
  children: ReactNode;
  onRequestClose: () => void;
}

type ModalStackEntry = () => void;

const modalStack: ModalStackEntry[] = [];
let bodyLockCount = 0;
let bodyOverflowBeforeModal = '';
let rootInertBeforeModal = false;

function onModalKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  modalStack[modalStack.length - 1]?.();
}

function mountModal(close: ModalStackEntry) {
  if (modalStack.length === 0) window.addEventListener('keydown', onModalKeyDown);
  modalStack.push(close);

  if (bodyLockCount === 0) {
    const root = document.getElementById('root');
    bodyOverflowBeforeModal = document.body.style.overflow;
    rootInertBeforeModal = root?.inert ?? false;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
    mountModalBackdropSnapshot();
  }
  bodyLockCount += 1;
}

function unmountModal(close: ModalStackEntry) {
  const index = modalStack.lastIndexOf(close);
  if (index === -1) return;
  modalStack.splice(index, 1);
  if (modalStack.length === 0) window.removeEventListener('keydown', onModalKeyDown);

  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    const root = document.getElementById('root');
    document.body.style.overflow = bodyOverflowBeforeModal;
    if (root) root.inert = rootInertBeforeModal;
    unmountModalBackdropSnapshot();
  }
}

/**
 * Wspólna, portallowana rama modali aplikacji. Portal odcina overlay od
 * animowanych/transformowanych drzew stron, a jeden stos obsługuje Escape i
 * blokadę scrolla także wtedy, gdy lekki modal otworzy się nad edytorem.
 */
export function ModalFrame({
  ariaLabel,
  cardClassName,
  children,
  onRequestClose,
}: ModalFrameProps) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  const stackEntryRef = useRef<ModalStackEntry>(() => closeRef.current());

  useEffect(() => {
    const entry = stackEntryRef.current;
    mountModal(entry);
    return () => unmountModal(entry);
  }, []);

  const cardClasses = cardClassName
    ? `task-modal-card ${cardClassName}`
    : 'task-modal-card';

  return createPortal(
    <div className="task-modal-viewport" onClick={onRequestClose}>
      <motion.div
        className={cardClasses}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}
