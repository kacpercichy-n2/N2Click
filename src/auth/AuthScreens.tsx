// Ekrany trybu Supabase: ładowanie sesji, formularz e-mail+hasło oraz stan
// „brak profilu”. Reużywamy istniejących klas CSS (login-screen, login-card,
// field, field-error, btn primary) — bez nowego frameworka stylów.
import { useState, type FormEvent } from 'react';
import { useAuth } from './SessionProvider';

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2Hub</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Ekran odtwarzania sesji — nigdy nie migamy formularzem ani powłoką aplikacji. */
export function AuthLoading() {
  return (
    <AuthShell>
      <p className="login-lead" role="status">
        Wczytywanie sesji…
      </p>
    </AuthShell>
  );
}

/** Logowanie e-mailem i hasłem przez Supabase Auth. */
export function SupabaseLoginPage() {
  const { state, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = state.busy;
  const error = state.error;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    void signIn(email.trim(), password);
  };

  return (
    <AuthShell>
      <p className="login-lead">Zaloguj się do planera</p>
      <form className="login-password" onSubmit={onSubmit}>
        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            autoFocus
            autoComplete="email"
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            className={error ? 'invalid' : undefined}
            aria-invalid={error ? true : undefined}
          />
        </label>
        <label className="field">
          <span>Hasło</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            className={error ? 'invalid' : undefined}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Logowanie…' : 'Zaloguj się'}
        </button>
      </form>
    </AuthShell>
  );
}

/**
 * Uwierzytelniony użytkownik bez profilu w planerze. Planer pozostaje zamknięty;
 * jedyna akcja to wylogowanie.
 */
export function AuthBlocked({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <AuthShell>
      <p className="login-lead">
        Brak profilu w planerze dla {email || 'tego konta'}. Skontaktuj się z administratorem.
      </p>
      <button type="button" className="btn primary" onClick={onSignOut}>
        Wyloguj
      </button>
    </AuthShell>
  );
}
