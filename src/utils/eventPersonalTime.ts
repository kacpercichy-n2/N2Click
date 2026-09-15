// OSOBISTY czas wystąpienia spotkania („tylko u mnie, tylko tego dnia") —
// czysta arytmetyka bez Reacta i bez store'u, współdzielona przez reduktor,
// `repairEvents`, hydrację chmury i selektory. Patrz `EventPersonalTime` w
// types.ts. Forma kanoniczna listy jest tu w JEDNYM miejscu, żeby trzy granice
// (reduktor, repair, hydracja) nie mogły się rozjechać.
import type { DateStr, EventPersonalTime, TaskRecurrence } from '../types';
import { isValidDateStr } from './dates';
import { expandOccurrences, isOccurrenceDate } from './recurrence';
import { DAY_MINUTES, MINUTE_STEP } from './time';
import { isLeaveKind } from './leave';

/** Minimum wydarzenia potrzebne do policzenia czasu bazowego wystąpienia. */
export interface PersonalTimeHost {
  date: DateStr;
  startMinutes: number;
  durationMinutes: number;
  attendeeIds: readonly string[];
  recurrence?: TaskRecurrence;
  kind?: string;
}

export interface OccurrenceTimes {
  startMinutes: number;
  durationMinutes: number;
}

/** Okno na siatce 15 min, w dobie, o dodatniej długości. */
export function isValidPersonalWindow(start: unknown, duration: unknown): boolean {
  return (
    typeof start === 'number' &&
    typeof duration === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(duration) &&
    start >= 0 &&
    duration >= MINUTE_STEP &&
    start % MINUTE_STEP === 0 &&
    duration % MINUTE_STEP === 0 &&
    start + duration <= DAY_MINUTES
  );
}

/**
 * Czas BAZOWY wystąpienia w danym dniu (to, co widzą wszyscy): jednorazowe ma
 * wystąpienie tylko w `date`, cykliczne rozwija regułę na ten dzień (z jej
 * własnymi `overrides`), nieobecności nie mają wystąpień w tym sensie.
 * `null` = tego dnia nie ma wystąpienia.
 */
export function baseOccurrenceTimes(host: PersonalTimeHost, date: DateStr): OccurrenceTimes | null {
  if (isLeaveKind(host.kind)) return null;
  if (!isValidDateStr(date)) return null;
  if (host.recurrence === undefined) {
    return host.date === date
      ? { startMinutes: host.startMinutes, durationMinutes: host.durationMinutes }
      : null;
  }
  if (!isOccurrenceDate(host.recurrence, host.date, date)) return null;
  const occ = expandOccurrences(host.recurrence, host.date, date, date)[0];
  return occ === undefined ? null : { startMinutes: occ.startMinutes, durationMinutes: occ.durationMinutes };
}

/** Osoba może mieć osobisty czas: uczestnik imienny albo każdy przy ogólnofirmowym. */
export function personMayPersonalize(host: PersonalTimeHost, personId: string): boolean {
  if (personId === '') return false;
  return host.attendeeIds.length === 0 || host.attendeeIds.includes(personId);
}

/**
 * Kanoniczna lista osobistych czasów z niezaufanego wejścia. Wpis przeżywa,
 * gdy: obiekt z niepustym `personId` (uczestnik, jeśli spotkanie imienne;
 * dodatkowo `personOk`, gdy wołający zna listę osób), `date` będąca realnym
 * dniem wystąpienia, poprawne okno 15-minutowe RÓŻNE od czasu bazowego tego
 * dnia. Dedup po (date, personId) — pierwszy wygrywa; sort po dacie, potem
 * osobie. Pusto => `undefined` (klucz kanonicznie nieobecny). Idempotentne.
 */
export function normalizeEventPersonalTimes(
  raw: unknown,
  host: PersonalTimeHost,
  personOk?: (personId: string) => boolean,
): EventPersonalTime[] | undefined {
  if (!Array.isArray(raw) || isLeaveKind(host.kind)) return undefined;
  const out: EventPersonalTime[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const date = rec.date;
    const personId = rec.personId;
    if (typeof date !== 'string' || typeof personId !== 'string' || personId === '') continue;
    if (!personMayPersonalize(host, personId)) continue;
    if (personOk !== undefined && !personOk(personId)) continue;
    if (!isValidPersonalWindow(rec.startMinutes, rec.durationMinutes)) continue;
    const startMinutes = rec.startMinutes as number;
    const durationMinutes = rec.durationMinutes as number;
    const base = baseOccurrenceTimes(host, date);
    if (base === null) continue;
    if (base.startMinutes === startMinutes && base.durationMinutes === durationMinutes) continue;
    const key = `${date} ${personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, personId, startMinutes, durationMinutes });
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );
  return out;
}

/** Osobisty czas osoby na dany dzień (albo `undefined`). Czysta funkcja na encji. */
export function personalTimeFor(
  event: { personalTimes?: EventPersonalTime[] },
  date: DateStr,
  personId: string,
): EventPersonalTime | undefined {
  if (event.personalTimes === undefined || personId === '') return undefined;
  return event.personalTimes.find((t) => t.date === date && t.personId === personId);
}

/** Czy dwie listy są identyczne po wartości (do straży „ta sama referencja"). */
export function samePersonalTimes(
  a: EventPersonalTime[] | undefined,
  b: EventPersonalTime[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === undefined && b === undefined;
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.date === b[i].date &&
      x.personId === b[i].personId &&
      x.startMinutes === b[i].startMinutes &&
      x.durationMinutes === b[i].durationMinutes,
  );
}
