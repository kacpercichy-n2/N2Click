// Czysta logika zmiany hasła (wymuszonej i dobrowolnej) w trybie Supabase.
//
// Moduł CELOWO nie importuje @supabase/supabase-js ani nie czyta
// `import.meta.env` — tak jak src/auth/session.ts. Działa na wstrzykniętych,
// minimalnych interfejsach (adapter na `supabase.auth.updateUser` oraz na
// PostgREST po stronie prowajdera), dzięki czemu walidacja, mapowanie błędów i
// orkiestracja są w pełni testowalne w node (vitest), bez jsdom i bez SDK.
//
// Nigdzie nie logujemy ani nie zapisujemy wartości hasła.

import { AUTH_MESSAGES, type AuthErrorLike } from './session';

/** Polskie komunikaty walidacji i błędów zmiany hasła — nigdy surowy tekst SDK. */
export const PASSWORD_MESSAGES = {
  empty: 'Wpisz nowe hasło',
  tooShort: 'Hasło musi mieć co najmniej 8 znaków',
  mismatch: 'Hasła nie są identyczne',
  samePassword: 'Nowe hasło musi różnić się od obecnego',
  weakPassword: 'Hasło jest zbyt słabe. Użyj dłuższego, trudniejszego hasła.',
  connection: AUTH_MESSAGES.connection,
  unexpected: 'Nie udało się zmienić hasła. Spróbuj ponownie.',
  localMode: 'Zmiana hasła jest dostępna tylko przy logowaniu przez serwer.',
} as const;

/** Minimalna długość nowego hasła (bramka UX; twarde reguły egzekwuje Supabase). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Waliduje nowe hasło i jego powtórzenie. Zwraca `null`, gdy wszystko jest OK,
 * albo polski komunikat błędu do wyświetlenia.
 */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password) return PASSWORD_MESSAGES.empty;
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_MESSAGES.tooShort;
  if (password !== confirm) return PASSWORD_MESSAGES.mismatch;
  return null;
}

/** Mapuje błąd SDK `updateUser` na polski komunikat (nigdy surowy tekst SDK). */
export function mapPasswordChangeError(error: AuthErrorLike | null | undefined): string {
  if (!error) return PASSWORD_MESSAGES.unexpected;
  const code = (error.code ?? '').toLowerCase();
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'same_password' || msg.includes('should be different') || msg.includes('same password')) {
    return PASSWORD_MESSAGES.samePassword;
  }
  if (code === 'weak_password' || msg.includes('weak') || msg.includes('password is too')) {
    return PASSWORD_MESSAGES.weakPassword;
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || error.status === 0) {
    return PASSWORD_MESSAGES.connection;
  }
  return PASSWORD_MESSAGES.unexpected;
}

/** Adapter na `supabase.auth.updateUser({ password })`. */
export type UpdatePasswordFn = (password: string) => Promise<{ error: AuthErrorLike | null }>;

/** Adapter na PostgREST: czyści flagę `must_change_password` właściciela. */
export type ClearFlagFn = (userId: string) => Promise<{ error: unknown | null }>;

/** Adapter na PostgREST: czyta flagę `must_change_password` właściciela. */
export type FetchFlagFn = (
  userId: string,
) => Promise<{ value: boolean | null; error: unknown | null }>;

/**
 * Wczytuje flagę wymuszonej zmiany hasła. Fail-open: brak wiersza profilu,
 * `value === null`, błąd zapytania lub odrzucony Promise ⇒ `false`. Tabela
 * `profiles` może być uśpiona/pusta — to bramka UX, więc błąd sieci/braku
 * wiersza NIGDY nie może zablokować aplikacji.
 */
export async function loadMustChangePassword(
  fetcher: FetchFlagFn,
  userId: string,
): Promise<boolean> {
  try {
    const { value, error } = await fetcher(userId);
    if (error || value === null) return false;
    return value === true;
  } catch {
    return false;
  }
}

export interface PerformPasswordChangeArgs {
  updatePassword: UpdatePasswordFn;
  clearFlag: ClearFlagFn;
  userId: string;
  password: string;
  confirm: string;
}

/**
 * Wynik zmiany hasła. `flagCleared` mówi, czy udało się też wyczyścić serwerową
 * flagę — hasło może już być zmienione, nawet jeśli czyszczenie flagi zawiedzie.
 */
export type PasswordChangeResult =
  | { ok: true; flagCleared: boolean }
  | { ok: false; error: string };

/**
 * Orkiestruje zmianę hasła: walidacja → `updatePassword` → (dopiero po sukcesie)
 * `clearFlag`.
 *
 * - Walidacja nie przechodzi ⇒ `ok:false`, `updatePassword` NIE jest wołane.
 * - `updatePassword` zwraca błąd lub rzuca ⇒ `ok:false` z polskim komunikatem,
 *   flaga NIE jest czyszczona.
 * - Hasło zmienione, ale `clearFlag` zawiedzie ⇒ nadal `ok:true`,
 *   `flagCleared:false` (lokalnie odblokowujemy; serwerowa flaga zostanie i przy
 *   następnym logowaniu użytkownik ustawi kolejne nowe hasło).
 */
export async function performPasswordChange(
  args: PerformPasswordChangeArgs,
): Promise<PasswordChangeResult> {
  const { updatePassword, clearFlag, userId, password, confirm } = args;

  const validationError = validateNewPassword(password, confirm);
  if (validationError) return { ok: false, error: validationError };

  let updateError: AuthErrorLike | null;
  try {
    ({ error: updateError } = await updatePassword(password));
  } catch (thrown) {
    return { ok: false, error: mapThrownPasswordError(thrown) };
  }
  if (updateError) return { ok: false, error: mapPasswordChangeError(updateError) };

  // Hasło zmienione. Próba wyczyszczenia flagi jest best-effort.
  let flagCleared = false;
  try {
    const { error: clearError } = await clearFlag(userId);
    flagCleared = !clearError;
  } catch {
    flagCleared = false;
  }
  return { ok: true, flagCleared };
}

/** Odrzucony Promise `updateUser` (np. błąd sieci `fetch`) ⇒ komunikat połączenia. */
function mapThrownPasswordError(_error: unknown): string {
  return PASSWORD_MESSAGES.connection;
}
