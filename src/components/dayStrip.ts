// Czysty pasek 7 dat nad widokiem dnia (telefon) + reguła pływającej pigułki
// „Dzisiaj”. Zero Reacta; CAŁA matematyka dat idzie przez `utils/dates.ts`
// (`addDaysStr`, `isWeekend`, `isInMonth`) — ten moduł nigdy nie liczy dat sam
// i nie formatuje etykiet (widok bierze `weekdayAbbr` / `dayOfMonthLabel`).
import type { DateStr } from '../types';
import { addDaysStr, isWeekend, monthKey } from '../utils/dates';

/** Ile dat pokazuje pasek (nieparzyste — aktywna data stoi w środku). */
export const DAY_STRIP_LENGTH = 7;

export interface DayStripEntry {
  date: DateStr;
  /** `=== anchor` — dokładnie jedna pozycja w pasku. */
  active: boolean;
  today: boolean;
  weekend: boolean;
}

/**
 * 7 dat wyśrodkowanych na kotwicy: `anchor-3 … anchor+3` (dla `anchor` = dziś
 * „dziś” wypada w środku). Zawsze `DAY_STRIP_LENGTH` pozycji, rosnąco.
 *
 * `today` porównujemy z PRZEKAZANĄ datą, a nie przez `isTodayStr` — funkcja ma
 * zostać czysta (ten sam wynik dla tych samych argumentów), więc zegar systemowy
 * czyta wyłącznie wołający.
 */
export function dayStripEntries(anchor: DateStr, today: DateStr): DayStripEntry[] {
  const half = (DAY_STRIP_LENGTH - 1) / 2;
  return Array.from({ length: DAY_STRIP_LENGTH }, (_, i) => {
    const date = addDaysStr(anchor, i - half);
    return {
      date,
      active: date === anchor,
      today: date === today,
      weekend: isWeekend(date),
    };
  });
}

/**
 * Czy pokazać pływającą pigułkę „Dzisiaj”: widoczny ZAKRES SIATKI nie zawiera
 * dzisiejszego dnia. W trybie dnia siatka pokazuje dokładnie jedną kolumnę
 * (kotwicę) — pasek 7 dat jest tylko nawigacją, więc nie liczy się do zakresu;
 * w trybie miesiąca zakresem jest miesiąc kotwicy.
 *
 * Miesiąc porównujemy przez `monthKey` ('yyyy-MM'), a nie `isInMonth` — to
 * drugie patrzy WYŁĄCZNIE na numer miesiąca, więc lipiec 2027 uchodziłby za ten
 * sam zakres co lipiec 2026 i pigułka chowałaby się rok od dziś.
 */
export function todayPillVisible(
  mode: 'day' | 'month',
  anchor: DateStr,
  today: DateStr,
): boolean {
  if (mode === 'month') return monthKey(anchor) !== monthKey(today);
  return anchor !== today;
}
