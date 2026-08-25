// Testy czystego kontraktu importu Kalendarza Google (współdzielonego z Edge
// Function `google-calendar-sync`): siatka 15 min, całodniowe, wielodniowe,
// odwołane, typy pomijane, link do spotkania, uczestnicy, okno syncu,
// klasyfikacja błędów, wymiana kodu.
import { describe, expect, it } from 'vitest';
import {
  FULL_RESYNC_AFTER_DAYS,
  classifyGoogleFailure,
  decideSyncMode,
  fullSyncWindow,
  mapGoogleEvent,
  meetingUrlOf,
  parseTokenExchange,
  profileEmailIndex,
  shiftDate,
  stripHtml,
  toLocalMoment,
  type GoogleEvent,
} from '../../supabase/functions/google-calendar-sync/contract';

const NOW = '2026-08-25T10:00:00.000Z';
const profiles = profileEmailIndex([
  { id: 'p-ola', email: 'Ola@N2.pl' },
  { id: 'p-marek', email: 'marek@n2.pl' },
  { id: 'bez', email: '' },
]);

function map(event: GoogleEvent) {
  return mapGoogleEvent({ event, calendarId: 'cal-1', accountId: 'acc-1', profileByEmail: profiles, nowIso: NOW });
}

describe('czas i siatka', () => {
  it('toLocalMoment honoruje strefę Europe/Warsaw (lato = UTC+2)', () => {
    expect(toLocalMoment('2026-08-25T08:07:00Z')).toEqual({ date: '2026-08-25', minutes: 607 });
    expect(toLocalMoment('2026-01-15T23:30:00Z')).toEqual({ date: '2026-01-16', minutes: 30 });
    expect(toLocalMoment('nie-data')).toBeNull();
  });

  it('shiftDate liczy dni bez strefy', () => {
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('godzinowe: start w dół, koniec w górę do kwadransa', () => {
    const result = map({
      id: 'e1',
      status: 'confirmed',
      summary: 'Daily',
      start: { dateTime: '2026-08-25T10:07:00+02:00' },
      end: { dateTime: '2026-08-25T10:38:00+02:00' },
    });
    expect(result.kind).toBe('row');
    if (result.kind !== 'row') return;
    expect(result.row.event_date).toBe('2026-08-25');
    expect(result.row.start_minutes).toBe(600);
    expect(result.row.duration_minutes).toBe(45);
    expect(result.row.is_all_day).toBe(false);
    expect(result.row.is_busy).toBe(true);
    expect(result.row.end_date).toBeNull();
    expect(result.row.start_at).toBe('2026-08-25T08:07:00.000Z');
  });

  it('zerowa długość dostaje minimum 15 minut, a koniec doby nie wychodzi poza 1440', () => {
    const zero = map({
      id: 'e2',
      start: { dateTime: '2026-08-25T12:00:00+02:00' },
      end: { dateTime: '2026-08-25T12:00:00+02:00' },
    });
    expect(zero.kind === 'row' && zero.row.duration_minutes).toBe(15);
    const late = map({
      id: 'e3',
      start: { dateTime: '2026-08-25T23:50:00+02:00' },
      end: { dateTime: '2026-08-25T23:59:00+02:00' },
    });
    expect(late.kind === 'row' && late.row.start_minutes).toBe(1425);
    expect(late.kind === 'row' && late.row.duration_minutes).toBe(15);
  });

  it('całodniowe: 0/1440, koniec Google wyłączny => end_date dzień wcześniej', () => {
    const one = map({ id: 'e4', start: { date: '2026-08-25' }, end: { date: '2026-08-26' } });
    expect(one.kind === 'row' && one.row).toMatchObject({
      is_all_day: true,
      start_minutes: 0,
      duration_minutes: 1440,
      end_date: null,
      is_busy: false,
    });
    const multi = map({ id: 'e5', start: { date: '2026-08-25' }, end: { date: '2026-08-28' } });
    expect(multi.kind === 'row' && multi.row.end_date).toBe('2026-08-27');
    const ooo = map({ id: 'e6', eventType: 'outOfOffice', start: { date: '2026-08-25' }, end: { date: '2026-08-26' } });
    expect(ooo.kind === 'row' && ooo.row.is_busy).toBe(true);
  });

  it('wielodniowe godzinowe: pierwszy dzień do północy + end_date', () => {
    const result = map({
      id: 'e7',
      start: { dateTime: '2026-08-25T22:00:00+02:00' },
      end: { dateTime: '2026-08-27T00:00:00+02:00' },
    });
    expect(result.kind === 'row' && result.row).toMatchObject({
      event_date: '2026-08-25',
      start_minutes: 1320,
      duration_minutes: 120,
      end_date: '2026-08-26',
      // Koniec dokładnie o północy => ostatni dzień to pełna doba.
      last_day_end_minutes: null,
    });
    const partial = map({
      id: 'e7b',
      start: { dateTime: '2026-08-25T22:00:00+02:00' },
      end: { dateTime: '2026-08-27T09:20:00+02:00' },
    });
    expect(partial.kind === 'row' && partial.row).toMatchObject({
      end_date: '2026-08-27',
      last_day_end_minutes: 570,
    });
    const single = map({
      id: 'e7c',
      start: { dateTime: '2026-08-25T10:00:00+02:00' },
      end: { dateTime: '2026-08-25T11:00:00+02:00' },
    });
    expect(single.kind === 'row' && single.row.last_day_end_minutes).toBeNull();
  });
});

describe('decyzje mapowania', () => {
  it('odwołane => cancelled, brak id/czasu i typy spoza listy => skip', () => {
    expect(map({ id: 'x', status: 'cancelled' })).toEqual({ kind: 'cancelled', googleEventId: 'x' });
    expect(map({}).kind).toBe('skip');
    expect(map({ id: 'y' }).kind).toBe('skip');
    expect(map({ id: 'z', eventType: 'birthday', start: { date: '2026-08-25' }, end: { date: '2026-08-26' } }).kind).toBe('skip');
  });

  it('prywatne/poufne => is_confidential; Wolny => is_busy false', () => {
    const priv = map({
      id: 'e8',
      visibility: 'private',
      transparency: 'transparent',
      start: { dateTime: '2026-08-25T10:00:00+02:00' },
      end: { dateTime: '2026-08-25T11:00:00+02:00' },
    });
    expect(priv.kind === 'row' && priv.row.is_confidential).toBe(true);
    expect(priv.kind === 'row' && priv.row.is_busy).toBe(false);
  });

  it('uczestnicy i organizator dopasowani po e-mailu (lowercase), zasoby pominięte', () => {
    const result = map({
      id: 'e9',
      start: { dateTime: '2026-08-25T10:00:00+02:00' },
      end: { dateTime: '2026-08-25T11:00:00+02:00' },
      organizer: { email: 'MAREK@n2.pl' },
      attendees: [
        { email: 'ola@n2.pl', responseStatus: 'accepted', self: true },
        { email: 'sala@resource.calendar.google.com', resource: true },
        { email: 'obcy@example.com', responseStatus: 'declined' },
      ],
    });
    expect(result.kind === 'row' && result.row.attendee_profile_ids.sort()).toEqual(['p-marek', 'p-ola']);
    expect(result.kind === 'row' && result.row.self_response).toBe('accepted');
    expect(result.kind === 'row' && result.row.attendees.map((a) => a.email)).toEqual(['ola@n2.pl', 'obcy@example.com']);
  });

  it('meetingUrlOf: conferenceData > hangoutLink > regex po opisie', () => {
    expect(
      meetingUrlOf({
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+48' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
        hangoutLink: 'https://meet.google.com/zzz-zzzz-zzz',
      }),
    ).toBe('https://meet.google.com/abc-defg-hij');
    expect(meetingUrlOf({ hangoutLink: 'https://meet.google.com/zzz-zzzz-zzz' })).toBe('https://meet.google.com/zzz-zzzz-zzz');
    expect(meetingUrlOf({ description: 'Link: https://us02web.zoom.us/j/123456789?pwd=abc dziękuję' })).toBe(
      'https://us02web.zoom.us/j/123456789?pwd=abc',
    );
    expect(meetingUrlOf({ location: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting' })).toBe(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
    );
    expect(meetingUrlOf({ description: 'bez linku' })).toBe('');
  });

  it('stripHtml zdejmuje znaczniki i encje, zostawia nowe linie', () => {
    expect(stripHtml('<p>Agenda:</p><ul><li>a &amp; b</li></ul><br>koniec')).toBe('Agenda:\na & b\nkoniec');
  });
});

describe('okno i tryb syncu', () => {
  it('fullSyncWindow to -30/+90 dni', () => {
    expect(fullSyncWindow('2026-08-25')).toEqual({ timeMin: '2026-07-26T00:00:00Z', timeMax: '2026-11-23T00:00:00Z' });
  });

  it('decideSyncMode: brak tokenu albo stare okno => pełny; inaczej przyrostowy', () => {
    expect(decideSyncMode({ syncToken: null, lastFullSyncAt: null }, NOW).mode).toBe('full');
    expect(decideSyncMode({ syncToken: 'tok', lastFullSyncAt: '2026-08-20T00:00:00Z' }, NOW)).toEqual({ mode: 'incremental', syncToken: 'tok' });
    const stale = shiftDate('2026-08-25', -(FULL_RESYNC_AFTER_DAYS + 1)) + 'T00:00:00Z';
    expect(decideSyncMode({ syncToken: 'tok', lastFullSyncAt: stale }, NOW).mode).toBe('full');
  });

  it('classifyGoogleFailure: 410, 401/invalid_grant, 429/403 quota, 5xx, reszta fatal', () => {
    expect(classifyGoogleFailure(410, '')).toEqual({ kind: 'sync-token-expired' });
    expect(classifyGoogleFailure(401, '')).toEqual({ kind: 'revoked' });
    expect(classifyGoogleFailure(400, '{"error":"invalid_grant"}')).toEqual({ kind: 'revoked' });
    expect(classifyGoogleFailure(429, '')).toEqual({ kind: 'rate-limited' });
    expect(classifyGoogleFailure(403, '{"reason":"rateLimitExceeded"}')).toEqual({ kind: 'rate-limited' });
    expect(classifyGoogleFailure(503, '')).toEqual({ kind: 'temporary', status: 503 });
    expect(classifyGoogleFailure(404, 'nie ma').kind).toBe('fatal');
  });

  it('parseTokenExchange wymaga access_token i refresh_token', () => {
    expect(parseTokenExchange({ access_token: 'a', refresh_token: 'r', scope: 's' })).toEqual({ ok: true, accessToken: 'a', refreshToken: 'r', scope: 's' });
    expect(parseTokenExchange({ access_token: 'a' }).ok).toBe(false);
    expect(parseTokenExchange(null).ok).toBe(false);
  });
});
