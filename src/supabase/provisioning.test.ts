// Testy czystego kontraktu provisioningu konta (contract.ts z Edge Function).
// Importujemy WYŁĄCZNIE moduł kontraktu (bez SDK, bez globali Deno) — dzięki
// temu jest deterministyczny w środowisku node (patrz vitest.config.ts).
// Świadomie ściągamy plik spoza `src/` z jawnym rozszerzeniem `.ts`.
import { describe, expect, it } from 'vitest';
import {
  PROVISIONING_MESSAGES,
  authorizeProvisioning,
  parseProvisionRequest,
  validateManagerRelationship,
  type ProvisionAccountRequest,
} from '../../supabase/functions/provision-account/contract.ts';

const NO_DOMAINS = { allowedEmailDomains: [] as string[] };
const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174999';

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Anna',
    email: 'anna@example.com',
    accessRole: 'worker',
    initialPassword: { mode: 'invite' },
    ...overrides,
  };
}

function parseOk(input: Record<string, unknown>, options = NO_DOMAINS): ProvisionAccountRequest {
  const result = parseProvisionRequest(input, options);
  if (!result.ok) throw new Error(`Oczekiwano sukcesu, otrzymano: ${result.message}`);
  return result.value;
}

describe('parseProvisionRequest — e-mail', () => {
  it('normalizuje e-mail (przycięcie + małe litery)', () => {
    const value = parseOk(baseInput({ email: '  Anna.Kowalska@Example.COM  ' }));
    expect(value.email).toBe('anna.kowalska@example.com');
  });

  it('odrzuca brak e-maila', () => {
    const result = parseProvisionRequest(baseInput({ email: '   ' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.emailRequired });
  });

  it('odrzuca e-mail o złym formacie', () => {
    for (const bad of ['brak-malpy', 'a@b', 'a@@b.com', 'a @b.com', '@example.com', 'a@example']) {
      const result = parseProvisionRequest(baseInput({ email: bad }), NO_DOMAINS);
      expect(result.ok).toBe(false);
    }
  });

  it('egzekwuje dozwoloną domenę, gdy lista jest niepusta', () => {
    const options = { allowedEmailDomains: ['firma.pl'] };
    expect(parseProvisionRequest(baseInput({ email: 'jan@firma.pl' }), options).ok).toBe(true);
    const denied = parseProvisionRequest(baseInput({ email: 'jan@inna.pl' }), options);
    expect(denied).toEqual({ ok: false, message: PROVISIONING_MESSAGES.emailDomainNotAllowed });
  });

  it('dopuszcza dowolną domenę, gdy lista jest pusta', () => {
    expect(parseProvisionRequest(baseInput({ email: 'jan@cokolwiek.io' }), NO_DOMAINS).ok).toBe(true);
  });
});

describe('parseProvisionRequest — pola tekstowe', () => {
  it('wymaga imienia', () => {
    const result = parseProvisionRequest(baseInput({ firstName: '   ' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.firstNameRequired });
  });

  it('odrzuca imię dłuższe niż 100 znaków', () => {
    const result = parseProvisionRequest(baseInput({ firstName: 'x'.repeat(101) }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.firstNameTooLong });
  });

  it('przycina imię', () => {
    expect(parseOk(baseInput({ firstName: '  Ewa  ' })).firstName).toBe('Ewa');
  });

  it('domyślnie ustawia lastName i roleTitle na pusty łańcuch', () => {
    const value = parseOk(baseInput());
    expect(value.lastName).toBe('');
    expect(value.roleTitle).toBe('');
  });

  it('odrzuca nazwisko dłuższe niż 100 znaków', () => {
    const result = parseProvisionRequest(baseInput({ lastName: 'y'.repeat(101) }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.lastNameTooLong });
  });

  it('odrzuca stanowisko dłuższe niż 200 znaków', () => {
    const result = parseProvisionRequest(baseInput({ roleTitle: 'z'.repeat(201) }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.roleTitleTooLong });
  });
});

describe('parseProvisionRequest — accessRole', () => {
  it('akceptuje trzy wartości enum', () => {
    for (const role of ['administrator', 'manager', 'worker'] as const) {
      expect(parseOk(baseInput({ accessRole: role })).accessRole).toBe(role);
    }
  });

  it('odrzuca nieznaną rolę', () => {
    const result = parseProvisionRequest(baseInput({ accessRole: 'pm' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.accessRoleInvalid });
  });
});

describe('parseProvisionRequest — uuid', () => {
  it('akceptuje poprawne uuid i traktuje puste/null jako null', () => {
    expect(parseOk(baseInput({ departmentId: UUID_A })).departmentId).toBe(UUID_A);
    expect(parseOk(baseInput({ departmentId: null })).departmentId).toBeNull();
    expect(parseOk(baseInput({ departmentId: '   ' })).departmentId).toBeNull();
    expect(parseOk(baseInput({ managerProfileId: UUID_B })).managerProfileId).toBe(UUID_B);
  });

  it('odrzuca niepoprawne uuid działu', () => {
    const result = parseProvisionRequest(baseInput({ departmentId: 'nie-uuid' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.departmentIdInvalid });
  });

  it('odrzuca niepoprawne uuid menedżera', () => {
    const result = parseProvisionRequest(baseInput({ managerProfileId: '123' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.managerProfileIdInvalid });
  });
});

describe('parseProvisionRequest — initialPassword', () => {
  it('odrzuca nieznany tryb', () => {
    const result = parseProvisionRequest(
      baseInput({ initialPassword: { mode: 'magic' } }),
      NO_DOMAINS,
    );
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.initialPasswordInvalid });
  });

  it('odrzuca brak obiektu trybu hasła', () => {
    const result = parseProvisionRequest(baseInput({ initialPassword: 'invite' }), NO_DOMAINS);
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.initialPasswordInvalid });
  });

  it('odrzuca hasło tymczasowe krótsze niż 8 znaków bez ujawniania wartości', () => {
    const secret = 'abc';
    const result = parseProvisionRequest(
      baseInput({ initialPassword: { mode: 'temporary-password', password: secret } }),
      NO_DOMAINS,
    );
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.passwordTooShort });
    if (!result.ok) expect(result.message).not.toContain(secret);
  });

  it('akceptuje tryb invite', () => {
    expect(parseOk(baseInput()).initialPassword).toEqual({ mode: 'invite' });
  });

  it('akceptuje poprawne hasło tymczasowe', () => {
    const value = parseOk(
      baseInput({ initialPassword: { mode: 'temporary-password', password: 'trudneHaslo1' } }),
    );
    expect(value.initialPassword).toEqual({
      mode: 'temporary-password',
      password: 'trudneHaslo1',
    });
  });
});

describe('authorizeProvisioning', () => {
  it('odrzuca brak profilu (null/undefined) z 403', () => {
    for (const caller of [null, undefined]) {
      const result = authorizeProvisioning(caller);
      expect(result).toEqual({
        ok: false,
        status: 403,
        message: PROVISIONING_MESSAGES.notAdministrator,
      });
    }
  });

  it('odrzuca workera i menedżera z 403', () => {
    for (const role of ['worker', 'manager']) {
      const result = authorizeProvisioning({ access_role: role });
      expect(result.ok).toBe(false);
    }
  });

  it('dopuszcza administratora', () => {
    expect(authorizeProvisioning({ access_role: 'administrator' })).toEqual({ ok: true });
  });
});

describe('validateManagerRelationship', () => {
  const req = (managerProfileId: string | null, departmentId: string | null) => ({
    managerProfileId,
    departmentId,
  });

  it('jest ok, gdy nie wskazano menedżera', () => {
    expect(validateManagerRelationship(null, req(null, UUID_A))).toEqual({ ok: true });
  });

  it('odrzuca brak profilu menedżera', () => {
    expect(validateManagerRelationship(null, req(UUID_B, UUID_A))).toEqual({
      ok: false,
      message: PROVISIONING_MESSAGES.managerNotFound,
    });
  });

  it('odrzuca profil, który nie jest menedżerem', () => {
    const manager = { id: UUID_B, access_role: 'worker', department_id: UUID_A };
    expect(validateManagerRelationship(manager, req(UUID_B, UUID_A))).toEqual({
      ok: false,
      message: PROVISIONING_MESSAGES.managerNotManager,
    });
  });

  it('odrzuca menedżera bez działu', () => {
    const manager = { id: UUID_B, access_role: 'manager', department_id: null };
    expect(validateManagerRelationship(manager, req(UUID_B, UUID_A))).toEqual({
      ok: false,
      message: PROVISIONING_MESSAGES.managerDepartmentMismatch,
    });
  });

  it('odrzuca niezgodność działu menedżera z żądaniem', () => {
    const manager = { id: UUID_B, access_role: 'manager', department_id: UUID_B };
    expect(validateManagerRelationship(manager, req(UUID_B, UUID_A))).toEqual({
      ok: false,
      message: PROVISIONING_MESSAGES.managerDepartmentMismatch,
    });
  });

  it('jest ok dla menedżera zarządzającego wskazanym działem', () => {
    const manager = { id: UUID_B, access_role: 'manager', department_id: UUID_A };
    expect(validateManagerRelationship(manager, req(UUID_B, UUID_A))).toEqual({ ok: true });
  });
});

describe('parseProvisionRequest — pełny, zaszumiony ładunek', () => {
  it('parsuje surowe dane do znormalizowanej wartości', () => {
    const value = parseOk(
      {
        firstName: '  Jan  ',
        lastName: '  Nowak  ',
        email: '  Jan.Nowak@Firma.PL ',
        roleTitle: '  Specjalista  ',
        departmentId: UUID_A,
        managerProfileId: UUID_B,
        accessRole: 'worker',
        initialPassword: { mode: 'temporary-password', password: 'haslo123!' },
      },
      { allowedEmailDomains: ['firma.pl'] },
    );
    expect(value).toEqual({
      firstName: 'Jan',
      lastName: 'Nowak',
      email: 'jan.nowak@firma.pl',
      roleTitle: 'Specjalista',
      departmentId: UUID_A,
      managerProfileId: UUID_B,
      accessRole: 'worker',
      initialPassword: { mode: 'temporary-password', password: 'haslo123!' },
    });
  });
});
