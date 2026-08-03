// Moduł „Content plan" — na razie SZKIELET trasy: nagłówek, pager miesięcy ze
// stanem w URL (`?m=YYYY-MM`) i pusty stan. Siatka kalendarza, karty publikacji
// i edytor wchodzą kolejnymi fazami; store modułu (marki i publikacje) jest już
// w AppStore, ale ta strona jeszcze go nie czyta.
//
// Bramka: strona pilnuje się SAMA (wzorzec `AdminPage`/`TeamPage`), więc wejście
// z paska adresu przez użytkownika bez roli kończy się przekierowaniem na Panel,
// nawet gdyby pozycja menu wyciekła. To bramka UX, nie granica bezpieczeństwa —
// realny zakres wymusza serwer (RLS schematu `contentplan`).
import { Navigate, useSearchParams } from 'react-router-dom';
import { useContentPlanAccess } from '../contentplan/useContentPlanAccess';
import { MONTH_PARAM, monthPagerFromParam, resolveMonthParam } from './contentPlanRoute';
import { HOME_PATH } from './homeRoute';
import { todayStr } from '../utils/dates';

export function ContentPlanPage() {
  const canView = useContentPlanAccess();
  const [params, setParams] = useSearchParams();
  const today = todayStr();
  // Cała arytmetyka miesiąca (walidacja parametru, etykieta, sąsiedzi) siedzi w
  // czystym `contentPlanRoute.ts` — tutaj zostaje sam render.
  const pager = monthPagerFromParam(params.get(MONTH_PARAM), today);
  const currentMonth = resolveMonthParam(null, today);

  if (!canView) return <Navigate to={HOME_PATH} replace />;

  const goToMonth = (key: string) => {
    const next = new URLSearchParams(params);
    next.set(MONTH_PARAM, key);
    // `replace`: przewijanie miesięcy nie ma zasypywać historii przeglądarki
    // (Wstecz wraca tam, skąd użytkownik wszedł na moduł).
    setParams(next, { replace: true });
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Content plan</h1>
        <div className="page-head-actions">
          <div className="cal-nav">
            <span className="cal-range-label">{pager.label}</span>
            <button
              type="button"
              className="nav-btn"
              aria-label="Poprzedni miesiąc"
              onClick={() => goToMonth(pager.prev)}
            >
              ‹
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={pager.key === currentMonth}
              onClick={() => goToMonth(currentMonth)}
            >
              Bieżący miesiąc
            </button>
            <button
              type="button"
              className="nav-btn"
              aria-label="Następny miesiąc"
              onClick={() => goToMonth(pager.next)}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="empty-state">
        <p className="empty-title">Brak zaplanowanych treści w tym miesiącu.</p>
        <p className="empty-hint">
          Widok kalendarza publikacji i edytor postów pojawią się w kolejnym kroku
          wdrożenia modułu.
        </p>
      </div>
    </section>
  );
}
