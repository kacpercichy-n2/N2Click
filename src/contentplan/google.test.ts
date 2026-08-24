// Czysta część integracji z Dyskiem Google: cache tokenu (wstrzyknięty zegar +
// zamockowany klient GIS), budowa adresów pliku, mapowanie wyboru Pickera na
// media kanału i miękka walidacja konfiguracji. Sam Picker, `window` i sieć NIE
// są tu dotykane — to warstwa, którą da się przetestować w node.
import { describe, expect, it, vi } from 'vitest';
import {
  createTokenCache,
  driveErrorMessage,
  drivePreviewUrl,
  driveThumbUrl,
  driveViewUrl,
  GOOGLE_DRIVE_MISSING_CONFIG_REASON,
  GOOGLE_DRIVE_SCOPE,
  googleDriveDisabledReason,
  isGoogleDriveConfigured,
  mediaFromPickerDocument,
  mediaFromPickerSelection,
  pickerParentId,
  resolveGoogleDriveConfig,
  TOKEN_REFRESH_MARGIN_MS,
  type GoogleTokenGrant,
  type PickerDocument,
} from './google';

// ---- Zamockowany klient GIS ------------------------------------------------

interface GisResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Odpowiednik `initTokenClient(...).requestAccessToken()`: kolejka odpowiedzi
 *  Google, mapowana tak samo jak w module (callback => grant / błąd). */
function gisRequest(responses: GisResponse[]): {
  request: () => Promise<GoogleTokenGrant>;
  calls: () => number;
} {
  let calls = 0;
  const request = () =>
    new Promise<GoogleTokenGrant>((resolve, reject) => {
      calls += 1;
      const response = responses.shift() ?? { error: 'brak odpowiedzi w kolejce' };
      // Klient GIS odpowiada asynchronicznie (okno logowania).
      queueMicrotask(() => {
        if (response.error !== undefined) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        resolve({
          accessToken: response.access_token ?? '',
          ...(response.expires_in !== undefined ? { expiresInSeconds: response.expires_in } : {}),
        });
      });
    });
  return { request, calls: () => calls };
}

describe('createTokenCache', () => {
  it('pierwsze wywołanie pobiera token z klienta GIS', async () => {
    const gis = gisRequest([{ access_token: 'token-1', expires_in: 3600 }]);
    let now = 0;
    const getToken = createTokenCache(gis.request, () => now);
    await expect(getToken()).resolves.toBe('token-1');
    expect(gis.calls()).toBe(1);
  });

  it('kolejne wywołanie PRZED marginesem trafia w cache (bez drugiego logowania)', async () => {
    const gis = gisRequest([
      { access_token: 'token-1', expires_in: 3600 },
      { access_token: 'token-2', expires_in: 3600 },
    ]);
    let now = 0;
    const getToken = createTokenCache(gis.request, () => now);
    await getToken();
    // Tuż PRZED progiem odświeżenia (wygaśnięcie minus 60 s).
    now = 3600 * 1000 - TOKEN_REFRESH_MARGIN_MS - 1;
    await expect(getToken()).resolves.toBe('token-1');
    expect(gis.calls()).toBe(1);
  });

  it('po przekroczeniu progu (wygaśnięcie minus 60 s) bierze świeży token', async () => {
    const gis = gisRequest([
      { access_token: 'token-1', expires_in: 3600 },
      { access_token: 'token-2', expires_in: 3600 },
    ]);
    let now = 0;
    const getToken = createTokenCache(gis.request, () => now);
    await getToken();
    now = 3600 * 1000 - TOKEN_REFRESH_MARGIN_MS;
    await expect(getToken()).resolves.toBe('token-2');
    expect(gis.calls()).toBe(2);
  });

  it('brak `expires_in` daje domyślną godzinę ważności', async () => {
    const gis = gisRequest([{ access_token: 'token-1' }, { access_token: 'token-2' }]);
    let now = 0;
    const getToken = createTokenCache(gis.request, () => now);
    await getToken();
    now = 3600 * 1000 - TOKEN_REFRESH_MARGIN_MS - 1;
    await expect(getToken()).resolves.toBe('token-1');
    now = 3600 * 1000;
    await expect(getToken()).resolves.toBe('token-2');
  });

  it('równoległe wywołania dzielą JEDNO żądanie (jedno okno logowania)', async () => {
    const gis = gisRequest([{ access_token: 'token-1', expires_in: 3600 }]);
    const getToken = createTokenCache(gis.request, () => 0);
    const [a, b] = await Promise.all([getToken(), getToken()]);
    expect([a, b]).toEqual(['token-1', 'token-1']);
    expect(gis.calls()).toBe(1);
  });

  it('błąd logowania wraca do wołającego i NIE zatruwa cache', async () => {
    const gis = gisRequest([
      { error: 'access_denied', error_description: 'Logowanie Google przerwane.' },
      { access_token: 'token-1', expires_in: 3600 },
    ]);
    const getToken = createTokenCache(gis.request, () => 0);
    await expect(getToken()).rejects.toThrow('Logowanie Google przerwane.');
    await expect(getToken()).resolves.toBe('token-1');
    expect(gis.calls()).toBe(2);
  });
});

describe('adresy pliku Dysku', () => {
  it('miniatura ma domyślną szerokość 640 px', () => {
    expect(driveThumbUrl('file-1')).toBe(
      'https://drive.google.com/thumbnail?id=file-1&sz=w640',
    );
  });

  it('miniatura przyjmuje własną szerokość', () => {
    expect(driveThumbUrl('file-1', 160)).toBe(
      'https://drive.google.com/thumbnail?id=file-1&sz=w160',
    );
  });

  it('widok i podgląd stoją na tym samym id pliku', () => {
    expect(driveViewUrl('file-1')).toBe('https://drive.google.com/file/d/file-1/view');
    expect(drivePreviewUrl('file-1')).toBe('https://drive.google.com/file/d/file-1/preview');
  });
});

describe('wybór Pickera -> media kanału', () => {
  const image: PickerDocument = { id: 'file-1', name: 'kadr.png', mimeType: 'image/png' };

  it('pierwszy wybrany plik staje się mediami kanału', () => {
    expect(mediaFromPickerSelection([image])).toEqual({
      source: 'gdrive',
      fileId: 'file-1',
      type: 'image',
    });
  });

  it('multi-select bierze PIERWSZY dokument (model niesie jedno medium)', () => {
    const second: PickerDocument = { id: 'file-2', mimeType: 'image/png' };
    expect(mediaFromPickerSelection([image, second])?.fileId).toBe('file-1');
  });

  it('anulowanie i pusty wybór dają null', () => {
    expect(mediaFromPickerSelection(null)).toBeNull();
    expect(mediaFromPickerSelection(undefined)).toBeNull();
    expect(mediaFromPickerSelection([])).toBeNull();
  });

  it('mimeType video/* daje typ wideo, reszta obraz', () => {
    expect(mediaFromPickerDocument({ id: 'f', mimeType: 'video/mp4' })?.type).toBe('video');
    expect(mediaFromPickerDocument({ id: 'f', mimeType: 'application/pdf' })?.type).toBe('image');
    expect(mediaFromPickerDocument({ id: 'f' })?.type).toBe('image');
  });

  it('wymiary wchodzą tylko jako dodatnie liczby całkowite', () => {
    expect(mediaFromPickerDocument({ id: 'f', width: 1080, height: 1350 })).toEqual({
      source: 'gdrive',
      fileId: 'f',
      width: 1080,
      height: 1350,
      type: 'image',
    });
    expect(
      mediaFromPickerDocument({ id: 'f', width: 0, height: -2 } as PickerDocument),
    ).toEqual({ source: 'gdrive', fileId: 'f', type: 'image' });
  });

  it('dokument bez id oraz FOLDER nie dają mediów', () => {
    expect(mediaFromPickerDocument({ name: 'bez id' })).toBeNull();
    expect(
      mediaFromPickerDocument({ id: 'f', mimeType: 'application/vnd.google-apps.folder' }),
    ).toBeNull();
  });

  it('rodzic pierwszego pliku wchodzi do pamięci folderów', () => {
    expect(pickerParentId([{ id: 'file-1', parentId: 'folder-1' }])).toBe('folder-1');
    expect(pickerParentId([{ id: 'file-1' }])).toBeNull();
    expect(pickerParentId(null)).toBeNull();
  });
});

describe('miękka konfiguracja', () => {
  it('komplet zmiennych daje appId z prefiksu client_id', () => {
    expect(
      resolveGoogleDriveConfig({
        VITE_GOOGLE_CLIENT_ID: '123456789012-abc.apps.googleusercontent.com',
        VITE_GOOGLE_API_KEY: 'klucz',
      }),
    ).toEqual({
      clientId: '123456789012-abc.apps.googleusercontent.com',
      apiKey: 'klucz',
      appId: '123456789012',
    });
  });

  it('brak którejkolwiek zmiennej (albo puste białe znaki) wyłącza picker', () => {
    expect(resolveGoogleDriveConfig({ VITE_GOOGLE_CLIENT_ID: 'a' })).toBeNull();
    expect(resolveGoogleDriveConfig({ VITE_GOOGLE_API_KEY: 'b' })).toBeNull();
    expect(
      resolveGoogleDriveConfig({ VITE_GOOGLE_CLIENT_ID: '  ', VITE_GOOGLE_API_KEY: 'b' }),
    ).toBeNull();
  });

  it('bez zmiennych środowiskowych powód blokady jest po polsku', () => {
    // Lokalny `.env.local` definiuje prawdziwe zmienne Google, a Vitest wnosi
    // je do `import.meta.env` — „brak konfiguracji" trzeba wystubować jawnie,
    // inaczej test zależy od maszyny, na której biegnie.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('VITE_GOOGLE_API_KEY', '');
    try {
      expect(isGoogleDriveConfigured()).toBe(false);
      expect(googleDriveDisabledReason()).toBe(GOOGLE_DRIVE_MISSING_CONFIG_REASON);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(GOOGLE_DRIVE_MISSING_CONFIG_REASON).toContain('VITE_GOOGLE_CLIENT_ID');
    expect(GOOGLE_DRIVE_MISSING_CONFIG_REASON).toContain('VITE_GOOGLE_API_KEY');
  });

  it('komplet zmiennych odblokowuje przyciski', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '1-abc.apps.googleusercontent.com');
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'klucz');
    try {
      expect(isGoogleDriveConfigured()).toBe(true);
      expect(googleDriveDisabledReason()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('zakres OAuth jest zawężony do plików wskazanych przez użytkownika', () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});

describe('driveErrorMessage', () => {
  it('bierze komunikat błędu, a nieznany powód opisuje po polsku', () => {
    expect(driveErrorMessage(new Error('Logowanie Google przerwane.'))).toBe(
      'Logowanie Google przerwane.',
    );
    expect(driveErrorMessage(new Error('   '))).toBe('Nie udało się połączyć z Dyskiem Google.');
    expect(driveErrorMessage('cokolwiek')).toBe('Nie udało się połączyć z Dyskiem Google.');
  });
});
