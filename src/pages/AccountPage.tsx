// Panel konta: dobrowolna zmiana hasła w trybie Supabase. Reużywa czystego
// modułu walidacji (src/auth/passwordChange.ts) i `changePassword` z kontekstu
// sesji. Dostępny wyłącznie dla realnego konta Supabase — w trybie lokalnym
// trasa przekierowuje na `/` (patrz App.tsx). Nigdy nie wyświetlamy haseł.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/SessionProvider';
import { validateNewPassword } from '../auth/passwordChange';
import { useStore } from '../store/AppStore';
import { useOrgData } from '../supabase/OrgDataProvider';
import type { CloudProfile } from '../supabase/referenceData';
import { PROVISION_ROLE_LABELS } from './teamScope';
import { NavOrderEditor } from '../components/NavOrderEditor';

export function AccountPage() {
  const { changePassword, mode } = useAuth();
  const { state } = useStore();
  const currentUserId = state.currentUserId;
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

      {currentUserId && (
        <div className="editor-section">
          <h2>Profil</h2>
          <p className="field-hint">
            <Link to={`/people/${currentUserId}`} className="profile-link">
              Mój profil
            </Link>
          </p>
        </div>
      )}

      {mode === 'supabase' && <CloudProfileSection />}

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

      <NavOrderEditor />
    </section>
  );
}

/**
 * Profil z chmury (tryb supabase): odczyt RLS-owy przez OrgDataProvider. RLS jest
 * autorytatywne — kontrole klienta są wyłącznie UX. Ładowanie/błąd/„brak profilu"
 * po polsku; nigdy nie pokazujemy surowego komunikatu SDK.
 */
function CloudProfileSection() {
  const { state, reload } = useOrgData();

  return (
    <div className="editor-section">
      <h2>Profil w chmurze</h2>
      {state.status === 'idle' || state.status === 'loading' ? (
        <p className="field-hint">Ładowanie profilu…</p>
      ) : state.status === 'error' ? (
        <>
          <p className="field-error">{state.message}</p>
          <button type="button" className="btn ghost" onClick={reload}>
            Spróbuj ponownie
          </button>
        </>
      ) : state.snapshot.profile === null ? (
        <p className="field-hint">Brak profilu w chmurze dla tego konta.</p>
      ) : (
        <CloudProfileDetails
          profile={state.snapshot.profile}
          departmentName={
            state.snapshot.departments.find((d) => d.id === state.snapshot.profile?.departmentId)
              ?.name ?? null
          }
        />
      )}
    </div>
  );
}

function CloudProfileDetails({
  profile,
  departmentName,
}: {
  profile: CloudProfile;
  departmentName: string | null;
}) {
  const fullName = `${profile.firstName} ${profile.lastName}`.trim() || '(bez nazwy)';
  return (
    <dl className="cloud-profile">
      <div>
        <dt>Imię i nazwisko</dt>
        <dd>{fullName}</dd>
      </div>
      <div>
        <dt>E-mail</dt>
        <dd>{profile.email || '—'}</dd>
      </div>
      <div>
        <dt>Rola</dt>
        <dd>{PROVISION_ROLE_LABELS[profile.cloudRole]}</dd>
      </div>
      <div>
        <dt>Dział</dt>
        <dd>{departmentName ?? 'Brak działu'}</dd>
      </div>
    </dl>
  );
}
