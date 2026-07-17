// Czysta maszyna stanów sesji uwierzytelniania Supabase.
//
// Moduł CELOWO nie importuje @supabase/supabase-js ani nie czyta
// `import.meta.env`. Działa na wstrzykniętym, minimalnym interfejsie klienta
// auth (podzbiór supabase.auth), dzięki czemu cała logika przejść i obsługi
// błędów jest w pełni testowalna w środowisku node (vitest), bez jsdom i bez
// prawdziwego SDK. Integracja z Reactem (SessionProvider) pozostaje cienka.

/**
 * Minimalny kształt użytkownika sesji — potrzebujemy adresu e-mail (skojarzenie
 * profilu) i opcjonalnie `id` (klucz profilu przy fladze zmiany hasła). SDK
 * strukturalnie dostarcza oba pola.
 */
export interface AuthUser {
  id?: string;
  email?: string | null;
}

/** Minimalny kształt sesji Supabase używany przez planer. */
export interface AuthSession {
  user: AuthUser;
}

/** Kształt błędu zgodny ze strukturą `AuthError` z SDK (pola opcjonalne). */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

/** Wynik wywołania metody auth (data + error) — jak w supabase-js. */
export interface AuthResult<T> {
  data: T;
  error: AuthErrorLike | null;
}

export interface AuthSubscription {
  unsubscribe: () => void;
}

/**
 * Podzbiór `supabase.auth`, od którego zależy maszyna stanów. Prawdziwy klient
 * SDK spełnia ten interfejs strukturalnie; w testach wstrzykujemy atrapę.
 */
export interface MinimalAuthClient {
  getSession(): Promise<AuthResult<{ session: AuthSession | null }>>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<AuthResult<{ session: AuthSession | null }>>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
  onAuthStateChange(
    callback: (event: string, session: AuthSession | null) => void,
  ): { data: { subscription: AuthSubscription } };
}

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface SessionState {
  status: SessionStatus;
  /** Aktywna sesja tylko przy `signedIn`; w pozostałych stanach `null`. */
  session: AuthSession | null;
  /** Polski komunikat błędu — istotny wyłącznie w stanie `signedOut`. */
  error?: string;
  /** Trwa logowanie (`signInWithPassword` w locie) — blokuje formularz. */
  busy: boolean;
}

/** Stan startowy: odtwarzamy sesję, więc pokazujemy ekran ładowania. */
export const INITIAL_SESSION_STATE: SessionState = {
  status: 'restoring',
  session: null,
  busy: false,
};

/** Polskie komunikaty — nigdy nie pokazujemy surowych tekstów z SDK. */
export const AUTH_MESSAGES = {
  invalidCredentials: 'Nieprawidłowy e-mail lub hasło',
  emailNotConfirmed: 'Potwierdź adres e-mail, aby się zalogować',
  connection: 'Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.',
  unexpected: 'Wystąpił nieoczekiwany błąd logowania. Spróbuj ponownie.',
} as const;

/** Mapuje błąd zwrócony przez SDK na czytelny polski komunikat. */
export function mapAuthError(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_MESSAGES.unexpected;
  const code = (error.code ?? '').toLowerCase();
  const msg = (error.message ?? '').toLowerCase();
  if (
    code === 'invalid_credentials' ||
    msg.includes('invalid login credentials') ||
    msg.includes('invalid_grant')
  ) {
    return AUTH_MESSAGES.invalidCredentials;
  }
  if (
    code === 'email_not_confirmed' ||
    msg.includes('email not confirmed') ||
    msg.includes('not confirmed')
  ) {
    return AUTH_MESSAGES.emailNotConfirmed;
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || error.status === 0) {
    return AUTH_MESSAGES.connection;
  }
  return AUTH_MESSAGES.unexpected;
}

/** Mapuje wyjątek (odrzucony Promise, np. błąd sieci `fetch`) na komunikat. */
export function mapThrownError(_error: unknown): string {
  return AUTH_MESSAGES.connection;
}

/**
 * Sterownik sesji: trzyma bieżący stan, powiadamia subskrybentów i wykonuje
 * asynchroniczne przejścia (odtworzenie sesji, logowanie, wylogowanie). Cały
 * stan jest domknięty w tej funkcji fabrycznej — bez modułowego stanu globalnego.
 */
export interface AuthController {
  getState(): SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  /** Rejestruje nasłuch zmian sesji i odtwarza sesję z `getSession()`. */
  initialize(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  dispose(): void;
}

export function createAuthController(client: MinimalAuthClient): AuthController {
  let state: SessionState = INITIAL_SESSION_STATE;
  const listeners = new Set<(state: SessionState) => void>();
  let subscription: AuthSubscription | undefined;
  let disposed = false;

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function subscribe(listener: (state: SessionState) => void): () => void {
    listeners.add(listener);
    listener(state); // od razu przekaż aktualny stan
    return () => {
      listeners.delete(listener);
    };
  }

  async function initialize(): Promise<void> {
    // Nasłuch rejestrujemy PRZED getSession, aby nie zgubić żadnego zdarzenia.
    if (!subscription) {
      const { data } = client.onAuthStateChange((event, session) => {
        if (disposed) return;
        if (event === 'SIGNED_OUT' || !session) {
          setState({ status: 'signedOut', session: null, busy: false });
        } else {
          setState({ status: 'signedIn', session, busy: false });
        }
      });
      subscription = data.subscription;
    }
    try {
      const { data, error } = await client.getSession();
      if (disposed) return;
      // Fail-closed: brak sesji lub błąd = brak dostępu.
      if (error || !data.session) {
        setState({ status: 'signedOut', session: null, busy: false });
        return;
      }
      setState({ status: 'signedIn', session: data.session, busy: false });
    } catch {
      if (disposed) return;
      setState({ status: 'signedOut', session: null, busy: false });
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    if (disposed) return;
    setState({ ...state, busy: true, error: undefined });
    try {
      const { data, error } = await client.signInWithPassword({ email, password });
      if (disposed) return;
      if (error) {
        setState({ status: 'signedOut', session: null, busy: false, error: mapAuthError(error) });
        return;
      }
      if (data.session) {
        // onAuthStateChange zwykle też dostarczy SIGNED_IN, ale ustawiamy stan
        // bezpośrednio, aby był poprawny nawet bez zdarzenia.
        setState({ status: 'signedIn', session: data.session, busy: false });
      } else {
        setState({ ...state, busy: false });
      }
    } catch (thrown) {
      if (disposed) return;
      setState({ status: 'signedOut', session: null, busy: false, error: mapThrownError(thrown) });
    }
  }

  async function signOut(): Promise<void> {
    if (disposed) return;
    try {
      await client.signOut();
    } catch {
      // Ignorujemy — i tak przechodzimy w stan signedOut poniżej.
    }
    if (disposed) return;
    setState({ status: 'signedOut', session: null, busy: false });
  }

  function dispose(): void {
    disposed = true;
    subscription?.unsubscribe();
    subscription = undefined;
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe,
    initialize,
    signIn,
    signOut,
    dispose,
  };
}
