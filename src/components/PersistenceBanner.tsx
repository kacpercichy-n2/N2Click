// Global persistence banner — the house pattern (like the impersonation
// banner), no toasts. Surfaces three mutually exclusive, honest states about
// LOCAL persistence (same-browser only — never a collaboration claim):
//   1. a durable write FAILURE with recovery guidance (export copy + retry),
//   2. a two-tab CONFLICT choice (local edits vs. another tab's write),
//   3. a dismissible "refreshed from another tab" notice.
// Render priority: saveError > conflict > refreshed > null. All copy is fixed
// Polish; styling uses existing --n2-* semantic tokens; no animation.
import { useEffect } from 'react';
import { useStore, usePersistence } from '../store/AppStore';
import { exportRawData } from '../store/storage';
import type { SaveFailureReason } from '../store/storage';

const FAILURE_FIRST_SENTENCE: Record<SaveFailureReason, string> = {
  quota: 'Nie udało się zapisać danych — brak miejsca w pamięci przeglądarki.',
  unavailable:
    'Nie udało się zapisać danych — pamięć przeglądarki jest niedostępna (np. tryb prywatny).',
  serialization:
    'Nie udało się zapisać danych — nie można ich przekształcić do zapisu.',
  unknown: 'Nie udało się zapisać danych — wystąpił nieoczekiwany błąd zapisu.',
};

export function PersistenceBanner() {
  const { state } = useStore();
  const {
    saveError,
    external,
    retryPersist,
    acceptExternal,
    keepLocal,
    dismissExternalNotice,
  } = usePersistence();

  // While the failure banner is up, warn on tab close/reload — the in-memory
  // changes exist only in this tab and localStorage is stale.
  useEffect(() => {
    if (saveError === null) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveError]);

  // Export the IN-MEMORY state — that is the point: after a failed write the
  // stored copy is stale. Fall back to the raw stored copy only when the state
  // itself cannot serialize. Mirrors ErrorBoundary.handleExport's download.
  const handleExport = (): void => {
    let raw: string;
    try {
      raw = JSON.stringify(state);
    } catch {
      const fallback = exportRawData();
      if (fallback === null) return;
      raw = fallback;
    }
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'n2hub-dane.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (saveError !== null) {
    return (
      <div className="persistence-banner persistence-banner--error" role="alert">
        <div className="persistence-banner-text">
          <p>{FAILURE_FIRST_SENTENCE[saveError]}</p>
          <p>
            Zmiany istnieją tylko w tej karcie i przepadną po jej zamknięciu —
            pobierz kopię danych lub spróbuj ponownie.
          </p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn soft" onClick={handleExport}>
            Pobierz kopię danych (JSON)
          </button>
          <button type="button" className="btn primary" onClick={retryPersist}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }

  if (external === 'conflict') {
    return (
      <div
        className="persistence-banner persistence-banner--conflict"
        role="alert"
      >
        <div className="persistence-banner-text">
          <p>
            Dane zostały zmienione w innej karcie przeglądarki, a ta karta ma
            niezapisane zmiany.
          </p>
        </div>
        <div className="persistence-banner-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (
                window.confirm(
                  'Wczytać dane zapisane przez inną kartę? Niezapisane zmiany w tej karcie zostaną utracone.',
                )
              ) {
                acceptExternal();
              }
            }}
          >
            Wczytaj wersję z innej karty
          </button>
          <button
            type="button"
            className="btn ghost"
            title="Zapisuje stan tej karty, nadpisując zmiany z innej karty."
            onClick={keepLocal}
          >
            Zostaw moją wersję (nadpisz)
          </button>
        </div>
      </div>
    );
  }

  if (external === 'refreshed') {
    return (
      <div
        className="persistence-banner persistence-banner--info"
        role="status"
      >
        <div className="persistence-banner-text">
          <p>Dane odświeżono — wczytano zmiany zapisane w innej karcie.</p>
        </div>
        <div className="persistence-banner-actions">
          <button
            type="button"
            className="btn ghost small"
            onClick={dismissExternalNotice}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  return null;
}
