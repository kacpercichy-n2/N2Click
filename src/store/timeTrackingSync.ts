// Czysta arytmetyka „wykonanie → plan" trackera czasu (bez Reacta, bez mutacji).
// Używana przez reduktor (materializacja wpisu w planie) i przez UI (podgląd
// przekroczenia PRZED dispatchem, żeby zadać pytanie dokładnie wtedy, gdy
// reduktor by go potrzebował). Jedna definicja liczb, dwa miejsca odczytu.
//
// Słownik:
//   * plan pary (zadanie, osoba, dzień) = suma DATOWANYCH bloków tej pary,
//   * wykonanie pary = suma wpisów tej pary tego dnia,
//   * nadwyżka = wykonanie − plan − (już zapisane „ponad sprzedane" tego dnia),
//   * nadwyżka rośnie w planie jak przy rozciąganiu bloku: najpierw z zasobnika
//     osoby, potem z wolnych godzin sprzedanych zadania (estymata − wszystko
//     zaplanowane u wszystkich), a to, na co nie ma pokrycia, to „ponad
//     sprzedane" (wymaga potwierdzenia). Zadanie bez estymaty (kubełek) ma
//     pokrycie nieskończone: nigdy nie przekracza, zawsze dopisuje się do planu.
import type { AppData, TimeEntry, WorkloadEntry } from '../types';
import { hoursToMinutes, isBinEntry } from '../utils/time';
import { timeEntryMinutes } from '../utils/timeTracking';

export interface TrackingBalance {
  /** Datowane bloki pary tego dnia, rosnąco po starcie. */
  blocks: WorkloadEntry[];
  plannedMinutes: number;
  loggedMinutes: number;
  /** Minuty „ponad sprzedane" już zapisane na wpisach pary tego dnia (poza `excludeEntryId`). */
  recordedOverrunMinutes: number;
  binMinutes: number;
  /** Wolne sprzedane godziny zadania (wszyscy, kalendarz + zasobnik); Infinity dla kubełka. */
  headroomMinutes: number;
}

export function trackingBalance(
  state: AppData,
  taskId: string,
  personId: string,
  date: string,
  excludeEntryId?: string,
): TrackingBalance {
  const task = state.tasks.find((t) => t.id === taskId);
  const blocks = state.workload
    .filter((w) => w.taskId === taskId && w.personId === personId && w.date === date && !isBinEntry(w))
    .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
  const plannedMinutes = blocks.reduce((s, b) => s + hoursToMinutes(b.plannedHours), 0);
  const entries = state.timeEntries.filter(
    (e) => e.taskId === taskId && e.personId === personId && e.date === date && e.id !== excludeEntryId,
  );
  const loggedMinutes = entries.reduce((s, e) => s + timeEntryMinutes(e), 0);
  const recordedOverrunMinutes = entries.reduce((s, e) => s + (e.overrunMinutes ?? 0), 0);
  const binMinutes = state.workload
    .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
    .reduce((s, w) => s + hoursToMinutes(w.plannedHours), 0);
  let headroomMinutes = Infinity;
  if (task !== undefined && task.estimatedHours !== null) {
    const allPlanned = state.workload
      .filter((w) => w.taskId === taskId)
      .reduce((s, w) => s + hoursToMinutes(w.plannedHours), 0);
    headroomMinutes = Math.max(0, hoursToMinutes(task.estimatedHours) - allPlanned);
  }
  return { blocks, plannedMinutes, loggedMinutes, recordedOverrunMinutes, binMinutes, headroomMinutes };
}

export interface GrowthPlan {
  /** Ile minut planu dopisać (z zasobnika + wolnych sprzedanych). */
  growMinutes: number;
  fromBinMinutes: number;
  /** Ile minut zostaje „ponad sprzedane" (0 dla kubełka). */
  overrunMinutes: number;
}

/**
 * Jak rozliczyć `addedMinutes` nowego wykonania pary (zadanie, osoba, dzień):
 * co dopisać do planu, a co zostaje ponad sprzedane. `excludeEntryId` przy
 * poprawce wpisu (jego stara długość nie liczy się do „wykonania").
 */
export function planGrowth(
  state: AppData,
  taskId: string,
  personId: string,
  date: string,
  addedMinutes: number,
  excludeEntryId?: string,
): GrowthPlan {
  const b = trackingBalance(state, taskId, personId, date, excludeEntryId);
  const extra = Math.max(0, b.loggedMinutes + addedMinutes - b.plannedMinutes - b.recordedOverrunMinutes);
  const growable = b.binMinutes + b.headroomMinutes;
  const growMinutes = Math.min(extra, growable);
  return {
    growMinutes: Number.isFinite(growMinutes) ? growMinutes : extra,
    fromBinMinutes: Math.min(growMinutes, b.binMinutes),
    overrunMinutes: Math.max(0, extra - growMinutes),
  };
}

/**
 * Przedziały zegarowe zalogowanego czasu NIEPOKRYTE żadnym blokiem (unia
 * `entrySpans` minus unia `blockSpans`), rosnąco. Geometria, nie pula minut —
 * wynik nie zależy od KOLEJNOŚCI dodawania wpisów, tylko od godzin na zegarze.
 * Używane przy materializacji wzrostu planu: wzrost ląduje tam, gdzie czas
 * faktycznie został zalogowany, a plan go nie pokrywa.
 */
export function uncoveredEntryGaps(
  entrySpans: ReadonlyArray<{ startMinutes: number; endMinutes: number }>,
  blockSpans: ReadonlyArray<{ startMinutes: number; endMinutes: number }>,
): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const s of [...entrySpans].sort((a, b) => a.startMinutes - b.startMinutes)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && s.startMinutes <= last[1]) last[1] = Math.max(last[1], s.endMinutes);
    else merged.push([s.startMinutes, s.endMinutes]);
  }
  const blocks = [...blockSpans].sort((a, b) => a.startMinutes - b.startMinutes);
  const out: Array<[number, number]> = [];
  for (const [start, end] of merged) {
    let cursor = start;
    for (const b of blocks) {
      if (b.endMinutes <= cursor || b.startMinutes >= end) continue;
      if (b.startMinutes > cursor) out.push([cursor, b.startMinutes]);
      cursor = Math.max(cursor, b.endMinutes);
      if (cursor >= end) break;
    }
    if (cursor < end) out.push([cursor, end]);
  }
  return out;
}

/**
 * Sekwencyjne pokrycie bloków wykonaniem: zalogowane minuty pary wypełniają
 * bloki po kolei od najwcześniejszego. Zwraca minuty przypadające na każdy blok.
 */
export function portionFill(blocks: readonly WorkloadEntry[], loggedMinutes: number): Map<string, number> {
  const out = new Map<string, number>();
  let pool = loggedMinutes;
  for (const b of blocks) {
    const take = Math.min(pool, hoursToMinutes(b.plannedHours));
    out.set(b.id, take);
    pool -= take;
  }
  return out;
}

/**
 * WCIĘCIE: kawałki przedziału bloku po wycięciu przedziału wpisu — głowa
 * (przed wpisem) i ogon (po wpisie), każdy może nie istnieć, plus liczba
 * wyciętych minut. Czysta geometria zegarowa: „duży task 9-17, w środku
 * 15 min rozmowy" daje głowę 9-15 i ogon 15:15-17 (zgłoszenie 2026-09-01).
 * Brak nakładki => obie części null i 0 minut.
 */
export function carveSpan(
  block: { startMinutes: number; endMinutes: number },
  cut: { startMinutes: number; endMinutes: number },
): { head: [number, number] | null; tail: [number, number] | null; cutMinutes: number } {
  const s = Math.max(block.startMinutes, cut.startMinutes);
  const e = Math.min(block.endMinutes, cut.endMinutes);
  if (e <= s) return { head: null, tail: null, cutMinutes: 0 };
  return {
    head: s > block.startMinutes ? [block.startMinutes, s] : null,
    tail: e < block.endMinutes ? [e, block.endMinutes] : null,
    cutMinutes: e - s,
  };
}

/**
 * Wolne kawałki przedziału [start, end) — minuty NIEzajęte przez żaden z
 * `occupied` (przedziały mogą nachodzić na siebie i być w dowolnej kolejności).
 * Rosnąco; pusty wynik, gdy całość jest zajęta.
 */
export function freeRangesWithin(
  start: number,
  end: number,
  occupied: ReadonlyArray<{ startMinutes: number; endMinutes: number }>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cursor = start;
  for (const o of [...occupied].sort((a, b) => a.startMinutes - b.startMinutes)) {
    if (o.endMinutes <= cursor || o.startMinutes >= end) continue;
    if (o.startMinutes > cursor) out.push([cursor, o.startMinutes]);
    cursor = Math.max(cursor, o.endMinutes);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push([cursor, end]);
  return out;
}

/** Czy wpis powstały z bloku („wykonane") jest nadal 1:1 z tym blokiem. */
export function entryMatchesBlock(entry: TimeEntry, block: WorkloadEntry): boolean {
  return (
    entry.taskId === block.taskId &&
    entry.personId === block.personId &&
    entry.date === block.date &&
    entry.startMinutes === block.startMinutes &&
    entry.endMinutes === block.startMinutes + hoursToMinutes(block.plannedHours)
  );
}
