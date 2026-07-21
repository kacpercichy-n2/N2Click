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

// Menedżer prowadzi kartę osoby z własnego działu — data urodzenia mieści się w
// tym samym zakresie co telefon/godziny (dane organizacyjne, nie uprawnienia).
const MANAGER_FIELDS: readonly ProfileField[] = [
  'roleTitle',
  'phone',
  'workDays',
  'workHours',
  'supervisorId',
  'birthDate',
];

/**
 * Zbiór pól, które `actor` może edytować u `target`.
 *
 * Kolejność reguł (ustalona macierz):
 *  1. tryb setup (`peopleCount === 0`) — wszystko (brak lockoutu),
 *  2. administrator — wszystko,
 *  3. self (nie-admin, `actor.id === target.id`) — imię/nazwisko/telefon/emoji,
 *  4. PM na osobie z WŁASNEGO działu (niebędącej sobą ani administratorem) —
 *     stanowisko/telefon/dni robocze/godziny/przełożony,
 *  5. w przeciwnym razie / brak aktora — zbiór pusty.
 */
export function editableProfileFields(
  actor: Person | undefined,
  target: Person,
  opts: { peopleCount: number },
): ReadonlySet<ProfileField> {
  if (opts.peopleCount === 0) return new Set(ALL_FIELDS);
  if (!actor) return new Set();
  if (actor.accessRole === 'administrator') return new Set(ALL_FIELDS);
  if (actor.id === target.id) return new Set(SELF_FIELDS);
  if (
    actor.accessRole === 'pm' &&
    actor.departmentId !== '' &&
    actor.departmentId === target.departmentId &&
    target.accessRole !== 'administrator'
  ) {
    return new Set(MANAGER_FIELDS);
  }
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
 * Supabase i tylko dla: trybu setup, administratora albo samego siebie
 * (menedżer NIGDY nie wgrywa cudzych zdjęć — odzwierciedla RLS Storage).
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
  return actor.accessRole === 'administrator' || actor.id === target.id;
}
