// Warstwa I/O Google (runtime Deno, współdzielona przez `google-calendar-connect`
// i `google-calendar-sync`): wymiana kodu, odświeżenie tokenu, `calendarList`
// i `events.list` z paginacją. ZERO decyzyjności — mapowanie i klasyfikację
// błędów robi czysty `../google-calendar-sync/contract.ts`.
//
// Ten plik NIE jest typowany przez tsc repo (jak `index.ts` funkcji).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleHttpResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  text: string;
}

async function readJson<T>(response: Response): Promise<GoogleHttpResult<T>> {
  const text = await response.text();
  let body: T | null = null;
  try {
    body = text === '' ? null : (JSON.parse(text) as T);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body, text };
}

/** Wymiana kodu z GIS (tryb popup => `redirect_uri=postmessage`). */
export async function exchangeAuthorizationCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleHttpResult<Record<string, unknown>>> {
  const params = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return readJson(response);
}

/** Nowy access token z refresh tokenu. */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<GoogleHttpResult<{ access_token?: string; expires_in?: number }>> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return readJson(response);
}

/** E-mail konta z tokenu (zakres `email`). */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await readJson<{ email?: string }>(response);
  return result.ok && typeof result.body?.email === 'string' ? result.body.email.toLowerCase() : '';
}

export interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  deleted?: boolean;
  hidden?: boolean;
}

/** Lista kalendarzy (tylko z prawem odczytu, bez ukrytych i usuniętych). */
export async function fetchCalendarList(
  accessToken: string,
): Promise<GoogleHttpResult<{ items?: GoogleCalendarListEntry[] }>> {
  const url = new URL(`${CALENDAR_API}/users/me/calendarList`);
  url.searchParams.set('minAccessRole', 'reader');
  url.searchParams.set('showHidden', 'false');
  url.searchParams.set('fields', 'items(id,summary,primary,selected,accessRole,backgroundColor,deleted,hidden)');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return readJson(response);
}

export interface EventsListPage {
  items?: unknown[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface EventsListQuery {
  calendarId: string;
  timeZone: string;
  /** Pełny sync: okno; przyrostowy: token (wzajemnie wykluczające się). */
  window?: { timeMin: string; timeMax: string };
  syncToken?: string;
  pageToken?: string;
}

const EVENT_FIELDS =
  'nextPageToken,nextSyncToken,items(id,iCalUID,recurringEventId,etag,status,summary,description,location,hangoutLink,htmlLink,updated,visibility,transparency,eventType,start,end,attendees(email,responseStatus,self,optional,resource),organizer(email,self),conferenceData(entryPoints(entryPointType,uri)))';

/** Jedna strona `events.list` (singleEvents, showDeleted, importowane typy). */
export async function fetchEventsPage(
  accessToken: string,
  query: EventsListQuery,
): Promise<GoogleHttpResult<EventsListPage>> {
  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(query.calendarId)}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('showDeleted', 'true');
  url.searchParams.set('maxResults', '2500');
  url.searchParams.set('timeZone', query.timeZone);
  url.searchParams.set('fields', EVENT_FIELDS);
  for (const type of ['default', 'outOfOffice', 'focusTime']) url.searchParams.append('eventTypes', type);
  if (query.syncToken) {
    url.searchParams.set('syncToken', query.syncToken);
  } else if (query.window) {
    url.searchParams.set('timeMin', query.window.timeMin);
    url.searchParams.set('timeMax', query.window.timeMax);
  }
  if (query.pageToken) url.searchParams.set('pageToken', query.pageToken);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return readJson(response);
}

/** Cofnięcie zgody (rozłączenie) — best effort, błąd ignorujemy. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // celowo cicho
  }
}
