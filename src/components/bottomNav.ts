// Czysta logika dolnego paska zakładek (telefon, ≤760 px). Zero Reacta, zero
// store'a — `App.tsx` bierze stąd wyłącznie stałe i cztery funkcje, dzięki czemu
// kolejność zakładek, wybór tras do arkusza „Więcej” i dopasowanie tytułu trasy
// dają się przetestować w node, tak jak `navItems.ts` obok.

/** Ścieżki trzech zakładek-tras, w kolejności wyświetlania. */
export const BOTTOM_NAV_PRIMARY: readonly string[] = ['/dashboard', '/calendar', '/tasks'];

/** Nazwa parametru URL otwierającego arkusz zasobnika w widoku dnia. */
export const BIN_SHEET_PARAM = 'zasobnik';

/**
 * Deep-link zakładki „Zasobnik” — kalendarz z otwartym arkuszem. Parametr
 * konsumuje i czyści `WeekView` (`replace: true`), więc zakładka nie potrzebuje
 * żadnego stanu globalnego ani propsów przeciąganych przez `CalendarPage`.
 */
export const BIN_TAB_TARGET = `/calendar?${BIN_SHEET_PARAM}=1`;

/**
 * Czy `pathname` leży w gałęzi trasy `base`. Porównanie jest SEGMENTOWE:
 * `/tasks` łapie `/tasks` i `/tasks/42`, ale nie `/tasksy`. Zwykłe
 * `startsWith` dawałoby fałszywe trafienia na trasach o wspólnym przedrostku.
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Trasy do arkusza „Więcej”: `orderedPaths` (wynik `orderNavPaths`, już po
 * filtrach uprawnień) minus ścieżki podstawowe, z zachowaną kolejnością.
 */
export function moreNavPaths(orderedPaths: string[]): string[] {
  return orderedPaths.filter((path) => !BOTTOM_NAV_PRIMARY.includes(path));
}

/**
 * Etykieta w górnym pasku dla bieżącej ścieżki. Dopasowanie po NAJDŁUŻSZYM
 * pasującym prefiksie z `labels` (`'/tasks/42'` → „Zadania”); `'/'` i nieznane
 * trasy → `'N2Hub'`. `'/'` jest pomijane celowo — jako prefiks wszystkiego
 * wygrywałoby na każdej trasie bez własnej etykiety.
 */
export function topBarTitle(pathname: string, labels: ReadonlyMap<string, string>): string {
  let bestPath = '';
  let title = 'N2Hub';
  for (const [path, label] of labels) {
    if (path === '/' || path === '') continue;
    if (!isUnder(pathname, path)) continue;
    if (path.length <= bestPath.length) continue;
    bestPath = path;
    title = label;
  }
  return title;
}

/**
 * Która zakładka ma stan aktywny (`null` = żadna, np. w „Więcej”). Ta sama
 * reguła najdłuższego prefiksu co w `topBarTitle`, zawężona do zakładek.
 */
export function activeTabPath(pathname: string): string | null {
  let best: string | null = null;
  for (const path of BOTTOM_NAV_PRIMARY) {
    if (!isUnder(pathname, path)) continue;
    if (best !== null && path.length <= best.length) continue;
    best = path;
  }
  return best;
}
