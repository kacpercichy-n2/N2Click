// Czyste sortowanie PREZENTACYJNE list Zadań i Projektów (zgłoszenie 9db56d5a).
// Wybór jest zapamiętywany per widok w `lastFilters.<view>.sort` (jak filtr
// „planowanie"); '' = domyślny porządek widoku (Zadania: data rozpoczęcia,
// Projekty: nazwa w grupie klienta). Sortuje KOPIĘ — nigdy kolejności store'u.

import { comparePl } from '../utils/collation';

/** Dozwolone wartości `LastViewFilter.sort` ('' = domyślny porządek widoku). */
export const LIST_SORT_VALUES = ['', 'title', 'start', 'created-desc', 'created-asc'] as const;

export type ListSortValue = (typeof LIST_SORT_VALUES)[number];

/** Etykiety opcji selecta „Sortowanie" (etykieta '' zależy od widoku). */
export const LIST_SORT_LABELS: Record<Exclude<ListSortValue, ''>, string> = {
  title: 'Nazwa A–Z',
  start: 'Data rozpoczęcia',
  'created-desc': 'Ostatnio dodane',
  'created-asc': 'Najdawniej dodane',
};

/** Zawęża zapamiętany string do dozwolonej wartości (nieznana => ''). */
export function coerceListSort(raw: string | undefined): ListSortValue {
  return (LIST_SORT_VALUES as readonly string[]).includes(raw ?? '')
    ? ((raw ?? '') as ListSortValue)
    : '';
}

interface SortableRow {
  title?: string;
  name?: string;
  startDate: string; // yyyy-MM-dd
  createdAt: string; // ISO timestamp
}

const displayName = (row: SortableRow): string => row.title ?? row.name ?? '';

/**
 * Komparator dla wybranej opcji. `fallback` rozstrzyga '' oraz remisy —
 * Zadania podają swój dotychczasowy porządek (startDate, potem tytuł),
 * Projekty alfabetyczny po nazwie, więc lista bez wyboru wygląda jak dotąd.
 * `nameOf` pozwala sortować po nazwie WYŚWIETLANEJ (utajniona treść maskuje
 * tytuły — porządek alfabetyczny nie może zdradzać prawdziwego tytułu).
 */
export function listSortComparator<R extends SortableRow>(
  sort: ListSortValue,
  fallback: (a: R, b: R) => number,
  nameOf: (row: R) => string = displayName,
): (a: R, b: R) => number {
  switch (sort) {
    case 'title':
      return (a, b) => comparePl(nameOf(a), nameOf(b)) || fallback(a, b);
    case 'start':
      return (a, b) => a.startDate.localeCompare(b.startDate) || fallback(a, b);
    case 'created-desc':
      return (a, b) => b.createdAt.localeCompare(a.createdAt) || fallback(a, b);
    case 'created-asc':
      return (a, b) => a.createdAt.localeCompare(b.createdAt) || fallback(a, b);
    default:
      return fallback;
  }
}
