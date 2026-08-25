// Podpięcie konta Google do importu kalendarza: GIS w trybie AUTHORIZATION CODE
// (popup), ten sam klient OAuth i ten sam leniwie ładowany skrypt co Dysk
// w Content Planie (`contentplan/google.ts`). Wynikiem jest JEDNORAZOWY kod,
// który Edge Function `google-calendar-connect` wymienia na refresh token po
// stronie serwera — przeglądarka nigdy nie widzi ani sekretu klienta, ani
// refresh tokenu (dlatego nie `initTokenClient`: tamten model wymaga
// obecności użytkownika i nie da syncu w tle).
//
// Konfiguracja jest MIĘKKA: brak `VITE_GOOGLE_CLIENT_ID` daje polski powód
// blokady przycisku zamiast wyjątku przy imporcie.
import { GIS_SRC, loadScript, resolveGoogleDriveConfig } from '../contentplan/google';
import { GCAL_MESSAGES } from './types';

/** Zakresy importu (tylko odczyt) + e-mail konta do etykiety w ustawieniach. */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'openid',
  'email',
].join(' ');

interface GoogleCodeResponse {
  code?: string;
  error?: string;
  error_description?: string;
}

interface GoogleCodeClient {
  requestCode(): void;
}

interface GoogleCodeClientConfig {
  client_id: string;
  scope: string;
  ux_mode: 'popup';
  select_account?: boolean;
  callback: (response: GoogleCodeResponse) => void;
  error_callback: (error: { type?: string; message?: string } | undefined) => void;
}

function readEnv(): Record<string, string | undefined> {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return { ...metaEnv, ...processEnv };
}

/** Powód blokady przycisku „Podepnij konto Google" (`null` = można). */
export function googleCalendarDisabledReason(): string | null {
  const clientId = readEnv().VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  return clientId === '' ? GCAL_MESSAGES.notConfigured : null;
}

/**
 * Otwiera popup Google i zwraca kod autoryzacji. Rzuca po polsku, gdy brak
 * konfiguracji, skrypt się nie wczyta albo użytkownik zamknie popup.
 */
export async function requestGoogleCalendarCode(): Promise<string> {
  const env = readEnv();
  const clientId = env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  if (clientId === '') throw new Error(GCAL_MESSAGES.notConfigured);
  // `resolveGoogleDriveConfig` wymaga też klucza API (Picker); kalendarz go nie
  // potrzebuje, więc czytamy sam client_id — ale jeśli komplet jest, bierzemy
  // go z jednego miejsca.
  const drive = resolveGoogleDriveConfig(env);
  const client_id = drive?.clientId ?? clientId;

  await loadScript(GIS_SRC);
  const oauth2 = (
    globalThis as unknown as {
      google?: { accounts?: { oauth2?: { initCodeClient(config: GoogleCodeClientConfig): GoogleCodeClient } } };
    }
  ).google?.accounts?.oauth2;
  if (oauth2 === undefined) throw new Error('Nie udało się uruchomić logowania Google.');

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id,
      scope: GOOGLE_CALENDAR_SCOPES,
      ux_mode: 'popup',
      select_account: true,
      callback: (response) => {
        if (response.error !== undefined) {
          reject(new Error(response.error_description ?? GCAL_MESSAGES.connectCancelled));
          return;
        }
        if (typeof response.code !== 'string' || response.code === '') {
          reject(new Error(GCAL_MESSAGES.connect));
          return;
        }
        resolve(response.code);
      },
      error_callback: (error) => {
        reject(new Error(error?.message ?? GCAL_MESSAGES.connectCancelled));
      },
    });
    client.requestCode();
  });
}
