// Reorder the sidebar nav per user (per browser). Device-local only — stored in
// uiPrefs (`navOrderByUser`, keyed by the REAL logged-in id), never in the
// versioned planner data. Lists the user's VISIBLE nav items (same gates as the
// sidebar) in effective order with ↑/↓ buttons. Moves operate on the FULL stored
// order, swapping a visible item with its nearest VISIBLE neighbour so hidden
// gated items keep their positions. Every change persists and fires
// `n2hub:nav-order-changed`, which App listens for to re-order the live sidebar.
import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { can } from '../store/permissions';
import { NAV, type NavItem } from './navItems';
import { applyNavOrder } from '../utils/navOrder';
import { loadUiPrefs, navOrderForUser, updateNavOrderForUser } from '../utils/uiPrefs';

const DEFAULT_PATHS = NAV.map(([to]) => to);

export function NavOrderEditor() {
  const { state } = useStore();
  const { mode } = useAuth();
  const [version, setVersion] = useState(0);

  // Impersonacja usunięta (run 257) — currentUserId JEST realnym użytkownikiem.
  const userId = state.currentUserId;
  const currentUser = state.people.find((p) => p.id === state.currentUserId);
  const canAdmin = can(currentUser, 'admin.panel', { peopleCount: state.people.length });

  // Full effective order (all default paths, self-repairing), then the visible
  // subset under the SAME gates the sidebar applies.
  const effectiveOrder = useMemo(() => {
    const stored = userId ? navOrderForUser(loadUiPrefs(), userId) : [];
    return applyNavOrder(DEFAULT_PATHS, stored);
    // `version` re-reads prefs after each persisted move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, version]);

  const visibleItems: NavItem[] = effectiveOrder
    .flatMap((path) => {
      const item = NAV.find(([to]) => to === path);
      return item ? [item] : [];
    })
    .filter(
      ([to]) => (to !== '/admin' || canAdmin) && (to !== '/account' || mode === 'supabase'),
    );

  if (!userId || visibleItems.length === 0) return null;

  const visiblePaths = visibleItems.map(([to]) => to);

  const persist = (order: string[]) => {
    updateNavOrderForUser(userId, order);
    window.dispatchEvent(new CustomEvent('n2hub:nav-order-changed'));
    setVersion((v) => v + 1);
  };

  const move = (path: string, direction: 'up' | 'down') => {
    const vi = visiblePaths.indexOf(path);
    const targetVi = direction === 'up' ? vi - 1 : vi + 1;
    if (targetVi < 0 || targetVi >= visiblePaths.length) return;
    const otherPath = visiblePaths[targetVi];
    const next = [...effectiveOrder];
    const a = next.indexOf(path);
    const b = next.indexOf(otherPath);
    [next[a], next[b]] = [next[b], next[a]];
    persist(next);
  };

  const resetOrder = () => persist([]);

  return (
    <div className="editor-section">
      <h2>Kolejność menu</h2>
      <p className="field-hint">
        Ustaw własną kolejność pozycji w menu bocznym. Dotyczy tylko tej przeglądarki.
      </p>
      <ul className="nav-order-list">
        {visibleItems.map(([to, label, Icon], i) => (
          <li key={to} className="nav-order-row">
            <span className="nav-order-label">
              <Icon size={18} aria-hidden className="nav-icon" />
              <span>{label}</span>
            </span>
            <span className="nav-order-controls">
              <button
                type="button"
                className="nav-btn"
                disabled={i === 0}
                onClick={() => move(to, 'up')}
                aria-label={`Przesuń „${label}” wyżej`}
              >
                ↑
              </button>
              <button
                type="button"
                className="nav-btn"
                disabled={i === visibleItems.length - 1}
                onClick={() => move(to, 'down')}
                aria-label={`Przesuń „${label}” niżej`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn ghost" onClick={resetOrder}>
        Przywróć domyślną kolejność
      </button>
    </div>
  );
}
