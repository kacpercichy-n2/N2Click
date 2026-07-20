// Stanowisko (role_title) jest JEDNĄ Z OPCJI wyprowadzonych ze słownika
// działów: „Specjalista {dział}” / „Menadżer {dział}” — zamiast wolnego tekstu.
// Obecna niestandardowa wartość (zaszłość) pozostaje wybieralna na końcu listy,
// żeby select nigdy nie kłamał ani nie gubił zapisanych danych.
import type { Department } from '../types';

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
