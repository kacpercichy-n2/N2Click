// Dismissible first-run banner. Only shown when the store is empty and the
// banner hasn't been dismissed. "Load sample data" seeds; "Dismiss" just hides.
// W trybie supabase NIGDY: chmura jest źródłem prawdy, dane przykładowe
// zostałyby i tak wymiecione przy najbliższej hydracji (i nigdy nie są
// mirrorowane), więc oferowanie ich byłoby myleniem użytkownika.
import { useEffect } from 'react';
import { useStore } from '../store/AppStore';
import { buildSampleData } from '../store/seed';
import { useAuth } from '../auth/SessionProvider';
import { announce } from '../utils/liveRegion';

const SAMPLE_MSG = 'Brak danych — wczytaj przykładowe zadania i osoby, żeby poznać planer.';

export function SampleBanner() {
  const { state, dispatch } = useStore();
  const auth = useAuth();

  const isEmpty =
    state.tasks.length === 0 &&
    state.people.length === 0 &&
    state.workload.length === 0;
  const visible = auth.mode !== 'supabase' && isEmpty && !state.sampleBannerDismissed;

  // Baner pojawia się razem ze swoim tekstem, więc własny `role="status"` bywa
  // niesłyszalny — ogłasza go trwały kanał powłoki.
  useEffect(() => {
    if (!visible) return;
    announce({ id: 'sample-banner', text: SAMPLE_MSG, tone: 'polite' });
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="sample-banner">
      <span className="sample-banner-text">{SAMPLE_MSG}</span>
      <div className="sample-banner-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => dispatch({ type: 'LOAD_SAMPLE', data: buildSampleData() })}
        >
          Wczytaj przykładowe dane
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => dispatch({ type: 'DISMISS_SAMPLE_BANNER' })}
        >
          Ukryj
        </button>
      </div>
    </div>
  );
}
