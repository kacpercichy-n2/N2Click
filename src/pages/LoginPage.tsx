// Local login screen. Gates the whole app when people exist and nobody is
// logged in. Session = the persisted `currentUserId` (see App.tsx gate); real
// sessions/tokens arrive with the storage.ts→API swap. Passwordless people log
// in with one click (recovery path); people with a hash type a password that is
// checked via `verifyPassword` (cosmetic client-side gating only).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { ROLE_LABELS } from '../store/permissions';
import { verifyPassword } from '../utils/password';
import { Avatar } from '../components/Avatar';
import { markOnboardingLogin } from '../utils/uiPrefs';
import { HOME_PATH } from './homeRoute';

export function LoginPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const login = (personId: string) => {
    // Jeden wspólny home dla każdej roli — „Panel" (patrz homeRoute.ts).
    markOnboardingLogin(personId);
    dispatch({ type: 'SET_CURRENT_USER', personId });
    navigate(HOME_PATH);
  };

  // Row click: passwordless people log straight in; protected people open the
  // inline password form (and reset any stale error/input).
  const pick = (personId: string, hasPassword: boolean) => {
    if (!hasPassword) {
      login(personId);
      return;
    }
    setSelectedId(personId);
    setPassword('');
    setError('');
  };

  const submitPassword = async (personId: string, hash: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (await verifyPassword(password, hash)) {
        login(personId);
      } else {
        setError('Nieprawidłowe hasło');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2Hub</span>
        </div>
        <p className="login-lead">Wybierz osobę, aby się zalogować</p>

        <ul className="login-people">
          {state.people.map((person) => {
            const hasPassword = person.passwordHash !== '';
            const isSelected = selectedId === person.id;
            return (
              <li key={person.id} className="login-person-item">
                <button
                  type="button"
                  className={isSelected ? 'login-person selected' : 'login-person'}
                  onClick={() => pick(person.id, hasPassword)}
                  aria-expanded={hasPassword ? isSelected : undefined}
                >
                  <Avatar person={person} size={36} />
                  <span className="login-person-text">
                    <span className="login-person-name">{person.name}</span>
                    <span className="login-person-role">{ROLE_LABELS[person.accessRole]}</span>
                  </span>
                  <span className="login-person-lock" aria-hidden>
                    {hasPassword ? '🔒' : ''}
                  </span>
                </button>

                {hasPassword && isSelected && (
                  <form
                    className="login-password"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitPassword(person.id, person.passwordHash);
                    }}
                  >
                    <label className="field">
                      <span>Hasło</span>
                      <input
                        type="password"
                        value={password}
                        autoFocus
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (error) setError('');
                        }}
                        className={error ? 'invalid' : undefined}
                        aria-invalid={error ? true : undefined}
                      />
                    </label>
                    {error && <p className="field-error">{error}</p>}
                    <button type="submit" className="btn primary" disabled={busy}>
                      Zaloguj się
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
