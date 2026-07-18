// Most Reactowy dla lustra danych planera w chmurze (cała logika i mapowanie
// żyją w cloudMirror.ts / plannerData.ts — czyste, testowalne w node).
//
// GRANICA: w trybie supabase osiem grup encji planera (klienci, projekty,
// kamienie milowe, zadania, przypisania, godziny, komentarze, aktywność) jest
// lustrzanych do Supabase (zapisy liczone z diff-a stanu PO reduktorze) i
// hydratowanych przy logowaniu jedną akcją MERGE_CLOUD_ENTITIES. Edycje osób
// lustrzą dodatkowo wąską projekcję `profiles` (update-only, bez hydracji).
// Chmura jest autorytatywna; renderowanie idzie ze stanu AppStore w pamięci,
// a localStorage jest kopią odzyskową, którą tryb wycofany (retirement) może
// pomijać — żaden błąd chmury nie gubi pracy. Tryb lokalny: zero różnicy
// (żaden klient Supabase nie powstaje, brak dispatchy).
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
import {
  clearCloudQueue,
  readCloudQueueRaw,
  writeCloudQueueRaw,
  writeCloudRetirementMarker,
} from '../store/storage';
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
  diagnosticsToDropped,
  diffToCloudOps,
  type CloudIdMaps,
  type CloudOp,
} from './cloudMirror';
import { planHydrationOutcome } from './hydrationOutcome';
import { shouldMirrorTransition } from './mirrorGate';
import {
  MAX_HYDRATION_RESTARTS,
  QUEUE_FOREIGN_DROPPED,
  QUEUE_RESTORED_NOTICE,
  HYDRATION_RESTART_ERROR,
  decodeQueue,
  encodeQueue,
  planDeactivation,
  planHydrationStep,
  planQueueRestore,
} from './opQueue';

export type CloudSyncStatus = 'idle' | 'hydrating' | 'ready' | 'error';

export interface CloudSyncValue {
  status: CloudSyncStatus;
  pendingCount: number;
  error: string | null;
  dropped: Array<{ label: string; message: string }>;
  /** Ponawia: hydrację (gdy błąd hydracji) albo kolejkę zapisów (błąd przejściowy). */
  retry: () => void;
  /** Odśwież dane z serwera — dostępne tylko przy pustej kolejce i bez błędu. */
  refresh: () => void;
  dismissDropped: () => void;
  /** Neutralne powiadomienie o trwałej kolejce (przywrócono / zachowano). Polski. */
  notice: string | null;
  /** Zamyka bieżące powiadomienie o kolejce. */
  dismissNotice: () => void;
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

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, lastActionRef } = useStore();
  const { retryPersist } = usePersistence();
  const auth = useAuth();
  const org = useOrgData();

  const [status, setStatus] = useState<CloudSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ label: string; message: string }>>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
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
  const drainErrorRef = useRef<string | null>(null);
  const hydratedUserRef = useRef<string | null>(null);
  const dbRef = useRef<PlannerDb | null>(null);
  const mapsRef = useRef<CloudIdMaps | null>(null);
  const statusRef = useRef<CloudSyncStatus>('idle');
  statusRef.current = status;
  const mountedRef = useRef(true);
  // StrictMode wywołuje efekty mount->unmount->mount; ciało MUSI przywrócić
  // `true`, inaczej po replayu hydracja utknęłaby na 'hydrating' na zawsze.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const userId =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.user?.id ?? null
      : null;
  const snapshot = org.state.status === 'ready' ? org.state.snapshot : null;
  const active = auth.mode === 'supabase' && userId !== null && snapshot !== null;

  // Żywy ref na userId — trwały zapis kolejki koduje kopertę pod tym kontem.
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;

  const getDb = useCallback((): PlannerDb => {
    if (!dbRef.current) dbRef.current = createSupabasePlannerDb(getSupabaseClient());
    return dbRef.current;
  }, []);

  const setPending = useCallback((n: number) => {
    pendingRef.current = n;
    setPendingCount(n);
  }, []);

  // Trwała kolejka: koduje bieżący queueRef pod aktywnym userId i zapisuje na
  // dedykowanym kluczu. Pusta kolejka => czyścimy klucz (drenaż do zera). Bez
  // aktywnego userId nie utrwalamy (nie ma pod co podpiąć operacji).
  // Wielozakładkowość (ustalone): last-writer-wins na kluczu jest akceptowalny —
  // operacje to idempotentne upserty/remove kluczowane tożsamością wiersza, więc
  // powtórna replikacja zbiega się; brak blokad międzyzakładkowych.
  const persistQueue = useCallback(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    if (queueRef.current.length === 0) {
      clearCloudQueue();
    } else {
      writeCloudQueueRaw(encodeQueue(uid, queueRef.current));
    }
  }, []);

  // Wykonuje kolejkę operacji sekwencyjnie (serializacja jedną pętlą). Na błędzie
  // przejściowym zatrzymuje się i zostawia resztę w kolejce (retry wznawia).
  // W trybie wycofanym: świeży zapis lokalny (kopia do odzysku) przy DRENAŻU
  // kolejki do zera (stan potwierdzony w chmurze) oraz NATYCHMIAST przy błędzie
  // przejściowym (praca zagrożona trafia na dysk, zanim można ją zgubić).
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    // Synchroniczny sygnał wyniku drenażu dla runHydration: odróżnia błąd
    // przejściowy (kolejka niepusta z powodu awarii) od edycji w locie
    // dokolejkowanej TUŻ po opróżnieniu (kolejka niepusta, ale bez błędu).
    drainErrorRef.current = null;
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
          drainErrorRef.current = result.error;
          queueRef.current = [...result.remaining, ...queueRef.current];
          setPending(queueRef.current.length);
          persistQueue(); // utrwal resztę: niewysłane operacje przeżyją przeładowanie
          setError(result.error);
          // Błąd przejściowy: flaga zdrowia opadnie (efekt), zapisy per-akcyjne
          // wznawiają się; zagrożoną pracę zapisujemy TERAZ lokalnie.
          if (retiredRef.current) retryPersistRef.current();
          return; // zatrzymaj — retry() wznowi
        }
        setError(null);
        setPending(queueRef.current.length);
        persistQueue(); // po każdej iteracji: utrwal resztę / wyczyść przy zerze
      }
      // Kolejka opróżniona bez błędu: kopia do odzysku = stan potwierdzony chmurą.
      if (retiredRef.current) retryPersistRef.current();
    } finally {
      processingRef.current = false;
    }
  }, [getDb, setPending, persistQueue]);

  const runHydration = useCallback(async () => {
    if (auth.mode !== 'supabase' || !userId || org.state.status !== 'ready') return;
    const snap = org.state.snapshot;
    setStatus('hydrating');
    setError(null);
    // Mapy budujemy od razu, aby edycje w locie (okno 'hydrating') mogły być
    // zdiffowane i skolejkowane przez efekt lustra, a nie cicho pochłonięte.
    mapsRef.current = buildCloudIdMaps(stateRef.current, snap);

    // FAZA 1 — przywrócenie trwałej kolejki PRZED odczytem snapshotu, aby
    // hydracja nigdy nie nadpisała niewysłanej lokalnej edycji.
    const restore = planQueueRestore(decodeQueue(readCloudQueueRaw()), userId);
    if (restore.kind === 'discard-foreign-user') {
      clearCloudQueue();
      setDropped((prev) => [...prev, { label: 'Kolejka', message: QUEUE_FOREIGN_DROPPED }]);
    } else if (restore.kind === 'restore') {
      queueRef.current.push(...restore.ops);
      setPending(queueRef.current.length);
      persistQueue();
      setNotice(QUEUE_RESTORED_NOTICE);
      await processQueue();
      if (!mountedRef.current) return;
      // Błąd przejściowy drenażu => zatrzymaj z jawnym błędem (komunikat już
      // ustawiony przez processQueue). retry() (status 'error') ponowi
      // drenaż-i-hydrację. Sam niepusty queueRef (edycja w locie) nie jest błędem.
      if (drainErrorRef.current !== null) {
        setStatus('error');
        return;
      }
    }

    // FAZA 2 — odczyt snapshotu z pętlą kroków hydracji: edycje w locie są
    // wypłukiwane (drain) lub wymuszają ponowny odczyt (restart) na świeżym
    // stanie; wyczerpanie budżetu restartów => jawny błąd.
    let restarts = 0;
    for (;;) {
      const before = stateRef.current;
      mapsRef.current = buildCloudIdMaps(before, snap);
      const result = await loadPlannerSnapshot(getDb(), mapsRef.current, before);
      if (!mountedRef.current) return;
      const step = planHydrationStep({
        pendingOps: queueRef.current.length,
        stateChanged: stateRef.current !== before,
        restarts,
        maxRestarts: MAX_HYDRATION_RESTARTS,
      });
      if (step === 'drain') {
        await processQueue();
        if (!mountedRef.current) return;
        if (drainErrorRef.current !== null) {
          setStatus('error');
          return;
        }
        continue;
      }
      if (step === 'restart') {
        restarts += 1;
        continue;
      }
      if (step === 'give-up') {
        setStatus('error');
        setError(HYDRATION_RESTART_ERROR);
        return;
      }
      // 'merge' — obie flagi czyste: scal jak dotąd. Wynik świadomy odrzucenia:
      // gdy reduktor odrzuci ładunek (fail-closed), pokazujemy jawny błąd.
      const outcome = planHydrationOutcome(before, result);
      if (outcome.status === 'error') {
        setStatus('error');
        setError(outcome.error);
        return;
      }
      dispatch({ type: 'MERGE_CLOUD_ENTITIES', payload: outcome.payload, origin: 'cloud' });
      setStatus('ready');
      return;
    }
  }, [auth.mode, userId, org.state, dispatch, getDb, processQueue, persistQueue, setPending]);

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
      // Dezaktywacja (wylogowanie / utrata snapshotu): czyścimy kolejkę w
      // pamięci, ale trwała kopia ZOSTAJE — niewysłane operacje przetrwają
      // przełącznik `active` i wrócą po ponownym zalogowaniu. Gdy coś czekało,
      // informujemy użytkownika neutralnym komunikatem.
      const plan = planDeactivation(pendingRef.current);
      hydratedUserRef.current = null;
      queueRef.current = []; // tylko pamięć — NIE clearCloudQueue()
      prevRef.current = stateRef.current;
      if (plan.notice) setNotice(plan.notice);
      if (statusRef.current !== 'idle') {
        setStatus('idle');
        setError(null);
        setDropped([]);
        setPending(0);
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
    // Lustrujemy w oknie 'ready' ORAZ 'hydrating': w 'hydrating' edycje są
    // kolejkowane i utrwalane, ale NIE przetwarzane (drenaż zostaje pod kontrolą
    // runHydration) — nigdy nie pochłaniamy edycji bez zdiffowania.
    const phase = statusRef.current;
    const canMirror =
      active &&
      hydratedUserRef.current === userId &&
      (phase === 'ready' || phase === 'hydrating');
    if (!canMirror) {
      prevRef.current = state;
      return;
    }
    if (!shouldMirrorTransition(lastActionRef.current)) {
      // Suppresja przejść oznaczonych origin:'cloud' (własna hydracja / replace
      // ze storage / sample / reset) — także w 'hydrating' zachowuje dzisiejsze
      // pochłanianie: przesuń prevRef bez kolejkowania.
      prevRef.current = state;
      return;
    }
    if (prevRef.current === state) return;
    const maps = mapsRef.current;
    if (!maps) {
      prevRef.current = state;
      return;
    }
    const { ops, diagnostics } = diffToCloudOps(prevRef.current, state, maps);
    prevRef.current = state;
    // Wiersze niemapowalne do chmury: pokaż w bannerze i ZAWSZE wymuś świeży
    // zapis lokalny (retryPersist woła saveData bezwarunkowo), nawet gdy
    // ops.length === 0 — inaczej w trybie wycofanym praca dotykająca tylko
    // takich wierszy nie trafiłaby ani do chmury, ani do localStorage.
    if (diagnostics.length > 0) {
      setDropped((prev) => [...prev, ...diagnosticsToDropped(diagnostics)]);
      retryPersistRef.current();
    }
    if (ops.length === 0) return;
    queueRef.current.push(...ops);
    setPending(queueRef.current.length);
    persistQueue(); // utrwal po każdej mutacji — przetrwa przeładowanie karty
    // Przetwarzaj tylko w 'ready'. W 'hydrating' drenaż jest bramkowany przez
    // pętlę runHydration (krok 'drain'), która wypłucze te operacje.
    if (phase === 'ready') void processQueue();
  }, [state, active, userId, lastActionRef, processQueue, persistQueue, setPending]);

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
    void runHydration();
  }, [runHydration, error]);

  const dismissDropped = useCallback(() => setDropped([]), []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const applyRetirement = useCallback((enabled: boolean) => {
    writeCloudRetirementMarker({ enabled });
    setRetired(enabled);
  }, []);

  const value = useMemo<CloudSyncValue>(
    () => ({
      status,
      pendingCount,
      error,
      dropped,
      retry,
      refresh,
      dismissDropped,
      notice,
      dismissNotice,
      retired,
      applyRetirement,
    }),
    [
      status,
      pendingCount,
      error,
      dropped,
      retry,
      refresh,
      dismissDropped,
      notice,
      dismissNotice,
      retired,
      applyRetirement,
    ],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}
