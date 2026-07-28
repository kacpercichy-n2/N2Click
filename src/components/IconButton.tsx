// Okrągły przycisk z wyłącznie ikoną (SVG). Istnieje po to, by raz na zawsze
// zabić powracający problem źle wycentrowanych glifów tekstowych (× / +): ikona
// jest flex-centrowana w kwadratowym polu i NIGDY nie polega na line-height ani
// baseline czcionki. Etykieta dostępności (`label`) trafia do `aria-label`.
// Wariant `danger` odwzorowuje `.btn.danger-ghost`. Komponent przekazuje ref na
// <button>, żeby wywołujący mógł oddać mu fokus (np. powrót fokusa po zamknięciu
// modala).
//
// Natywnego `title` TU NIE MA: hover-only dymek przeglądarki nie działa na
// dotyku, nie da się go ostylować i dubluje `aria-label` w czytniku ekranu.
// Zastępuje go `Tooltip` (`tooltipShell.ts` decyduje, czy tekst w ogóle coś
// DODAJE do nazwy — wtedy i tylko wtedy dochodzi `aria-describedby`).
//
// Stany niedostępności są celowo MIĘKKIE: zamiast natywnego `disabled` idzie
// `aria-disabled`/`aria-busy`, więc przycisk zostaje w cyklu Tab i użytkownik
// klawiatury/czytnika ekranu może odczytać POWÓD blokady zamiast trafić na
// martwy, niewidoczny dla fokusa element. Kliknięcie jest wtedy pomijane.
import { forwardRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from './Tooltip';

interface Props {
  /** Nazwa dostępna (obowiązkowa — przycisk ikonowy nie ma tekstu). */
  label: string;
  /** Tekst dymka; domyślnie = `label`. `null` = bez dymka. */
  tooltip?: string | null;
  /** Skrót klawiszowy pokazywany w dymku. */
  shortcut?: string;
  onClick: () => void;
  icon: ReactNode;
  variant?: 'default' | 'danger';
  className?: string;
  /** `md` = 32 px (domyślnie), `sm` = 24 px. Pole trafienia zawsze ≥ 44 px. */
  size?: 'sm' | 'md';
  /** Blokada miękka: `aria-disabled`, przycisk zostaje w cyklu Tab. */
  disabled?: boolean;
  /** Polskie zdanie z powodem blokady — zasila dymek i opis dla czytnika. */
  disabledReason?: string;
  /** Operacja w toku: `aria-busy`, kliknięcia pomijane. */
  busy?: boolean;
  /** Przełącznik: `aria-pressed`. */
  pressed?: boolean;
  /** Otwieracz warstwy: `aria-expanded`. */
  expanded?: boolean;
  /** Rodzaj warstwy pod przyciskiem: `aria-haspopup` (menu ⋯, okno dialogowe). */
  haspopup?: 'menu' | 'dialog';
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  {
    label,
    tooltip,
    shortcut,
    onClick,
    icon,
    variant = 'default',
    className,
    size = 'md',
    disabled = false,
    disabledReason,
    busy = false,
    pressed,
    expanded,
    haspopup,
  },
  ref,
): ReactElement {
  const cls = ['icon-btn', variant === 'danger' ? 'danger' : '', className]
    .filter(Boolean)
    .join(' ');
  const blocked = disabled || busy;
  // Powód blokady jest ważniejszy od zwykłej podpowiedzi — to jedyna
  // informacja, której użytkownik NIE ma skąd wziąć z samego wyglądu.
  const text = disabled && disabledReason !== undefined ? disabledReason : (tooltip ?? label);
  const button = (
    <button
      ref={ref}
      type="button"
      className={cls}
      data-size={size}
      onClick={() => {
        if (blocked) return;
        onClick();
      }}
      aria-label={label}
      aria-disabled={blocked ? true : undefined}
      aria-busy={busy ? true : undefined}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={haspopup}
    >
      {icon}
    </button>
  );
  if (tooltip === null || text.trim() === '') return button;
  return (
    <Tooltip text={text} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
});
