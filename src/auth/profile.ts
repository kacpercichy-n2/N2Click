// Skojarzenie uwierzytelnionego użytkownika z lokalnym profilem `Person`.
//
// WYŁĄCZNIE PO TOŻSAMOŚCI (adres e-mail). Rola dostępu i dział ZAWSZE pochodzą
// z lokalnego rekordu `Person` (tak jak dotąd) — nigdy nie czytamy roli, działu
// ani żadnych uprawnień z `user_metadata`, `app_metadata` czy z tokenu JWT.
// Ten moduł jest czysty i testowalny w node.

import type { Person } from '../types';

/** Normalizuje e-mail do porównań: przycięcie + małe litery. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Znajduje osobę o pasującym e-mailu (po przycięciu, bez rozróżniania
 * wielkości liter). Pusty e-mail nigdy nie pasuje — po żadnej ze stron.
 */
export function findPersonByEmail(
  people: Person[],
  email: string | null | undefined,
): Person | undefined {
  const target = normalizeEmail(email);
  if (!target) return undefined;
  return people.find((person) => {
    const candidate = normalizeEmail(person.email);
    return candidate !== '' && candidate === target;
  });
}

/**
 * Wynik skojarzenia: dopasowana osoba albo stan zablokowany (uwierzytelniony
 * użytkownik bez profilu w planerze — planer musi pozostać zamknięty).
 */
export type ProfileAssociation =
  | { kind: 'matched'; person: Person }
  | { kind: 'blocked'; email: string };

export function associateProfile(
  people: Person[],
  email: string | null | undefined,
): ProfileAssociation {
  const person = findPersonByEmail(people, email);
  if (person) return { kind: 'matched', person };
  return { kind: 'blocked', email: (email ?? '').trim() };
}
