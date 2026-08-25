// Edge Function `google-calendar-sync` — cykliczny import wydarzeń z Google
// dla WSZYSTKICH aktywnych kont (pg_cron co 5 min) albo dla JEDNEGO konta
// (żądanie użytkownika „Synchronizuj teraz" z JWT).
//
// Ten plik działa WYŁĄCZNIE w runtime Deno (Supabase Edge) i NIE jest
// typowany przez tsc repo. Decyzyjność (mapowanie, okno, klasyfikacja błędów)
// siedzi w czystym `./contract.ts` (testowanym w repo).
//
// GRANICA ZAUFANIA:
//   * Wywołanie z crona autoryzuje nagłówek `x-n2-cron-secret` = sekret
//     funkcji `GOOGLE_SYNC_CRON_SECRET` (ten sam, co w Vault
//     `n2click_google_sync_secret`). Funkcja jest deployowana z
//     `--no-verify-jwt`, bo pg_net nie ma JWT użytkownika.
//   * Wywołanie z aplikacji ma `Authorization: Bearer <jwt>`; synchronizujemy
//     WYŁĄCZNIE konto wywołującego i wymagamy wiersza `app_access` N2Click.
//   * Refresh token czyta definer `google_read_refresh_token` (tylko
//     service_role). Nigdy nie logujemy tokenów ani treści wydarzeń.
//
// ATOMOWOŚĆ (przegląd Codex 2026-08-25): najpierw pobieramy WSZYSTKIE strony
// z Google, a dopiero potem jedno RPC `google_apply_calendar_sync` w jednej
// transakcji kasuje/upsertuje/przesuwa token — błąd sieci po drodze zostawia
// tabelę nietkniętą. Konto ma DZIERŻAWĘ (`sync_lease_until`) zajmowaną
// warunkowym UPDATE, więc cron, connect i „Synchronizuj teraz" nie biegną
// równolegle. Każdy błąd Supabase przerywa sync konta; `status`/`last_sync_at`
// idą do góry dopiero po komplecie kalendarzy.

import { createClient } from 'npm:@supabase/supabase-js@2.110.6';
import {
  GCAL_MESSAGES,
  classifyGoogleFailure,
  decideSyncMode,
  mapGoogleEvent,
  profileEmailIndex,
  type GoogleEvent,
  type GoogleEventRow,
} from './contract.ts';
import {
  fetchCalendarList,
  fetchEventsPage,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from '../_shared/google.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const TIME_ZONE = 'Europe/Warsaw';
/** Dzierżawa syncu konta: dłużej niż realny sync, krócej niż dwa takty crona. */
const LEASE_SECONDS = 240;

function corsHeaders(): Record<string, string> {
  const origin = Deno.env.get('GOOGLE_ALLOWED_ORIGIN');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, x-n2-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

interface AccountRow {
  id: string;
  profile_id: string;
  status: string;
}

interface CalendarRow {
  id: string;
  google_calendar_id: string;
  selected: boolean;
  is_primary: boolean;
  sync_token: string | null;
  last_full_sync_at: string | null;
}

type ServiceClient = ReturnType<typeof createClient>;

type AccountStatus = 'ok' | 'revoked' | 'error' | 'rate-limited' | 'busy';

/** Wynik syncu jednego konta (do odpowiedzi i logu). */
interface AccountSyncSummary {
  accountId: string;
  calendars: number;
  upserted: number;
  removed: number;
  status: AccountStatus;
  message?: string;
}

type CalendarSyncOutcome =
  | { kind: 'ok'; upserted: number; removed: number }
  | { kind: 'sync-token-expired' }
  | { kind: 'revoked' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; message: string };

/** Warunkowe zajęcie dzierżawy; `false` = ktoś inny właśnie synchronizuje. */
async function claimLease(client: ServiceClient, accountId: string, nowIso: string): Promise<boolean> {
  const until = new Date(Date.parse(nowIso) + LEASE_SECONDS * 1000).toISOString();
  const { data, error } = await client
    .from('google_accounts')
    .update({ sync_lease_until: until })
    .eq('id', accountId)
    .or(`sync_lease_until.is.null,sync_lease_until.lt.${nowIso}`)
    .select('id');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function releaseLease(client: ServiceClient, accountId: string): Promise<void> {
  await client.from('google_accounts').update({ sync_lease_until: null }).eq('id', accountId);
}

async function syncAccount(
  client: ServiceClient,
  oauth: GoogleOAuthConfig,
  account: AccountRow,
  profileByEmail: Map<string, string>,
  nowIso: string,
): Promise<AccountSyncSummary> {
  const summary: AccountSyncSummary = {
    accountId: account.id,
    calendars: 0,
    upserted: 0,
    removed: 0,
    status: 'ok',
  };
  const fail = async (status: AccountStatus, message: string): Promise<AccountSyncSummary> => {
    summary.status = status;
    summary.message = message;
    if (status === 'revoked' || status === 'error') {
      await client
        .from('google_accounts')
        .update({ status: status === 'revoked' ? 'revoked' : 'error', last_error: message.slice(0, 300) })
        .eq('id', account.id);
    }
    return summary;
  };

  if (!(await claimLease(client, account.id, nowIso))) {
    summary.status = 'busy';
    summary.message = GCAL_MESSAGES.syncBusy;
    return summary;
  }

  try {
    // 1. Refresh token (Vault przez definera) -> access token.
    const { data: refreshToken, error: secretError } = await client.rpc('google_read_refresh_token', {
      p_account_id: account.id,
    });
    if (secretError || typeof refreshToken !== 'string' || refreshToken === '') {
      return await fail('error', 'Brak tokenu odświeżania.');
    }
    const refreshed = await refreshAccessToken(oauth, refreshToken);
    const accessToken = refreshed.body?.access_token;
    if (!refreshed.ok || typeof accessToken !== 'string' || accessToken === '') {
      const failure = classifyGoogleFailure(refreshed.status, refreshed.text);
      if (failure.kind === 'revoked') return await fail('revoked', GCAL_MESSAGES.syncRevoked);
      if (failure.kind === 'rate-limited' || failure.kind === 'temporary') {
        return await fail('rate-limited', GCAL_MESSAGES.syncRateLimited);
      }
      return await fail('error', 'Nie udało się odświeżyć tokenu Google.');
    }

    // 2. Lista kalendarzy (WSZYSTKIE strony): nowe dopisujemy (primary domyślnie
    //    `selected`), zniknięte kasujemy (kaskada sprząta wydarzenia). Każdy
    //    błąd Supabase przerywa sync konta.
    const list = await fetchCalendarList(accessToken);
    if (!list.ok) {
      const failure = classifyGoogleFailure(list.status, list.text);
      if (failure.kind === 'revoked') return await fail('revoked', GCAL_MESSAGES.syncRevoked);
      if (failure.kind === 'rate-limited' || failure.kind === 'temporary') {
        return await fail('rate-limited', GCAL_MESSAGES.syncRateLimited);
      }
      return await fail('error', 'Nie udało się pobrać listy kalendarzy.');
    }
    const remoteCalendars = (list.body?.items ?? []).filter(
      (item) => typeof item.id === 'string' && item.id !== '' && item.deleted !== true && item.hidden !== true,
    );
    const { data: existingRows, error: existingError } = await client
      .from('google_calendars')
      .select('id, google_calendar_id, selected, is_primary, sync_token, last_full_sync_at')
      .eq('account_id', account.id);
    if (existingError) return await fail('error', 'Nie udało się odczytać kalendarzy.');
    const existing = new Map<string, CalendarRow>();
    for (const row of (existingRows ?? []) as CalendarRow[]) existing.set(row.google_calendar_id, row);

    const remoteIds = new Set<string>();
    for (const item of remoteCalendars) {
      const gid = item.id as string;
      remoteIds.add(gid);
      const known = existing.get(gid);
      if (known) {
        const { error } = await client
          .from('google_calendars')
          .update({ summary: item.summary ?? '', is_primary: item.primary === true, color: item.backgroundColor ?? null })
          .eq('id', known.id);
        if (error) return await fail('error', 'Nie udało się zapisać kalendarza.');
        continue;
      }
      const { data: inserted, error } = await client
        .from('google_calendars')
        .insert({
          account_id: account.id,
          google_calendar_id: gid,
          summary: item.summary ?? '',
          is_primary: item.primary === true,
          selected: item.primary === true,
          color: item.backgroundColor ?? null,
        })
        .select('id, google_calendar_id, selected, is_primary, sync_token, last_full_sync_at')
        .maybeSingle();
      if (error || !inserted) return await fail('error', 'Nie udało się dodać kalendarza.');
      existing.set(gid, inserted as CalendarRow);
    }
    for (const [gid, row] of existing) {
      if (remoteIds.has(gid)) continue;
      const { error } = await client.from('google_calendars').delete().eq('id', row.id);
      if (error) return await fail('error', 'Nie udało się usunąć kalendarza.');
      existing.delete(gid);
    }

    // 3. Wydarzenia wybranych kalendarzy: pełny sync (okno) albo przyrostowy
    //    (syncToken). 410 => zrzuć token i pełny sync od nowa.
    for (const calendar of existing.values()) {
      if (!calendar.selected) continue;
      summary.calendars += 1;
      let mode = decideSyncMode(
        { syncToken: calendar.sync_token, lastFullSyncAt: calendar.last_full_sync_at },
        nowIso,
      );
      let attempt = 0;
      while (attempt < 2) {
        attempt += 1;
        const outcome = await syncCalendar(client, accessToken, account, calendar, mode, profileByEmail, nowIso);
        if (outcome.kind === 'ok') {
          summary.upserted += outcome.upserted;
          summary.removed += outcome.removed;
          break;
        }
        if (outcome.kind === 'sync-token-expired' && attempt === 1) {
          mode = decideSyncMode({ syncToken: null, lastFullSyncAt: null }, nowIso);
          continue;
        }
        if (outcome.kind === 'revoked') return await fail('revoked', GCAL_MESSAGES.syncRevoked);
        if (outcome.kind === 'rate-limited') return await fail('rate-limited', GCAL_MESSAGES.syncRateLimited);
        return await fail('error', outcome.kind === 'error' ? outcome.message : GCAL_MESSAGES.syncFailed);
      }
    }

    const { error: doneError } = await client
      .from('google_accounts')
      .update({ status: 'active', last_error: null, last_sync_at: nowIso })
      .eq('id', account.id);
    if (doneError) return await fail('error', 'Nie udało się zapisać stanu konta.');
    return summary;
  } finally {
    await releaseLease(client, account.id);
  }
}

async function syncCalendar(
  client: ServiceClient,
  accessToken: string,
  account: AccountRow,
  calendar: CalendarRow,
  mode: ReturnType<typeof decideSyncMode>,
  profileByEmail: Map<string, string>,
  nowIso: string,
): Promise<CalendarSyncOutcome> {
  const rows: GoogleEventRow[] = [];
  const cancelled: string[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  // Najpierw KOMPLET stron — dopiero potem jakikolwiek zapis.
  do {
    const page = await fetchEventsPage(accessToken, {
      calendarId: calendar.google_calendar_id,
      timeZone: TIME_ZONE,
      window: mode.mode === 'full' ? mode.window : undefined,
      syncToken: mode.mode === 'incremental' ? mode.syncToken : undefined,
      pageToken,
    });
    if (!page.ok) {
      const failure = classifyGoogleFailure(page.status, page.text);
      if (failure.kind === 'sync-token-expired') return { kind: 'sync-token-expired' };
      if (failure.kind === 'revoked') return { kind: 'revoked' };
      if (failure.kind === 'rate-limited' || failure.kind === 'temporary') return { kind: 'rate-limited' };
      return { kind: 'error', message: `Google odrzuciło zapytanie (${failure.status}).` };
    }
    for (const raw of page.body?.items ?? []) {
      const mapped = mapGoogleEvent({
        event: raw as GoogleEvent,
        calendarId: calendar.id,
        accountId: account.id,
        profileByEmail,
        timeZone: TIME_ZONE,
        nowIso,
      });
      if (mapped.kind === 'row') rows.push(mapped.row);
      else if (mapped.kind === 'cancelled') cancelled.push(mapped.googleEventId);
    }
    pageToken = page.body?.nextPageToken;
    if (page.body?.nextSyncToken) nextSyncToken = page.body.nextSyncToken;
  } while (pageToken);

  // Jedna transakcja: kasowanie (pełny sync), upsert, odwołane, token.
  const { error } = await client.rpc('google_apply_calendar_sync', {
    p_calendar_id: calendar.id,
    p_full: mode.mode === 'full',
    p_rows: rows,
    p_cancelled: cancelled,
    p_sync_token: nextSyncToken ?? null,
    p_now: nowIso,
  });
  if (error) return { kind: 'error', message: 'Nie udało się zapisać wydarzeń.' };
  return { kind: 'ok', upserted: rows.length, removed: cancelled.length };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return json(405, { error: GCAL_MESSAGES.methodNotAllowed });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const cronSecret = Deno.env.get('GOOGLE_SYNC_CRON_SECRET') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    console.error('google-calendar-sync: brak konfiguracji (SUPABASE_* / GOOGLE_CLIENT_*)');
    return json(500, { error: GCAL_MESSAGES.serverConfig });
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'n2click' },
  });

  // Kto woła: cron (sekret) albo użytkownik (JWT => tylko jego konto).
  let onlyProfileId: string | null = null;
  const headerSecret = req.headers.get('x-n2-cron-secret') ?? '';
  if (headerSecret !== '') {
    if (cronSecret === '' || headerSecret !== cronSecret) {
      return json(403, { error: GCAL_MESSAGES.forbiddenCron });
    }
  } else {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
    const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    if (jwt === '') return json(401, { error: GCAL_MESSAGES.missingAuthorization });
    const { data: userData, error: userError } = await client.auth.getUser(jwt);
    if (userError || !userData?.user) return json(401, { error: GCAL_MESSAGES.invalidSession });
    onlyProfileId = userData.user.id;
    // Dostęp do N2Click (projekt wspólny dla appek) — jak w connect.
    const { data: access, error: accessError } = await client
      .from('app_access')
      .select('user_id')
      .eq('user_id', onlyProfileId)
      .eq('app', 'n2click')
      .maybeSingle();
    if (accessError) return json(500, { error: GCAL_MESSAGES.serverError });
    if (!access) return json(403, { error: GCAL_MESSAGES.forbiddenApp });
  }

  const nowIso = new Date().toISOString();
  let accountsQuery = client.from('google_accounts').select('id, profile_id, status');
  accountsQuery = onlyProfileId
    ? accountsQuery.eq('profile_id', onlyProfileId)
    : accountsQuery.eq('status', 'active');
  const { data: accountRows, error: accountsError } = await accountsQuery;
  if (accountsError) {
    console.error('google-calendar-sync: nie udało się pobrać kont');
    return json(500, { error: GCAL_MESSAGES.serverError });
  }
  const accounts = (accountRows ?? []) as AccountRow[];
  if (accounts.length === 0) return json(200, { synced: [] });

  const { data: profileRows, error: profilesError } = await client.from('profiles').select('id, email');
  if (profilesError) {
    console.error('google-calendar-sync: nie udało się pobrać profili');
    return json(500, { error: GCAL_MESSAGES.serverError });
  }
  const profileByEmail = profileEmailIndex((profileRows ?? []) as Array<{ id?: unknown; email?: unknown }>);

  const results: AccountSyncSummary[] = [];
  for (const account of accounts) {
    try {
      results.push(await syncAccount(client, { clientId, clientSecret }, account, profileByEmail, nowIso));
    } catch (error) {
      console.error('google-calendar-sync: wyjątek konta', account.id, error instanceof Error ? error.message : '');
      results.push({
        accountId: account.id,
        calendars: 0,
        upserted: 0,
        removed: 0,
        status: 'error',
        message: GCAL_MESSAGES.syncFailed,
      });
    }
  }

  // Wywołanie użytkownika: porażka JEGO konta wraca jako błąd (409 + polski
  // komunikat), nie jako 200 — klient nie może zgłosić sukcesu na ślepo.
  if (onlyProfileId !== null) {
    const own = results[0];
    if (own && own.status !== 'ok') {
      return json(409, { error: own.message ?? GCAL_MESSAGES.syncFailed, synced: results });
    }
  }
  return json(200, { synced: results });
});
