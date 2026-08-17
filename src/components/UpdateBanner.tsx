// Baner „dostępna nowa wersja" dla karty otwartej przed publikacją. Reużywa
// klas `.persistence-banner*` (jak `CloudSyncBanner`). Sprawdzenie idzie przy
// powrocie do karty (`visibilitychange`/`focus`, nie częściej niż co minutę)
// i co 10 minut w tle widocznej karty; porównanie i parsowanie są czyste w
// `utils/appVersion.ts`. Raz pokazany baner ZOSTAJE do odświeżenia — nie ma
// „zamknij", bo problem (stary kod przy żywym czacie) nie znika sam.
import { useEffect, useState } from 'react';
import { isNewerBuild, moduleScriptSrc } from '../utils/appVersion';
import { announce } from '../utils/liveRegion';

/** Najkrótszy odstęp między dwoma sprawdzeniami (powrót do karty). */
const MIN_CHECK_GAP_MS = 60_000;
/** Okresowe sprawdzenie w tle widocznej karty. */
const CHECK_INTERVAL_MS = 10 * 60_000;

const UPDATE_MSG = 'Dostępna jest nowa wersja N2Hub. Odśwież stronę, żeby mieć wszystkie zmiany.';

/** Odcisk pakietu ZAŁADOWANEGO w tej karcie (`null` w środowisku bez DOM). */
function currentBundle(): string | null {
  if (typeof document === 'undefined') return null;
  const script = document.querySelector('script[type="module"][src]');
  return script?.getAttribute('src') ?? null;
}

async function fetchDeployedBundle(): Promise<string | null> {
  try {
    const response = await fetch(new URL('/', window.location.href), {
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return null;
    return moduleScriptSrc(await response.text());
  } catch {
    // Offline / zerwana sieć: brak odpowiedzi to „nie wiem", nie „nowa wersja".
    return null;
  }
}

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const current = currentBundle();
    // Dev-server (`/src/main.tsx`) i środowiska bez skryptu modułu nie mają
    // czego porównywać — hook nic nie robi.
    if (current === null || !current.startsWith('/assets/')) return;

    let cancelled = false;
    let found = false;
    let lastCheck = 0;

    const check = async (): Promise<void> => {
      if (found || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastCheck < MIN_CHECK_GAP_MS) return;
      lastCheck = now;
      const deployed = await fetchDeployedBundle();
      if (cancelled || found) return;
      if (isNewerBuild(current, deployed)) {
        found = true;
        setAvailable(true);
      }
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    announce({ id: 'app-update', text: UPDATE_MSG, tone: 'polite' });
  }, [available]);

  if (!available) return null;
  return (
    <div className="persistence-banner persistence-banner--info" data-testid="update-banner">
      <div className="persistence-banner-text">
        <p>{UPDATE_MSG}</p>
      </div>
      <div className="persistence-banner-actions">
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Odśwież teraz
        </button>
      </div>
    </div>
  );
}
