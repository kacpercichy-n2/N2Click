// Picker emoji kompozytora (decyzja D6). Cienki komponent: katalog, filtr i
// arytmetyka wstawiania siedzą w czystym `chatEmoji.ts`.
//
// DECYZJE:
//   * Panel jest DZIECKIEM `.n2chat-composer` wewnątrz okna rozmowy, a nie
//     portalem: okno ma własną warstwę (`--n2-z-chat`) i `overflow: hidden`,
//     więc picker nie potrzebuje ani nowego tokenu z-index, ani pomiaru
//     kotwicy. Stąd `useOverlay` w wariancie NIEPOZYCJONOWANYM (bez
//     `getAnchorRect`) — jak `ChatSearchPopover`.
//   * Panel ZOSTAJE otwarty po wybraniu emoji: ludzie wstawiają kilka z rzędu.
//     Zamyka Escape, klik poza i ponowne kliknięcie wyzwalacza.
//   * Wybór nie kradnie fokusa panelowi na stałe — to okno rozmowy przenosi go
//     do kompozytora i ustawia karetkę, żeby dało się pisać dalej.
import { useMemo, useRef, useState, type RefObject } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Search } from '../../components/icons';
import { useOverlay } from '../../components/useOverlay';
import { emojiLabel, filterEmoji } from './chatEmoji';

export function ChatEmojiPopover({
  label = 'Emoji',
  recent,
  triggerRef,
  onClose,
  onPick,
}: {
  /** Nazwa dialogu dla czytnika ekranu („Emoji" albo „Wybierz reakcję"). */
  label?: string;
  /** Ostatnio użyte znaki (pamięć sesji okna rozmowy). */
  recent: readonly string[];
  triggerRef: RefObject<HTMLElement>;
  onClose: () => void;
  onPick: (char: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  useOverlay({ open: true, onClose, overlayRef: panelRef, triggerRef });

  const categories = useMemo(() => filterEmoji(query), [query]);
  const showRecent = query === '' && recent.length > 0;

  const button = (char: string) => (
    <button
      key={char}
      type="button"
      className="n2chat-emoji"
      aria-label={emojiLabel(char)}
      onClick={() => onPick(char)}
    >
      <span aria-hidden>{char}</span>
    </button>
  );

  return (
    <m.div
      ref={panelRef}
      className="n2chat-inpop"
      role="dialog"
      aria-label={label}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="n2chat-inpop-head">
        <Search size={14} aria-hidden className="n2chat-search-icon" />
        <input
          className="n2chat-search-input"
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Szukaj emoji…"
          aria-label="Szukaj emoji"
        />
      </div>

      <div className="n2chat-inpop-body">
        {showRecent && (
          <section role="group" aria-labelledby="n2chat-emoji-recent">
            <p className="n2chat-section" id="n2chat-emoji-recent">
              Ostatnie
            </p>
            <div className="n2chat-emoji-grid">{recent.map(button)}</div>
          </section>
        )}
        {categories.length === 0 ? (
          <p className="n2chat-empty">Brak emoji dla tego hasła.</p>
        ) : (
          categories.map((category) => (
            <section
              key={category.id}
              role="group"
              aria-labelledby={`n2chat-emoji-${category.id}`}
            >
              <p className="n2chat-section" id={`n2chat-emoji-${category.id}`}>
                {category.label}
              </p>
              <div className="n2chat-emoji-grid">
                {category.emojis.map((emoji) => button(emoji.char))}
              </div>
            </section>
          ))
        )}
      </div>
    </m.div>
  );
}
