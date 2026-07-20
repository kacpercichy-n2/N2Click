// Cienki dostawca Reacta dla snapshotu organizacji z Supabase (patrz
// referenceData.ts — cała logika i mapowanie żyją tam, testowalne w node).
//
// Maszyna stanów: idle | loading | error(message, retry) | ready(snapshot).
// Ładuje raz na zalogowany identyfikator użytkownika, resetuje do `idle` przy
// wylogowaniu i w trybie lokalnym (żaden klient Supabase nie powstaje). Wystawia
// `useOrgData()` oraz `reload()` (retry). Chroni przed setState-po-odmontowaniu
// wzorcem `cancelled`.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/SessionProvider';
import { getSupabaseClient } from './client';
import { createSupabaseImportDb } from './dataImport';
import { loadOrgSnapshot, type OrgState } from './referenceData';
import {
  planReloadError,
  planReloadStart,
  planReloadSuccess,
  type OrgReloadMode,
} from './orgReload';

interface OrgDataContextValue {
  state: OrgState;
  /** Ponawia wczytanie snapshotu bieżącego użytkownika (przycisk „Spróbuj ponownie”). */
  reload: () => void;
  /**
   * Przeładowanie w TLE (zdarzenie realtime tabeli słownikowej): zachowuje
   * poprzedni gotowy snapshot do czasu wyniku — bez migotania 'loading', więc
   * `active` w CloudSyncProvider nie miga i cicha rehydracja może się odpalić.
   */
  backgroundReload: () => void;
}

const OrgDataContext = createContext<OrgDataContextValue | null>(null);

export function useOrgData(): OrgDataContextValue {
  const ctx = useContext(OrgDataContext);
  if (!ctx) throw new Error('useOrgData must be used within OrgDataProvider');
  return ctx;
}

export function OrgDataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<OrgState>({ status: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);
  // Tryb NAJBLIŻSZEGO przeładowania. Login/retry => 'foreground' (miga
  // 'loading'); zdarzenie słownikowe realtime => 'background' (zachowaj stary
  // snapshot). Odczytany synchronicznie przez efekt uruchomiony bumpem tokenu.
  const reloadModeRef = useRef<OrgReloadMode>('foreground');

  // Identyfikator zalogowanego użytkownika (auth.users id) — źródło ładowania.
  // W trybie lokalnym oraz gdy nikt nie jest zalogowany: null → stan `idle`.
  const userId =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.user?.id ?? null
      : null;

  useEffect(() => {
    if (auth.mode !== 'supabase' || !userId) {
      reloadModeRef.current = 'foreground';
      setState({ status: 'idle' });
      return;
    }
    const mode = reloadModeRef.current;
    reloadModeRef.current = 'foreground'; // domyślny tryb dla ładowań z userId
    let cancelled = false;
    setState((prev) => planReloadStart(prev, mode));
    const db = createSupabaseImportDb(getSupabaseClient());
    void loadOrgSnapshot(db, userId).then((result) => {
      if (cancelled) return;
      setState((prev) =>
        result.ok
          ? planReloadSuccess(result.snapshot)
          : planReloadError(prev, mode, result.error),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [auth.mode, userId, reloadToken]);

  const reload = useCallback(() => {
    reloadModeRef.current = 'foreground';
    setReloadToken((t) => t + 1);
  }, []);

  const backgroundReload = useCallback(() => {
    reloadModeRef.current = 'background';
    setReloadToken((t) => t + 1);
  }, []);

  return (
    <OrgDataContext.Provider value={{ state, reload, backgroundReload }}>
      {children}
    </OrgDataContext.Provider>
  );
}
