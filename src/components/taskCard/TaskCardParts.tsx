// Karta zadania v2: cienkie elementy prezentacji. Żaden z nich nie trzyma
// stanu zadania. Wartości, handlery i kotwice pól przychodzą z TaskEditor, więc
// zapis, walidacja i auto-zapis zostają tam, gdzie były.
import { forwardRef, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Check, Info, Link2, MessageSquare } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../IconButton';
import { announce } from '../../utils/liveRegion';
import type { HoursTileSummary } from './taskCardModel';
import './task-card.css';

export interface TaskTileProps {
  /** `id` przycisku kafelka (cel powrotu fokusa). */
  id: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  expanded: boolean;
  /** `id` panelu edytora, który kafelek rozwija. */
  controls: string;
  /** Powód blokady edycji (tylko odczyt). `null` = edycja dozwolona. */
  disabledReason: string | null;
  /** `id` ukrytego opisu powodu blokady (jeden na widok). */
  disabledDescId?: string;
  /** Widoczny błąd pola schowanego w zwiniętym edytorze. */
  error?: { id: string; message: string } | null;
  onToggle: () => void;
}

/**
 * Kafelek w trybie odczytu (wzorzec disclosure: `aria-expanded` +
 * `aria-controls`). Wyłączony kafelek jest MIĘKKO wyłączony (`aria-disabled`),
 * zostaje w cyklu Tab i niesie powód w dymku, jak `IconButton`.
 */
export const TaskTile = forwardRef(function TaskTile(
  {
    id,
    icon,
    label,
    value,
    expanded,
    controls,
    disabledReason,
    disabledDescId,
    error = null,
    onToggle,
  }: TaskTileProps,
  ref: Ref<HTMLButtonElement>,
) {
  const disabled = disabledReason !== null;
  const describedBy = [error?.id, disabled ? disabledDescId : undefined]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  return (
    <div className="task-tile" data-invalid={error ? 'true' : undefined}>
      <Tooltip text={disabled ? disabledReason : ''}>
        <button
          ref={ref}
          id={id}
          type="button"
          className="task-tile-button"
          aria-expanded={disabled ? undefined : expanded}
          aria-controls={disabled ? undefined : controls}
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          onClick={() => {
            if (!disabled) onToggle();
          }}
        >
          <span className="task-tile-label">
            <span className="task-tile-icon" aria-hidden>
              {icon}
            </span>
            {label}
          </span>
          <span className="task-tile-value">{value}</span>
        </button>
      </Tooltip>
      {error && (
        <p className="field-error task-tile-error" id={error.id}>
          {error.message}
        </p>
      )}
    </div>
  );
});

/** Pasek kafelka „Godziny": kalendarz (fiolet) + zasobnik (lawenda). */
export function HoursBar({ summary }: { summary: HoursTileSummary }) {
  return (
    <span className="task-hours-bar-row">
      <span className="task-hours-bar" data-over={summary.over ? 'true' : undefined} aria-hidden>
        <span
          className="task-hours-bar-calendar"
          style={{ width: `${(summary.calendarRatio * 100).toFixed(2)}%` }}
        />
        <span
          className="task-hours-bar-bin"
          style={{ width: `${(summary.binRatio * 100).toFixed(2)}%` }}
        />
      </span>
      <span className="task-hours-bar-label" aria-hidden>
        {summary.label}
      </span>
      <span className="sr-only">{summary.spoken}</span>
    </span>
  );
}

/** Ikona pomocy: dłuższy tekst objaśnienia w WSPÓLNYM dymku (bez `title`). */
export function HelpTip({ text, label = 'Wyjaśnienie' }: { text: string; label?: string }) {
  return (
    <Tooltip text={text}>
      <button type="button" className="task-help-tip" aria-label={label}>
        <Info size={16} aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * Kopiowanie linku do pełnego widoku zadania. Wynik idzie wspólnym kanałem
 * ogłoszeń, a ikona na chwilę zmienia się w ✓, żeby było widać skutek.
 */
export function CopyTaskLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    const url = new URL(path, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      announce({ id: 'task-card:copy-link', text: 'Skopiowano link do zadania.', tone: 'polite' });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      announce({
        id: 'task-card:copy-link',
        text: 'Nie udało się skopiować linku. Skopiuj adres z paska przeglądarki.',
        tone: 'assertive',
      });
    }
  };
  return (
    <IconButton
      icon={copied ? <Check size={18} aria-hidden /> : <Link2 size={18} aria-hidden />}
      label={copied ? 'Skopiowano link' : 'Kopiuj link do zadania'}
      onClick={() => {
        void copy();
      }}
    />
  );
}

/** Prawy panel, zanim rozmowa może istnieć (tworzenie, szkic, maska). */
export function TaskConversationEmpty({ text }: { text: string }) {
  return (
    <div className="task-card-conversation-empty">
      <MessageSquare size={28} aria-hidden />
      <p>{text}</p>
    </div>
  );
}
