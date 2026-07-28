// Czysta matematyka nawigacji po siatce miesiąca (APG „Date Picker Dialog”
// grid) + polska nazwa dostępna komórki dnia. Bez Reacta i bez DOM-u, więc
// testuje się w środowisku `node` — warstwa Reactowa (`MonthView.tsx`) tylko
// przekłada zdarzenie klawiatury na komendę i przestawia fokus.
//
// Powód istnienia: `.month-grid` był płaską listą `<button>` bez roli siatki,
// bez wędrującego `tabindex` i bez ŻADNEJ nawigacji klawiaturą — do 30. dnia
// miesiąca trzeba było nacisnąć Tab trzydzieści razy.
//
// Model: strzałki chodzą po komórkach (dzień / tydzień) i NIE zawijają się na
// krawędziach siatki (zawijanie w dwuwymiarowej siatce gubi orientację).
// Siatka pokazuje pełne tygodnie, więc na jej brzegach stoją dni SĄSIEDNICH
// miesięcy — są normalnymi komórkami i można na nie wejść; miesiąc zmienia się
// wyłącznie PageUp/PageDown (rok: z Shiftem), bo tylko to jest jednoznaczne.
import { polishAmount, polishCount } from '../utils/polishPlural';

/** Tydzień ma 7 kolumn — tyle samo, co `monthGridDays` układa w wierszu. */
export const MONTH_GRID_COLS = 7;

/**
 * Co ma zrobić warstwa Reactowa. `focus` zostaje w bieżącym miesiącu (zmienia
 * tylko wędrujący `tabindex` i fokus), `shiftMonth`/`shiftYear` idą do rodzica —
 * kotwica kalendarza mieszka w `CalendarPage`, więc matematyka dat nie dubluje
 * się w widoku.
 */
export type MonthGridCommand =
  | { type: 'focus'; index: number }
  | { type: 'shiftMonth'; delta: number }
  | { type: 'shiftYear'; delta: number };

/** Klawisz bez skutku (krawędź siatki, nieobsługiwany) → `null`. */
function focusCommand(next: number, index: number, cellCount: number): MonthGridCommand | null {
  if (next < 0 || next >= cellCount || next === index) return null;
  return { type: 'focus', index: next };
}

/**
 * Komenda dla klawisza w siatce miesiąca:
 * - ← → o dzień, ↑ ↓ o tydzień (bez zawijania),
 * - Home/End = pierwsza/ostatnia komórka WIERSZA, z Ctrl — całej siatki,
 * - PageUp/PageDown = ±1 miesiąc, z Shiftem ±1 rok.
 */
export function monthGridCommand(
  key: string,
  mods: { shift: boolean; ctrl: boolean },
  index: number,
  cellCount: number,
): MonthGridCommand | null {
  if (key === 'PageUp') return { type: mods.shift ? 'shiftYear' : 'shiftMonth', delta: -1 };
  if (key === 'PageDown') return { type: mods.shift ? 'shiftYear' : 'shiftMonth', delta: 1 };
  if (cellCount <= 0 || index < 0 || index >= cellCount) return null;
  const rowStart = Math.floor(index / MONTH_GRID_COLS) * MONTH_GRID_COLS;
  switch (key) {
    case 'ArrowLeft':
      return focusCommand(index - 1, index, cellCount);
    case 'ArrowRight':
      return focusCommand(index + 1, index, cellCount);
    case 'ArrowUp':
      return focusCommand(index - MONTH_GRID_COLS, index, cellCount);
    case 'ArrowDown':
      return focusCommand(index + MONTH_GRID_COLS, index, cellCount);
    case 'Home':
      return focusCommand(mods.ctrl ? 0 : rowStart, index, cellCount);
    case 'End':
      return focusCommand(
        mods.ctrl ? cellCount - 1 : Math.min(rowStart + MONTH_GRID_COLS - 1, cellCount - 1),
        index,
        cellCount,
      );
    default:
      return null;
  }
}

/**
 * Indeks komórki, która niesie `tabindex="0"`. Zapamiętana data bywa poza
 * siatką (nawigacja paskiem narzędzi przestawia miesiąc pod spodem), więc
 * spada wtedy na kotwicę miesiąca, a w ostateczności na pierwszą komórkę —
 * siatka NIGDY nie zostaje bez jedynego punktu wejścia z Taba.
 */
export function monthFocusIndex(
  days: readonly string[],
  focusDate: string,
  fallbackDate: string,
): number {
  const exact = days.indexOf(focusDate);
  if (exact !== -1) return exact;
  const fallback = days.indexOf(fallbackDate);
  return fallback === -1 ? 0 : fallback;
}

/** Podział płaskiej listy dni na wiersze-tygodnie (role `row` w siatce). */
export function monthGridRows<T>(cells: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < cells.length; i += MONTH_GRID_COLS) {
    rows.push(cells.slice(i, i + MONTH_GRID_COLS));
  }
  return rows;
}

export interface MonthCellNameInput {
  /** Data słownie, np. „30 lipca” (`dayMonthLabel`). */
  dayLabel: string;
  /** Zaplanowane godziny w filtrze (0 = brak pracy). */
  hours: number;
  /** Liczba osób z pracą tego dnia. */
  peopleCount: number;
  today?: boolean;
  outOfMonth?: boolean;
  overloaded?: boolean;
  /** Gotowe zdania znaczników („Urodziny: Anna”, „Wydarzenia: Standup”). */
  markers?: readonly string[];
}

const HOUR_FORMS = {
  one: 'zaplanowana godzina',
  few: 'zaplanowane godziny',
  many: 'zaplanowanych godzin',
  fraction: 'zaplanowanej godziny',
};

/**
 * Nazwa dostępna komórki dnia, np. „30 lipca, 6 zaplanowanych godzin, 2 osoby”.
 * Niesie CAŁĄ treść komórki (liczby, kropki osób, znaczniki 🎂/⟳/📅), bo
 * `aria-label` przykrywa dzieci przycisku — dlatego same znaczniki chowamy przed
 * czytnikiem, żeby nic nie czytało się dwa razy.
 */
export function monthCellName(input: MonthCellNameInput): string {
  const parts: string[] = [input.dayLabel];
  if (input.today === true) parts.push('dzisiaj');
  if (input.outOfMonth === true) parts.push('poza miesiącem');
  parts.push(input.hours > 0 ? polishAmount(input.hours, HOUR_FORMS) : 'brak pracy');
  if (input.peopleCount > 0) {
    parts.push(`${input.peopleCount} ${polishCount(input.peopleCount, 'osoba', 'osoby', 'osób')}`);
  }
  if (input.overloaded === true) parts.push('powyżej dostępności');
  for (const marker of input.markers ?? []) {
    if (marker !== '') parts.push(marker);
  }
  return parts.join(', ');
}
