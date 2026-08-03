// Czysta logika kafelka „Urlop" na koncie (/account). Urlopy żyją jako
// wydarzenia `kind: 'urlop'` (jeden uczestnik, zakres date..endDate włącznie —
// patrz types.ts); ten moduł tylko je CZYTA. Limit roczny jest na razie
// domyślną stałą (26 dni — standard kodeksowy), bo panel HR z prawdziwymi
// limitami dopiero powstanie; UI oznacza tę wartość jako domyślną.
import type { CalendarEvent, DateStr } from '../types';
import { eachDayInclusive } from '../utils/dates';
import { isoWeekday } from '../utils/recurrence';

/** Domyślny roczny wymiar urlopu, dopóki panel HR nie przechowuje realnego. */
export const DEFAULT_VACATION_ALLOWANCE_DAYS = 26;

export interface VacationRange {
  start: DateStr;
  /** Ostatni dzień włącznie (dla urlopu jednodniowego równy `start`). */
  end: DateStr;
}

/** Zakresy urlopów danej osoby, posortowane rosnąco po dacie startu. */
export function personVacationRanges(
  events: readonly CalendarEvent[],
  personId: string,
): VacationRange[] {
  if (personId === '') return [];
  return events
    .filter((e) => e.kind === 'urlop' && e.attendeeIds[0] === personId)
    .map((e) => ({ start: e.date, end: e.endDate ?? e.date }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * Liczba DNI ROBOCZYCH urlopu przypadających w danym roku kalendarzowym.
 * Dzień liczy się, gdy jego izo-dzień tygodnia należy do dni roboczych osoby —
 * tak samo, jak urlop realnie zdejmuje planowanie. Zakres przycinany do roku.
 */
export function vacationWorkDaysInYear(
  ranges: readonly VacationRange[],
  workDays: readonly number[],
  year: number,
): number {
  const yearStart = `${year}-01-01` as DateStr;
  const yearEnd = `${year}-12-31` as DateStr;
  const workSet = new Set(workDays);
  let count = 0;
  for (const range of ranges) {
    const start = range.start < yearStart ? yearStart : range.start;
    const end = range.end > yearEnd ? yearEnd : range.end;
    if (start > end) continue;
    for (const day of eachDayInclusive(start, end)) {
      if (workSet.has(isoWeekday(day))) count += 1;
    }
  }
  return count;
}

/** Zakresy jeszcze trwające lub przyszłe (koniec >= dziś), od najbliższego. */
export function upcomingVacationRanges(
  ranges: readonly VacationRange[],
  today: DateStr,
  limit = 3,
): VacationRange[] {
  return ranges.filter((r) => r.end >= today).slice(0, limit);
}

/** Pozostałe dni z limitu — nigdy poniżej zera (nadwyżkę pokazuje osobny tekst). */
export function remainingVacationDays(usedDays: number, allowanceDays: number): number {
  return Math.max(0, allowanceDays - usedDays);
}
