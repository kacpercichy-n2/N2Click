// Baner synchronizacji z chmurą (tryb supabase). Reużywa istniejących klas
// `.persistence-banner*` (te same tokeny --n2-*, bez animacji). W trybie
// lokalnym / bez sesji / gdy snapshot nie jest gotowy — renderuje `null`.
// Priorytet: błąd hydracji > błąd przejściowy zapisu > porzucone (brak
// uprawnień) > gotowe z pustą kolejką (odśwież). Wszystkie napisy po polsku;
// nigdy nie pokazujemy surowego komunikatu SDK.
import { useEffect, useState } from 'react';
import { useCloudSync } from '../supabase/CloudSyncProvider';
import { STALE_HINT_MSG, SYNC_ERROR_MSG, SYNC_PERMISSION_MSG } from '../supabase/cloudMirror';

/** Karencja braku kanału Realtime, zanim pokażemy baner „dane nieaktualne”. */
const STALE_GRACE_MS = 30_000;

/**
 * True dopiero, gdy warunek utrzymuje się NIEPRZERWANIE przez `ms`. Każdy
 * powrót warunku do false zeruje licznik. Chwilowe zerwania kanału Realtime
 * (uśpienie, zmiana sieci — przebudowują się same z backoffem) nie mogą migać
 * banerem i przesuwać layoutu nad kalendarzem.
 */
function useSustained(condition: boolean, ms: number): boolean {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!condition) {
      setSustained(false);
      return;
    }
    const timer = setTimeout(() => setSustained(true), ms);
    return () => clearTimeout(timer);
  }, [condition, ms]);
  return sustained;
}

export function CloudSyncBanner() {
  const { status, pendingCount, error, live, dropped, retry, refresh, dismissDropped } =
    useCloudSync();
  // Hook przed wczesnymi returnami (stała lista hooków między renderami).
  const staleForLong = useSustained(status === 'ready' && !live, STALE_GRACE_MS);

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

  // Żywa synchronizacja aktywna: zmiany w bazie same trafiają do GUI — stały
  // baner „dane mogą być nieaktualne” byłby fałszywy, więc nic nie pokazujemy.
  if (status === 'ready' && live) {
    return null;
  }

  // Gotowe, ale kanał Realtime leży NIEPRZERWANIE od ≥30 s (offline / stara
  // publikacja) — dopiero wtedy oferuj ręczne odświeżenie (last-write-wins).
  // Krótkie zerwania łata resubscribe + dociągnięcie w CloudSyncProvider.
  if (status === 'ready' && pendingCount === 0 && staleForLong) {
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
