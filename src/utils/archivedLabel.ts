// JEDNA polska etykieta „zarchiwizowany” dla całego UI. Wcześniej każde miejsce
// pisało ją po swojemu — `StatusBadge` wstawiał wręcz angielskie
// „ (archived)” w polskim interfejsie, obok „ (zarchiwizowany)” w TaskModal,
// ProjectDetailPage i ClientsPage. Element oznaczony jako zarchiwizowany dostaje
// dodatkowo atrybut `data-archived`, żeby CSS i testy nie musiały dopasowywać
// tekstu.

/** Sam przymiotnik (rodzaj męski: status, klient, projekt). */
export const ARCHIVED_LABEL = 'zarchiwizowany';

/** Dopisek za nazwą pozycji, np. „Zrobione (zarchiwizowany)”. */
export const ARCHIVED_SUFFIX = ` (${ARCHIVED_LABEL})`;

/** Dopisek dla listy — pusty, gdy pozycja nie jest zarchiwizowana. */
export function archivedSuffix(archived: boolean | undefined): string {
  return archived ? ARCHIVED_SUFFIX : '';
}

/** Wartość atrybutu `data-archived` (pomijany, gdy pozycja jest aktywna). */
export function archivedAttr(archived: boolean | undefined): 'true' | undefined {
  return archived ? 'true' : undefined;
}
