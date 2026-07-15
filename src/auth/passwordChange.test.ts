import { describe, expect, it, vi } from 'vitest';
import { AUTH_MESSAGES, type AuthErrorLike } from './session';
import {
  PASSWORD_MESSAGES,
  loadMustChangePassword,
  mapPasswordChangeError,
  performPasswordChange,
  validateNewPassword,
} from './passwordChange';

// Hasła w testach to wyłącznie oczywiste atrapy.
const DUMMY = 'nowe-haslo-123';

// ---- validateNewPassword ----------------------------------------------------

describe('validateNewPassword', () => {
  it('odrzuca puste hasło', () => {
    expect(validateNewPassword('', '')).toBe(PASSWORD_MESSAGES.empty);
  });

  it('odrzuca hasło krótsze niż 8 znaków', () => {
    expect(validateNewPassword('abc', 'abc')).toBe(PASSWORD_MESSAGES.tooShort);
  });

  it('odrzuca niezgodne powtórzenie', () => {
    expect(validateNewPassword(DUMMY, 'inne-haslo-123')).toBe(PASSWORD_MESSAGES.mismatch);
  });

  it('zwraca null, gdy hasło jest poprawne i zgodne', () => {
    expect(validateNewPassword(DUMMY, DUMMY)).toBeNull();
  });
});

// ---- mapPasswordChangeError -------------------------------------------------

describe('mapPasswordChangeError', () => {
  it('mapuje same_password (po kodzie i po komunikacie)', () => {
    expect(mapPasswordChangeError({ code: 'same_password' })).toBe(
      PASSWORD_MESSAGES.samePassword,
    );
    expect(
      mapPasswordChangeError({ message: 'New password should be different from the old password.' }),
    ).toBe(PASSWORD_MESSAGES.samePassword);
  });

  it('mapuje weak_password', () => {
    expect(mapPasswordChangeError({ code: 'weak_password' })).toBe(
      PASSWORD_MESSAGES.weakPassword,
    );
    expect(mapPasswordChangeError({ message: 'Password is too weak' })).toBe(
      PASSWORD_MESSAGES.weakPassword,
    );
  });

  it('mapuje błędy sieci na komunikat połączenia', () => {
    expect(mapPasswordChangeError({ message: 'Failed to fetch' })).toBe(
      AUTH_MESSAGES.connection,
    );
  });

  it('nie ujawnia surowego tekstu SDK dla nieznanych błędów', () => {
    const raw = 'PostgREST 42501 permission denied for table profiles';
    const mapped = mapPasswordChangeError({ message: raw });
    expect(mapped).toBe(PASSWORD_MESSAGES.unexpected);
    expect(mapped).not.toContain('PostgREST');
    expect(mapPasswordChangeError(null)).toBe(PASSWORD_MESSAGES.unexpected);
  });
});

// ---- loadMustChangePassword (fail-open) -------------------------------------

describe('loadMustChangePassword', () => {
  it('zwraca true, gdy flaga to true', async () => {
    const fetcher = vi.fn(async () => ({ value: true, error: null }));
    expect(await loadMustChangePassword(fetcher, 'u1')).toBe(true);
  });

  it('zwraca false, gdy flaga to false', async () => {
    const fetcher = vi.fn(async () => ({ value: false, error: null }));
    expect(await loadMustChangePassword(fetcher, 'u1')).toBe(false);
  });

  it('fail-open: value === null ⇒ false', async () => {
    const fetcher = vi.fn(async () => ({ value: null, error: null }));
    expect(await loadMustChangePassword(fetcher, 'u1')).toBe(false);
  });

  it('fail-open: błąd zapytania ⇒ false', async () => {
    const fetcher = vi.fn(async () => ({ value: true, error: { message: 'boom' } }));
    expect(await loadMustChangePassword(fetcher, 'u1')).toBe(false);
  });

  it('fail-open: odrzucony Promise ⇒ false', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await loadMustChangePassword(fetcher, 'u1')).toBe(false);
  });
});

// ---- performPasswordChange --------------------------------------------------

describe('performPasswordChange', () => {
  it('sukces: zmienia hasło i czyści flagę', async () => {
    const updatePassword = vi.fn(async () => ({ error: null }));
    const clearFlag = vi.fn(async () => ({ error: null }));
    const result = await performPasswordChange({
      updatePassword,
      clearFlag,
      userId: 'u1',
      password: DUMMY,
      confirm: DUMMY,
    });
    expect(result).toEqual({ ok: true, flagCleared: true });
    expect(updatePassword).toHaveBeenCalledWith(DUMMY);
    expect(clearFlag).toHaveBeenCalledWith('u1');
  });

  it('błąd updateUser: NIE czyści flagi i zwraca polski komunikat', async () => {
    const updatePassword = vi.fn(async () => ({
      error: { code: 'same_password' } as AuthErrorLike,
    }));
    const clearFlag = vi.fn(async () => ({ error: null }));
    const result = await performPasswordChange({
      updatePassword,
      clearFlag,
      userId: 'u1',
      password: DUMMY,
      confirm: DUMMY,
    });
    expect(result).toEqual({ ok: false, error: PASSWORD_MESSAGES.samePassword });
    expect(clearFlag).not.toHaveBeenCalled();
  });

  it('wyjątek updateUser ⇒ ok:false z komunikatem połączenia, flaga nietknięta', async () => {
    const updatePassword = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const clearFlag = vi.fn(async () => ({ error: null }));
    const result = await performPasswordChange({
      updatePassword,
      clearFlag,
      userId: 'u1',
      password: DUMMY,
      confirm: DUMMY,
    });
    expect(result).toEqual({ ok: false, error: PASSWORD_MESSAGES.connection });
    expect(clearFlag).not.toHaveBeenCalled();
  });

  it('sukces hasła + błąd clearFlag ⇒ ok:true, flagCleared:false', async () => {
    const updatePassword = vi.fn(async () => ({ error: null }));
    const clearFlag = vi.fn(async () => ({ error: { message: 'row-level security' } }));
    const result = await performPasswordChange({
      updatePassword,
      clearFlag,
      userId: 'u1',
      password: DUMMY,
      confirm: DUMMY,
    });
    expect(result).toEqual({ ok: true, flagCleared: false });
  });

  it('walidacja zatrzymuje przed updateUser (updatePassword nie wywołane)', async () => {
    const updatePassword = vi.fn(async () => ({ error: null }));
    const clearFlag = vi.fn(async () => ({ error: null }));
    const result = await performPasswordChange({
      updatePassword,
      clearFlag,
      userId: 'u1',
      password: 'abc',
      confirm: 'abc',
    });
    expect(result).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooShort });
    expect(updatePassword).not.toHaveBeenCalled();
    expect(clearFlag).not.toHaveBeenCalled();
  });
});
