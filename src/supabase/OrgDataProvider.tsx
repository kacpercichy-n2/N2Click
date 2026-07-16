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
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/SessionProvider';
import { getSupabaseClient } from './client';
import { createSupabaseImportDb } from './dataImport';
import { loadOrgSnapshot, type OrgState } from './referenceData';

interface OrgDataContextValue {
  state: OrgState;
  /** Ponawia wczytanie snapshotu bieżącego użytkownika (przycisk „Spróbuj ponownie”). */
  reload: () => void;
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

  // Identyfikator zalogowanego użytkownika (auth.users id) — źródło ładowania.
  // W trybie lokalnym oraz gdy nikt nie jest zalogowany: null → stan `idle`.
  const userId =
    auth.mode === 'supabase' && auth.state.status === 'signedIn'
      ? auth.state.session?.user?.id ?? null
      : null;

  useEffect(() => {
    if (auth.mode !== 'supabase' || !userId) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    const db = createSupabaseImportDb(getSupabaseClient());
    void loadOrgSnapshot(db, userId).then((result) => {
      if (cancelled) return;
      if (result.ok) setState({ status: 'ready', snapshot: result.snapshot });
      else setState({ status: 'error', message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [auth.mode, userId, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return (
    <OrgDataContext.Provider value={{ state, reload }}>{children}</OrgDataContext.Provider>
  );
}
