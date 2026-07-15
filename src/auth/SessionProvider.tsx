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
  type AuthErrorLike,
  type MinimalAuthClient,
  type SessionState,
} from './session';
import { findPersonByEmail } from './profile';
import {
  PASSWORD_MESSAGES,
  loadMustChangePassword,
  performPasswordChange,
  type ClearFlagFn,
  type FetchFlagFn,
  type UpdatePasswordFn,
} from './passwordChange';

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

interface AuthContextValue {
  mode: AuthMode;
  state: SessionState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Wymuszona zmiana pierwszego hasła: `null` = wczytywanie flagi (serwerowej),
   * `true` = konto musi ustawić nowe hasło zanim wejdzie do aplikacji, `false` =
   * bez wymuszenia. W trybie lokalnym zawsze `false`.
   */
  mustChangePassword: boolean | null;
  /** Zmiana hasła (wymuszona i dobrowolna). W trybie lokalnym zwraca `ok:false`. */
  changePassword: (password: string, confirm: string) => Promise<ChangePasswordResult>;
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

  // Flaga wymuszonej zmiany hasła. Lokalnie zawsze `false` (nieosiągalne z UI).
  // W trybie Supabase `null` do czasu wczytania z serwera dla danego użytkownika.
  const [mustChangePassword, setMustChangePassword] = useState<boolean | null>(
    mode === 'supabase' ? null : false,
  );
  // Id użytkownika, dla którego flagę już wczytano — żeby ładować raz na login,
  // a kolejny użytkownik nie widział wartości poprzedniego.
  const loadedUserIdRef = useRef<string | null>(null);

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

  // Po zalogowaniu wczytujemy serwerową flagę `must_change_password` raz na id
  // użytkownika (fail-open w loadMustChangePassword — błąd/brak wiersza ⇒ false,
  // nigdy nie blokujemy aplikacji błędem sieci). Reset flagi przy wylogowaniu /
  // zmianie użytkownika, żeby kolejny login nie zobaczył starej wartości.
  useEffect(() => {
    if (mode !== 'supabase') return;
    if (sessionState.status !== 'signedIn') {
      loadedUserIdRef.current = null;
      setMustChangePassword(null);
      return;
    }
    const userId = sessionState.session?.user?.id ?? null;
    if (!userId) {
      // Brak id (SDK zwykle je dostarcza) — fail-open, nie blokuj aplikacji.
      loadedUserIdRef.current = null;
      setMustChangePassword(false);
      return;
    }
    if (loadedUserIdRef.current === userId) return;
    loadedUserIdRef.current = userId;
    setMustChangePassword(null);
    const fetchFlag: FetchFlagFn = async (id) => {
      const { data, error } = await getSupabaseClient()
        .from('profiles')
        .select('must_change_password')
        .eq('id', id)
        .maybeSingle();
      return { value: (data?.must_change_password ?? null) as boolean | null, error };
    };
    let cancelled = false;
    void loadMustChangePassword(fetchFlag, userId).then((flag) => {
      if (!cancelled) setMustChangePassword(flag);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, sessionState.status, sessionState.session]);

  const signIn = useCallback(async (email: string, password: string) => {
    await controllerRef.current?.signIn(email, password);
  }, []);

  const signOut = useCallback(async () => {
    await controllerRef.current?.signOut();
  }, []);

  const changePassword = useCallback(
    async (password: string, confirm: string): Promise<ChangePasswordResult> => {
      if (mode !== 'supabase') return { ok: false, error: PASSWORD_MESSAGES.localMode };
      const userId = controllerRef.current?.getState().session?.user?.id ?? '';
      const client = getSupabaseClient();
      const updatePassword: UpdatePasswordFn = async (pw) => {
        const { error } = await client.auth.updateUser({ password: pw });
        return { error: (error as AuthErrorLike | null) ?? null };
      };
      const clearFlag: ClearFlagFn = async (id) => {
        const { error } = await client
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', id);
        return { error };
      };
      const result = await performPasswordChange({
        updatePassword,
        clearFlag,
        userId,
        password,
        confirm,
      });
      if (result.ok) {
        // Hasło zmienione — lokalnie odblokowujemy niezależnie od tego, czy
        // czyszczenie serwerowej flagi się powiodło (best-effort).
        setMustChangePassword(false);
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [mode],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ mode, state: sessionState, signIn, signOut, mustChangePassword, changePassword }),
    [mode, sessionState, signIn, signOut, mustChangePassword, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
