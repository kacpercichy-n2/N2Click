// Czysty kontrakt i walidacja provisioningu konta N2Hub.
//
// Ten moduł jest CELOWO pozbawiony jakichkolwiek zależności: nie importuje SDK
// (@supabase/supabase-js), nie używa globali Deno ani Node, nie czyta env. Dzięki
// temu konsumuje go zarówno bundler Deno (Edge Function `index.ts`), jak i
// tsc/vitest po stronie repo (test `src/supabase/provisioning.test.ts` ściąga go
// tranzytywnie pod `tsc --noEmit` z ustawieniami strict). Cała logika jest
// czysta i deterministyczna.
//
// Nigdy nie logujemy ani nie zwracamy wartości hasła.

/** Polskie komunikaty provisioningu — nigdy surowy tekst SDK ani wartości sekretów. */
export const PROVISIONING_MESSAGES = {
  // Autoryzacja / uwierzytelnienie (warstwa transportu w index.ts).
  missingAuthorization: 'Brak autoryzacji.',
  invalidSession: 'Nieprawidłowa lub wygasła sesja.',
  notAdministrator: 'Brak uprawnień administratora.',
  // Metoda / ciało żądania.
  methodNotAllowed: 'Niedozwolona metoda.',
  malformedJson: 'Nieprawidłowe dane wejściowe: treść żądania nie jest poprawnym JSON-em.',
  invalidBody: 'Nieprawidłowe dane wejściowe.',
  // Walidacja pól.
  firstNameRequired: 'Nieprawidłowe dane wejściowe: imię jest wymagane (1–100 znaków).',
  firstNameTooLong: 'Nieprawidłowe dane wejściowe: imię może mieć najwyżej 100 znaków.',
  lastNameTooLong: 'Nieprawidłowe dane wejściowe: nazwisko może mieć najwyżej 100 znaków.',
  roleTitleTooLong: 'Nieprawidłowe dane wejściowe: stanowisko może mieć najwyżej 200 znaków.',
  emailRequired: 'Nieprawidłowe dane wejściowe: adres e-mail jest wymagany.',
  emailInvalid: 'Nieprawidłowe dane wejściowe: adres e-mail ma nieprawidłowy format.',
  emailDomainNotAllowed: 'Nieprawidłowe dane wejściowe: domena adresu e-mail nie jest dozwolona.',
  accessRoleInvalid:
    'Nieprawidłowe dane wejściowe: rola dostępu musi być jedną z: administrator, manager, worker.',
  departmentIdInvalid: 'Nieprawidłowe dane wejściowe: identyfikator działu ma nieprawidłowy format.',
  managerProfileIdInvalid:
    'Nieprawidłowe dane wejściowe: identyfikator profilu menedżera ma nieprawidłowy format.',
  initialPasswordInvalid: 'Nieprawidłowe dane wejściowe: nieprawidłowy tryb hasła początkowego.',
  passwordTooShort: 'Nieprawidłowe dane wejściowe: hasło musi mieć co najmniej 8 znaków.',
  // Spójność powiązań.
  departmentNotFound: 'Nieprawidłowe dane wejściowe: wskazany dział nie istnieje.',
  managerNotFound: 'Nieprawidłowe dane wejściowe: wskazany profil menedżera nie istnieje.',
  managerNotManager: 'Nieprawidłowe dane wejściowe: wskazany profil nie jest menedżerem.',
  managerDepartmentMismatch:
    'Nieprawidłowe dane wejściowe: wskazany menedżer nie zarządza wybranym działem.',
  // Tworzenie konta.
  emailAlreadyExists: 'Konto z tym adresem e-mail już istnieje.',
  serverConfig: 'Błąd serwera: nieprawidłowa konfiguracja serwera.',
  serverError: 'Błąd serwera. Spróbuj ponownie później.',
} as const;

/** Dozwolone role dostępu (odzwierciedla enum `public.access_role` w migracji rdzenia). */
export const ACCESS_ROLES = ['administrator', 'manager', 'worker'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

/**
 * Minimalna długość hasła tymczasowego. LUSTRO wobec `MIN_PASSWORD_LENGTH` z
 * `src/auth/passwordChange.ts` (nie importujemy go — bundling Edge musi zostać
 * w obrębie `supabase/functions/`).
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Górne granice długości pól tekstowych (lustro `check`ów z migracji rdzenia). */
const FIRST_NAME_MAX = 100;
const LAST_NAME_MAX = 100;
const ROLE_TITLE_MAX = 200;

/** Tryb hasła początkowego: zaproszenie e-mail albo hasło tymczasowe. */
export type InitialPassword =
  | { mode: 'invite' }
  | { mode: 'temporary-password'; password: string };

/**
 * Bazowe hasło startowe nadawane każdemu nowo zakładanemu kontu z UI. Serwer
 * zawsze ustawia `must_change_password: true`, więc użytkownik musi je zmienić
 * przy pierwszym logowaniu — to hasło jednorazowe, nie sekret długoterminowy.
 */
export const DEFAULT_INITIAL_PASSWORD = 'N2Media2026!';

/** Znormalizowany, zwalidowany kontrakt żądania provisioningu. */
export interface ProvisionAccountRequest {
  firstName: string;
  lastName: string;
  email: string;
  roleTitle: string;
  departmentId: string | null;
  managerProfileId: string | null;
  accessRole: AccessRole;
  initialPassword: InitialPassword;
}

/** Wynik parsowania: sukces ze znormalizowaną wartością albo polski komunikat. */
export type ParseResult =
  | { ok: true; value: ProvisionAccountRequest }
  | { ok: false; message: string };

export interface ParseOptions {
  /** Dozwolone domeny e-mail. Pusta lista = dowolna domena dozwolona. */
  allowedEmailDomains: string[];
}

// --- Pomocnicze: format e-mail i uuid ----------------------------------------

/**
 * Normalizuje e-mail do porównań: przycięcie + małe litery. LUSTRO semantyki
 * `normalizeEmail` z `src/auth/profile.ts` (nie importujemy go — Edge bundling
 * musi zostać w `supabase/functions/`).
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Rozsądny (nie wyczerpujący RFC) format e-mail: dokładnie jedno `@`, brak spacji. */
function isValidEmailFormat(email: string): boolean {
  if (email.length === 0 || email.length > 320) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || domain.length === 0) return false;
  if (/\s/.test(email)) return false;
  // Domena: etykiety rozdzielone kropką, co najmniej jedna kropka, sensowne znaki.
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  if (!domain.includes('.')) return false;
  return true;
}

/** Zwraca część domenową znormalizowanego e-maila (po jedynym `@`). */
function emailDomain(normalizedEmail: string): string {
  return normalizedEmail.slice(normalizedEmail.indexOf('@') + 1);
}

/** Kanoniczny format uuid (dowolna wersja) — 8-4-4-4-12 znaków hex. */
function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// --- Parsowanie żądania -------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/**
 * Waliduje defensywnie nieznany JSON (błędne typy, brak pól, nieznany
 * `initialPassword.mode`, złe uuid) i zwraca znormalizowany kontrakt.
 */
export function parseProvisionRequest(input: unknown, options: ParseOptions): ParseResult {
  if (!isPlainObject(input)) return fail(PROVISIONING_MESSAGES.invalidBody);

  // firstName — wymagane, przycięte, 1–100.
  if (typeof input.firstName !== 'string') return fail(PROVISIONING_MESSAGES.firstNameRequired);
  const firstName = input.firstName.trim();
  if (firstName.length < 1) return fail(PROVISIONING_MESSAGES.firstNameRequired);
  if (firstName.length > FIRST_NAME_MAX) return fail(PROVISIONING_MESSAGES.firstNameTooLong);

  // lastName — opcjonalne, przycięte, ≤ 100, domyślnie ''.
  let lastName = '';
  if (input.lastName !== undefined && input.lastName !== null) {
    if (typeof input.lastName !== 'string') return fail(PROVISIONING_MESSAGES.lastNameTooLong);
    lastName = input.lastName.trim();
    if (lastName.length > LAST_NAME_MAX) return fail(PROVISIONING_MESSAGES.lastNameTooLong);
  }

  // roleTitle — opcjonalne, przycięte, ≤ 200, domyślnie ''.
  let roleTitle = '';
  if (input.roleTitle !== undefined && input.roleTitle !== null) {
    if (typeof input.roleTitle !== 'string') return fail(PROVISIONING_MESSAGES.roleTitleTooLong);
    roleTitle = input.roleTitle.trim();
    if (roleTitle.length > ROLE_TITLE_MAX) return fail(PROVISIONING_MESSAGES.roleTitleTooLong);
  }

  // email — wymagane; normalizacja trim + lowercase, sensowny format, opcjonalna domena.
  if (typeof input.email !== 'string') return fail(PROVISIONING_MESSAGES.emailRequired);
  const email = normalizeEmail(input.email);
  if (email.length === 0) return fail(PROVISIONING_MESSAGES.emailRequired);
  if (!isValidEmailFormat(email)) return fail(PROVISIONING_MESSAGES.emailInvalid);
  if (options.allowedEmailDomains.length > 0) {
    const allowed = options.allowedEmailDomains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0);
    if (allowed.length > 0 && !allowed.includes(emailDomain(email))) {
      return fail(PROVISIONING_MESSAGES.emailDomainNotAllowed);
    }
  }

  // accessRole — musi być jedną z trzech wartości enum.
  if (typeof input.accessRole !== 'string' || !ACCESS_ROLES.includes(input.accessRole as AccessRole)) {
    return fail(PROVISIONING_MESSAGES.accessRoleInvalid);
  }
  const accessRole = input.accessRole as AccessRole;

  // departmentId — opcjonalne uuid lub null.
  const departmentId = parseOptionalUuid(input.departmentId);
  if (departmentId === INVALID) return fail(PROVISIONING_MESSAGES.departmentIdInvalid);

  // managerProfileId — opcjonalne uuid lub null.
  const managerProfileId = parseOptionalUuid(input.managerProfileId);
  if (managerProfileId === INVALID) return fail(PROVISIONING_MESSAGES.managerProfileIdInvalid);

  // initialPassword — unia tagowana.
  const initialPassword = parseInitialPassword(input.initialPassword);
  if (initialPassword.ok === false) return fail(initialPassword.message);

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      roleTitle,
      departmentId,
      managerProfileId,
      accessRole,
      initialPassword: initialPassword.value,
    },
  };
}

// Sentinel dla nieprawidłowego uuid (odróżnia od poprawnego `null`).
const INVALID = Symbol('invalid-uuid');

function parseOptionalUuid(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!isValidUuid(trimmed)) return INVALID;
  return trimmed;
}

function parseInitialPassword(
  value: unknown,
): { ok: true; value: InitialPassword } | { ok: false; message: string } {
  if (!isPlainObject(value)) return fail(PROVISIONING_MESSAGES.initialPasswordInvalid);
  const mode = value.mode;
  if (mode === 'invite') {
    return { ok: true, value: { mode: 'invite' } };
  }
  if (mode === 'temporary-password') {
    // Uwaga: nigdy nie umieszczamy wartości hasła w komunikatach błędów.
    if (typeof value.password !== 'string') return fail(PROVISIONING_MESSAGES.passwordTooShort);
    if (value.password.length < MIN_PASSWORD_LENGTH) return fail(PROVISIONING_MESSAGES.passwordTooShort);
    return { ok: true, value: { mode: 'temporary-password', password: value.password } };
  }
  return fail(PROVISIONING_MESSAGES.initialPasswordInvalid);
}

// --- Autoryzacja --------------------------------------------------------------

export type AuthorizeResult = { ok: true } | { ok: false; status: 403; message: string };

/**
 * Tylko profil z `access_role === 'administrator'` może zakładać konta. Brak
 * profilu, null lub inna rola → 403 z polskim komunikatem.
 */
export function authorizeProvisioning(
  callerProfile: { access_role: string } | null | undefined,
): AuthorizeResult {
  if (callerProfile && callerProfile.access_role === 'administrator') {
    return { ok: true };
  }
  return { ok: false, status: 403, message: PROVISIONING_MESSAGES.notAdministrator };
}

// --- Spójność powiązania z menedżerem ----------------------------------------

export type ManagerRelationshipResult = { ok: true } | { ok: false; message: string };

/**
 * Sprawdza spójność powiązania z menedżerem. W modelu N2Hub NIE ma kolumny
 * `manager_id`: menedżer to profil z `access_role = 'manager'`, którego
 * `department_id` wskazuje zarządzany dział. Gdy żądanie wskazuje menedżera,
 * jego profil musi istnieć, być menedżerem, a jego dział musi być niepusty i
 * równy `departmentId` z żądania. Brak `managerProfileId` → ok (nie żądano
 * powiązania).
 */
export function validateManagerRelationship(
  manager: { id: string; access_role: string; department_id: string | null } | null,
  request: { managerProfileId: string | null; departmentId: string | null },
): ManagerRelationshipResult {
  if (request.managerProfileId === null) return { ok: true };
  if (!manager) return fail(PROVISIONING_MESSAGES.managerNotFound);
  if (manager.access_role !== 'manager') return fail(PROVISIONING_MESSAGES.managerNotManager);
  if (manager.department_id === null) return fail(PROVISIONING_MESSAGES.managerDepartmentMismatch);
  if (manager.department_id !== request.departmentId) {
    return fail(PROVISIONING_MESSAGES.managerDepartmentMismatch);
  }
  return { ok: true };
}
