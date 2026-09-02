// Czysta warstwa danych importu Kalendarza Google: granica bazy (wstrzykiwany
// `GcalDb`), łagodne mapowanie wierszy snake_case → typy domenowe, rozwijanie
// wielodniowych na dni i operacje (konto, kalendarze, wydarzenia w oknie,
// ustawienia, rozłączenie, sync). Zero Reacta, zero SDK w logice — testowalne
// w node na atrapie (`gcalData.test.ts`), wzór `chat/chatData.ts`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from '../auth/profile';
import type { Person } from '../types';
import { addDaysStr, isValidDateStr } from '../utils/dates';
import { DAY_MINUTES } from '../utils/time';
import {
  GCAL_MESSAGES,
  isGoogleAccountStatus,
  isGoogleEventAccess,
  isGoogleShareLevel,
  type GcalResult,
  type GoogleAccount,
  type GoogleCalendar,
  type GoogleEvent,
  type GoogleEventOccurrence,
  type GoogleShareLevel,
} from './types';

export type GcalRow = Record<string, unknown>;

export interface GcalDbError {
  code: string | null;
  message: string;
}

export interface GcalDb {
  /** Własny wiersz `google_accounts` (RLS: tylko właściciel); null gdy brak. */
  selectAccount(): Promise<{ row: GcalRow | null; error: GcalDbError | null }>;
  selectCalendars(accountId: string): Promise<{ rows: GcalRow[]; error: GcalDbError | null }>;
  /** Widok maskujący dla zespołu, w oknie dat (włącznie). */
  selectVisibleEvents(
    fromDate: string,
    toDate: string,
  ): Promise<{ rows: GcalRow[]; error: GcalDbError | null }>;
  updateCalendarSelected(
    calendarId: string,
    selected: boolean,
  ): Promise<{ error: GcalDbError | null }>;
  updateShareLevel(
    accountId: string,
    shareLevel: GoogleShareLevel,
  ): Promise<{ error: GcalDbError | null }>;
  deleteAccount(accountId: string): Promise<{ error: GcalDbError | null }>;
  /** Edge Function `google-calendar-connect` z kodem GIS. */
  invokeConnect(code: string): Promise<{ error: GcalDbError | null }>;
  /** Edge Function `google-calendar-sync` dla konta wywołującego. */
  invokeSync(): Promise<{ error: GcalDbError | null }>;
}

function toDbError(error: unknown, fallback: string): GcalDbError {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : null,
      message: typeof e.message === 'string' ? e.message : fallback,
    };
  }
  return { code: null, message: error instanceof Error ? error.message : fallback };
}

/** Polski komunikat z odpowiedzi Edge Function (`{ error }`), jeśli jest. */
async function functionError(
  result: { data: unknown; error: unknown },
  fallback: string,
): Promise<GcalDbError | null> {
  if (!result.error) return null;
  const err = result.error as { context?: unknown; message?: unknown };
  const context = err.context;
  if (context && typeof context === 'object' && 'json' in context) {
    try {
      const body = (await (context as { json(): Promise<unknown> }).json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error !== '') {
        return { code: 'function', message: body.error };
      }
    } catch {
      // brak JSON w odpowiedzi — zostaje komunikat zapasowy
    }
  }
  return toDbError(result.error, fallback);
}

/** Cienki adapter nad klientem Supabase — jedyne miejsce, które zna SDK. */
export function createSupabaseGcalDb(client: SupabaseClient): GcalDb {
  const rows = (data: unknown): GcalRow[] => (Array.isArray(data) ? (data as GcalRow[]) : []);
  return {
    async selectAccount() {
      try {
        const { data, error } = await client
          .from('google_accounts')
          .select('id, profile_id, google_email, share_level, status, last_error, last_sync_at')
          .maybeSingle();
        if (error) return { row: null, error: toDbError(error, 'Błąd zapytania.') };
        return { row: (data ?? null) as GcalRow | null, error: null };
      } catch (e) {
        return { row: null, error: toDbError(e, 'Błąd zapytania.') };
      }
    },
    async selectCalendars(accountId) {
      try {
        const { data, error } = await client
          .from('google_calendars')
          .select('id, google_calendar_id, summary, is_primary, selected, color, last_sync_at')
          .eq('account_id', accountId)
          .order('is_primary', { ascending: false })
          .order('summary', { ascending: true });
        if (error) return { rows: [], error: toDbError(error, 'Błąd zapytania.') };
        return { rows: rows(data), error: null };
      } catch (e) {
        return { rows: [], error: toDbError(e, 'Błąd zapytania.') };
      }
    },
    async selectVisibleEvents(fromDate, toDate) {
      try {
        // Wielodniowe zaczynają się przed oknem, ale kończą w nim: filtr po
        // `event_date` w oknie LUB `end_date` >= początek okna.
        const { data, error } = await client
          .from('google_calendar_events_visible')
          .select('*')
          .lte('event_date', toDate)
          .or(`event_date.gte.${fromDate},end_date.gte.${fromDate}`);
        if (error) return { rows: [], error: toDbError(error, 'Błąd zapytania.') };
        return { rows: rows(data), error: null };
      } catch (e) {
        return { rows: [], error: toDbError(e, 'Błąd zapytania.') };
      }
    },
    async updateCalendarSelected(calendarId, selected) {
      try {
        const { error } = await client.from('google_calendars').update({ selected }).eq('id', calendarId);
        return { error: error ? toDbError(error, 'Błąd zapisu.') : null };
      } catch (e) {
        return { error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async updateShareLevel(accountId, shareLevel) {
      try {
        const { error } = await client
          .from('google_accounts')
          .update({ share_level: shareLevel })
          .eq('id', accountId);
        return { error: error ? toDbError(error, 'Błąd zapisu.') : null };
      } catch (e) {
        return { error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async deleteAccount(accountId) {
      try {
        const { error } = await client.from('google_accounts').delete().eq('id', accountId);
        return { error: error ? toDbError(error, 'Błąd zapisu.') : null };
      } catch (e) {
        return { error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async invokeConnect(code) {
      try {
        const result = await client.functions.invoke('google-calendar-connect', { body: { code } });
        return { error: await functionError(result, GCAL_MESSAGES.connect) };
      } catch (e) {
        return { error: toDbError(e, GCAL_MESSAGES.connect) };
      }
    },
    async invokeSync() {
      try {
        const result = await client.functions.invoke('google-calendar-sync', { body: {} });
        return { error: await functionError(result, GCAL_MESSAGES.sync) };
      } catch (e) {
        return { error: toDbError(e, GCAL_MESSAGES.sync) };
      }
    },
  };
}

// ---- Mapowanie ---------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const bool = (v: unknown): boolean => v === true;
function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

export function toGoogleAccount(row: GcalRow | null): GoogleAccount | null {
  if (!row) return null;
  const id = str(row.id);
  const profileId = str(row.profile_id);
  if (id === '' || profileId === '') return null;
  return {
    id,
    profileId,
    googleEmail: str(row.google_email),
    shareLevel: isGoogleShareLevel(row.share_level) ? row.share_level : 'busy',
    status: isGoogleAccountStatus(row.status) ? row.status : 'error',
    lastError: nullableStr(row.last_error),
    lastSyncAt: nullableStr(row.last_sync_at),
  };
}

export function toGoogleCalendar(row: GcalRow): GoogleCalendar | null {
  const id = str(row.id);
  const googleCalendarId = str(row.google_calendar_id);
  if (id === '' || googleCalendarId === '') return null;
  return {
    id,
    googleCalendarId,
    summary: str(row.summary),
    isPrimary: bool(row.is_primary),
    selected: bool(row.selected),
    color: nullableStr(row.color),
    lastSyncAt: nullableStr(row.last_sync_at),
  };
}

/** Wiersz widoku → wydarzenie. Zły czas/dane => null (pomijamy, nie wywracamy). */
export function toGoogleEvent(row: GcalRow): GoogleEvent | null {
  const id = str(row.id);
  const date = str(row.event_date);
  const startMinutes = int(row.start_minutes);
  const durationMinutes = int(row.duration_minutes);
  if (id === '' || !isValidDateStr(date) || startMinutes === null || durationMinutes === null) {
    return null;
  }
  if (startMinutes < 0 || startMinutes > 1425 || durationMinutes < 15 || durationMinutes > 1440) {
    return null;
  }
  const endDateRaw = nullableStr(row.end_date);
  const lastDayEnd = int(row.last_day_end_minutes);
  const attendeeIds = Array.isArray(row.attendee_profile_ids)
    ? (row.attendee_profile_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return {
    id,
    calendarId: str(row.calendar_id),
    googleEventId: str(row.google_event_id),
    ownerProfileId: str(row.owner_profile_id),
    access: isGoogleEventAccess(row.access) ? row.access : 'busy',
    title: str(row.title),
    description: str(row.description),
    location: str(row.location),
    meetingUrl: str(row.meeting_url),
    htmlLink: str(row.html_link),
    date,
    endDate: endDateRaw !== null && isValidDateStr(endDateRaw) && endDateRaw > date ? endDateRaw : null,
    lastDayEndMinutes:
      lastDayEnd !== null && lastDayEnd >= 15 && lastDayEnd <= 1440 && lastDayEnd % 15 === 0 ? lastDayEnd : null,
    startMinutes,
    durationMinutes,
    isAllDay: bool(row.is_all_day),
    isBusy: row.is_busy !== false,
    attendeeProfileIds: attendeeIds,
    selfResponse: nullableStr(row.self_response),
  };
}

// ---- Rozwijanie na dni --------------------------------------------------------

/**
 * Wystąpienia wydarzeń po dniu. Wielodniowe: pierwszy dzień od `startMinutes`
 * do północy, dni środkowe jako pełna doba (0/1440), ostatni dzień do
 * `lastDayEndMinutes` (albo pełna doba, gdy brak). Wynik posortowany po
 * starcie, potem po id (stabilnie).
 */
export function occurrencesByDate(
  events: readonly GoogleEvent[],
): ReadonlyMap<string, GoogleEventOccurrence[]> {
  const map = new Map<string, GoogleEventOccurrence[]>();
  const push = (occ: GoogleEventOccurrence): void => {
    const list = map.get(occ.date);
    if (list) list.push(occ);
    else map.set(occ.date, [occ]);
  };
  for (const event of events) {
    push({ event, date: event.date, startMinutes: event.startMinutes, durationMinutes: event.durationMinutes });
    if (event.endDate === null) continue;
    let day = addDaysStr(event.date, 1);
    // Twardy limit obronny: wiersz z absurdalnym `end_date` nie zapętli renderu.
    let guard = 0;
    while (day <= event.endDate && guard < 366) {
      const isLast = day === event.endDate;
      const duration = isLast && event.lastDayEndMinutes !== null ? event.lastDayEndMinutes : 1440;
      push({ event, date: day, startMinutes: 0, durationMinutes: duration });
      day = addDaysStr(day, 1);
      guard += 1;
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.startMinutes !== b.startMinutes
        ? a.startMinutes - b.startMinutes
        : a.event.id < b.event.id
          ? -1
          : a.event.id > b.event.id
            ? 1
            : 0,
    );
  }
  return map;
}

/**
 * Mapa id profilu chmury → id OSOBY w planerze. Widok bazy niesie `auth.users`
 * id, a osoba dopasowana po e-mailu przy hydracji (`applyCloudPeople`)
 * ZACHOWUJE lokalne id (stabilne referencje planera) — więc filtr osób,
 * `getPerson` i `currentUserId` mówią id osoby, nie profilu. Dopasowanie:
 * najpierw osoba o tym samym id (profil bez pary e-mailowej dostaje id
 * profilu), potem po znormalizowanym e-mailu profilu. Profil bez osoby nie
 * trafia do mapy (wołający zostawia surowe id).
 */
export function buildProfileToPersonMap(
  profiles: readonly { id: string; email: string }[],
  people: readonly Person[],
): ReadonlyMap<string, string> {
  const byId = new Set(people.map((p) => p.id));
  const byEmail = new Map<string, string>();
  for (const person of people) {
    const key = normalizeEmail(person.email);
    if (key !== '' && !byEmail.has(key)) byEmail.set(key, person.id);
  }
  const map = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.id === '') continue;
    if (byId.has(profile.id)) {
      map.set(profile.id, profile.id);
      continue;
    }
    const personId = byEmail.get(normalizeEmail(profile.email));
    if (personId !== undefined) map.set(profile.id, personId);
  }
  return map;
}

/**
 * Podmienia `ownerProfileId` / `attendeeProfileIds` na id osób planera wg
 * mapy z `buildProfileToPersonMap`. Id bez wpisu w mapie zostaje surowe
 * (dialog pokaże pusty podpis, filtr go nie trafi — bez fałszywego
 * dopasowania). Zwraca tę samą tablicę, gdy nic się nie zmienia.
 */
export function resolveEventPeople(
  events: readonly GoogleEvent[],
  profileToPerson: ReadonlyMap<string, string>,
): readonly GoogleEvent[] {
  if (profileToPerson.size === 0) return events;
  const resolve = (id: string): string => profileToPerson.get(id) ?? id;
  let changed = false;
  const out = events.map((event) => {
    const owner = resolve(event.ownerProfileId);
    const attendees = event.attendeeProfileIds.map(resolve);
    const sameAttendees = attendees.every((id, i) => id === event.attendeeProfileIds[i]);
    if (owner === event.ownerProfileId && sameAttendees) return event;
    changed = true;
    return { ...event, ownerProfileId: owner, attendeeProfileIds: sameAttendees ? event.attendeeProfileIds : attendees };
  });
  return changed ? out : events;
}

/**
 * Kto widzi wystąpienie Google w kalendarzu (decyzja 2026-08-26): wydarzenie
 * NALEŻY do właściciela kalendarza. Właściciel widzi je zawsze; reszta zespołu
 * tylko wtedy, gdy filtr osób obejmuje właściciela. Pusty filtr (= „wszyscy"
 * dla spotkań N2Hub) NIE pokazuje cudzych wydarzeń Google — bez świadomego
 * zawężenia do osoby cudzy kalendarz jest odfiltrowany. Maska szczegółów
 * („Zajęty") zostaje sprawą widoku bazy; tu decyduje się tylko obecność kafla.
 */
export function visibleOccurrences(
  occurrences: readonly GoogleEventOccurrence[],
  personFilter: ReadonlySet<string>,
): readonly GoogleEventOccurrence[] {
  if (occurrences.length === 0) return occurrences;
  const visible = occurrences.filter(
    (occ) => occ.event.access === 'owner' || personFilter.has(occ.event.ownerProfileId),
  );
  return visible.length === occurrences.length ? occurrences : visible;
}

// ---- Widok „Dzień" trackera ----------------------------------------------------

/** Prefiks `TimeEntry.eventId` dla wpisu powstałego z wydarzenia Google —
 *  odróżnia je od id spotkań N2Hub w tym samym polu. */
export const GCAL_ENTRY_PREFIX = 'gcal:';

/**
 * Klucz wpisu czasu dla wystąpienia Google. STABILNY: `gcal:<calendar_id>:<google_event_id>`
 * — id wiersza widoku zmienia się przy pełnym syncu (kasowanie + wstawienie
 * wierszy kalendarza), więc zaliczone spotkanie „odznaczałoby się" samo po syncu
 * (przegląd Codex 2026-09-02). Instancje serii mają w Google osobne id, więc
 * każde wystąpienie ma własny klucz. Gdy widok bazy nie niesie jeszcze tych
 * kolumn (deploy klienta przed migracją), zostaje klucz po id wiersza.
 */
export function gcalEntryKey(event: Pick<GoogleEvent, 'id' | 'calendarId' | 'googleEventId'>): string {
  return event.calendarId !== '' && event.googleEventId !== ''
    ? `${GCAL_ENTRY_PREFIX}${event.calendarId}:${event.googleEventId}`
    : GCAL_ENTRY_PREFIX + event.id;
}

/** Klucz sprzed migracji widoku (po id wiersza): wpisy zapisane tym kluczem
 *  nadal liczą się jako zaliczone do najbliższego pełnego syncu. */
export function gcalLegacyEntryKey(event: Pick<GoogleEvent, 'id'>): string {
  return GCAL_ENTRY_PREFIX + event.id;
}

/**
 * Wystąpienia Google, które widok „Dzień" trackera stawia w kolumnie planu jako
 * spotkania do odhaczenia (2026-09-02, zgłoszenie Kacpra: bez nich w planie
 * była dziura): tylko godzinowe (całodniowe nie mają godzin do zaliczenia),
 * z niezerowym czasem i nie odrzucone przez zalogowanego; rosnąco po starcie.
 * Nadal warstwa cieniowa (inwariant 1): kolizje, sumy dnia i wzrost planu nie
 * czytają tej listy — czas liczy się dopiero z wpisu, który powstaje z kliknięcia.
 */
export function dayTrackerOccurrences(
  occurrences: readonly GoogleEventOccurrence[],
): GoogleEventOccurrence[] {
  return occurrences
    .filter(
      (occ) =>
        !occ.event.isAllDay &&
        occ.durationMinutes > 0 &&
        !(occ.startMinutes === 0 && occ.durationMinutes >= DAY_MINUTES) &&
        occ.event.selfResponse !== 'declined',
    )
    .sort((a, b) => a.startMinutes - b.startMinutes || a.event.id.localeCompare(b.event.id));
}

// ---- Operacje -----------------------------------------------------------------

export async function loadAccount(db: GcalDb): Promise<GcalResult<GoogleAccount | null>> {
  const { row, error } = await db.selectAccount();
  if (error) return { ok: false, error: GCAL_MESSAGES.account };
  return { ok: true, value: toGoogleAccount(row) };
}

export async function loadCalendars(db: GcalDb, accountId: string): Promise<GcalResult<GoogleCalendar[]>> {
  if (accountId === '') return { ok: true, value: [] };
  const { rows, error } = await db.selectCalendars(accountId);
  if (error) return { ok: false, error: GCAL_MESSAGES.account };
  return { ok: true, value: rows.map(toGoogleCalendar).filter((c): c is GoogleCalendar => c !== null) };
}

export async function loadVisibleEvents(
  db: GcalDb,
  fromDate: string,
  toDate: string,
): Promise<GcalResult<GoogleEvent[]>> {
  if (!isValidDateStr(fromDate) || !isValidDateStr(toDate) || fromDate > toDate) {
    return { ok: false, error: GCAL_MESSAGES.load };
  }
  const { rows, error } = await db.selectVisibleEvents(fromDate, toDate);
  if (error) return { ok: false, error: GCAL_MESSAGES.load };
  return { ok: true, value: rows.map(toGoogleEvent).filter((e): e is GoogleEvent => e !== null) };
}

export async function setCalendarSelected(
  db: GcalDb,
  calendarId: string,
  selected: boolean,
): Promise<GcalResult<boolean>> {
  if (calendarId === '') return { ok: false, error: GCAL_MESSAGES.update };
  const { error } = await db.updateCalendarSelected(calendarId, selected);
  if (error) return { ok: false, error: GCAL_MESSAGES.update };
  return { ok: true, value: selected };
}

export async function setShareLevel(
  db: GcalDb,
  accountId: string,
  shareLevel: GoogleShareLevel,
): Promise<GcalResult<GoogleShareLevel>> {
  if (accountId === '' || !isGoogleShareLevel(shareLevel)) return { ok: false, error: GCAL_MESSAGES.update };
  const { error } = await db.updateShareLevel(accountId, shareLevel);
  if (error) return { ok: false, error: GCAL_MESSAGES.update };
  return { ok: true, value: shareLevel };
}

export async function disconnectAccount(db: GcalDb, accountId: string): Promise<GcalResult<true>> {
  if (accountId === '') return { ok: false, error: GCAL_MESSAGES.disconnect };
  const { error } = await db.deleteAccount(accountId);
  if (error) return { ok: false, error: GCAL_MESSAGES.disconnect };
  return { ok: true, value: true };
}

/** Kod GIS → Edge Function connect. Komunikat z funkcji (polski) ma pierwszeństwo. */
export async function connectWithCode(db: GcalDb, code: string): Promise<GcalResult<true>> {
  if (code === '') return { ok: false, error: GCAL_MESSAGES.connect };
  const { error } = await db.invokeConnect(code);
  if (error) return { ok: false, error: error.code === 'function' ? error.message : GCAL_MESSAGES.connect };
  return { ok: true, value: true };
}

export async function syncNow(db: GcalDb): Promise<GcalResult<true>> {
  const { error } = await db.invokeSync();
  if (error) return { ok: false, error: error.code === 'function' ? error.message : GCAL_MESSAGES.sync };
  return { ok: true, value: true };
}
