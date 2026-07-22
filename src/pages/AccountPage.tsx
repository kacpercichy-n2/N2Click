// Panel „Ustawienia”: preferencje interfejsu (kolejność menu bocznego — LOKALNIE
// per urządzenie) oraz dobrowolna zmiana hasła w trybie Supabase. Reużywa
// czystego modułu walidacji (src/auth/passwordChange.ts) i `changePassword` z
// kontekstu sesji. Trasa `/account` działa w OBU trybach; sekcja „Zmiana hasła”
// renderuje się wyłącznie dla realnego konta Supabase. Nigdy nie pokazujemy haseł.
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/SessionProvider';
import { validateNewPassword } from '../auth/passwordChange';
import { useStore } from '../store/AppStore';
import { useOrgData } from '../supabase/OrgDataProvider';
import { effectiveAccessRole } from '../supabase/referenceData';
import { currentUser as currentUserSel } from '../store/selectors';
import { can } from '../store/permissions';
import { canViewTeam } from './teamScope';
import { NAV_ITEMS, orderNavPaths } from '../components/navItems';
import { loadUiPrefs, updateUiPrefs } from '../utils/uiPrefs';

export function AccountPage() {
  const { changePassword, mode } = useAuth();

  return (
    <section className="page">
      <div className="page-head">
        <h1>Ustawienia</h1>
      </div>

      <InterfaceSection />

      {mode === 'supabase' && <PasswordSection changePassword={changePassword} />}
    </section>
  );
}

/**
 * Sekcja „Interfejs”: edytor kolejności menu bocznego. LOKALNE ONLY (per
 * urządzenie, `n2hub.ui.v1`). Lista pokazuje wyłącznie pozycje, które ten
 * użytkownik widzi (ten sam filtr canAdmin/canTeam co pasek boczny). Każda
 * zmiana zapisuje pełną widoczną kolejność i emituje `n2hub:nav-order-changed`,
 * więc pasek przestawia się natychmiast (bez przeładowania).
 */
function InterfaceSection() {
  const { state } = useStore();
  const auth = useAuth();
  const org = useOrgData();
  const currentUser = currentUserSel(state);
  const peopleCount = state.people.length;
  const canAdmin = can(currentUser, 'admin.panel', { peopleCount });
  const teamRole = effectiveAccessRole(currentUser, org.state, { mode: auth.mode });
  const teamUser = currentUser && teamRole ? { ...currentUser, accessRole: teamRole } : currentUser;
  const canTeam = canViewTeam(teamUser);

  const [navOrder, setNavOrder] = useState(() => loadUiPrefs().navOrder);

  const allPaths = NAV_ITEMS.map(([to]) => to);
  const isVisible = (to: string) =>
    (to !== '/admin' || canAdmin) && (to !== '/team' || canTeam);
  // Kolejność efektywna (zapisana → domyślna) zawężona do widocznych pozycji.
  const visibleOrder = orderNavPaths(allPaths, navOrder).filter(isVisible);
  const labelFor = new Map(NAV_ITEMS.map(([to, label]) => [to, label]));
  const iconFor = new Map(NAV_ITEMS.map(([to, , Icon]) => [to, Icon]));

  const persist = (order: string[]) => {
    updateUiPrefs({ navOrder: order });
    setNavOrder(order);
    window.dispatchEvent(new Event('n2hub:nav-order-changed'));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= visibleOrder.length) return;
    const next = [...visibleOrder];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  const resetOrder = () => {
    updateUiPrefs((prefs) => {
      const { navOrder: _drop, ...rest } = prefs;
      return rest;
    });
    setNavOrder(undefined);
    window.dispatchEvent(new Event('n2hub:nav-order-changed'));
  };

  return (
    <div className="editor-section">
      <h2>Interfejs</h2>
      <h3>Kolejność menu</h3>
      <p className="field-hint">
        Ustaw kolejność pozycji menu bocznego. Zmiana obowiązuje na tym urządzeniu.
      </p>
      <ul className="nav-order-list">
        {visibleOrder.map((to, index) => {
          const Icon = iconFor.get(to);
          return (
            <li key={to} className="nav-order-item">
              {Icon && <Icon size={18} aria-hidden className="nav-icon" />}
              <span className="nav-order-label">{labelFor.get(to)}</span>
              <button
                type="button"
                className="btn ghost nav-order-btn"
                aria-label="W górę"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost nav-order-btn"
                aria-label="W dół"
                disabled={index === visibleOrder.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn ghost" onClick={resetOrder}>
        Przywróć domyślną kolejność
      </button>
    </div>
  );
}

/** Sekcja „Zmiana hasła” (tryb supabase). */
function PasswordSection({
  changePassword,
}: {
  changePassword: ReturnType<typeof useAuth>['changePassword'];
}) {
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
  );
}
