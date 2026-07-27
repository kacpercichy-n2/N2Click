// Kontrakt pola formularza — CZYSTA warstwa wiązania (`aria-describedby` /
// `aria-invalid`, pierwsze złe pole, jedno liczone podsumowanie błędów zapisu).
//
// Vitest chodzi w środowisku `node` i zbiera tylko `src/**/*.test.ts`, więc
// renderowania komponentów nie da się testować. Cała logika, którą warto pokryć
// testem, mieszka DLATEGO tutaj, a `Field.tsx` jest jej cienkim konsumentem.
import { polishCount } from '../utils/polishPlural';

/** Identyfikatory opisów pola. DETERMINISTYCZNE — dzięki temu błąd zakresu
 *  (np. okres zadania) może być wskazany przez DWA pola jednym `id`. */
export interface FieldIds {
  help: string;
  error: string;
}

export function fieldIds(controlId: string): FieldIds {
  return { help: `${controlId}-help`, error: `${controlId}-error` };
}

/** Atrybuty dostępności kontrolki. Klucz jest POMIJANY, gdy nie ma czego opisać
 *  (żaden `aria-describedby=""` ani `aria-invalid="false"` nie ląduje w DOM). */
export interface FieldAria {
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldAriaOptions {
  hasHelp: boolean;
  hasError: boolean;
  /** Wymuszenie `aria-invalid` bez własnego komunikatu (błąd zakresu opisuje
   *  DWA pola). Domyślnie równe `hasError`. */
  invalid?: boolean;
  /** Dodatkowe `id` opisu (jedno lub kilka rozdzielonych spacją). */
  extraDescribedBy?: string;
}

/**
 * Kolejność `aria-describedby`: najpierw błąd (czytnik ma powiedzieć, co jest
 * nie tak, przed podpowiedzią), potem podpowiedź, potem dodatkowe `id`.
 * Duplikaty są usuwane, bo współdzielony błąd zakresu bywa podany zarówno jako
 * `extraDescribedBy`, jak i własny błąd pola.
 */
export function fieldAria(controlId: string, opts: FieldAriaOptions): FieldAria {
  const ids = fieldIds(controlId);
  const parts: string[] = [];
  if (opts.hasError) parts.push(ids.error);
  if (opts.hasHelp) parts.push(ids.help);
  if (opts.extraDescribedBy !== undefined) {
    for (const token of opts.extraDescribedBy.split(/\s+/)) {
      if (token !== '') parts.push(token);
    }
  }
  const describedBy = [...new Set(parts)].join(' ');
  const aria: FieldAria = {};
  if (describedBy !== '') aria['aria-describedby'] = describedBy;
  if (opts.invalid ?? opts.hasError) aria['aria-invalid'] = true;
  return aria;
}

/**
 * Pierwsze pole z błędem w KOLEJNOŚCI FORMULARZA — nieudany zapis skacze
 * dokładnie tam. `null` = formularz jest czysty.
 */
export function firstInvalidKey<K extends string>(
  order: readonly K[],
  errors: Partial<Record<K, unknown>>,
): K | null {
  for (const key of order) {
    if (errors[key] !== undefined) return key;
  }
  return null;
}

/**
 * JEDNO liczone podsumowanie błędów zapisu na modal:
 * „Nie można zapisać zadania — popraw 2 pola: Tytuł, Okres.”
 * Bez etykiet zostaje samo zdanie („Nie można zapisać zadania.”), np. gdy
 * przyczyna nie ma pola (blokada `other`).
 */
export function saveErrorSummary(prefix: string, fieldLabels: string[]): string {
  const labels = [...new Set(fieldLabels)];
  const n = labels.length;
  if (n === 0) return `${prefix}.`;
  return `${prefix} — popraw ${n} ${polishCount(n, 'pole', 'pola', 'pól')}: ${labels.join(', ')}.`;
}
