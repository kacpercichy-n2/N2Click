// Stanowisko (role_title) jest JEDNĄ Z OPCJI wyprowadzonych ze słownika
// działów: „Specjalista {dział}” / „Menadżer {dział}” — zamiast wolnego tekstu.
// Obecna niestandardowa wartość (zaszłość) pozostaje wybieralna na końcu listy,
// żeby select nigdy nie kłamał ani nie gubił zapisanych danych.
import type { Department } from '../types';

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
