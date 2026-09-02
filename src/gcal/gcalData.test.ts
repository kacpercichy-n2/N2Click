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
  dayTrackerOccurrences,
  gcalEntryKey,
  gcalLegacyEntryKey,
  occurrencesByDate,
  setCalendarSelected,
  setShareLevel,
  syncNow,
  toGoogleAccount,
  toGoogleCalendar,
  buildProfileToPersonMap,
  resolveEventPeople,
  toGoogleEvent,
  visibleOccurrences,
  type GcalDb,
  type GcalDbError,
  type GcalRow,
} from './gcalData';
import type { Person } from '../types';
import { GCAL_MESSAGES, type GoogleEvent } from './types';

function eventRow(overrides: Partial<Record<string, unknown>> = {}): GcalRow {
  return {
    id: 'ev-1',
    calendar_id: 'cal-1',
    google_event_id: 'g-ev-1',
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

describe('buildProfileToPersonMap / resolveEventPeople', () => {
  const person = (id: string, email: string) => ({ id, email } as Person);
  const people = [person('local-kacper', 'Kacper@N2.pl'), person('uuid-zuzia', 'zuzia@n2.pl')];
  const profiles = [
    { id: 'uuid-kacper', email: 'kacper@n2.pl' },
    { id: 'uuid-zuzia', email: 'zuzia@n2.pl' },
    { id: 'uuid-nikt', email: 'nikt@n2.pl' },
  ];

  it('mapuje profil po id, a gdy brak — po e-mailu; obcy profil pomija', () => {
    const map = buildProfileToPersonMap(profiles, people);
    expect(map.get('uuid-kacper')).toBe('local-kacper');
    expect(map.get('uuid-zuzia')).toBe('uuid-zuzia');
    expect(map.has('uuid-nikt')).toBe(false);
  });

  it('podmienia właściciela i uczestników na id osób; nieznane id zostają', () => {
    const map = buildProfileToPersonMap(profiles, people);
    const ev = toGoogleEvent(
      eventRow({ owner_profile_id: 'uuid-kacper', attendee_profile_ids: ['uuid-kacper', 'uuid-zuzia', 'uuid-nikt'] }),
    )!;
    const [resolved] = resolveEventPeople([ev], map);
    expect(resolved.ownerProfileId).toBe('local-kacper');
    expect(resolved.attendeeProfileIds).toEqual(['local-kacper', 'uuid-zuzia', 'uuid-nikt']);
  });

  it('bez zmian zwraca tę samą tablicę i te same obiekty', () => {
    const ev = toGoogleEvent(eventRow({ owner_profile_id: 'uuid-zuzia', attendee_profile_ids: ['uuid-zuzia'] }))!;
    const list = [ev];
    expect(resolveEventPeople(list, new Map())).toBe(list);
    expect(resolveEventPeople(list, buildProfileToPersonMap(profiles, people))).toBe(list);
  });

  it('filtr po lokalnym id osoby trafia cudze wydarzenie po rozwiązaniu', () => {
    const map = buildProfileToPersonMap(profiles, people);
    const ev = toGoogleEvent(eventRow({ owner_profile_id: 'uuid-kacper', access: 'busy' }))!;
    const [resolved] = resolveEventPeople([ev], map);
    const occ = { event: resolved, date: '2026-08-25', startMinutes: 600, durationMinutes: 30 };
    expect(visibleOccurrences([occ], new Set(['local-kacper']))).toHaveLength(1);
    expect(visibleOccurrences([occ], new Set(['uuid-kacper']))).toHaveLength(0);
  });
});

describe('visibleOccurrences', () => {
  const occ = (id: string, owner: string, access: string) => ({
    event: toGoogleEvent(eventRow({ id, owner_profile_id: owner, access }))!,
    date: '2026-08-25',
    startMinutes: 600,
    durationMinutes: 30,
  });
  const own = occ('ev-own', 'p-me', 'owner');
  const ola = occ('ev-ola', 'p-ola', 'busy');
  const invited = occ('ev-inv', 'p-marek', 'attendee');
  const ids = (list: readonly { event: { id: string } }[]) => list.map((o) => o.event.id);

  it('pusty filtr: tylko własne wydarzenia (cudze są odfiltrowane)', () => {
    expect(ids(visibleOccurrences([own, ola, invited], new Set()))).toEqual(['ev-own']);
  });

  it('filtr obejmujący właściciela pokazuje jego wydarzenie', () => {
    expect(ids(visibleOccurrences([own, ola, invited], new Set(['p-ola'])))).toEqual(['ev-own', 'ev-ola']);
    expect(ids(visibleOccurrences([own, ola, invited], new Set(['p-marek', 'p-ola'])))).toEqual([
      'ev-own',
      'ev-ola',
      'ev-inv',
    ]);
  });

  it('bycie zaproszonym nie wystarcza: liczy się właściciel w filtrze', () => {
    expect(ids(visibleOccurrences([invited], new Set(['p-me'])))).toEqual([]);
  });

  it('zwraca tę samą tablicę, gdy nic nie odpada (stabilne referencje dla memo)', () => {
    const only = [own];
    expect(visibleOccurrences(only, new Set())).toBe(only);
    expect(visibleOccurrences([], new Set())).toEqual([]);
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

  it('ostatni dzień wielodniowego kończy się o `lastDayEndMinutes`, nie o północy', () => {
    const multi: GoogleEvent = {
      ...base,
      id: 'multi',
      startMinutes: 1320,
      durationMinutes: 120,
      endDate: '2026-08-27',
      lastDayEndMinutes: 570,
    };
    const map = occurrencesByDate([multi]);
    expect(map.get('2026-08-26')?.[0]).toMatchObject({ startMinutes: 0, durationMinutes: 1440 });
    expect(map.get('2026-08-27')?.[0]).toMatchObject({ startMinutes: 0, durationMinutes: 570 });
    expect(toGoogleEvent(eventRow({ last_day_end_minutes: 570 }))?.lastDayEndMinutes).toBe(570);
    expect(toGoogleEvent(eventRow({ last_day_end_minutes: 7 }))?.lastDayEndMinutes).toBeNull();
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

describe('dayTrackerOccurrences (widok Dzień trackera)', () => {
  const occ = (over: Partial<Record<string, unknown>>) => {
    const ev = toGoogleEvent(eventRow(over));
    if (ev === null) throw new Error('zła atrapa wydarzenia');
    return { event: ev, date: ev.date, startMinutes: ev.startMinutes, durationMinutes: ev.durationMinutes };
  };
  it('tylko godzinowe, niezerowe i nie odrzucone; rosnąco po starcie', () => {
    const list = dayTrackerOccurrences([
      occ({ id: 'late', start_minutes: 900 }),
      occ({ id: 'allday', is_all_day: true, start_minutes: 0, duration_minutes: 1440 }),
      occ({ id: 'declined', self_response: 'declined' }),
      { ...occ({ id: 'zero' }), durationMinutes: 0 }, // mapowanie odrzuca <15 min, filtr broni się i tak
      occ({ id: 'early', start_minutes: 600 }),
    ]);
    expect(list.map((o) => o.event.id)).toEqual(['early', 'late']);
  });
  it('gcalEntryKey: stabilny klucz po (calendar_id, google_event_id), nie po id wiersza', () => {
    const ev = toGoogleEvent(eventRow({}));
    expect(ev?.calendarId).toBe('cal-1');
    expect(ev?.googleEventId).toBe('g-ev-1');
    expect(gcalEntryKey(ev!)).toBe('gcal:cal-1:g-ev-1');
    // pełny sync wstawia wiersz od nowa (inne `id`), klucz zostaje ten sam
    const resynced = toGoogleEvent(eventRow({ id: 'row-2' }));
    expect(gcalEntryKey(resynced!)).toBe('gcal:cal-1:g-ev-1');
    expect(gcalLegacyEntryKey(ev!)).toBe('gcal:ev-1');
  });
  it('gcalEntryKey: widok bez nowych kolumn (stary deploy) wraca do id wiersza', () => {
    const ev = toGoogleEvent(eventRow({ calendar_id: undefined, google_event_id: undefined }));
    expect(ev?.calendarId).toBe('');
    expect(gcalEntryKey(ev!)).toBe('gcal:ev-1');
  });
});
