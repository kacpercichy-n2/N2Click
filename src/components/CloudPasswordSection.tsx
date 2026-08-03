// Dobrowolna zmiana hasła konta Supabase — sekcja profilu własnego (Konto).
// Reużywa czystego modułu walidacji (src/auth/passwordChange.ts) i
// `changePassword` z kontekstu sesji. Montowana wyłącznie w trybie Supabase dla
// własnego profilu; lokalne hasła obsługuje PasswordSection w
// PersonProfilePage. Nigdy nie wyświetlamy haseł. Potwierdzenie zmiany ogłasza
// trwały kanał powłoki (liveRegion).
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/SessionProvider';
import { announce } from '../utils/liveRegion';
import { validateNewPassword } from '../auth/passwordChange';

const PASSWORD_CHANGED_MSG = 'Hasło zostało zmienione.';

/**
 * `embedded` = renderuje sam formularz (bez karty `.editor-section` i nagłówka)
 * — do osadzenia wewnątrz kafelka konta; zagnieżdżanie kart jest zabronione.
 */
export function CloudPasswordSection({ embedded = false }: { embedded?: boolean }) {
  const { changePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  // Potwierdzenie montuje się razem ze swoim tekstem — ogłasza je trwały kanał
  // powłoki, a sam akapit jest już zwykłym hintem.
  useEffect(() => {
    if (!success) return;
    announce({ id: 'account', text: PASSWORD_CHANGED_MSG, tone: 'polite' });
  }, [success]);

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

  const body = (
    <>
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
        {success && <p className="field-hint">{PASSWORD_CHANGED_MSG}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Zapisywanie…' : 'Zmień hasło'}
        </button>
      </form>
    </>
  );

  if (embedded) return body;
  return (
    <div className="editor-section">
      <h2>Zmiana hasła</h2>
      {body}
    </div>
  );
}
