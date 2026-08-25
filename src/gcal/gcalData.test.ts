// Testy czystej warstwy danych importu Kalendarza Google na atrapie `GcalDb`:
// łagodne mapowanie wierszy, rozwijanie wielodniowych na dni, operacje z
// polskimi komunikatami (błąd funkcji ma pierwszeństwo).
import { describe, expect, it } from 'vitest';
import {
  connectWithCode,
  disconnectAccount,
  loadAccount,
  loadCalendars,
  loadVisibleEvents,
  occurrencesByDate,
  setCalendarSelected,
  setShareLevel,
  syncNow,
  toGoogleAccount,
  toGoogleCalendar,
  toGoogleEvent,
  type GcalDb,
  type GcalDbError,
  type GcalRow,
} from './gcalData';
import { GCAL_MESSAGES, type GoogleEvent } from './types';

function eventRow(overrides: Partial<Record<string, unknown>> = {}): GcalRow {
  return {
    id: 'ev-1',
    owner_profile_id: 'p-ola',
    access: 'attendee',
    title: 'Daily',
    description: '',
    location: '',
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    html_link: '',
    event_date: '2026-08-25',
    end_date: null,
    start_minutes: 600,
    duration_minutes: 30,
    is_all_day: false,
    is_busy: true,
    attendee_profile_ids: ['p-ola', 'p-marek'],
    self_response: 'accepted',
    ...overrides,
  };
}

class FakeGcalDb implements GcalDb {
  accountRow: GcalRow | null = null;
  accountError: GcalDbError | null = null;
  calendarRows: GcalRow[] = [];
  eventRows: GcalRow[] = [];
  eventsError: GcalDbError | null = null;
  writeError: GcalDbError | null = null;
  functionError: GcalDbError | null = null;
  calls: string[] = [];

  async selectAccount() {
    this.calls.push('account');
    return { row: this.accountRow, error: this.accountError };
  }
  async selectCalendars(accountId: string) {
    this.calls.push(`calendars:${accountId}`);
    return { rows: this.calendarRows, error: null };
  }
  async selectVisibleEvents(fromDate: string, toDate: string) {
    this.calls.push(`events:${fromDate}:${toDate}`);
    return { rows: this.eventRows, error: this.eventsError };
  }
  async updateCalendarSelected(calendarId: string, selected: boolean) {
    this.calls.push(`selected:${calendarId}:${selected}`);
    return { error: this.writeError };
  }
  async updateShareLevel(accountId: string, shareLevel: string) {
    this.calls.push(`share:${accountId}:${shareLevel}`);
    return { error: this.writeError };
  }
  async deleteAccount(accountId: string) {
    this.calls.push(`delete:${accountId}`);
    return { error: this.writeError };
  }
  async invokeConnect(code: string) {
    this.calls.push(`connect:${code}`);
    return { error: this.functionError };
  }
  async invokeSync() {
    this.calls.push('sync');
    return { error: this.functionError };
  }
}

describe('mapowanie wierszy', () => {
  it('toGoogleEvent czyta widok i odrzuca wiersze poza siatką', () => {
    const event = toGoogleEvent(eventRow());
    expect(event).toMatchObject({
      id: 'ev-1',
      access: 'attendee',
      startMinutes: 600,
      durationMinutes: 30,
      endDate: null,
      attendeeProfileIds: ['p-ola', 'p-marek'],
    });
    expect(toGoogleEvent(eventRow({ start_minutes: 1430 }))).toBeNull();
    expect(toGoogleEvent(eventRow({ duration_minutes: 0 }))).toBeNull();
    expect(toGoogleEvent(eventRow({ event_date: '25.08.2026' }))).toBeNull();
    expect(toGoogleEvent(eventRow({ access: 'cos' }))?.access).toBe('busy');
    // `end_date` nie później niż start nie jest zakresem.
    expect(toGoogleEvent(eventRow({ end_date: '2026-08-25' }))?.endDate).toBeNull();
    expect(toGoogleEvent(eventRow({ end_date: '2026-08-27' }))?.endDate).toBe('2026-08-27');
  });

  it('toGoogleAccount i toGoogleCalendar mają bezpieczne domyślne', () => {
    expect(toGoogleAccount(null)).toBeNull();
    expect(toGoogleAccount({ id: 'a', profile_id: 'p', share_level: 'zle', status: 'dziwne' })).toMatchObject({
      shareLevel: 'busy',
      status: 'error',
      lastError: null,
    });
    expect(toGoogleCalendar({ id: 'c', google_calendar_id: 'primary', is_primary: true })).toMatchObject({
      isPrimary: true,
      selected: false,
      color: null,
    });
    expect(toGoogleCalendar({ id: 'c' })).toBeNull();
  });
});

describe('occurrencesByDate', () => {
  const base = toGoogleEvent(eventRow()) as GoogleEvent;

  it('wielodniowe rozwija na dni: pierwszy dzień od startu, kolejne 0/1440', () => {
    const multi: GoogleEvent = { ...base, id: 'multi', startMinutes: 1320, durationMinutes: 120, endDate: '2026-08-27' };
    const map = occurrencesByDate([base, multi]);
    expect(map.get('2026-08-25')?.map((o) => [o.event.id, o.startMinutes, o.durationMinutes])).toEqual([
      ['ev-1', 600, 30],
      ['multi', 1320, 120],
    ]);
    expect(map.get('2026-08-26')?.map((o) => [o.event.id, o.startMinutes, o.durationMinutes])).toEqual([
      ['multi', 0, 1440],
    ]);
    expect(map.get('2026-08-27')).toHaveLength(1);
    expect(map.get('2026-08-28')).toBeUndefined();
  });

  it('sortuje po starcie, potem po id', () => {
    const later: GoogleEvent = { ...base, id: 'a-later', startMinutes: 660 };
    const same: GoogleEvent = { ...base, id: 'aaa' };
    const map = occurrencesByDate([later, base, same]);
    expect(map.get('2026-08-25')?.map((o) => o.event.id)).toEqual(['aaa', 'ev-1', 'a-later']);
  });
});

describe('operacje', () => {
  it('loadAccount / loadCalendars / loadVisibleEvents mapują i tłumaczą błędy', async () => {
    const db = new FakeGcalDb();
    expect(await loadAccount(db)).toEqual({ ok: true, value: null });
    db.accountRow = { id: 'a', profile_id: 'p', google_email: 'x@n2.pl', share_level: 'details', status: 'active' };
    const account = await loadAccount(db);
    expect(account.ok && account.value?.shareLevel).toBe('details');
    db.accountError = { code: null, message: 'x' };
    expect(await loadAccount(db)).toEqual({ ok: false, error: GCAL_MESSAGES.account });

    expect(await loadCalendars(db, '')).toEqual({ ok: true, value: [] });
    db.calendarRows = [{ id: 'c', google_calendar_id: 'primary' }, { id: '' }];
    const calendars = await loadCalendars(db, 'a');
    expect(calendars.ok && calendars.value.map((c) => c.id)).toEqual(['c']);

    db.eventRows = [eventRow(), eventRow({ id: '' })];
    const events = await loadVisibleEvents(db, '2026-08-01', '2026-08-31');
    expect(events.ok && events.value.map((e) => e.id)).toEqual(['ev-1']);
    expect(db.calls).toContain('events:2026-08-01:2026-08-31');
    expect((await loadVisibleEvents(db, '2026-08-31', '2026-08-01')).ok).toBe(false);
    db.eventsError = { code: null, message: 'x' };
    expect(await loadVisibleEvents(db, '2026-08-01', '2026-08-31')).toEqual({ ok: false, error: GCAL_MESSAGES.load });
  });

  it('ustawienia i rozłączenie wołają bazę i mapują błąd zapisu', async () => {
    const db = new FakeGcalDb();
    expect(await setCalendarSelected(db, 'c', true)).toEqual({ ok: true, value: true });
    expect(await setShareLevel(db, 'a', 'hidden')).toEqual({ ok: true, value: 'hidden' });
    expect(await disconnectAccount(db, 'a')).toEqual({ ok: true, value: true });
    expect(db.calls).toEqual(['selected:c:true', 'share:a:hidden', 'delete:a']);
    expect((await setCalendarSelected(db, '', true)).ok).toBe(false);
    expect((await setShareLevel(db, 'a', 'zle' as never)).ok).toBe(false);
    db.writeError = { code: '42501', message: 'forbidden' };
    expect(await setCalendarSelected(db, 'c', false)).toEqual({ ok: false, error: GCAL_MESSAGES.update });
    expect(await disconnectAccount(db, 'a')).toEqual({ ok: false, error: GCAL_MESSAGES.disconnect });
  });

  it('connectWithCode i syncNow: polski błąd z funkcji ma pierwszeństwo', async () => {
    const db = new FakeGcalDb();
    expect(await connectWithCode(db, 'kod')).toEqual({ ok: true, value: true });
    expect(await connectWithCode(db, '')).toEqual({ ok: false, error: GCAL_MESSAGES.connect });
    db.functionError = { code: 'function', message: 'Google odrzuciło kod autoryzacji.' };
    expect(await connectWithCode(db, 'kod')).toEqual({ ok: false, error: 'Google odrzuciło kod autoryzacji.' });
    db.functionError = { code: null, message: 'network' };
    expect(await syncNow(db)).toEqual({ ok: false, error: GCAL_MESSAGES.sync });
    db.functionError = null;
    expect(await syncNow(db)).toEqual({ ok: true, value: true });
  });
});
