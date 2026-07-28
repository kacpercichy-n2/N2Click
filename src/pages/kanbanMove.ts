// Czysty automat trybu „przenieś kartę" na tablicy Kanban — klawiaturowy
// odpowiednik przeciągania. Bez Reacta i bez dostępu do store'u (wzorzec
// `touchDrag.ts` / `kanbanBoard.ts`), więc całość da się przetestować bez DOM-u.
//
// Powód istnienia: natywne HTML5 DnD nie miało ŻADNEJ ścieżki klawiaturowej ani
// dotykowej — kartę dało się przenieść wyłącznie myszą. Tryb przenoszenia daje
// tę samą operację z klawiatury, a warstwa Reactowa rysuje ten sam wskaźnik
// upuszczenia co przeciąganie wskaźnikiem.
//
// Model: tryb wybiera KOLUMNĘ, nigdy pozycję w kolumnie. Kolejność w kolumnie
// jest POCHODNA (`compareTasks` = `(orderIndex, startDate, id)`) i nie jest
// utrwalana per-kolumna, więc „pozycja N z M" to WYLICZONE miejsce, w którym
// karta faktycznie wyląduje — a nie coś, co użytkownik ustawia. Jedyną mutacją
// tablicy zostaje istniejąca akcja `SET_TASK_STATUS` (inwariant 6): automat sam
// niczego nie wysyła, tylko zwraca intencję.
import type { Task } from '../types';
import { compareTasks } from './kanbanBoard';

/** Kolumna-CEL przenoszenia. Budowana wyłącznie z aktywnych statusów: kolumna
 *  archiwum jest miejscem, z którego się wyciąga, nigdy celem upuszczenia. */
export interface KanbanMoveColumn {
  statusId: string;
  name: string;
  tasks: readonly Task[];
}

/** `null` = brak trybu przenoszenia. `targetIndex` indeksuje listę kolumn-celów. */
export interface KanbanMoveState {
  taskId: string;
  /** Status, z którego karta wyszła — także archiwalny (wtedy poza listą celów). */
  sourceStatusId: string;
  targetIndex: number;
}

/** Intencja wysyłki dla warstwy Reactowej — dokładnie ładunek `SET_TASK_STATUS`. */
export interface KanbanMoveIntent {
  taskId: string;
  statusId: string;
}

export type KanbanMoveEvent =
  | { type: 'pickup'; taskId: string; sourceStatusId: string }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'drop' }
  | { type: 'cancel' };

/**
 * Reduktor trybu przenoszenia. Jak `touchHoldReducer` i reduktor store'u
 * (inwariant 6): zdarzenie BEZ SKUTKU zwraca TĘ SAMĄ referencję stanu — warstwa
 * Reactowa czyta z tego „czy w ogóle jest co ogłaszać", bez porównywania pól.
 * Na krawędziach listy `move` się NIE zawija (zawijanie w liniowym pasie kolumn
 * gubi orientację użytkownika czytnika ekranu).
 */
export function kanbanMoveReducer(
  state: KanbanMoveState | null,
  event: KanbanMoveEvent,
  columns: readonly KanbanMoveColumn[],
): KanbanMoveState | null {
  switch (event.type) {
    case 'pickup': {
      // Nie ma dokąd przenosić (brak aktywnych statusów) → tryb się nie włącza.
      if (columns.length === 0) return state;
      // Podniesienie w trakcie przenoszenia jest bez skutku: dopóki trwa gest,
      // stan należy do jednej karty (drugi uchwyt najpierw anuluje przez blur).
      if (state !== null) return state;
      const source = columns.findIndex((column) => column.statusId === event.sourceStatusId);
      return {
        taskId: event.taskId,
        sourceStatusId: event.sourceStatusId,
        // Karta z archiwum nie ma swojej kolumny wśród celów — startuje od pierwszej.
        targetIndex: source === -1 ? 0 : source,
      };
    }
    case 'move': {
      if (state === null) return state;
      const next = state.targetIndex + event.delta;
      if (next < 0 || next >= columns.length) return state; // clamp na krawędzi
      return { ...state, targetIndex: next };
    }
    case 'first': {
      if (state === null || columns.length === 0 || state.targetIndex === 0) return state;
      return { ...state, targetIndex: 0 };
    }
    case 'last': {
      if (state === null || columns.length === 0) return state;
      const last = columns.length - 1;
      if (state.targetIndex === last) return state;
      return { ...state, targetIndex: last };
    }
    case 'drop':
    case 'cancel':
      // Obie ścieżki kończą tryb; RÓŻNI je wyłącznie to, że przy `drop` warstwa
      // Reactowa pyta wcześniej o intencję (patrz `kanbanDropIntent`).
      return state === null ? state : null;
    default:
      return state;
  }
}

/**
 * Co wysłać przy upuszczeniu. `null` = nie ma czego wysyłać: brak trybu, cel
 * wypadł z listy (zmiana filtrów w trakcie) albo cel = źródło — no-opa nie
 * wysyłamy, bo zapis stanu i banner „Zapisano" nie mogą kłamać.
 */
export function kanbanDropIntent(
  state: KanbanMoveState | null,
  columns: readonly KanbanMoveColumn[],
): KanbanMoveIntent | null {
  if (state === null) return null;
  const column = columns[state.targetIndex];
  if (column === undefined) return null;
  if (column.statusId === state.sourceStatusId) return null;
  return { taskId: state.taskId, statusId: column.statusId };
}

/** Miejsce, na którym karta wyląduje w kolumnie celu (0-indeksowane). */
export interface KanbanDropPosition {
  index: number;
  /** Liczba kart w kolumnie PO upuszczeniu (karta liczy się dokładnie raz). */
  total: number;
}

/**
 * Wyliczone miejsce karty w kolumnie celu. Kolejność jest pochodna, więc indeks
 * bierzemy z tego samego komparatora, co render tablicy — karta już obecna w tej
 * kolumnie nie jest liczona dwa razy (upuszczenie na źródło niczego nie rusza).
 */
export function kanbanDropPosition(column: KanbanMoveColumn, task: Task): KanbanDropPosition {
  let index = 0;
  let total = 1; // sama przenoszona karta
  for (const other of column.tasks) {
    if (other.id === task.id) continue;
    total += 1;
    if (compareTasks(other, task) < 0) index += 1;
  }
  return { index, total };
}

// ---------- Komunikaty dla regionu `aria-live` (po polsku) ----------
// Osobne budowniczki zamiast pól w stanie: stan zostaje minimalny i
// porównywalny przez `===`, a testy sprawdzają brzmienie bez udawania DOM-u.

/** „pozycja 2 z 4" — wspólny ogon obu komunikatów o celu. */
function positionPhrase(position: KanbanDropPosition): string {
  return `pozycja ${position.index + 1} z ${position.total}`;
}

export function pickupAnnouncement(
  taskTitle: string,
  columnName: string,
  position: KanbanDropPosition,
): string {
  return `Podniesiono: ${taskTitle}. Kolumna ${columnName}, ${positionPhrase(position)}.`;
}

export function targetAnnouncement(columnName: string, position: KanbanDropPosition): string {
  return `Cel: kolumna ${columnName}, ${positionPhrase(position)}.`;
}

export function dropAnnouncement(taskTitle: string, columnName: string): string {
  return `Przeniesiono: ${taskTitle} do kolumny ${columnName}.`;
}

export function cancelAnnouncement(taskTitle: string, sourceName: string): string {
  return `Anulowano przenoszenie. ${taskTitle} zostaje w kolumnie ${sourceName}.`;
}
