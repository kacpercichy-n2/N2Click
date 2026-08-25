// Reakcje emoji przy dymku (model Messengera): szybki pasek 7 emoji + „+”
// (pełny picker) oraz pigułki z licznikami pod dymkiem. Cienkie komponenty:
// grupowanie i etykiety liczy `chatState.ts` / `chatWindowView.ts`.
//
// DECYZJE:
//   * Pasek jest DZIECKIEM wiersza wiadomości (nie portalem): okno rozmowy ma
//     własną warstwę i `overflow: hidden`, więc — jak pickery kompozytora —
//     nie potrzebuje ani tokenu z-index, ani pomiaru kotwicy. `useOverlay` w
//     wariancie niepozycjonowanym niesie Escape, klik poza i powrót fokusa.
//   * Pasek to `role="toolbar"` z własnym roving tabindex (strzałki, Home/End):
//     `menuKeyboard` powłoki zakłada `role="menuitem"`, a to nie jest menu.
//   * Pigułka to `button aria-pressed` ze STAŁĄ nazwą (kto i ile); klik to
//     toggle własnej reakcji tym emoji. Wybrane emoji jest dekoracją przy
//     etykiecie, więc siedzi w `aria-hidden`.
//   * Animacje tylko `transform`/`opacity`; `useReducedMotion` gasi ruch.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Plus } from '../../components/icons';
import { useOverlay } from '../../components/useOverlay';
import { CHAT_QUICK_REACTIONS, type ChatReactionGroup } from '../types';
import { emojiLabel } from './chatEmoji';

/** Ile pigułek pokazujemy pod dymkiem (dalsze zlewają się w licznik). */
export const MAX_VISIBLE_REACTION_PILLS = 3;

const SPRING = { type: 'spring', stiffness: 520, damping: 30, mass: 0.6 } as const;

export function ReactionBar({
  quick = CHAT_QUICK_REACTIONS,
  own,
  triggerRef,
  onPick,
  onMore,
  onClose,
}: {
  /** Szybkie emoji (domyślnie 7 Messengera; okno stawia emoji motywu pierwsze). */
  quick?: readonly string[];
  /** Aktualna własna reakcja (podświetlona w pasku); null gdy brak. */
  own: string | null;
  /** Element, który otworzył pasek (jego kliknięcia nie zamykają; powrót fokusa). */
  triggerRef: RefObject<HTMLElement>;
  onPick: (emoji: string) => void;
  /** „+”: pełny picker emoji w trybie „wybierz jedno”. */
  onMore: () => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);

  useOverlay({ open: true, onClose, overlayRef: barRef, triggerRef });

  // Dosunięcie w poziomie: pasek jest kotwiczony do dymka, a dymek bywa przy
  // krawędzi listy — bez tego pasek wychodziłby poza okno (overflow hidden).
  // Jeden odczyt geometrii przed malowaniem, zapis jednej zmiennej CSS.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const list = bar?.closest<HTMLElement>('.n2chat-messages');
    if (!bar || !list) return;
    const barRect = bar.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (barRect.left < listRect.left + margin) shift = listRect.left + margin - barRect.left;
    else if (barRect.right > listRect.right - margin) shift = listRect.right - margin - barRect.right;
    if (shift !== 0) bar.style.setProperty('--bar-shift', `${Math.round(shift)}px`);
  }, []);

  // Fokus wchodzi na pierwszy element paska (długie przytrzymanie na dotyku
  // nie daje fokusa, a klawiatura ma mieć od razu gdzie iść).
  useEffect(() => {
    const first = barRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus({ preventScroll: true });
    // Pasek zakotwiczony nad dymkiem może wypaść poza widoczny obszar listy
    // (długa wiadomość przy górnej krawędzi) — dosuwamy go bez skoku.
    barRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const bar = barRef.current;
    if (bar === null) return;
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button'));
    const index = buttons.findIndex((button) => button === document.activeElement);
    let next = -1;
    if (event.key === 'ArrowRight') next = index < buttons.length - 1 ? index + 1 : 0;
    else if (event.key === 'ArrowLeft') next = index > 0 ? index - 1 : buttons.length - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next === -1) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <m.div
      ref={barRef}
      className="n2chat-react-bar"
      role="toolbar"
      aria-label="Zareaguj emoji"
      onKeyDown={onKeyDown}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85, y: reduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.95, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { ...SPRING, opacity: { duration: 0.12 } }}
    >
      {quick.map((emoji, index) => (
        <button
          key={emoji}
          type="button"
          className={`n2chat-react-quick${own === emoji ? ' is-own' : ''}`}
          aria-label={emojiLabel(emoji)}
          aria-pressed={own === emoji}
          tabIndex={index === 0 ? 0 : -1}
          onClick={() => onPick(emoji)}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
      <button
        type="button"
        className="n2chat-react-quick n2chat-react-more"
        aria-label="Więcej emoji"
        tabIndex={-1}
        onClick={onMore}
      >
        <Plus size={16} aria-hidden />
      </button>
    </m.div>
  );
}

export function ReactionPills({
  groups,
  labelOf,
  onToggle,
}: {
  groups: readonly ChatReactionGroup[];
  /** Pełna etykieta pigułki (`reactionPillLabel`). */
  labelOf: (group: ChatReactionGroup) => string;
  onToggle: (emoji: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  if (groups.length === 0) return null;
  const visible = groups.slice(0, MAX_VISIBLE_REACTION_PILLS);
  const hidden = groups.slice(MAX_VISIBLE_REACTION_PILLS);
  const hiddenCount = hidden.reduce((sum, group) => sum + group.count, 0);
  const hiddenLabel = hidden.map(labelOf).join('; ');

  return (
    <div className="n2chat-reactions">
      <AnimatePresence initial={false}>
        {visible.map((group) => (
          <m.button
            key={group.emoji}
            layout={!reduceMotion}
            type="button"
            className={`n2chat-reaction${group.mine ? ' is-mine' : ''}`}
            aria-label={labelOf(group)}
            aria-pressed={group.mine}
            title={labelOf(group)}
            onClick={() => onToggle(group.emoji)}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.7 }}
            transition={reduceMotion ? { duration: 0 } : { ...SPRING, opacity: { duration: 0.12 } }}
          >
            <span aria-hidden>{group.emoji}</span>
            {group.count > 1 && (
              <span className="n2chat-reaction-count" aria-hidden>
                {group.count}
              </span>
            )}
          </m.button>
        ))}
        {hiddenCount > 0 && (
          <m.span
            key="more"
            layout={!reduceMotion}
            className="n2chat-reaction n2chat-reaction-rest"
            title={hiddenLabel}
            aria-label={`Pozostałe reakcje: ${hiddenLabel}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.12 }}
          >
            +{hiddenCount}
          </m.span>
        )}
      </AnimatePresence>
    </div>
  );
}
