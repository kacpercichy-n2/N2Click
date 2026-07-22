// Czysta polityka edycji pól profilu: kto (aktor) może edytować które pola
// docelowej osoby. Zwraca zbiór dozwolonych pól — UI wyłącza pozostałe wejścia,
// a `save()` bierze zablokowane pola z aktualnego rekordu, nigdy z draftu.
//
// To granica UX/spójności danych, NIE bezpieczeństwa — realną granicą jest RLS
// na serwerze (patrz supabase/migrations/20260715210500_rls_policies.sql).
// Testowalne w node (bez importu Reacta).

import type { AuthMode } from '../auth/mode';
import type { Person } from '../types';

export type ProfileField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'roleTitle'
  | 'departmentId'
  | 'companyId'
  | 'avatarEmoji'
  | 'capacity'
  | 'accessRole'
  | 'workDays'
  | 'workHours'
  | 'supervisorId'
  | 'birthDate';

const ALL_FIELDS: readonly ProfileField[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'roleTitle',
  'departmentId',
  // Spółka: wyłącznie administrator (i tryb setup) — parytet z serwerowym
  // triggerem app.protect_profile_privileges. NIE w SELF/MANAGER_FIELDS.
  'companyId',
  'avatarEmoji',
  'capacity',
  'accessRole',
  'workDays',
  'workHours',
  'supervisorId',
  'birthDate',
];

// Self edytuje własne dane osobowe/kontaktowe, w tym datę urodzenia.
const SELF_FIELDS: readonly ProfileField[] = [
  'firstName',
  'lastName',
  'phone',
  'avatarEmoji',
  'birthDate',
];

/**
 * Zbiór pól, które `actor` może edytować u `target`.
 *
 * Kolejność reguł (macierz po kolapsie ról 2026-07-22):
 *  1. tryb setup (`peopleCount === 0`) — wszystko (brak lockoutu),
 *  2. rola `pelne` — wszystko (dawna reguła administratora),
 *  3. self (rola `ograniczone`, `actor.id === target.id`) —
 *     imię/nazwisko/telefon/emoji/data urodzenia,
 *  4. w przeciwnym razie / brak aktora — zbiór pusty.
 * Dawna gałąź menedżera działu (PM) odeszła razem z rolą `pm`.
 */
export function editableProfileFields(
  actor: Person | undefined,
  target: Person,
  opts: { peopleCount: number },
): ReadonlySet<ProfileField> {
  if (opts.peopleCount === 0) return new Set(ALL_FIELDS);
  if (!actor) return new Set();
  if (actor.accessRole === 'pelne') return new Set(ALL_FIELDS);
  if (actor.id === target.id) return new Set(SELF_FIELDS);
  return new Set();
}

/** Czy aktor może edytować cokolwiek w profilu docelowej osoby. */
export function canEditAnyProfileField(
  actor: Person | undefined,
  target: Person,
  opts: { peopleCount: number },
): boolean {
  return editableProfileFields(actor, target, opts).size > 0;
}

/**
 * Czy aktor może wgrać/usunąć zdjęcie profilowe docelowej osoby. Tylko w trybie
 * Supabase i tylko dla: trybu setup, roli `pelne` albo samego siebie
 * (odzwierciedla RLS Storage).
 */
export function canUploadAvatarPhoto(
  actor: Person | undefined,
  target: Person,
  mode: AuthMode,
  opts: { peopleCount: number },
): boolean {
  if (mode !== 'supabase') return false;
  if (opts.peopleCount === 0) return true;
  if (!actor) return false;
  return actor.accessRole === 'pelne' || actor.id === target.id;
}
