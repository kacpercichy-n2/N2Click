// Formatowanie czasu w czacie. Znaczniki z bazy to surowe stringi ISO
// (timestamptz), więc parsowanie i formatowanie należy do WIDOKU (kontrakt
// `types.ts`). Wszystko idzie przez `date-fns` z polskim locale i przez
// istniejące helpery `utils/dates.ts` — bez drugiej implementacji formatu daty.
//
// Format daty na ekranie: „dzisiaj"/„wczoraj" słownie, a starsze dni w
// prymitywie osi `formatShortWithWeekday` („20 lip (pon)") — separator listy
// wiadomości jest etykietą osi, nie samodzielną datą treści (SY-08).
import { format, isValid } from 'date-fns';
import { pl } from 'date-fns/locale/pl';
import { addDaysStr, formatShort, formatShortWithWeekday, toDateStr } from '../../utils/dates';

/** Parsuje ISO; niepoprawny znacznik => null (nigdy nie rzuca). */
function parseIso(iso: string): Date | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const date = new Date(iso);
  return isValid(date) ? date : null;
}

/** Dzień kalendarzowy znacznika w strefie użytkownika ('yyyy-MM-dd'); '' gdy zły. */
export function dayKey(iso: string): string {
  const date = parseIso(iso);
  return date === null ? '' : toDateStr(date);
}

/** Godzina dymka („14:05"); '' gdy znacznik nie do sparsowania. */
export function formatClock(iso: string): string {
  const date = parseIso(iso);
  return date === null ? '' : format(date, 'HH:mm', { locale: pl });
}

/** Separator dnia w liście wiadomości: „Dzisiaj" / „Wczoraj" / „20 lip (pon)". */
export function formatDaySeparator(iso: string, todayStr: string): string {
  const day = dayKey(iso);
  if (day === '') return '';
  if (day === todayStr) return 'Dzisiaj';
  if (day === addDaysStr(todayStr, -1)) return 'Wczoraj';
  return formatShortWithWeekday(day);
}

/**
 * Czas na liście rozmów: dzisiejsza rozmowa pokazuje godzinę, wczorajsza słowo,
 * starsza skrót daty („20 lip"). Pusty znacznik => ''.
 */
export function formatListTime(iso: string | null, todayStr: string): string {
  if (iso === null) return '';
  const day = dayKey(iso);
  if (day === '') return '';
  if (day === todayStr) return formatClock(iso);
  if (day === addDaysStr(todayStr, -1)) return 'Wczoraj';
  return formatShort(day);
}
