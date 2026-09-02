// Typy domenowe importu Kalendarza Google (camelCase) — jedyne kształty, które
// widzi UI. Wiersze bazy są snake_case; mapowanie żyje w `gcalData.ts`.
//
// GRANICE:
//   * Wydarzenia Google NIGDY nie wchodzą do reduktora aplikacji ani do
//     localStorage: to warstwa cieniowa tylko do odczytu, żyjąca w
//     `GoogleCalendarProvider` (tryb Supabase). W trybie lokalnym moduł jest
//     wyłączony.
//   * Kolizje, sumy dnia i planowanie NIE czytają tej warstwy (inwariant 1
//     nietknięty) — kalendarz pokazuje ją obok spotkań N2Hub.

export type GoogleShareLevel = 'details' | 'busy' | 'hidden';
export type GoogleAccountStatus = 'active' | 'revoked' | 'error';

export interface GoogleAccount {
  id: string;
  profileId: string;
  googleEmail: string;
  shareLevel: GoogleShareLevel;
  status: GoogleAccountStatus;
  lastError: string | null;
  lastSyncAt: string | null;
}

export interface GoogleCalendar {
  id: string;
  googleCalendarId: string;
  summary: string;
  isPrimary: boolean;
  selected: boolean;
  color: string | null;
  lastSyncAt: string | null;
}

/** Próg widoczności wiersza dla zalogowanego (kolumna `access` widoku). */
export type GoogleEventAccess = 'owner' | 'attendee' | 'busy';

/** Wydarzenie z widoku `google_calendar_events_visible` (już zamaskowane). */
export interface GoogleEvent {
  /** Id WIERSZA widoku: zmienia się przy pełnym syncu (kasowanie + wstawienie). */
  id: string;
  /** Stabilny klucz instancji: `(calendar_id, google_event_id)` przeżywa sync.
   *  Puste stringi, gdy widok bazy jeszcze nie niesie tych kolumn (stary deploy). */
  calendarId: string;
  googleEventId: string;
  /**
   * Z widoku: id profilu chmury (auth.users). Po `resolveEventPeople` w
   * providerze: id OSOBY planera (lokalne, gdy osoba dopasowana po e-mailu) —
   * to nim mówią filtr osób i `getPerson`. Tak samo `attendeeProfileIds`.
   */
  ownerProfileId: string;
  access: GoogleEventAccess;
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
  htmlLink: string;
  date: string; // yyyy-MM-dd
  endDate: string | null; // ostatni dzień (włącznie) dla wielodniowych
  /** Koniec ostatniego dnia (minuty) dla wielodniowych godzinowych; null = pełna doba. */
  lastDayEndMinutes: number | null;
  startMinutes: number;
  durationMinutes: number;
  isAllDay: boolean;
  isBusy: boolean;
  attendeeProfileIds: string[];
  selfResponse: string | null;
}

/** Wystąpienie na konkretny dzień (wielodniowe rozwijane na dni w kliencie). */
export interface GoogleEventOccurrence {
  event: GoogleEvent;
  date: string;
  startMinutes: number;
  durationMinutes: number;
}

export type GcalResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Ile dni wstecz/wprzód klient dociąga wydarzenia (spójne z oknem syncu). */
export const GCAL_CLIENT_WINDOW_PAST_DAYS = 30;
export const GCAL_CLIENT_WINDOW_FUTURE_DAYS = 90;

/** Odświeżenie w tle (cron serwera jedzie co 5 min — klient nie musi częściej). */
export const GCAL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const GCAL_MESSAGES = {
  load: 'Nie udało się wczytać wydarzeń z Google.',
  account: 'Nie udało się wczytać stanu konta Google.',
  connect: 'Nie udało się podpiąć konta Google.',
  connectCancelled: 'Podpinanie konta Google przerwane.',
  sync: 'Nie udało się zsynchronizować kalendarza.',
  disconnect: 'Nie udało się odłączyć konta Google.',
  update: 'Nie udało się zapisać ustawienia.',
  notConfigured: 'Brak konfiguracji Google: uzupełnij VITE_GOOGLE_CLIENT_ID w .env.local',
} as const;

export const SHARE_LEVEL_LABELS: Record<GoogleShareLevel, string> = {
  details: 'Zespół widzi szczegóły',
  busy: 'Zespół widzi tylko „Zajęty”',
  hidden: 'Tylko ja',
};

export function isGoogleShareLevel(value: unknown): value is GoogleShareLevel {
  return value === 'details' || value === 'busy' || value === 'hidden';
}

export function isGoogleAccountStatus(value: unknown): value is GoogleAccountStatus {
  return value === 'active' || value === 'revoked' || value === 'error';
}

export function isGoogleEventAccess(value: unknown): value is GoogleEventAccess {
  return value === 'owner' || value === 'attendee' || value === 'busy';
}
