// Czysta warstwa trasy pełnego widoku zadania (`/tasks/:id`, IA-15).
//
// Vitest chodzi w środowisku `node` i bierze wyłącznie `src/**/*.test.ts`, więc
// nie ma testów renderujących DOM. Pokrycie trasy stoi na TYCH dwóch funkcjach:
// budowaniu linku (kodowanie identyfikatora) i normalizacji parametru z routera
// (pusty/nieobecny => stan „nie znaleziono").

/** Ścieżka pełnego widoku zadania. Identyfikator zawsze zakodowany. */
export function taskFullViewPath(id: string): string {
  return `/tasks/${encodeURIComponent(id)}`;
}

/**
 * Parametr `:id` z routera → identyfikator zadania albo `null`. `null` znaczy
 * „pokaż stan «Nie znaleziono zadania»" — strona NIGDY nie szuka po pustym
 * identyfikatorze. React Router dekoduje segment sam, więc tutaj zostaje samo
 * przycięcie białych znaków.
 */
export function normalizeTaskRouteParam(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
