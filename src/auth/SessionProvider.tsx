// Cienka integracja maszyny sesji (src/auth/session.ts) z Reactem.
//
// Tryb ustalany JEST raz przy starcie, leniwie (jak src/supabase/client.ts):
// brak/niepoprawna konfiguracja Supabase => tryb lokalny i aplikacja zachowuje
// się dokładnie jak dotąd (bez tworzenia klienta Supabase, bez efektów ubocznych
// importu). W trybie Supabase tworzymy sterownik sesji na bazie prawdziwego
// `supabase.auth` i kojarzymy zalogowanego użytkownika z lokalnym profilem
// WYŁĄCZNIE po tożsamości (patrz src/auth/profile.ts).
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
import { realUserId } from '../store/selectors';
import { getSupabaseClient } from '../supabase/client';
import { detectAuthMode, type AuthMode } from './mode';
import {
  createAuthController,
  INITIAL_SESSION_STATE,
  type AuthController,
  type MinimalAuthClient,
  type SessionState,
} from './session';
import { findPersonByEmail } from './profile';

interface AuthContextValue {
  mode: AuthMode;
  state: SessionState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// W trybie lokalnym stan sesji jest nieistotny — gate lokalny w App.tsx działa
// jak dotąd na `currentUserId`. Podajemy stabilny placeholder.
const LOCAL_STATE: SessionState = { status: 'signedIn', session: null, busy: false };

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within SessionProvider');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { state: storeState, dispatch } = useStore();

  // Tryb ustalany raz — `import.meta.env` czytamy tylko tutaj (nie w czystych
  // modułach), więc testy node pozostają niezależne od Vite.
  const modeRef = useRef<AuthMode>();
  if (modeRef.current === undefined) {
    modeRef.current = detectAuthMode(
      import.meta.env as unknown as Record<string, string | undefined>,
    );
  }
  const mode = modeRef.current;

  const controllerRef = useRef<AuthController | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>(
    mode === 'supabase' ? INITIAL_SESSION_STATE : LOCAL_STATE,
  );

  // Sterownik tworzymy WEWNĄTRZ efektu (świeży na każdy montaż), żeby StrictMode
  // (montaż→cleanup→montaż) nie używał ponownie już zniszczonego sterownika.
  useEffect(() => {
    if (mode !== 'supabase') return;
    const auth = getSupabaseClient().auth;
    // Jawny adapter na minimalny interfejs — czytelne błędy typów i granica.
    const client: MinimalAuthClient = {
      getSession: () => auth.getSession(),
      signInWithPassword: (credentials) => auth.signInWithPassword(credentials),
      signOut: () => auth.signOut(),
      onAuthStateChange: (callback) => auth.onAuthStateChange(callback),
    };
    const controller = createAuthController(client);
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSessionState);
    void controller.initialize();
    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [mode]);

  // Skojarzenie tożsamości: po zalogowaniu/odtworzeniu wskaż `currentUserId` na
  // dopasowaną osobę — ale TYLKO gdy realny użytkownik się różni, żeby nie
  // zdeptać aktywnej personifikacji tego samego realnego użytkownika.
  useEffect(() => {
    if (mode !== 'supabase' || sessionState.status !== 'signedIn') return;
    const person = findPersonByEmail(storeState.people, sessionState.session?.user?.email);
    if (person && realUserId(storeState) !== person.id) {
      dispatch({ type: 'SET_CURRENT_USER', personId: person.id });
    }
  }, [mode, sessionState.status, sessionState.session, storeState, dispatch]);

  const signIn = useCallback(async (email: string, password: string) => {
    await controllerRef.current?.signIn(email, password);
  }, []);

  const signOut = useCallback(async () => {
    await controllerRef.current?.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ mode, state: sessionState, signIn, signOut }),
    [mode, sessionState, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
