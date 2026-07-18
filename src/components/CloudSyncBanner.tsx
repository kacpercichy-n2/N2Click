// Baner synchronizacji z chmurą (tryb supabase). Reużywa istniejących klas
// `.persistence-banner*` (te same tokeny --n2-*, bez animacji). W trybie
// lokalnym / bez sesji / gdy snapshot nie jest gotowy — renderuje `null`.
// Priorytet: błąd hydracji > błąd przejściowy zapisu > porzucone (brak
// uprawnień) > gotowe z pustą kolejką (odśwież). Wszystkie napisy po polsku;
// nigdy nie pokazujemy surowego komunikatu SDK.
import { useCloudSync } from '../supabase/CloudSyncProvider';
import { STALE_HINT_MSG, SYNC_ERROR_MSG, SYNC_PERMISSION_MSG } from '../supabase/cloudMirror';

export function CloudSyncBanner() {
  const { status, pendingCount, error, dropped, retry, refresh, dismissDropped, notice, dismissNotice } =
    useCloudSync();

  // Powiadomienie o trwałej kolejce (przywrócono / zachowano niewysłane zmiany).
  // Najwyższy priorytet, bo dotyczy pracy zagrożonej utratą i musi być widoczne
  // także gdy status to 'idle' (po wylogowaniu) — jest neutralne i zamykalne.
  if (notice !== null) {
    return (
      <div className="persistence-banner persistence-banner--info" role="status">
        <div className="persistence-banner-text">
          <p>{notice}</p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn ghost small" onClick={dismissNotice}>
            OK
          </button>
        </div>
      </div>
    );
  }

  // Błąd hydracji: dane lokalne pozostają w pełni używalne.
  if (status === 'error') {
    return (
      <div className="persistence-banner persistence-banner--error" role="alert">
        <div className="persistence-banner-text">
          <p>{error ?? 'Nie udało się wczytać danych planera z serwera.'}</p>
          <p>Pracujesz na danych z tej przeglądarki — możesz spróbować ponownie.</p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn primary" onClick={retry}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }

  // Błąd przejściowy zapisu: zmiana została lokalnie, można ponowić.
  if (error !== null) {
    return (
      <div className="persistence-banner persistence-banner--error" role="alert">
        <div className="persistence-banner-text">
          <p>{SYNC_ERROR_MSG}</p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn primary" onClick={retry}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }

  // Operacje odrzucone przez serwer (brak uprawnień) — zostały tylko lokalnie.
  if (dropped.length > 0) {
    return (
      <div className="persistence-banner persistence-banner--conflict" role="alert">
        <div className="persistence-banner-text">
          <p>{SYNC_PERMISSION_MSG}</p>
          <p>{dropped.map((d) => d.label).join(', ')}</p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn ghost small" onClick={dismissDropped}>
            OK
          </button>
        </div>
      </div>
    );
  }

  // Hydracja w toku — subtelny komunikat, aplikacja renderuje dane lokalne.
  if (status === 'hydrating') {
    return (
      <div className="persistence-banner persistence-banner--info" role="status">
        <div className="persistence-banner-text">
          <p>Wczytywanie danych z serwera…</p>
        </div>
      </div>
    );
  }

  // Gotowe i kolejka pusta: oferuj ręczne odświeżenie (last-write-wins).
  if (status === 'ready' && pendingCount === 0) {
    return (
      <div className="persistence-banner persistence-banner--info" role="status">
        <div className="persistence-banner-text">
          <p>{STALE_HINT_MSG}</p>
        </div>
        <div className="persistence-banner-actions">
          <button type="button" className="btn ghost small" onClick={refresh}>
            Odśwież dane z serwera
          </button>
        </div>
      </div>
    );
  }

  // Tryb lokalny / brak sesji / zapisy w toku: brak baneru.
  return null;
}
