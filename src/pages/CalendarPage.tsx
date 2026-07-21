import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import { PersonFilter } from '../components/PersonFilter';
import { WeekView } from '../components/WeekView';
import { MonthView } from '../components/MonthView';
import {
  monthLabel,
  shiftMonth,
  shiftWeek,
  todayStr,
  weekRangeLabel,
} from '../utils/dates';

type ViewMode = 'week' | 'month';

// Stabilna pusta lista chipów osób (referencja) na czas braku zapamiętanego filtra.
const EMPTY_PERSON_IDS: string[] = [];

export function CalendarPage() {
  const { state, dispatch } = useStore();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<string>(() => todayStr());

  // Zaznaczenie osób jest ZAPAMIĘTANE w store (`lastFilters.calendar.personIds`)
  // — przetrwa nawigację i przeładowanie. Set jest wyłącznie POCHODNY (inwariant 7:
  // zmienia się tylko ŹRÓDŁO zaznaczenia, nie ścieżka wskaźnika kalendarza).
  const personIds = state.lastFilters.calendar?.personIds ?? EMPTY_PERSON_IDS;
  const filter = useMemo(() => new Set(personIds), [personIds]);

  const commitPersonIds = (ids: string[]) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'calendar',
      filter: {
        criteria: DEFAULT_FILTER_CRITERIA,
        personIds: ids,
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });

  const toggleFilter = (personId: string) => {
    const next = new Set(filter);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    commitPersonIds([...next]);
  };
  const resetFilter = () => commitPersonIds([]);

  const prev = () =>
    setAnchor((a) => (view === 'week' ? shiftWeek(a, -1) : shiftMonth(a, -1)));
  const next = () =>
    setAnchor((a) => (view === 'week' ? shiftWeek(a, 1) : shiftMonth(a, 1)));
  const goToday = () => setAnchor(todayStr());

  const label = view === 'week' ? weekRangeLabel(anchor) : monthLabel(anchor);

  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Kalendarz</h1>
      </div>

      <div className="cal-toolbar" data-tour="calendar.toolbar">
        <div className="cal-view-toggle" role="group" aria-label="Widok kalendarza">
          <button
            type="button"
            className={view === 'week' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setView('week')}
          >
            Tydzień
          </button>
          <button
            type="button"
            className={view === 'month' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setView('month')}
          >
            Miesiąc
          </button>
        </div>

        <div className="cal-nav">
          <button type="button" className="nav-btn" onClick={prev} aria-label="Poprzedni">
            ‹
          </button>
          <button type="button" className="btn ghost" onClick={goToday}>
            Dzisiaj
          </button>
          <button type="button" className="nav-btn" onClick={next} aria-label="Następny">
            ›
          </button>
          <span className="cal-range-label">{label}</span>
        </div>
      </div>

      {state.people.length > 0 && (
        <PersonFilter
          people={state.people}
          selected={filter}
          onToggle={toggleFilter}
          onAll={resetFilter}
        />
      )}

      {view === 'week' ? (
        <WeekView state={state} anchor={anchor} filter={filter} />
      ) : (
        <MonthView
          state={state}
          anchor={anchor}
          filter={filter}
          onPickDay={pickDay}
        />
      )}
    </section>
  );
}
