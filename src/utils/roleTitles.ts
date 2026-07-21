// Stanowisko (role_title) jest JEDNĄ Z OPCJI wyprowadzonych ze słownika
// działów: „Specjalista {dział}” / „Menadżer {dział}” — zamiast wolnego tekstu.
// Obecna niestandardowa wartość (zaszłość) pozostaje wybieralna na końcu listy,
// żeby select nigdy nie kłamał ani nie gubił zapisanych danych.
import type { Department, JobTitle } from '../types';

/**
 * SPRZĘŻENIE stanowisko → rola dostępu (decyzja 2026-07-20): wybór
 * „Menadżer {dział}” ustawia rolę pm (menedżer), „Specjalista {dział}” —
 * pracownik. Inne/własne stanowiska → null (bez automatycznej zmiany).
 * Wołający NIGDY nie stosują wyniku, gdy edytowana osoba jest
 * administratorem — stanowisko nie może po cichu odebrać roli administratora.
 */
export function accessRoleForTitle(title: string): 'pm' | 'pracownik' | null {
  const t = title.trim();
  if (/^menad[żz]er\s/i.test(t)) return 'pm';
  if (/^specjalista\s/i.test(t)) return 'pracownik';
  return null;
}

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
