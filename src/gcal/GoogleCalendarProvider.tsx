// Cienki dostawca Reacta dla importu Kalendarza Google: spina warstwę danych
// (`gcalData.ts`) z cyklem życia (sesja, okno dat, odświeżanie). Cała logika,
// którą da się wyrazić bez Reacta, mieszka w `gcalData.ts`.
//
// GRANICE / DECYZJE:
//   * Wyłącznie tryb Supabase z zalogowanym użytkownikiem; w trybie lokalnym
//     provider przepuszcza dzieci i nie tworzy klienta.
//   * Wydarzenia Google NIE wchodzą do reduktora ani do localStorage — żyją tu,
//     w oknie −30/+90 dni wokół dziś (spójnie z oknem syncu serwera), i są
//     odświeżane co 5 minut oraz po powrocie karty do widoczności. Broadcastu
//     nie ma: cron serwera i tak jedzie co 5 minut.
//   * Widoki kalendarza czytają `occurrencesFor(date, filtrOsób)` — czysta mapa
//     dzień → wystąpienia, policzona raz na zmianę listy, zawężona do własnych
//     i do osób z filtra (`visibleOccurrences`).
//   * Konto/kalendarze/ustawienia wczytujemy LENIWIE (`loadSettings`), dopiero
//     gdy kafelek na koncie tego zażąda — kalendarz nie potrzebuje tych danych.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/SessionProvider';
import { useSelector } from '../store/AppStore';
import { useOrgData } from '../supabase/OrgDataProvider';
import { getSupabaseClient } from '../supabase/client';
import { addDaysStr, todayStr } from '../utils/dates';
import {
  buildProfileToPersonMap,
  connectWithCode,
  createSupabaseGcalDb,
  disconnectAccount as disconnectAccountRow,
  loadAccount,
  loadCalendars,
  loadVisibleEvents,
  occurrencesByDate,
  resolveEventPeople,
  setCalendarSelected as setCalendarSelectedRow,
  setShareLevel as setShareLevelRow,
  syncNow as syncNowRow,
  visibleOccurrences,
  type GcalDb,
} from './gcalData';
import { requestGoogleCalendarCode } from './googleConnect';
import {
  GCAL_CLIENT_WINDOW_FUTURE_DAYS,
  GCAL_CLIENT_WINDOW_PAST_DAYS,
  GCAL_REFRESH_INTERVAL_MS,
  type GoogleAccount,
  type GoogleCalendar,
  type GoogleEvent,
  type GoogleEventOccurrence,
  type GoogleShareLevel,
} from './types';

const NO_OCCURRENCES: GoogleEventOccurrence[] = [];
const NO_PROFILES: { id: string; email: string }[] = [];

export interface GoogleCalendarContextValue {
  /** `true` wyłącznie w trybie Supabase z zalogowanym użytkownikiem. */
  enabled: boolean;
  selfId: string | null;
  /**
   * Wystąpienia Google na dany dzień (już zamaskowane przez widok bazy),
   * zawężone filtrem osób: własne zawsze, cudze tylko gdy filtr obejmuje
   * właściciela kalendarza (patrz `visibleOccurrences`).
   */
  occurrencesFor: (date: string, personFilter: ReadonlySet<string>) => readonly GoogleEventOccurrence[];
  /** Wydarzenie po id (dialog szczegółów). */
  eventById: (id: string) => GoogleEvent | null;
  eventsLoading: boolean;
  /** Ostatni polski komunikat błędu warstwy wydarzeń albo null. */
  eventsError: string | null;
  refreshEvents: () => void;

  // ---- Ustawienia konta (kafelek na stronie konta) ----
  account: GoogleAccount | null;
  calendars: GoogleCalendar[];
  settingsLoading: boolean;
  settingsError: string | null;
  /** Wczytuje konto i kalendarze (idempotentne; kafelek woła przy montowaniu). */
  loadSettings: () => void;
  /** Popup Google → Edge Function connect → odświeżenie ustawień i wydarzeń. */
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  syncNow: () => Promise<boolean>;
  setCalendarSelected: (calendarId: string, selected: boolean) => Promise<boolean>;
  setShareLevel: (shareLevel: GoogleShareLevel) => Promise<boolean>;
  busy: boolean;
}

const GoogleCalendarContext = createContext<GoogleCalendarContextValue | null>(null);

export function useGoogleCalendar(): GoogleCalendarContextValue {
  const ctx = useContext(GoogleCalendarContext);
  if (!ctx) throw new Error('useGoogleCalendar must be used within GoogleCalendarProvider');
  return ctx;
}

export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const signedIn = auth.mode === 'supabase' && auth.state.status === 'signedIn';
  const selfId = signedIn ? auth.state.session?.user?.id ?? null : null;
  const active = signedIn && selfId !== null;

  const [events, setEvents] = useState<GoogleEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dbRef = useRef<GcalDb | null>(null);
  const mountedRef = useRef(true);
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshEvents = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;
    const today = todayStr();
    const result = await loadVisibleEvents(
      db,
      addDaysStr(today, -GCAL_CLIENT_WINDOW_PAST_DAYS),
      addDaysStr(today, GCAL_CLIENT_WINDOW_FUTURE_DAYS),
    );
    if (!mountedRef.current || dbRef.current !== db) return;
    setEventsLoading(false);
    if (!result.ok) {
      setEventsError(result.error);
      return;
    }
    setEventsError(null);
    setEvents(result.value);
  }, []);

  const loadSettings = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;
    setSettingsLoading(true);
    const accountResult = await loadAccount(db);
    if (!mountedRef.current || dbRef.current !== db) return;
    if (!accountResult.ok) {
      setSettingsLoading(false);
      setSettingsError(accountResult.error);
      return;
    }
    setAccount(accountResult.value);
    const calendarsResult = accountResult.value
      ? await loadCalendars(db, accountResult.value.id)
      : { ok: true as const, value: [] as GoogleCalendar[] };
    if (!mountedRef.current || dbRef.current !== db) return;
    setSettingsLoading(false);
    if (!calendarsResult.ok) {
      setSettingsError(calendarsResult.error);
      return;
    }
    setSettingsError(null);
    setCalendars(calendarsResult.value);
    settingsLoadedRef.current = true;
  }, []);

  // Cykl życia: klient, pierwsze wczytanie, odświeżanie co 5 min i po powrocie karty.
  useEffect(() => {
    if (!active) {
      dbRef.current = null;
      setEvents([]);
      setEventsLoading(false);
      setEventsError(null);
      setAccount(null);
      setCalendars([]);
      setSettingsLoading(false);
      setSettingsError(null);
      settingsLoadedRef.current = false;
      return;
    }
    dbRef.current = createSupabaseGcalDb(getSupabaseClient());
    setEventsLoading(true);
    void refreshEvents();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void refreshEvents();
    }, GCAL_REFRESH_INTERVAL_MS);
    const onVisible = (): void => {
      if (!document.hidden) void refreshEvents();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      dbRef.current = null;
    };
  }, [active, selfId, refreshEvents]);

  // Id profili chmury → id osób planera (osoba dopasowana po e-mailu przy
  // hydracji zachowuje LOKALNE id, którym mówią filtr osób i `getPerson`).
  // `people` przez selektor (nie `useStore`), żeby nie renderować dostawcy
  // na każdą akcję store'u.
  const people = useSelector((s) => s.people);
  const org = useOrgData();
  const profiles = org.state.status === 'ready' ? org.state.snapshot.profiles : NO_PROFILES;
  const profileToPerson = useMemo(() => buildProfileToPersonMap(profiles, people), [profiles, people]);
  const resolvedEvents = useMemo(() => resolveEventPeople(events, profileToPerson), [events, profileToPerson]);

  const byDate = useMemo(() => occurrencesByDate(resolvedEvents), [resolvedEvents]);
  const byId = useMemo(() => new Map(resolvedEvents.map((event) => [event.id, event])), [resolvedEvents]);

  const occurrencesFor = useCallback(
    (date: string, personFilter: ReadonlySet<string>): readonly GoogleEventOccurrence[] =>
      visibleOccurrences(byDate.get(date) ?? NO_OCCURRENCES, personFilter),
    [byDate],
  );
  const eventById = useCallback((id: string): GoogleEvent | null => byId.get(id) ?? null, [byId]);

  /** Wspólna owijka akcji: jedna naraz, polski błąd do `settingsError`. */
  const runAction = useCallback(
    async (action: (db: GcalDb) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
      const db = dbRef.current;
      if (!db) return false;
      setBusy(true);
      setSettingsError(null);
      const result = await action(db);
      if (!mountedRef.current) return result.ok;
      setBusy(false);
      if (!result.ok) setSettingsError(result.error);
      return result.ok;
    },
    [],
  );

  const connect = useCallback(
    () =>
      runAction(async (db) => {
        let code: string;
        try {
          code = await requestGoogleCalendarCode();
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Podpinanie konta Google przerwane.' };
        }
        const result = await connectWithCode(db, code);
        if (!result.ok) return result;
        await loadSettings();
        await refreshEvents();
        return { ok: true };
      }),
    [runAction, loadSettings, refreshEvents],
  );

  const disconnect = useCallback(
    () =>
      runAction(async (db) => {
        const current = account;
        if (!current) return { ok: true };
        const result = await disconnectAccountRow(db, current.id);
        if (!result.ok) return result;
        setAccount(null);
        setCalendars([]);
        await refreshEvents();
        return { ok: true };
      }),
    [runAction, account, refreshEvents],
  );

  const syncNow = useCallback(
    () =>
      runAction(async (db) => {
        const result = await syncNowRow(db);
        if (!result.ok) return result;
        await loadSettings();
        await refreshEvents();
        return { ok: true };
      }),
    [runAction, loadSettings, refreshEvents],
  );

  const setCalendarSelected = useCallback(
    (calendarId: string, selected: boolean) =>
      runAction(async (db) => {
        const result = await setCalendarSelectedRow(db, calendarId, selected);
        if (!result.ok) return result;
        setCalendars((list) =>
          list.map((calendar) => (calendar.id === calendarId ? { ...calendar, selected } : calendar)),
        );
        // Widok bazy filtruje po `selected`, więc odznaczony kalendarz znika od razu.
        await refreshEvents();
        return { ok: true };
      }),
    [runAction, refreshEvents],
  );

  const setShareLevel = useCallback(
    (shareLevel: GoogleShareLevel) =>
      runAction(async (db) => {
        const current = account;
        if (!current) return { ok: false, error: 'Najpierw podepnij konto Google.' };
        const result = await setShareLevelRow(db, current.id, shareLevel);
        if (!result.ok) return result;
        setAccount({ ...current, shareLevel });
        return { ok: true };
      }),
    [runAction, account],
  );

  const refresh = useCallback((): void => {
    void refreshEvents();
  }, [refreshEvents]);
  const load = useCallback((): void => {
    if (!settingsLoadedRef.current) void loadSettings();
  }, [loadSettings]);

  const value = useMemo<GoogleCalendarContextValue>(
    () => ({
      enabled: active,
      selfId,
      occurrencesFor,
      eventById,
      eventsLoading,
      eventsError,
      refreshEvents: refresh,
      account,
      calendars,
      settingsLoading,
      settingsError,
      loadSettings: load,
      connect,
      disconnect,
      syncNow,
      setCalendarSelected,
      setShareLevel,
      busy,
    }),
    [
      active,
      selfId,
      occurrencesFor,
      eventById,
      eventsLoading,
      eventsError,
      refresh,
      account,
      calendars,
      settingsLoading,
      settingsError,
      load,
      connect,
      disconnect,
      syncNow,
      setCalendarSelected,
      setShareLevel,
      busy,
    ],
  );

  return <GoogleCalendarContext.Provider value={value}>{children}</GoogleCalendarContext.Provider>;
}
