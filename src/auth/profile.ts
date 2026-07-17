// Skojarzenie uwierzytelnionego użytkownika z lokalnym profilem `Person`.
//
// WYŁĄCZNIE PO TOŻSAMOŚCI (adres e-mail): ten moduł kojarzy sesję z lokalnym
// rekordem `Person`, bo dane planera (zadania/projekty/godziny) wskazują na
// lokalne id osób — i to pozostaje wymagane. NIGDY nie czytamy tu roli, działu
// ani uprawnień z `user_metadata`, `app_metadata` czy tokenu JWT.
//
// UWAGA: w trybie supabase rola dostępu i dział na potrzeby bramek UX pochodzą
// z Supabase (RLS jest autorytatywne) — patrz src/supabase/referenceData.ts
// (effectiveAccessRole) i OrgDataProvider. Samo skojarzenie po e-mailu poniżej
// jest niezależne od tego i się nie zmienia. Moduł jest czysty i testowalny w node.

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

/**
 * Buduje draft lokalnego `Person` z własnego, RLS-owego profilu chmury —
 * auto-provisioning tożsamości dla uwierzytelnionego konta bez osoby w
 * planerze (App, tryb supabase). Pusty `firstName` w chmurze spada na część
 * lokalną adresu e-mail, a ostatecznie na 'Użytkownik', żeby draft zawsze
 * przechodził walidację `isValidPersonDraft` (wymagane imię). Dział i
 * przełożony celowo pozostają puste: lokalne słowniki mają własne id, a widok
 * działu/przełożonego zapewnia snapshot organizacji.
 */
export interface CloudProfileIdentity {
  firstName: string;
  lastName: string;
  roleTitle: string;
  cloudRole: 'administrator' | 'manager' | 'worker';
}

export function personDraftFromCloudProfile(
  profile: CloudProfileIdentity,
  email: string,
  toAccessRole: (role: CloudProfileIdentity['cloudRole']) => Person['accessRole'],
) {
  return {
    firstName: profile.firstName.trim() || email.split('@')[0]?.trim() || 'Użytkownik',
    lastName: profile.lastName,
    email,
    phone: '',
    role: profile.roleTitle,
    departmentId: '',
    avatar: '',
    capacity: 8,
    accessRole: toAccessRole(profile.cloudRole),
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
  };
}
