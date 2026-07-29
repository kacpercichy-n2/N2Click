// Jedyne źródło porównywania polskich nazw w listach i dropdownach. Zawsze
// `localeCompare(..., 'pl')` — zwykły sort/localeCompare bez locale ustawia
// polskie znaki po literach ASCII (Ł za Z itd.).

/** Porównanie dwóch etykiet w polskiej kolacji (do `Array.prototype.sort`). */
export function comparePl(a: string, b: string): number {
  return a.localeCompare(b, 'pl');
}

/** Posortowana KOPIA elementów po `name` w polskiej kolacji — bez mutacji wejścia. */
export function sortByNamePl<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => comparePl(a.name, b.name));
}
