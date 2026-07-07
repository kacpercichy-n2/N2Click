import { useState } from 'react';
import { useStore } from '../store/AppStore';
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

export function CalendarPage() {
  const { state } = useStore();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<string>(() => todayStr());
  const [filter, setFilter] = useState<Set<string>>(new Set());

  const toggleFilter = (personId: string) => {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };
  const resetFilter = () => setFilter(new Set());

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
        <h1>Calendar</h1>
      </div>

      <div className="cal-toolbar">
        <div className="cal-view-toggle" role="group" aria-label="Calendar view">
          <button
            type="button"
            className={view === 'week' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setView('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={view === 'month' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setView('month')}
          >
            Month
          </button>
        </div>

        <div className="cal-nav">
          <button type="button" className="nav-btn" onClick={prev} aria-label="Previous">
            ‹
          </button>
          <button type="button" className="btn ghost" onClick={goToday}>
            Today
          </button>
          <button type="button" className="nav-btn" onClick={next} aria-label="Next">
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
