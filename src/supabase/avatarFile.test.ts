// Testy czystej walidacji awatara: dozwolone/odrzucone typy, dopasowanie po
// rozszerzeniu, granice rozmiaru, dokładne polskie komunikaty, budowniczy
// ścieżki oraz decyzja cache podpisanego URL z wstrzykniętym zegarem.
import { describe, expect, it } from 'vitest';
import {
  AVATAR_ERRORS,
  AVATAR_MAX_BYTES,
  AVATAR_URL_TTL_SECONDS,
  avatarObjectPath,
  cachedSignedUrl,
  validateAvatarFile,
  type SignedUrlEntry,
} from './avatarFile';

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'x.png',
  type: 'image/png',
  size: 1024,
  ...over,
});

describe('validateAvatarFile — akceptowane typy', () => {
  it('akceptuje JPEG, PNG i WebP po MIME', () => {
    expect(validateAvatarFile(file({ type: 'image/jpeg' }))).toEqual({ ok: true, ext: 'jpg' });
    expect(validateAvatarFile(file({ type: 'image/png' }))).toEqual({ ok: true, ext: 'png' });
    expect(validateAvatarFile(file({ type: 'image/webp' }))).toEqual({ ok: true, ext: 'webp' });
  });

  it('jest niewrażliwy na wielkość liter w MIME', () => {
    expect(validateAvatarFile(file({ type: 'IMAGE/JPEG' }))).toEqual({ ok: true, ext: 'jpg' });
  });

  it('dopasowuje po rozszerzeniu, gdy typ jest pusty (jpg/jpeg/png/webp)', () => {
    expect(validateAvatarFile(file({ type: '', name: 'photo.JPG' }))).toEqual({ ok: true, ext: 'jpg' });
    expect(validateAvatarFile(file({ type: '', name: 'photo.jpeg' }))).toEqual({ ok: true, ext: 'jpg' });
    expect(validateAvatarFile(file({ type: '', name: 'photo.png' }))).toEqual({ ok: true, ext: 'png' });
    expect(validateAvatarFile(file({ type: '', name: 'photo.webp' }))).toEqual({ ok: true, ext: 'webp' });
  });
});

describe('validateAvatarFile — odrzucone typy', () => {
  it('odrzuca gif/svg/pdf i nieznane rozszerzenie przy pustym typie', () => {
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf']) {
      expect(validateAvatarFile(file({ type }))).toEqual({ ok: false, error: AVATAR_ERRORS.type });
    }
    expect(validateAvatarFile(file({ type: '', name: 'doc.pdf' }))).toEqual({
      ok: false,
      error: AVATAR_ERRORS.type,
    });
    expect(validateAvatarFile(file({ type: '', name: 'noext' }))).toEqual({
      ok: false,
      error: AVATAR_ERRORS.type,
    });
  });

  it('używa dokładnego polskiego komunikatu formatu', () => {
    expect(AVATAR_ERRORS.type).toBe('Nieobsługiwany format pliku. Dozwolone formaty: JPG, PNG, WebP.');
  });
});

describe('validateAvatarFile — rozmiar', () => {
  it('odrzuca plik 0-bajtowy dopiero po sprawdzeniu typu', () => {
    expect(validateAvatarFile(file({ size: 0 }))).toEqual({ ok: false, error: AVATAR_ERRORS.empty });
    // zły typ ma pierwszeństwo nad pustym plikiem
    expect(validateAvatarFile(file({ type: 'image/gif', size: 0 }))).toEqual({
      ok: false,
      error: AVATAR_ERRORS.type,
    });
    expect(AVATAR_ERRORS.empty).toBe('Plik jest pusty.');
  });

  it('akceptuje dokładnie 2 MB, odrzuca 2 MB + 1', () => {
    expect(validateAvatarFile(file({ size: AVATAR_MAX_BYTES }))).toEqual({ ok: true, ext: 'png' });
    expect(validateAvatarFile(file({ size: AVATAR_MAX_BYTES + 1 }))).toEqual({
      ok: false,
      error: AVATAR_ERRORS.tooBig,
    });
    expect(AVATAR_ERRORS.tooBig).toBe('Plik jest za duży (maksymalnie 2 MB).');
  });
});

describe('avatarObjectPath', () => {
  it('buduje ścieżkę wg konwencji <id profilu>/avatar.<ext>', () => {
    expect(avatarObjectPath('abc-123', 'webp')).toBe('abc-123/avatar.webp');
  });
});

describe('cachedSignedUrl', () => {
  const now = 1_000_000;
  const fresh = (): Map<string, SignedUrlEntry> =>
    new Map([['p/avatar.png', { url: 'https://signed', expiresAtMs: now + AVATAR_URL_TTL_SECONDS * 1000 }]]);

  it('zwraca null przy pudle (brak wpisu)', () => {
    expect(cachedSignedUrl(new Map(), 'p/avatar.png', now)).toBeNull();
  });

  it('zwraca URL, gdy do wygaśnięcia zostaje więcej niż margines', () => {
    expect(cachedSignedUrl(fresh(), 'p/avatar.png', now)).toBe('https://signed');
  });

  it('zwraca null w oknie marginesu (odświeżenia)', () => {
    // margines 300 s: wpis wygasa za dokładnie 300 s → już do odświeżenia
    const cache = fresh();
    const expiry = now + AVATAR_URL_TTL_SECONDS * 1000;
    expect(cachedSignedUrl(cache, 'p/avatar.png', expiry - 300 * 1000)).toBeNull();
    // 301 s do wygaśnięcia → nadal ważny
    expect(cachedSignedUrl(cache, 'p/avatar.png', expiry - 301 * 1000)).toBe('https://signed');
  });

  it('zwraca null po wygaśnięciu', () => {
    const cache = fresh();
    expect(cachedSignedUrl(cache, 'p/avatar.png', now + AVATAR_URL_TTL_SECONDS * 1000 + 1)).toBeNull();
  });
});
