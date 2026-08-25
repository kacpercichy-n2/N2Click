// Czysty kontrakt importu Kalendarza Google — ZERO zależności, zero globali
// Deno, zero SDK. Konsumują go: bundler Deno (`index.ts` funkcji sync) oraz
// `tsc`/`vitest` repo (`src/gcal/gcalContract.test.ts`). Tu żyje cała
// decyzyjność: mapowanie wydarzenia Google na wiersz `google_calendar_events`
// (siatka 15 min N2Hub, doba 0/1440 dla całodniowych), wykrywanie linku do
// spotkania, dopasowanie uczestników do profili po e-mailu, okno pełnego syncu
// i klasyfikacja błędów API.
//
// ZAOKRĄGLANIE (decyzja z researchu 2026-08-25): start W DÓŁ do kwadransa,
// koniec W GÓRĘ — blok w N2Hub nigdy nie jest krótszy niż spotkanie, więc
// kolizje i objętość dnia są ostrożne, nie optymistyczne.

// ---- Kształt wydarzenia z API (tylko pola, których używamy) ------------------

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleAttendee {
  email?: string;
  responseStatus?: string;
  self?: boolean;
  optional?: boolean;
  resource?: boolean;
}

export interface GoogleEvent {
  id?: string;
  iCalUID?: string;
  recurringEventId?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  updated?: string;
  visibility?: string;
  transparency?: string;
  eventType?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; self?: boolean };
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

/** Wiersz `n2click.google_calendar_events` (snake_case, gotowy do upsert). */
export interface GoogleEventRow {
  calendar_id: string;
  account_id: string;
  google_event_id: string;
  ical_uid: string | null;
  recurring_event_id: string | null;
  etag: string | null;
  status: string;
  title: string;
  description: string;
  location: string;
  meeting_url: string;
  html_link: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  event_date: string;
  start_minutes: number;
  duration_minutes: number;
  end_date: string | null;
  /** Wielodniowe godzinowe: koniec OSTATNIEGO dnia (minuty, siatka 15); null = pełna doba / jednodniowe. */
  last_day_end_minutes: number | null;
  event_type: string;
  visibility: string;
  is_busy: boolean;
  is_confidential: boolean;
  attendees: Array<{ email: string; responseStatus: string; self: boolean }>;
  attendee_profile_ids: string[];
  self_response: string | null;
  google_updated_at: string | null;
  synced_at: string;
}

export const DAY_MINUTES = 1440;
export const STEP = 15;

/** Okno pełnego syncu względem „dziś": −30 / +90 dni (research 2026-08-25). */
export const SYNC_WINDOW_PAST_DAYS = 30;
export const SYNC_WINDOW_FUTURE_DAYS = 90;
/** Po tylu dniach od pełnego syncu okno jest przesuwane (nowy pełny sync). */
export const FULL_RESYNC_AFTER_DAYS = 30;

/** Typy wydarzeń, które importujemy (reszta: workingLocation, birthday, fromGmail — pomijamy). */
export const IMPORTED_EVENT_TYPES: readonly string[] = ['default', 'outOfOffice', 'focusTime'];

// ---- Czas -------------------------------------------------------------------

/** Minuty od północy i data 'yyyy-MM-dd' z ISO/offsetu w zadanej strefie. */
export interface LocalMoment {
  date: string;
  minutes: number;
}

/**
 * Chwila w strefie `timeZone` (domyślnie Europe/Warsaw) z użyciem `Intl` —
 * jedyny sposób w JS bez bibliotek, który honoruje czas letni. `Intl` jest w
 * Deno i w node, więc kontrakt zostaje czysty.
 */
export function toLocalMoment(iso: string, timeZone = 'Europe/Warsaw'): LocalMoment | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + minute };
}

export function floorToStep(minutes: number): number {
  return Math.floor(minutes / STEP) * STEP;
}

export function ceilToStep(minutes: number): number {
  return Math.ceil(minutes / STEP) * STEP;
}

/** `yyyy-MM-dd` ± dni (UTC, bez stref — to tylko arytmetyka kalendarzowa). */
export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isDateStr(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ---- Link do spotkania ------------------------------------------------------

const MEETING_URL_RE =
  /https:\/\/(?:meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|[\w.-]*zoom\.us\/j\/\d+[^\s"<)]*|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<)]+|teams\.live\.com\/meet\/[^\s"<)]+)/i;

/** Meet z `conferenceData`, potem `hangoutLink`, potem regex po lokalizacji i opisie. */
export function meetingUrlOf(event: GoogleEvent): string {
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && typeof entry.uri === 'string',
  );
  if (video?.uri) return video.uri;
  if (typeof event.hangoutLink === 'string' && event.hangoutLink !== '') return event.hangoutLink;
  const haystack = `${event.location ?? ''}\n${event.description ?? ''}`;
  const match = haystack.match(MEETING_URL_RE);
  return match ? match[0] : '';
}

/** Opis Google bywa HTML-em: zdejmujemy znaczniki i encje, zostawiamy tekst. */
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// ---- Mapowanie --------------------------------------------------------------

export interface MapEventInput {
  event: GoogleEvent;
  calendarId: string;
  accountId: string;
  /** e-mail (lowercase) → id profilu, do dopasowania uczestników. */
  profileByEmail: ReadonlyMap<string, string>;
  timeZone?: string;
  /** ISO teraz (wstrzykiwane — kontrakt bez zegara). */
  nowIso: string;
}

export type MapEventResult =
  | { kind: 'row'; row: GoogleEventRow }
  | { kind: 'cancelled'; googleEventId: string }
  | { kind: 'skip'; reason: string };

/**
 * Jedno wydarzenie API → wiersz albo decyzja „odwołane"/„pomiń". Wydarzenia
 * wielodniowe GODZINOWE zostają JEDNYM wierszem z `end_date` (UI rozwija je
 * na dni przy renderze); całodniowe mają koniec WYŁĄCZNY w Google (odejmujemy
 * dzień).
 */
export function mapGoogleEvent(input: MapEventInput): MapEventResult {
  const { event } = input;
  const googleEventId = typeof event.id === 'string' ? event.id : '';
  if (googleEventId === '') return { kind: 'skip', reason: 'brak id' };
  if (event.status === 'cancelled') return { kind: 'cancelled', googleEventId };
  const eventType = typeof event.eventType === 'string' && event.eventType !== '' ? event.eventType : 'default';
  if (!IMPORTED_EVENT_TYPES.includes(eventType)) return { kind: 'skip', reason: `eventType ${eventType}` };

  const tz = input.timeZone ?? 'Europe/Warsaw';
  const start = event.start ?? {};
  const end = event.end ?? {};
  let isAllDay = false;
  let eventDate = '';
  let endDate: string | null = null;
  let lastDayEndMinutes: number | null = null;
  let startMinutes = 0;
  let durationMinutes = DAY_MINUTES;
  let startAt = '';
  let endAt = '';

  if (typeof start.date === 'string' && isDateStr(start.date)) {
    isAllDay = true;
    eventDate = start.date;
    const endExclusive = typeof end.date === 'string' && isDateStr(end.date) ? end.date : shiftDate(start.date, 1);
    const lastDay = shiftDate(endExclusive, -1);
    endDate = lastDay > eventDate ? lastDay : null;
    startAt = `${eventDate}T00:00:00.000Z`;
    endAt = `${endExclusive}T00:00:00.000Z`;
  } else if (typeof start.dateTime === 'string' && typeof end.dateTime === 'string') {
    const s = toLocalMoment(start.dateTime, tz);
    const e = toLocalMoment(end.dateTime, tz);
    if (!s || !e) return { kind: 'skip', reason: 'zły czas' };
    startAt = new Date(Date.parse(start.dateTime)).toISOString();
    endAt = new Date(Date.parse(end.dateTime)).toISOString();
    eventDate = s.date;
    startMinutes = Math.min(floorToStep(s.minutes), DAY_MINUTES - STEP);
    if (e.date === s.date) {
      const endMin = Math.max(ceilToStep(e.minutes), startMinutes + STEP);
      durationMinutes = Math.min(endMin, DAY_MINUTES) - startMinutes;
    } else {
      // Wielodniowe godzinowe: pierwszy dzień do północy, `end_date` = ostatni
      // dzień (albo poprzedni, gdy kończy się dokładnie o północy — wtedy
      // ostatni dzień jest pełną dobą), a `last_day_end_minutes` niesie
      // godzinę końca ostatniego dnia, żeby UI nie malował go na całą dobę.
      durationMinutes = DAY_MINUTES - startMinutes;
      const endsAtMidnight = e.minutes === 0;
      const last = endsAtMidnight ? shiftDate(e.date, -1) : e.date;
      endDate = last > eventDate ? last : null;
      lastDayEndMinutes =
        endDate !== null && !endsAtMidnight ? Math.max(STEP, Math.min(ceilToStep(e.minutes), DAY_MINUTES)) : null;
    }
  } else {
    return { kind: 'skip', reason: 'brak czasu' };
  }

  const attendeesRaw = Array.isArray(event.attendees) ? event.attendees : [];
  const attendees = attendeesRaw
    .filter((a) => typeof a.email === 'string' && a.email !== '' && a.resource !== true)
    .map((a) => ({
      email: (a.email as string).toLowerCase(),
      responseStatus: typeof a.responseStatus === 'string' ? a.responseStatus : 'needsAction',
      self: a.self === true,
    }));
  const organizerEmail =
    typeof event.organizer?.email === 'string' ? event.organizer.email.toLowerCase() : '';
  const emails = new Set(attendees.map((a) => a.email));
  if (organizerEmail !== '') emails.add(organizerEmail);
  const attendeeProfileIds = Array.from(emails)
    .map((email) => input.profileByEmail.get(email))
    .filter((id): id is string => typeof id === 'string' && id !== '');
  const selfResponse = attendees.find((a) => a.self)?.responseStatus ?? null;

  const visibility = typeof event.visibility === 'string' && event.visibility !== '' ? event.visibility : 'default';
  const description = typeof event.description === 'string' ? stripHtml(event.description).slice(0, 4000) : '';

  return {
    kind: 'row',
    row: {
      calendar_id: input.calendarId,
      account_id: input.accountId,
      google_event_id: googleEventId,
      ical_uid: typeof event.iCalUID === 'string' ? event.iCalUID : null,
      recurring_event_id: typeof event.recurringEventId === 'string' ? event.recurringEventId : null,
      etag: typeof event.etag === 'string' ? event.etag : null,
      status: typeof event.status === 'string' && event.status !== '' ? event.status : 'confirmed',
      title: typeof event.summary === 'string' ? event.summary.trim().slice(0, 500) : '',
      description,
      location: typeof event.location === 'string' ? event.location.trim().slice(0, 500) : '',
      meeting_url: meetingUrlOf(event).slice(0, 1000),
      html_link: typeof event.htmlLink === 'string' ? event.htmlLink : '',
      start_at: startAt,
      end_at: endAt,
      is_all_day: isAllDay,
      event_date: eventDate,
      start_minutes: startMinutes,
      duration_minutes: durationMinutes,
      end_date: endDate,
      last_day_end_minutes: lastDayEndMinutes,
      event_type: eventType,
      visibility,
      // Google „Wolny" (transparent) nie blokuje; całodniowe też nie, chyba że
      // to nieobecność (outOfOffice).
      is_busy: event.transparency !== 'transparent' && (!isAllDay || eventType === 'outOfOffice'),
      is_confidential: visibility === 'private' || visibility === 'confidential',
      attendees,
      attendee_profile_ids: Array.from(new Set(attendeeProfileIds)),
      self_response: selfResponse,
      google_updated_at: typeof event.updated === 'string' ? event.updated : null,
      synced_at: input.nowIso,
    },
  };
}

// ---- Okno i decyzje syncu ---------------------------------------------------

export interface SyncWindow {
  timeMin: string;
  timeMax: string;
}

/** Okno pełnego syncu wokół `todayDate` ('yyyy-MM-dd'), w ISO (UTC północ). */
export function fullSyncWindow(todayDate: string): SyncWindow {
  return {
    timeMin: `${shiftDate(todayDate, -SYNC_WINDOW_PAST_DAYS)}T00:00:00Z`,
    timeMax: `${shiftDate(todayDate, SYNC_WINDOW_FUTURE_DAYS)}T00:00:00Z`,
  };
}

export type SyncMode = { mode: 'full'; window: SyncWindow } | { mode: 'incremental'; syncToken: string };

/**
 * Pełny czy przyrostowy? Pełny, gdy brak tokenu albo okno się zestarzało
 * (`syncToken` nie łączy się z `timeMin/timeMax`, więc okno jest zamrożone w
 * chwili pełnego syncu i trzeba je co jakiś czas przesunąć).
 */
export function decideSyncMode(
  calendar: { syncToken: string | null; lastFullSyncAt: string | null },
  nowIso: string,
): SyncMode {
  const today = nowIso.slice(0, 10);
  if (!calendar.syncToken || !calendar.lastFullSyncAt) return { mode: 'full', window: fullSyncWindow(today) };
  const ageMs = Date.parse(nowIso) - Date.parse(calendar.lastFullSyncAt);
  if (!Number.isFinite(ageMs) || ageMs > FULL_RESYNC_AFTER_DAYS * 86_400_000) {
    return { mode: 'full', window: fullSyncWindow(today) };
  }
  return { mode: 'incremental', syncToken: calendar.syncToken };
}

/** Klasyfikacja odpowiedzi API Google (status HTTP + treść błędu). */
export type GoogleApiFailure =
  | { kind: 'sync-token-expired' }
  | { kind: 'revoked' }
  | { kind: 'rate-limited' }
  | { kind: 'temporary'; status: number }
  | { kind: 'fatal'; status: number; message: string };

export function classifyGoogleFailure(status: number, body: string): GoogleApiFailure {
  const lower = body.toLowerCase();
  if (status === 410) return { kind: 'sync-token-expired' };
  if (status === 401 || lower.includes('invalid_grant')) return { kind: 'revoked' };
  if (status === 429 || (status === 403 && (lower.includes('ratelimit') || lower.includes('usagelimits') || lower.includes('quota')))) {
    return { kind: 'rate-limited' };
  }
  if (status >= 500) return { kind: 'temporary', status };
  return { kind: 'fatal', status, message: body.slice(0, 200) };
}

/** Mapa e-mail → profil z wierszy `core.profiles` (przez widok `profiles`). */
export function profileEmailIndex(
  rows: ReadonlyArray<{ id?: unknown; email?: unknown }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.id !== 'string' || typeof row.email !== 'string') continue;
    const email = row.email.trim().toLowerCase();
    if (email !== '') map.set(email, row.id);
  }
  return map;
}

/** Polskie komunikaty funkcji connect/sync (zwracane klientowi). */
export const GCAL_MESSAGES = {
  methodNotAllowed: 'Dozwolone jest wyłącznie POST.',
  missingAuthorization: 'Brak nagłówka Authorization.',
  invalidSession: 'Sesja jest nieważna. Zaloguj się ponownie.',
  serverConfig: 'Serwer nie jest skonfigurowany do połączenia z Google.',
  serverError: 'Wystąpił błąd serwera.',
  malformedJson: 'Nieprawidłowe ciało żądania.',
  missingCode: 'Brak kodu autoryzacji Google.',
  exchangeFailed: 'Google odrzuciło kod autoryzacji. Spróbuj podpiąć konto ponownie.',
  noRefreshToken:
    'Google nie zwróciło tokenu odświeżania. Odłącz N2Hub w ustawieniach konta Google i spróbuj ponownie.',
  forbiddenCron: 'Nieprawidłowy sekret harmonogramu.',
  forbiddenApp: 'To konto nie ma dostępu do N2Click.',
  syncFailed: 'Synchronizacja nie powiodła się.',
  syncRevoked: 'Google cofnęło dostęp. Podepnij konto ponownie.',
  syncRateLimited: 'Google ograniczyło liczbę zapytań. Spróbuj za kilka minut.',
  syncBusy: 'Synchronizacja tego konta już trwa. Spróbuj za chwilę.',
} as const;

/**
 * Parsuje odpowiedź wymiany kodu na tokeny (`oauth2.googleapis.com/token`).
 * `refresh_token` jest WYMAGANY — bez niego sync w tle nie zadziała.
 */
export function parseTokenExchange(
  body: unknown,
): { ok: true; refreshToken: string; accessToken: string; scope: string } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: GCAL_MESSAGES.exchangeFailed };
  const b = body as Record<string, unknown>;
  const accessToken = typeof b.access_token === 'string' ? b.access_token : '';
  const refreshToken = typeof b.refresh_token === 'string' ? b.refresh_token : '';
  if (accessToken === '') return { ok: false, message: GCAL_MESSAGES.exchangeFailed };
  if (refreshToken === '') return { ok: false, message: GCAL_MESSAGES.noRefreshToken };
  return { ok: true, refreshToken, accessToken, scope: typeof b.scope === 'string' ? b.scope : '' };
}
