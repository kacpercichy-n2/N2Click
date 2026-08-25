// Wybór motywu rozmowy (skiny, model Messengera: wspólny dla uczestników).
// Panel pod nagłówkiem okna: siatka swatchy z mini-sceną (tło + dwa dymki),
// klik stosuje od razu. Cienki komponent: katalog i zmienne liczy
// `themes/catalog.ts` + `themes/themeVars.ts`.
//
// DECYZJE:
//   * DZIECKO okna rozmowy (nie portal), jak pickery kompozytora — okno ma
//     własną warstwę i `overflow: hidden`; `useOverlay` w wariancie
//     niepozycjonowanym niesie Escape, klik poza i powrót fokusa do przycisku
//     palety w nagłówku.
//   * Siatka to `role="radiogroup"` z `aria-checked` — wybór jest jeden, jak
//     radio. Zaznaczenie niesie obwódka + ikona, nie sam kolor.
//   * Bez „Cofnij": zasada domu to brak toastów (PersistenceBanner.tsx); poprzedni
//     motyw jest jedno kliknięcie dalej w tej samej siatce.
import { useRef, type RefObject } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Check } from '../../components/icons';
import { useOverlay } from '../../components/useOverlay';
import { CHAT_THEMES, type ChatTheme } from '../themes/catalog';
import { themeCssVars } from '../themes/themeVars';

export function ChatThemePicker({
  currentId,
  triggerRef,
  onPick,
  onClose,
}: {
  /** Id aktualnego motywu rozmowy (nieznany => nic nie jest zaznaczone). */
  currentId: string;
  triggerRef: RefObject<HTMLElement>;
  onPick: (theme: ChatTheme) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ open: true, onClose, overlayRef: panelRef, triggerRef });

  return (
    <m.div
      ref={panelRef}
      className="n2chat-themes"
      role="dialog"
      aria-label="Motyw czatu"
      initial={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="n2chat-section">Motyw rozmowy</p>
      <div className="n2chat-themes-grid" role="radiogroup" aria-label="Motywy">
        {CHAT_THEMES.map((theme) => {
          const selected = theme.id === currentId;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`n2chat-theme${selected ? ' is-selected' : ''}`}
              style={themeCssVars(theme)}
              onClick={() => onPick(theme)}
            >
              <span className="n2chat-theme-scene" aria-hidden>
                <span className="n2chat-theme-pattern" />
                <span className="n2chat-theme-mb is-theirs" />
                <span className="n2chat-theme-mb is-mine" />
                {selected && (
                  <span className="n2chat-theme-check">
                    <Check size={12} aria-hidden />
                  </span>
                )}
              </span>
              <span className="n2chat-theme-name">{theme.name}</span>
            </button>
          );
        })}
      </div>
      <p className="n2chat-themes-hint">Motyw widzą wszyscy uczestnicy rozmowy.</p>
    </m.div>
  );
}
