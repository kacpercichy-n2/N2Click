// Panel konta: dobrowolna zmiana hasła w trybie Supabase. Reużywa czystego
// modułu walidacji (src/auth/passwordChange.ts) i `changePassword` z kontekstu
// sesji. Dostępny wyłącznie dla realnego konta Supabase — w trybie lokalnym
// trasa przekierowuje na `/` (patrz App.tsx). Nigdy nie wyświetlamy haseł.
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/SessionProvider';
import { validateNewPassword } from '../auth/passwordChange';

export function AccountPage() {
  const { changePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSuccess(false);
    const localError = validateNewPassword(password, confirm);
    if (localError) {
      setError(localError);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await changePassword(password, confirm);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPassword('');
    setConfirm('');
    setSuccess(true);
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Konto</h1>
      </div>

      <div className="editor-section">
        <h2>Zmiana hasła</h2>
        <p className="field-hint">
          Ustaw nowe hasło do swojego konta. Hasło musi mieć co najmniej 8 znaków.
        </p>
        <form className="login-password" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            <span>Nowe hasło</span>
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              disabled={busy}
              onChange={(e) => {
                setPassword(e.target.value);
                setSuccess(false);
              }}
              className={error ? 'invalid' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <label className="field">
            <span>Powtórz nowe hasło</span>
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              disabled={busy}
              onChange={(e) => {
                setConfirm(e.target.value);
                setSuccess(false);
              }}
              className={error ? 'invalid' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          {success && (
            <p className="field-hint" role="status">
              Hasło zostało zmienione.
            </p>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Zapisywanie…' : 'Zmień hasło'}
          </button>
        </form>
      </div>
    </section>
  );
}
