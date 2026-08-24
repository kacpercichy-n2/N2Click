// Czysty view-model KALENDARZA WYBORU DATY (popover pól daty formularzy).
// Zero Reacta i DOM-u — testowalne w node jak `weekViewLayout.ts`.
//
// Research-before-custom (wiki frontend-performance-and-primitives, 2026-08-24),
// dwa źródła pierwotne:
//   * React Aria Calendar/RangeCalendar — siatka `role="grid"` z nagłówkami
//     dni, JEDNA komórka w cyklu Tab (roving tabindex), strzałki ±1/±7 dnia,
//     PageUp/PageDown ±miesiąc, Home/End do granic tygodnia, wybór
//     Enter/Spacją, `aria-selected` na komórkach zakresu, dni spoza zakresu
//     `aria-disabled`.
//   * shadcn/ui Calendar (react-day-picker v9) — klasy stanu zamiast stylu
//     inline: `range-start` / `range-end` / `range-middle` (pas zaznaczenia),
//     dni spoza miesiąca wyciszone, nawigacja ‹ › z etykietami.
// Świadome różnice N2Hub: popover na WŁASNEJ powłoce `useOverlay` (portal,
// stos Escape, klik na zewnątrz) zamiast warstwy biblioteki; bez zależności —
// siatkę liczy ten moduł; miesiąc pokazywany jest JEDEN (pola formularza, nie
// widok planowania).
import {
  addDaysStr,
  inclusiveDayCount,
  isValidDateStr,
  monthKey,
  parseDate,
  toDateStr,
} from '../utils/dates';
import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import type { DateStr } from '../types';

const WEEK_OPTS = { weekStartsOn: 1 as const }; // poniedziałek, jak wszędzie

/** Pełne tygodnie miesiąca (pon-nd) z dniami przyległych miesięcy włącznie. */
export function calendarWeeks(anchor: DateStr): DateStr[][] {
  const base = parseDate(isValidDateStr(anchor) ? anchor : toDateStr(new Date()));
  const first = startOfWeek(startOfMonth(base), WEEK_OPTS);
  const last = endOfWeek(endOfMonth(base), WEEK_OPTS);
  const weeks: DateStr[][] = [];
  let cursor = first;
  while (cursor <= last) {
    const week: DateStr[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(toDateStr(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 12);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Kotwica sąsiedniego miesiąca (pierwszy dzień) — nawigacja ‹ ›. */
export function monthAnchorShift(anchor: DateStr, deltaMonths: number): DateStr {
  return toDateStr(startOfMonth(addMonths(parseDate(anchor), deltaMonths)));
}

/** Czy dzień leży w miesiącu kotwicy (dni przyległe są wyciszone). */
export function inAnchorMonth(day: DateStr, anchor: DateStr): boolean {
  return monthKey(day) === monthKey(anchor);
}

/**
 * Klawiatura siatki (wzór React Aria): strzałki ±1/±7 dnia, PageUp/PageDown
 * ±miesiąc, Home/End do poniedziałku/niedzieli tygodnia. `null` = klawisz
 * nie należy do siatki (Enter/Space obsługuje przycisk komórki).
 */
export function resolveCalendarKey(key: string, focused: DateStr): DateStr | null {
  switch (key) {
    case 'ArrowLeft':
      return addDaysStr(focused, -1);
    case 'ArrowRight':
      return addDaysStr(focused, 1);
    case 'ArrowUp':
      return addDaysStr(focused, -7);
    case 'ArrowDown':
      return addDaysStr(focused, 7);
    case 'PageUp':
      return toDateStr(addMonths(parseDate(focused), -1));
    case 'PageDown':
      return toDateStr(addMonths(parseDate(focused), 1));
    case 'Home':
      return toDateStr(startOfWeek(parseDate(focused), WEEK_OPTS));
    case 'End':
      return toDateStr(endOfWeek(parseDate(focused), WEEK_OPTS));
    default:
      return null;
  }
}

export interface CalendarDayContext {
  /** Wybrana data pojedyncza ALBO początek zakresu ('' = brak). */
  selected: DateStr | '';
  /** Koniec podświetlanego zakresu ('' = zakresu nie ma). */
  rangeEnd: DateStr | '';
  /** Dolna/górna granica wyboru włącznie ('' = bez granicy). */
  min: DateStr | '';
  max: DateStr | '';
  today: DateStr;
}

export interface CalendarDayState {
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
  isRangeStart: boolean;
  isRangeEnd: boolean;
  /** Wewnątrz zakresu, bez końców — pas zaznaczenia (wzór react-day-picker). */
  isRangeMiddle: boolean;
}

/** Stan JEDNEJ komórki dnia — mapowany wprost na klasy CSS i aria-*. */
export function calendarDayState(day: DateStr, ctx: CalendarDayContext): CalendarDayState {
  const hasRange = ctx.selected !== '' && ctx.rangeEnd !== '' && ctx.rangeEnd > ctx.selected;
  return {
    disabled: (ctx.min !== '' && day < ctx.min) || (ctx.max !== '' && day > ctx.max),
    isToday: day === ctx.today,
    isSelected: day === ctx.selected || (hasRange && day === ctx.rangeEnd),
    isRangeStart: hasRange && day === ctx.selected,
    isRangeEnd: hasRange && day === ctx.rangeEnd,
    isRangeMiddle: hasRange && day > ctx.selected && day < ctx.rangeEnd,
  };
}

/**
 * Górna granica wyboru KOŃCA zakresu o zadanym maksimum długości (włącznie) —
 * np. urlop do 92 dni: start + 91. `''` gdy nie ma startu.
 */
export function rangeEndLimit(start: DateStr | '', maxDays: number): DateStr | '' {
  if (start === '' || !isValidDateStr(start) || maxDays < 1) return '';
  return addDaysStr(start, maxDays - 1);
}

/** Kotwica miesiąca otwarcia: wybrana data, inaczej dziś. */
export function initialCalendarAnchor(value: DateStr | '', today: DateStr): DateStr {
  const base = value !== '' && isValidDateStr(value) ? value : today;
  return toDateStr(startOfMonth(parseDate(base)));
}

/** Sanity dla testów i konsumenta: ile dni obejmuje zakres (1 gdy brak końca). */
export function rangeDayCount(start: DateStr, end: DateStr | ''): number {
  if (end === '' || end <= start) return 1;
  return inclusiveDayCount(start, end);
}
