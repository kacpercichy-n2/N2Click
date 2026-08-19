// Czyste pomocniki trackera czasu pracy — zero Reacta, zero store'u. Importowane
// przez storage (repair), reduktor i selektory. Trzymane osobno od `time.ts`
// (matematyka bloków planu), bo tracker to DRUGA prawda: wykonanie, nie plan.
import type { TimeEntry, TimeEntrySource } from '../types';
import { DAY_MINUTES, MINUTE_STEP } from './time';

export const TIME_ENTRY_SOURCES: readonly TimeEntrySource[] = ['manual', 'draw', 'timer', 'event', 'block'];

export function isTimeEntrySource(v: unknown): v is TimeEntrySource {
  return typeof v === 'string' && (TIME_ENTRY_SOURCES as readonly string[]).includes(v);
}

/** Najkrótszy wpis: jeden krok siatki (15 min). */
export const MIN_TIME_ENTRY_MINUTES = MINUTE_STEP;

/** Czy zakres [start, end) jest poprawnym zakresem wpisu czasu w dobie na siatce 15 min. */
export function isValidTimeRange(start: unknown, end: unknown): start is number {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start as number) >= 0 &&
    (end as number) <= DAY_MINUTES &&
    (start as number) < (end as number) &&
    (start as number) % MINUTE_STEP === 0 &&
    (end as number) % MINUTE_STEP === 0
  );
}

/** Pierwszy wpis tej osoby tego dnia nachodzący na [start, end), z pominięciem `exceptId`. */
export function findOverlappingEntry(
  entries: readonly TimeEntry[],
  personId: string,
  date: string,
  start: number,
  end: number,
  exceptId?: string,
): TimeEntry | undefined {
  return entries.find(
    (e) =>
      e.personId === personId &&
      e.date === date &&
      e.id !== exceptId &&
      e.startMinutes < end &&
      e.endMinutes > start,
  );
}

export const timeEntryMinutes = (e: TimeEntry): number => e.endMinutes - e.startMinutes;

/** „1h 30m" / „45m" / „2h" / „0m" — jedna forma dla kafelków, pasków i sum. */
export function formatMinutesDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * Ranking podpowiedzi „częstość × świeżość" (frecency, jak Toggl/Firefox):
 * log(1 + liczba użyć) × wykładniczy zanik po dniach od ostatniego użycia
 * (półokres ~7 dni). `daysSinceLast` = null, gdy zadanie nie ma jeszcze wpisów.
 */
export function frecencyScore(uses: number, daysSinceLast: number | null): number {
  if (uses <= 0 || daysSinceLast === null) return 0;
  return Math.log(1 + uses) * Math.exp(-Math.max(0, daysSinceLast) / 7);
}
