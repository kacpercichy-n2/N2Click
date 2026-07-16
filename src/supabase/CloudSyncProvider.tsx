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
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from './OrgDataProvider';
import { getSupabaseClient } from './client';
import { createSupabasePlannerDb, loadPlannerSnapshot, type PlannerDb } from './plannerData';
import {
  applyCloudOps,
  buildCloudIdMaps,
  diffToCloudOps,
  type CloudIdMaps,
  type CloudOp,
} from './cloudMirror';

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
  'REPLACE_FROM_STORAGE',
  'LOAD_SAMPLE',
  'RESET_ALL',
]);

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, lastActionRef } = useStore();
  const auth = useAuth();
  const org = useOrgData();

  const [status, setStatus] = useState<CloudSyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ label: string; message: string }>>([]);
  const [pendingCount, setPendingCount] = useState(0);

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
  useEffect(() => () => { mountedRef.current = false; }, []);

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

  // Wykonuje kolejkę operacji sekwencyjnie (serializacja jedną pętlą). Na błędzie
  // przejściowym zatrzymuje się i zostawia resztę w kolejce (retry wznawia).
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
          setPendingCount(queueRef.current.length);
          setError(result.error);
          return; // zatrzymaj — retry() wznowi
        }
        setError(null);
        setPendingCount(queueRef.current.length);
      }
    } finally {
      processingRef.current = false;
    }
  }, [getDb]);

  const runHydration = useCallback(async () => {
    if (auth.mode !== 'supabase' || !userId || org.state.status !== 'ready') return;
    const snap = org.state.snapshot;
    setStatus('hydrating');
    setError(null);
    const maps = buildCloudIdMaps(stateRef.current, snap);
    mapsRef.current = maps;
    const result = await loadPlannerSnapshot(getDb(), maps, stateRef.current);
    if (!mountedRef.current) return;
    if (!result.ok) {
      setStatus('error');
      setError(result.error);
      return;
    }
    dispatch({ type: 'MERGE_CLOUD_ENTITIES', payload: result.payload });
    setStatus('ready');
  }, [auth.mode, userId, org.state, dispatch, getDb]);

  // Hydracja: raz na zalogowany identyfikator, gdy snapshot organizacji jest
  // gotowy. Reset przy wylogowaniu / trybie lokalnym (żaden klient nie powstaje).
  useEffect(() => {
    if (!active) {
      hydratedUserRef.current = null;
      queueRef.current = [];
      prevRef.current = stateRef.current;
      if (statusRef.current !== 'idle') {
        setStatus('idle');
        setError(null);
        setDropped([]);
        setPendingCount(0);
      }
      return;
    }
    if (hydratedUserRef.current === userId) return;
    hydratedUserRef.current = userId;
    void runHydration();
  }, [active, userId, runHydration]);

  // Lustro: diff prevRef -> state, kolejkowanie i wykonanie. Suppresja własnej
  // hydracji i operacji lokalnych (sample/reset/replace).
  useEffect(() => {
    if (!active || hydratedUserRef.current !== userId || statusRef.current !== 'ready') {
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
    setPendingCount(queueRef.current.length);
    void processQueue();
  }, [state, active, userId, lastActionRef, processQueue]);

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

  const value = useMemo<CloudSyncValue>(
    () => ({ status, pendingCount, error, dropped, retry, refresh, dismissDropped }),
    [status, pendingCount, error, dropped, retry, refresh, dismissDropped],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}
