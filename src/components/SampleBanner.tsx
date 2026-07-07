// Dismissible first-run banner. Only shown when the store is empty and the
// banner hasn't been dismissed. "Load sample data" seeds; "Dismiss" just hides.
import { useStore } from '../store/AppStore';
import { buildSampleData } from '../store/seed';

export function SampleBanner() {
  const { state, dispatch } = useStore();

  const isEmpty =
    state.tasks.length === 0 &&
    state.people.length === 0 &&
    state.workload.length === 0;

  if (!isEmpty || state.sampleBannerDismissed) return null;

  return (
    <div className="sample-banner" role="status">
      <span className="sample-banner-text">
        No data yet — load some sample tasks and people to explore the planner.
      </span>
      <div className="sample-banner-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => dispatch({ type: 'LOAD_SAMPLE', data: buildSampleData() })}
        >
          Load sample data
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => dispatch({ type: 'DISMISS_SAMPLE_BANNER' })}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
