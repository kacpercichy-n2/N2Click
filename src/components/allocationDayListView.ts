// Czysty model MOBILNEJ listy dni przydziału (telefon ≤ 760 px), nazwany jak
// `allocationGridView.ts` obok `AllocationGrid.tsx` — nazwa modelu MUSI różnić
// się od nazwy komponentu czymś więcej niż wielkością liter, bo system plików
// macOS jest bezwrażliwy na wielkość i TypeScript odmawia takiej pary. Lista jest
// bliźniakiem PREZENTACYJNYM tabeli `AllocationGrid`: czyta tę samą mapę
// `allocations` przez ten sam `allocKey` i zapisuje wyłącznie przez te same
// callbacki edytora — nie ma tu ani drugiego formatu klucza, ani drugiej
// ścieżki mutacji (inwariant 1).
//
// Zero DOM-u, zero Reacta — testuje się w środowisku `node`, tak jak
// `allocationGridView.ts` i `taskModalSections.ts`. Krok 0,25 h i zaokrąglenie
// do siatki idą przez wspólne `HOURS_STEP`/`snapHours` z `utils/time.ts`
// (inwariant 2), więc nie powstaje druga reguła arytmetyki godzin.
import { HOURS_STEP, snapHours } from '../utils/time';
import { allocKey } from './allocationGridView';

/** Sufit godzin w jednej komórce — ten sam, co `max={24}` w tabeli. */
export const MAX_CELL_HOURS = 24;

/** Jeden dzień okresu: suma po WSZYSTKICH osobach + rozbicie na osoby. */
export interface AllocationDayRow {
  date: string;
  /** Suma dnia po wszystkich przekazanych osobach (semantyka `dayTotalAcross`). */
  total: number;
  /** `personId` → godziny tej osoby tego dnia (0, gdy komórka pusta). */
  byPerson: Record<string, number>;
}

/** Clamp do zakresu komórki. Bez zaokrąglania — snap robi `snapHours`. */
function clampHours(hours: number): number {
  return Math.max(0, Math.min(MAX_CELL_HOURS, hours));
}

/**
 * Wiersze listy w KOLEJNOŚCI DNI okresu. Odczyt idzie po `allocKey`, więc
 * `total` jest tym samym, co `dayTotalAcross` tabeli, a suma `byPerson[p]` po
 * wszystkich wierszach — tym samym, co `personTotal` (round-trip pilnują testy).
 * Brak komórki = 0; żadna wartość nie jest tu normalizowana (lista pokazuje
 * dokładnie to, co siedzi w mapie edytora).
 */
export function allocationDayRows(
  days: readonly string[],
  personIds: readonly string[],
  allocations: Readonly<Record<string, number>>,
): AllocationDayRow[] {
  return days.map((date) => {
    const byPerson: Record<string, number> = {};
    let total = 0;
    for (const personId of personIds) {
      const value = allocations[allocKey(personId, date)] ?? 0;
      byPerson[personId] = value;
      total += value;
    }
    return { date, total, byPerson };
  });
}

/**
 * Sumy per osoba po wszystkich wierszach — stopka „Suma osoby" listy liczy się
 * z TYCH SAMYCH wierszy, co etykiety dni (jedno źródło liczb na widok).
 */
export function allocationPersonTotals(
  rows: readonly AllocationDayRow[],
  personIds: readonly string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const personId of personIds) {
    totals[personId] = rows.reduce((sum, row) => sum + (row.byPerson[personId] ?? 0), 0);
  }
  return totals;
}

/**
 * Krok steppera −/+ o 0,25 h. Reguła (ustalona): wartość spoza siatki jest
 * NAJPIERW przyciągana do najbliższego 0,25 (1,3 → 1,25), dopiero potem robi
 * się krok — czyli 1,3 + krok = 1,5, a 1,3 − krok = 1,0. Wynik jest clampowany
 * do 0–24, więc 24 „+" zostaje 24, a 0 „−" zostaje 0.
 */
export function stepAllocationHours(value: number, direction: 1 | -1): number {
  const base = Number.isFinite(value) ? clampHours(snapHours(value)) : 0;
  return clampHours(snapHours(base + direction * HOURS_STEP));
}

/**
 * Odczyt pola godzin (`inputMode="decimal"`). Polska klawiatura numeryczna daje
 * PRZECINEK, więc oba separatory są równoprawne. Puste pole = 0 (kasowanie
 * komórki), wartość spoza siatki przyciąga się do 0,25 (inwariant 2), a wszystko
 * poza „cyframi z jednym separatorem" (litery, minus, dwa separatory, wykładnik,
 * zapis szesnastkowy) zwraca `null` — wywołujący taki wpis IGNORUJE, zamiast
 * zapisywać `NaN` albo liczbę wyczarowaną przez `Number()`.
 */
export function parseAllocationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return clampHours(snapHours(parsed));
}

/** Godziny w polu tekstowym po polsku: 1,75 (0 = puste pole, jak w tabeli). */
export function formatAllocationInput(hours: number): string {
  if (hours === 0) return '';
  return String(hours).replace('.', ',');
}
