// JEDNO zdanie opisujące blok pracy — wspólne dla listy bloków w TaskModal i
// dla nazwy dostępnej (`aria-label`) kafelka w kalendarzu.
//
// Powód istnienia: zdanie żyło jako domknięcie `blockRowLabel` wewnątrz
// TaskModal (nad `state`/`getPerson`), więc kalendarz nie mógł go użyć i kafelek
// czytał się jako goła sklejka swoich dzieci („Montaż filmu 9:00–11:00 Anna 2h").
// Tutaj jest czysto: żadnego importu store'u, wszystkie dane wchodzą jawnie —
// dzięki temu testuje się bez Reacta i bez DOM-u (środowisko `node`).
//
// Kontrakt zgodności: dla wejścia BEZ `taskTitle` i BEZ `done` wynik jest
// BAJT W BAJT tym, co renderowała lista bloków w TaskModal.
import { formatShortWithWeekday } from './dates';
import { blockEndMinutes, formatDuration, formatMinutes, isBinEntry } from './time';

export interface BlockLabelInput {
  /** Imię osoby; puste/brak = zdanie bez przedrostka „Anna — ”. */
  personName?: string;
  /** `yyyy-MM-dd`; pusty łańcuch = wpis w zasobniku (bez terminu). */
  date: string;
  startMinutes: number;
  plannedHours: number;
  /** Tytuł zadania — dokłada kalendarz, TaskModal nigdy (ma go w nagłówku). */
  taskTitle?: string;
  /** Własna flaga wykonania bloku (znacznik „✓ Wykonane” na kafelku). */
  done?: boolean;
}

/**
 * „Anna — 30 lip (pon), 9:00–11:00 (2h)” albo „Anna — zasobnik (bez terminu), 2h”.
 * Z `taskTitle` zdanie dostaje przedrostek „Montaż filmu: ”, z `done` przyrostek
 * „, wykonane”.
 */
export function blockLabel(input: BlockLabelInput): string {
  const who = input.personName !== undefined && input.personName !== '' ? `${input.personName} — ` : '';
  const what = input.taskTitle !== undefined && input.taskTitle !== '' ? `${input.taskTitle}: ` : '';
  const doneNote = input.done === true ? ', wykonane' : '';
  if (isBinEntry(input)) {
    return `${what}${who}zasobnik (bez terminu), ${formatDuration(input.plannedHours)}${doneNote}`;
  }
  const end = blockEndMinutes(input.startMinutes, input.plannedHours);
  return `${what}${who}${formatShortWithWeekday(input.date)}, ${formatMinutes(
    input.startMinutes,
  )}–${formatMinutes(end)} (${formatDuration(input.plannedHours)})${doneNote}`;
}
