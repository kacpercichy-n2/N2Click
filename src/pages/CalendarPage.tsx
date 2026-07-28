import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import { FilterBar } from '../components/FilterBar';
import { NowClockBadge } from '../components/NowClockBadge';
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

/** `id` widocznej etykiety okresu — nazwa dostępna siatki miesiąca. */
const CAL_RANGE_LABEL_ID = 'cal-range-label';

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

  // Klawiatura siatki miesiąca (PageUp/PageDown, z Shiftem rok) przestawia TĘ
  // SAMĄ kotwicę, co przyciski ‹ ›. Rok liczymy jako 12 miesięcy tym samym
  // `shiftMonth`, żeby matematyka dat nie rozjechała się między widokiem a stroną.
  const shiftAnchorMonth = (delta: number) => setAnchor((a) => shiftMonth(a, delta));
  const shiftAnchorYear = (delta: number) => setAnchor((a) => shiftMonth(a, delta * 12));

  const label = view === 'week' ? weekRangeLabel(anchor) : monthLabel(anchor);

  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };

  return (
    <section className="page">
      {/* JEDEN pasek sterowania nad siatką: tytuł + przełącznik widoku + nawigacja
          + „Filtry” (z osobami) + zegar. Wcześniej były to trzy osobne wiersze
          (page-head / cal-toolbar / filter-toolbar) — złożenie ich oddaje ~90px
          wysokości samemu kalendarzowi (zgłoszenie zespołu). Zmiana jest czysto
          układowa: żadne zachowanie filtrowania ani nawigacji się nie zmienia,
          a kotwica onboardingu `calendar.toolbar` zostaje na tym wierszu. */}
      <div className="cal-toolbar" data-tour="calendar.toolbar">
        <h1 className="cal-title">Kalendarz</h1>

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
          {/* Widoczny nagłówek okresu jest JEDNOCZEŚNIE ogłoszeniem zmiany
              (PageUp/PageDown w siatce miesiąca nie przestawia fokusu poza
              komórkę) i nazwą dostępną siatki (`aria-labelledby`). */}
          <span
            className="cal-range-label"
            id={CAL_RANGE_LABEL_ID}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {label}
          </span>
        </div>

        {state.people.length > 0 && (
          <FilterBar
            filterPanel={{
              groups: [],
              activeCount: filter.size > 0 ? 1 : 0,
              onClearAll: resetFilter,
              chips: [],
            }}
            person={{
              people: state.people,
              selected: filter,
              onToggle: toggleFilter,
              onAll: resetFilter,
            }}
          />
        )}

        <NowClockBadge />
      </div>

      {view === 'week' ? (
        <WeekView state={state} anchor={anchor} filter={filter} />
      ) : (
        <MonthView
          state={state}
          anchor={anchor}
          filter={filter}
          onPickDay={pickDay}
          onShiftMonth={shiftAnchorMonth}
          onShiftYear={shiftAnchorYear}
          labelId={CAL_RANGE_LABEL_ID}
        />
      )}
    </section>
  );
}
