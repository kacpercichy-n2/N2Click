// Most Reactowy dla lustra danych planera w chmurze (cała logika i mapowanie
// żyją w cloudMirror.ts / plannerData.ts — czyste, testowalne w node).
//
// GRANICA PRZEJŚCIOWA: w trybie supabase siedem grup encji planera (klienci,
// projekty, zadania, przypisania, komentarze, aktywność) jest lustrzane do
// Supabase (zapisy liczone z diff-a stanu PO reduktorze) i hydratowane przy
// logowaniu jedną akcją MERGE_CLOUD_ENTITIES. localStorage pozostaje źródłem
// renderowania i kopią do odzysku — żaden błąd chmury nie gubi pracy. Tryb
// lokalny: zero różnicy (żaden klient Supabase nie powstaje, brak dispatchy).
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
import { usePersistence, useStore } from '../store/AppStore';
import { setCloudMirrorHealthy } from '../store/persistGate';
import { writeCloudRetirementMarker } from '../store/storage';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from './OrgDataProvider';
import { getSupabaseClient } from './client';
import {
  createSupabasePlannerDb,
  loadPlannerSnapshot,
  readRetirementSetting,
  type PlannerDb,
} from './plannerData';
import {
  applyCloudOps,
  buildCloudIdMaps,
  diffToCloudOps,
  type CloudIdMaps,
  type CloudOp,
} from './cloudMirror';
import { buildCloudPeoplePayload, type OrgSnapshot } from './referenceData';

export type CloudSyncStatus = 'idle' | 'hydrating' | 'ready' | 'error';

export interface CloudSyncValue {
  status: CloudSyncStatus;
  pendingCount: number;
  error: string | null;
  /** Czy kanał Realtime jest zasubskrybowany — zmiany w bazie same odświeżają GUI. */
  live: boolean;
  dropped: Array<{ label: string; message: string }>;
  /** Ponawia: hydrację (gdy błąd hydracji) albo kolejkę zapisów (błąd przejściowy). */
  retry: () => void;
  /** Odśwież dane z serwera — dostępne tylko przy pustej kolejce i bez błędu. */
  refresh: () => void;
  dismissDropped: () => void;
  /** Czy per-akcyjne zapisy lokalne są wycofane (zbuforowana decyzja organizacji). */
  retired: boolean;
  /**
   * Ustawia zbuforowany znacznik wycofania (per-przeglądarka) i odświeża stan.
   * Wołane przez panel migracji po udanym handshake (true) lub przywróceniu (false).
   */
  applyRetirement: (enabled: boolean) => void;
}

const CloudSyncContext = createContext<CloudSyncValue | null>(null);

export function useCloudSync(): CloudSyncValue {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) throw new Error('useCloudSync must be used within CloudSyncProvider');
  return ctx;
}

// Transitions the mirror must NEVER propagate to the cloud: our own hydration,
// another tab's already-mirrored write, and the local-only sample/reset ops.
const SUPPRESSED = new Set([
  'MERGE_CLOUD_ENTITIES',
  'MERGE_CLOUD_PEOPLE',
  'MERGE_CLOUD_DICTIONARIES',
  'REPLACE_FROM_STORAGE',
  'LOAD_SAMPLE',
  'RESET_ALL',
]);

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, lastActionRef } = useStore();
  const { retryPersist } = usePersistence();
  const auth = useAuth();
  const org = useOrgData();

  const [status, setStatus] = useState<CloudSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ label: string; message: string }>>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [retired, setRetired] = useState(false);

  // Live refs for the mount-once listeners / queue callbacks.
  const retiredRef = useRef(retired);
  retiredRef.current = retired;
  const pendingRef = useRef(0);
  const retryPersistRef = useRef(retryPersist);
  retryPersistRef.current = retryPersist;

  const stateRef = useRef(state);
  stateRef.current = state;
  const prevRef = useRef(state); // ostatni zlustrzany stan
  const queueRef = useRef<CloudOp[]>([]);
  const processingRef = useRef(false);
  const hydratedUserRef = useRef<string | null>(null);
  const dbRef = useRef<PlannerDb | null>(null);
  const mapsRef = useRef<CloudIdMaps | null>(null);
  const statusRef = useRef<CloudSyncStatus>('idle');
  statusRef.current = status;
  const mountedRef = useRef(true);
  // StrictMode symuluje odmontowanie i ponowny montaż: ciało efektu MUSI
  // przywrócić `true`, inaczej po remoncie każda hydracja przerywa się na
  // strażniku `!mountedRef.current` i synchronizacja nigdy nie startuje w dev.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Żywa synchronizacja (Realtime): stan subskrypcji + debounce pełnej
  // hydracji. Zdarzenie postgres_changes to wyłącznie sygnał „coś się
  // zmieniło” — prawdą pozostaje autorytatywny snapshot (org + planer).
  const [live, setLive] = useState(false);
  const refreshingFromReadyRef = useRef(false);
  const pendingLiveSyncRef = useRef(false);
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSyncRef = useRef<() => void>(() => {});
  const orgRefreshRef = useRef(org.refreshSilently);
  orgRefreshRef.current = org.refreshSilently;

  const userId =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.user?.id ?? null
      : null;
  const snapshot = org.state.status === 'ready' ? org.state.snapshot : null;
  const active = auth.mode === 'supabase' && userId !== null && snapshot !== null;

  const getDb = useCallback((): PlannerDb => {
    if (!dbRef.current) dbRef.current = createSupabasePlannerDb(getSupabaseClient());
    return dbRef.current;
  }, []);

  const setPending = useCallback((n: number) => {
    pendingRef.current = n;
    setPendingCount(n);
  }, []);

  // Wykonuje kolejkę operacji sekwencyjnie (serializacja jedną pętlą). Na błędzie
  // przejściowym zatrzymuje się i zostawia resztę w kolejce (retry wznawia).
  // W trybie wycofanym: świeży zapis lokalny (kopia do odzysku) przy DRENAŻU
  // kolejki do zera (stan potwierdzony w chmurze) oraz NATYCHMIAST przy błędzie
  // przejściowym (praca zagrożona trafia na dysk, zanim można ją zgubić).
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const ops = queueRef.current;
        queueRef.current = [];
        const result = await applyCloudOps(getDb(), ops);
        if (!mountedRef.current) return;
        if (result.dropped.length > 0) {
          setDropped((prev) => [...prev, ...result.dropped]);
        }
        if (result.error) {
          queueRef.current = [...result.remaining, ...queueRef.current];
          setPending(queueRef.current.length);
          setError(result.error);
          // Błąd przejściowy: flaga zdrowia opadnie (efekt), zapisy per-akcyjne
          // wznawiają się; zagrożoną pracę zapisujemy TERAZ lokalnie.
          if (retiredRef.current) retryPersistRef.current();
          return; // zatrzymaj — retry() wznowi
        }
        setError(null);
        setPending(queueRef.current.length);
      }
      // Kolejka opróżniona bez błędu: kopia do odzysku = stan potwierdzony chmurą.
      if (retiredRef.current) retryPersistRef.current();
      // Zdarzenie Realtime odłożone na czas drenażu kolejki => dosynchronizuj.
      if (pendingLiveSyncRef.current) {
        pendingLiveSyncRef.current = false;
        liveSyncRef.current();
      }
    } finally {
      processingRef.current = false;
    }
  }, [getDb, setPending]);

  const runHydration = useCallback(
    async (overrideSnap?: OrgSnapshot) => {
      const snap =
        overrideSnap ?? (org.state.status === 'ready' ? org.state.snapshot : null);
      if (auth.mode !== 'supabase' || !userId || !snap) return;
      // Odświeżenie ze stanu 'ready' (ręczne lub Realtime): lustro ma już mapy,
      // więc edycje wykonane w oknie hydracji dalej trafiają do kolejki zamiast
      // być pochłaniane i nadpisywane autorytatywnym scaleniem.
      refreshingFromReadyRef.current = statusRef.current === 'ready';
      setStatus('hydrating');
      setError(null);
      const maps = buildCloudIdMaps(stateRef.current, snap);
      mapsRef.current = maps;
      try {
        const result = await loadPlannerSnapshot(getDb(), maps, stateRef.current);
        if (!mountedRef.current) return;
        if (!result.ok) {
          setStatus('error');
          setError(result.error);
          return;
        }
        if (import.meta.env.DEV && result.diagnostics.length > 0) {
          console.warn('[cloud] Hydracja pominęła wiersze:', result.diagnostics);
        }
        // Autorytatywna hydracja: profile chmury jadą w TYM SAMYM ładunku, żeby
        // reduktor scalił zespół PRZED walidacją encji (osoby bez lokalnej pary
        // e-mailowej dostają wiersz o id profilu chmury w jednej atomowej akcji).
        dispatch({
          type: 'MERGE_CLOUD_ENTITIES',
          payload: { ...result.payload, people: buildCloudPeoplePayload(snap.profiles) },
        });
        setStatus('ready');
        // Edycje zakolejkowane w oknie hydracji: wypchnij od razu — pętla
        // Realtime (nasz własny zapis => zdarzenie => hydracja) je uzgodni.
        if (queueRef.current.length > 0) {
          void processQueue();
        } else if (pendingLiveSyncRef.current) {
          // Zdarzenie Realtime nadeszło w trakcie tej hydracji => po commitcie
          // (statusRef juz 'ready') dosynchronizuj z debounce.
          pendingLiveSyncRef.current = false;
          liveSyncRef.current();
        }
      } finally {
        refreshingFromReadyRef.current = false;
      }
    },
    [auth.mode, userId, org.state, dispatch, getDb, processQueue],
  );

  // Pełna żywa synchronizacja: cichy refetch snapshotu organizacji (zespół,
  // słowniki, avatary) + autorytatywna hydracja planera. Odraczana, gdy trwa
  // drenaż kolejki / hydracja — dokańczana z ogonów processQueue/runHydration.
  const performLiveSync = useCallback(async () => {
    if (!mountedRef.current || !active) return;
    if (
      processingRef.current ||
      queueRef.current.length > 0 ||
      statusRef.current !== 'ready'
    ) {
      pendingLiveSyncRef.current = true;
      return;
    }
    const snap = await orgRefreshRef.current();
    if (!mountedRef.current) return;
    await runHydration(snap ?? undefined);
  }, [active, runHydration]);

  const scheduleLiveSync = useCallback(() => {
    if (liveSyncTimerRef.current !== null) clearTimeout(liveSyncTimerRef.current);
    liveSyncTimerRef.current = setTimeout(() => {
      liveSyncTimerRef.current = null;
      void performLiveSync();
    }, 1200);
  }, [performLiveSync]);
  liveSyncRef.current = scheduleLiveSync;

  // Subskrypcja Realtime: jedno źródło zdarzeń postgres_changes dla wszystkich
  // opublikowanych tabel (publikacja supabase_realtime; RLS obowiązuje).
  // Zdarzenie => zaplanuj pełną synchronizację (debounce zlewa serie zmian).
  useEffect(() => {
    if (!active || !userId) {
      setLive(false);
      return;
    }
    const client = getSupabaseClient();
    const channel = client
      .channel(`planner-live-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        liveSyncRef.current();
      })
      .subscribe((subscribeStatus: string) => {
        if (!mountedRef.current) return;
        setLive(subscribeStatus === 'SUBSCRIBED');
      });
    return () => {
      setLive(false);
      if (liveSyncTimerRef.current !== null) {
        clearTimeout(liveSyncTimerRef.current);
        liveSyncTimerRef.current = null;
      }
      void client.removeChannel(channel);
    };
  }, [active, userId]);

  // Zbieżność zbuforowanego znacznika wycofania z decyzją organizacji
  // (app_settings). Błąd odczytu => zachowaj poprzednią zbuforowaną wartość.
  const syncRetirementMarker = useCallback(async () => {
    const res = await readRetirementSetting(getDb());
    if (!mountedRef.current || !res.ok) return;
    writeCloudRetirementMarker({ enabled: res.enabled });
    setRetired(res.enabled);
  }, [getDb]);

  // Hydracja: raz na zalogowany identyfikator, gdy snapshot organizacji jest
  // gotowy. Reset przy wylogowaniu / trybie lokalnym (żaden klient nie powstaje).
  useEffect(() => {
    if (!active) {
      hydratedUserRef.current = null;
      prevRef.current = stateRef.current;
      // Kolejkę kasujemy TYLKO przy braku sesji (wylogowanie / zmiana konta).
      // Chwilowy brak snapshotu przy tym samym użytkowniku (reload organizacji)
      // nie może wyrzucić niezlustrzanych zapisów — zostają i wypchną się po
      // ponownej aktywacji.
      if (userId === null && queueRef.current.length > 0) {
        queueRef.current = [];
      }
      if (statusRef.current !== 'idle') {
        setStatus('idle');
        setError(null);
        setDropped([]);
        setPending(userId === null ? 0 : queueRef.current.length);
      }
      return;
    }
    if (hydratedUserRef.current === userId) return;
    hydratedUserRef.current = userId;
    void runHydration();
  }, [active, userId, runHydration, setPending]);

  // Flaga zdrowia lustra dla bramki zapisu lokalnego: prawdziwa TYLKO gdy aktywne,
  // status 'ready' i brak błędu (przejściowego/hydracji). Każda degradacja => false
  // => per-akcyjne zapisy lokalne wznawiają się automatycznie.
  useEffect(() => {
    setCloudMirrorHealthy(active && status === 'ready' && error === null);
  }, [active, status, error]);
  useEffect(() => () => setCloudMirrorHealthy(false), []);

  // Po udanej hydracji (status -> 'ready'): świeży zapis lokalny (kopia = prawda
  // chmury) i synchronizacja znacznika wycofania. Efekt biegnie po commitcie, gdy
  // scalony stan jest już w stateRef.
  const prevStatusRef = useRef<CloudSyncStatus>('idle');
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== 'ready' && status === 'ready') {
      retryPersistRef.current();
      void syncRetirementMarker();
    }
  }, [status, syncRetirementMarker]);

  // Mount-once: strażnik przeładowania w locie — przy `pagehide` z niepustą
  // kolejką w trybie wycofanym zapisujemy stan lokalnie, zanim karta zniknie.
  useEffect(() => {
    const onPageHide = (): void => {
      if (retiredRef.current && pendingRef.current > 0) retryPersistRef.current();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Lustro: diff prevRef -> state, kolejkowanie i wykonanie. Suppresja własnej
  // hydracji i operacji lokalnych (sample/reset/replace).
  useEffect(() => {
    const mirroring =
      statusRef.current === 'ready' ||
      // Okno odświeżania ze stanu 'ready': mapy istnieją, edycje użytkownika
      // muszą trafić do kolejki, inaczej scalenie autorytatywne je nadpisze.
      (statusRef.current === 'hydrating' && refreshingFromReadyRef.current);
    if (!active || hydratedUserRef.current !== userId || !mirroring) {
      prevRef.current = state;
      return;
    }
    const last = lastActionRef.current;
    if (last !== null && SUPPRESSED.has(last)) {
      prevRef.current = state;
      return;
    }
    if (prevRef.current === state) return;
    const maps = mapsRef.current;
    if (!maps) {
      prevRef.current = state;
      return;
    }
    const { ops } = diffToCloudOps(prevRef.current, state, maps);
    prevRef.current = state;
    if (ops.length === 0) return;
    queueRef.current.push(...ops);
    setPending(queueRef.current.length);
    void processQueue();
  }, [state, active, userId, lastActionRef, processQueue, setPending]);

  const retry = useCallback(() => {
    if (statusRef.current === 'error') {
      void runHydration();
      return;
    }
    setError(null);
    void processQueue();
  }, [runHydration, processQueue]);

  const refresh = useCallback(() => {
    if (queueRef.current.length > 0 || error !== null) return;
    // Ręczne odświeżenie = pełna żywa synchronizacja: najpierw cichy refetch
    // organizacji (zespół/słowniki/avatary), potem hydracja planera na świeżym
    // snapshocie — bez zrzucania org do 'loading' (kolejka i aktywność zostają).
    void (async () => {
      const snap = await orgRefreshRef.current();
      if (!mountedRef.current) return;
      await runHydration(snap ?? undefined);
    })();
  }, [runHydration, error]);

  const dismissDropped = useCallback(() => setDropped([]), []);

  const applyRetirement = useCallback((enabled: boolean) => {
    writeCloudRetirementMarker({ enabled });
    setRetired(enabled);
  }, []);

  const value = useMemo<CloudSyncValue>(
    () => ({
      status,
      pendingCount,
      error,
      live,
      dropped,
      retry,
      refresh,
      dismissDropped,
      retired,
      applyRetirement,
    }),
    [status, pendingCount, error, live, dropped, retry, refresh, dismissDropped, retired, applyRetirement],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}
