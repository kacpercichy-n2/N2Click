// Cienki konsument kontraktu pola (`field.ts`). Renderuje DOKŁADNIE dotychczasową
// strukturę (`.field` > `<label htmlFor>` > kontrolka > `.field-hint` >
// `.field-error`), ale spina etykietę, podpowiedź i błąd z kontrolką przez
// `aria-describedby` / `aria-invalid`.
//
// Per-pole błędy CELOWO nie mają `role="alert"` — na modal przypada JEDNO
// ogłaszane podsumowanie (`saveErrorSummary`), inaczej nieudany zapis czytałby
// się jako kilka niezależnych alertów.
import { useId, type ReactNode } from 'react';
import { fieldAria, fieldIds, type FieldAria } from './fieldContract';

/** Propsy, które pole przekazuje kontrolce (rozłożone spreadem). */
export type FieldControlProps = { id: string } & FieldAria;

export interface FieldProps {
  /** ISTNIEJĄCE, stabilne `id` (kotwice fokusa IA-12: `t-title`, `event-date`, …).
   *  `useId()` jest tylko rezerwą dla przyszłych pól bez kotwicy. */
  id?: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  /** Wymuszenie `aria-invalid` bez własnego komunikatu (błąd zakresu). */
  invalid?: boolean;
  /** `id` opisu spoza pola (współdzielony błąd zakresu). */
  describedByExtra?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/** `''`/`false`/`null`/`undefined` to BRAK treści — inaczej puste akapity
 *  `.field-error` psułyby odstępy i wiązanie `aria-describedby`. */
function has(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function Field({
  id,
  label,
  help,
  error,
  invalid,
  describedByExtra,
  className,
  children,
}: FieldProps) {
  const auto = useId();
  const controlId = id ?? auto;
  const ids = fieldIds(controlId);
  const hasHelp = has(help);
  const hasError = has(error);
  const aria = fieldAria(controlId, {
    hasHelp,
    hasError,
    ...(invalid !== undefined ? { invalid } : {}),
    ...(describedByExtra !== undefined ? { extraDescribedBy: describedByExtra } : {}),
  });

  return (
    <div className={className === undefined ? 'field' : `field ${className}`}>
      <label htmlFor={controlId}>{label}</label>
      {children({ id: controlId, ...aria })}
      {hasHelp && (
        <p className="field-hint" id={ids.help}>
          {help}
        </p>
      )}
      {hasError && (
        <p className="field-error" id={ids.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * IA-12 — nieudany zapis MUSI mieć widoczny skutek: fokus + JEDNO przewinięcie
 * na środek pola (`preventScroll` powstrzymuje własne, minimalne przewinięcie
 * fokusa, które schowałoby pole pod sticky paskiem akcji).
 */
export function focusFieldById(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center' });
}
