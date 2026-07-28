// Wspólny wyzwalacz „⋯" + menu drugorzędnych akcji. To POPOVER, nie dialog:
// stoi na powłoce nakładek (`useOverlay` + `OverlayLayer`), a NIE na
// `useModalShell` — dokładnie ta sama konstrukcja, co menu karty Kanban
// (`KanbanPage.tsx`), tyle że wyjęta do jednego komponentu, bo używa jej teraz
// nagłówek TaskModala, panel dyskusji, kolumna osoby w siatce przydziału i
// pełna strona zadania.
//
// Cała decyzyjność (pozycja z flipem, stos Escape, zamknięcie parą
// `pointerdown`+`click`, roving tabindex, strzałki/Home/End/typeahead, powrót
// fokusa na wyzwalacz) siedzi w przetestowanym `overlayShell.ts` — tutaj nie ma
// ANI JEDNEJ własnej reguły a11y, więc nie ma też czego testować osobno.
import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { IconButton } from './IconButton';
import { MoreHorizontal } from './icons';
import { OverlayLayer, useOverlay } from './useOverlay';

export interface OverflowMenuItem {
  id: string;
  /** Etykieta po polsku. */
  label: string;
  /** Menu zamyka się PRZED akcją (fokus wraca na wyzwalacz, potem dzieje się rzecz). */
  onSelect: () => void;
  /** Czerwony tekst — WYŁĄCZNIE dla akcji niszczących. */
  danger?: boolean;
  /** Natywne `disabled`; powłoka pomija taką pozycję w nawigacji klawiaturą. */
  disabled?: boolean;
}

export interface OverflowMenuProps {
  /** Nazwa dostępna wyzwalacza (po polsku). */
  label: string;
  items: OverflowMenuItem[];
  /** Rozmiar `IconButton`; domyślnie `md` (32 px). */
  size?: 'sm' | 'md';
  className?: string;
}

export function OverflowMenu({
  label,
  items,
  size = 'md',
  className,
}: OverflowMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Ref siedzi na WEWNĘTRZNYM, zwykłym `<div>` (wzorzec `positionedBox`):
  // przy `AnimatePresence` nie może stać na `m.div`.
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const getAnchorRect = useCallback(() => {
    const element = triggerRef.current;
    return element === null || !element.isConnected ? null : element.getBoundingClientRect();
  }, []);

  const overlay = useOverlay({
    open,
    onClose: close,
    overlayRef: menuRef,
    getAnchorRect,
    // Strefa wyzwalacza jest wyłączona z zamykania kliknięciem na zewnątrz,
    // więc DRUGIE kliknięcie w „⋯" zamyka menu zamiast otwierać je na nowo.
    triggerRef,
    menuKeyboard: true,
    offset: 4,
  });

  return (
    <>
      <IconButton
        ref={triggerRef}
        className={className}
        size={size}
        label={label}
        icon={<MoreHorizontal size={size === 'sm' ? 14 : 16} aria-hidden />}
        expanded={open}
        haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      />
      <OverlayLayer>
        <AnimatePresence>
          {open && (
            <m.div
              // Ta sama karta, co menu kontekstowe kalendarza/Kanbana; wariant
              // różni się WYŁĄCZNIE miejscem na drabinie `z-index` (menu bywa
              // otwierane w modalu, a portal siedzi na `<body>`).
              className="context-menu overflow-menu"
              style={{ ...overlay.style, transformOrigin: 'top left' }}
              role="menu"
              aria-label={label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div ref={menuRef}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={
                      item.danger === true
                        ? 'context-menu-item danger'
                        : 'context-menu-item'
                    }
                    disabled={item.disabled === true}
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </OverlayLayer>
    </>
  );
}
