// Czysta arytmetyka widoku „Dzień" trackera (bez Reacta, bez store'u):
// zakres godzin osi, rozkład nachodzących kafli planu w kolumny, przeliczenie
// pikseli osi na minutę siatki 15 min.
import { DAY_MINUTES, MINUTE_STEP } from '../utils/time';

/** Domyślne okno osi (godziny); rozszerza się, gdy dane wystają poza nie. */
export const TRACKER_AXIS_START_HOUR = 7;
export const TRACKER_AXIS_END_HOUR = 19;
/** 84 px/h = 21 px na kwadrans, TA SAMA gęstość co siatka tygodnia (HOUR_PX w
 *  WeekView). Dawne 56 px/h dawało 14 px na kwadrans — kafle 15-45 min ucinały
 *  tytuł (zgłoszenie 2026-09-01 „Wysokość tasków w kalendarzu"). */
export const TRACKER_PX_PER_HOUR = 84;

/**
 * Klasa gęstości treści kafla (plan i wykonanie) z minut — odpowiednik
 * `blockDensityClass` w WeekView: ≤15 min (21 px) jedna linia „tytuł … godziny",
 * ≤30 min (42 px) tytuł + godziny, ≤45 min (63 px) tytuł + meta + godziny,
 * ≤60 min (84 px) bez tekstu postępu, dłuższe = pełna treść. Czysta prezentacja.
 */
export function trackerDensityClass(minutes: number): string {
  if (minutes <= 15) return 'h-quarter';
  if (minutes <= 30) return 'h-half';
  if (minutes <= 45) return 'h-threeq';
  if (minutes <= 60) return 'h-hour';
  return '';
}

export interface HourRange {
  startHour: number; // włącznie
  endHour: number; // wyłącznie (oś kończy się na endHour:00)
}

/** Oś obejmuje domyślne okno 7-19 ORAZ każdy przedział z `spans` (zaokrąglone do pełnych godzin). */
export function axisHourRange(spans: ReadonlyArray<{ startMinutes: number; endMinutes: number }>): HourRange {
  let startHour = TRACKER_AXIS_START_HOUR;
  let endHour = TRACKER_AXIS_END_HOUR;
  for (const s of spans) {
    startHour = Math.min(startHour, Math.floor(s.startMinutes / 60));
    endHour = Math.max(endHour, Math.ceil(s.endMinutes / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, Math.max(endHour, startHour + 1)) };
}

/** Piksel od góry osi dla minuty doby. */
export function minuteToPx(minute: number, range: HourRange, pxPerHour = TRACKER_PX_PER_HOUR): number {
  return ((minute - range.startHour * 60) / 60) * pxPerHour;
}

/** Minuta doby (na siatce 15 min, w granicach osi) dla piksela od góry osi. */
export function pxToSnappedMinute(px: number, range: HourRange, pxPerHour = TRACKER_PX_PER_HOUR): number {
  const raw = range.startHour * 60 + (px / pxPerHour) * 60;
  const snapped = Math.round(raw / MINUTE_STEP) * MINUTE_STEP;
  return Math.max(range.startHour * 60, Math.min(snapped, Math.min(range.endHour * 60, DAY_MINUTES)));
}

export interface ColumnSlot {
  col: number;
  cols: number;
}

/**
 * Nachodzące przedziały dzielą się szerokością: każda grupa przecinających się
 * elementów dostaje tyle kolumn, ile trzeba (pierwsza wolna kolumna). Wynik
 * per id; elementy bez nakładki mają {col: 0, cols: 1}.
 */
export function layoutColumns<T extends { id: string; startMinutes: number; endMinutes: number }>(
  items: readonly T[],
): Map<string, ColumnSlot> {
  const out = new Map<string, ColumnSlot>();
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);
  let group: T[] = [];
  let groupEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    const cols = new Map<string, number>();
    for (const x of group) {
      let k = 0;
      while (colEnds[k] !== undefined && colEnds[k] > x.startMinutes) k++;
      colEnds[k] = x.endMinutes;
      cols.set(x.id, k);
    }
    for (const x of group) out.set(x.id, { col: cols.get(x.id) ?? 0, cols: colEnds.length });
    group = [];
  };
  for (const x of sorted) {
    if (group.length > 0 && x.startMinutes >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    group.push(x);
    groupEnd = Math.max(groupEnd, x.endMinutes);
  }
  if (group.length > 0) flush();
  return out;
}
