// Stanowisko (role_title) jest JEDNĄ Z OPCJI wyprowadzonych ze słownika
// działów: „Specjalista {dział}” / „Menadżer {dział}” — zamiast wolnego tekstu.
// Obecna niestandardowa wartość (zaszłość) pozostaje wybieralna na końcu listy,
// żeby select nigdy nie kłamał ani nie gubił zapisanych danych.
import type { Department, JobTitle } from '../types';

// Dawne sprzężenie stanowisko → rola dostępu (accessRoleForTitle) usunięte
// 2026-07-22 razem z kolapsem ról do pelne/ograniczone: stanowisko jest czysto
// opisowe i nigdy nie zmienia uprawnień.

export function roleTitleOptions(departments: Department[], current = ''): string[] {
  const options: string[] = [];
  for (const d of departments) {
    options.push(`Specjalista ${d.name}`);
    options.push(`Menadżer ${d.name}`);
  }
  const trimmed = current.trim();
  if (trimmed !== '' && !options.includes(trimmed)) options.push(trimmed);
  return options;
}

/**
 * Opcje selecta „Stanowisko” w profilu osoby. Kolejność: (1) nazwy ze SŁOWNIKA
 * stanowisk (Administracja → „Stanowiska”) w kolejności słownika, (2) opcje
 * wyprowadzone z działów (`roleTitleOptions`) jeszcze nieobecne, (3) bieżąca
 * (zaszłościowa) wartość na SAMYM KOŃCU, gdy niepusta i nieobecna — żeby select
 * nigdy nie zgubił zapisanej wartości. Dedup po dokładnym (trimowanym) stringu.
 */
export function jobTitleSelectOptions(
  jobTitles: JobTitle[],
  departments: Department[],
  current = '',
): string[] {
  const options: string[] = [];
  for (const jt of jobTitles) {
    const name = jt.name.trim();
    if (name !== '' && !options.includes(name)) options.push(name);
  }
  for (const derived of roleTitleOptions(departments)) {
    if (!options.includes(derived)) options.push(derived);
  }
  const trimmed = current.trim();
  if (trimmed !== '' && !options.includes(trimmed)) options.push(trimmed);
  return options;
}
