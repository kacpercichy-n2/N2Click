import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import { FilterBar } from '../components/FilterBar';
import { NowClockBadge } from '../components/NowClockBadge';
import { WeekView } from '../components/WeekView';
import { MonthView } from '../components/MonthView';
import { todayPillVisible } from '../components/dayStrip';
import { OverlayLayer, useOverlay } from '../components/useOverlay';
import { CALENDAR_DAY_PARAM } from '../components/bottomNav';
import { MOBILE_NAV_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import {
  addDaysStr,
  formatShortWithWeekday,
  isValidDateStr,
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
  // Deep-link dnia (`/calendar?dzien=2026-07-25`) — używa go „+N więcej" w pasku
  // tygodnia na Panelu. Parametr USTAWIA kotwicę raz i znika (`replace`), więc
  // cofnięcie nie przywraca dnia, a dalsza nawigacja ‹ › zostaje w rękach
  // zwykłego stanu (jedno źródło prawdy o kotwicy). Niepoprawna data = brak akcji.
  const [searchParams, setSearchParams] = useSearchParams();
  const dayParam = searchParams.get(CALENDAR_DAY_PARAM);
  useEffect(() => {
    if (dayParam === null) return;
    if (isValidDateStr(dayParam)) setAnchor(dayParam);
    const next = new URLSearchParams(searchParams);
    next.delete(CALENDAR_DAY_PARAM);
    setSearchParams(next, { replace: true });
  }, [dayParam, searchParams, setSearchParams]);
  // Telefon (≤760 px): widok „Tydzień” renderuje JEDEN dzień, a pasek sterowania
  // schodzi do jednego rzędu 56 px. Ten sam hook, co powłoka aplikacji.
  const phone = useMediaQuery(MOBILE_NAV_QUERY);
  // Szybki skok (arkusz od dołu przy przycisku zakresu) — tylko na telefonie.
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpBtnRef = useRef<HTMLButtonElement | null>(null);
  const jumpSheetRef = useRef<HTMLDivElement | null>(null);
  const closeJump = useCallback(() => setJumpOpen(false), []);
  // Ten sam wariant powłoki co arkusz „Więcej”/arkusz filtrów: bez `getAnchorRect`
  // (arkusz kotwiczy CSS przy dolnej krawędzi), ze stosem Escape, zamykaniem
  // kliknięciem poza i powrotem fokusa na przycisk zakresu.
  useOverlay({
    open: jumpOpen,
    onClose: closeJump,
    overlayRef: jumpSheetRef,
    triggerRef: jumpBtnRef,
  });

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
        sort: '',
      },
    });

  const toggleFilter = (personId: string) => {
    const next = new Set(filter);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    commitPersonIds([...next]);
  };
  const resetFilter = () => commitPersonIds([]);

  // ‹ › przesuwają o tyle, ile WIDAĆ: na telefonie widok „Tydzień” pokazuje
  // jeden dzień, więc skacze o dzień; na desktopie o tydzień. Miesiąc bez zmian.
  const shiftRange = (delta: number) =>
    setAnchor((a) =>
      view === 'week'
        ? phone
          ? addDaysStr(a, delta)
          : shiftWeek(a, delta)
        : shiftMonth(a, delta),
    );
  const prev = () => shiftRange(-1);
  const next = () => shiftRange(1);
  const goToday = () => setAnchor(todayStr());

  // Klawiatura siatki miesiąca (PageUp/PageDown, z Shiftem rok) przestawia TĘ
  // SAMĄ kotwicę, co przyciski ‹ ›. Rok liczymy jako 12 miesięcy tym samym
  // `shiftMonth`, żeby matematyka dat nie rozjechała się między widokiem a stroną.
  const shiftAnchorMonth = (delta: number) => setAnchor((a) => shiftMonth(a, delta));
  const shiftAnchorYear = (delta: number) => setAnchor((a) => shiftMonth(a, delta * 12));

  // Etykieta okresu opisuje TO, CO WIDAĆ: na telefonie w widoku dnia jest to
  // jeden dzień („26 paź (pon)”), a nie zakres całego tygodnia.
  const label =
    view === 'month'
      ? monthLabel(anchor)
      : phone
        ? formatShortWithWeekday(anchor)
        : weekRangeLabel(anchor);

  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };

  // Filtry na telefonie i na desktopie to DOKŁADNIE ten sam `FilterBar` z tymi
  // samymi propsami — telefonowy rząd tylko go przestawia, nigdy nie zmienia
  // zachowania filtrowania (wybór osób i tak żyje w popoverze „Filtry”).
  const filterBar = state.people.length > 0 && (
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
  );

  // Widoczna etykieta okresu jest naraz ogłoszeniem zmiany (`aria-live`) i nazwą
  // dostępną siatki miesiąca (`aria-labelledby`), więc `id` + `role="status"`
  // muszą przetrwać w OBU wariantach paska. Na telefonie siedzą w `<span>`
  // WEWNĄTRZ przycisku skoku — `role="status"` na samym przycisku odebrałoby mu
  // rolę przycisku dla czytnika ekranu.
  const rangeLabel = (
    <span
      className="cal-range-label"
      id={CAL_RANGE_LABEL_ID}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {label}
    </span>
  );

  if (phone) {
    return (
      <section className="page">
        {/* JEDEN rząd 56 px: ‹ · zakres (otwiera szybki skok) · › · Filtry.
            Tytuł „Kalendarz” niesie górny pasek aplikacji, a zegar nie mieści
            się w rzędzie — oba znikają tylko na telefonie. Kotwica onboardingu
            `calendar.toolbar` zostaje na TYM SAMYM elemencie. */}
        <div className="cal-toolbar cal-toolbar-phone" data-tour="calendar.toolbar">
          <button type="button" className="nav-btn" onClick={prev} aria-label="Poprzedni">
            ‹
          </button>
          <button
            type="button"
            ref={jumpBtnRef}
            className="cal-range-btn"
            aria-haspopup="dialog"
            aria-expanded={jumpOpen}
            onClick={() => setJumpOpen((v) => !v)}
          >
            {rangeLabel}
          </button>
          <button type="button" className="nav-btn" onClick={next} aria-label="Następny">
            ›
          </button>
          {filterBar}
        </div>

        {view === 'week' ? (
          <WeekView
            state={state}
            anchor={anchor}
            filter={filter}
            mode="day"
            onPickDay={pickDay}
          />
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

        {/* „Dzisiaj” wraca jako pływająca pigułka — pokazuje się WYŁĄCZNIE wtedy,
            gdy widoczny zakres nie zawiera dzisiejszego dnia, więc w typowej
            sesji nie zabiera miejsca w rzędzie sterowania. */}
        {todayPillVisible(view === 'month' ? 'month' : 'day', anchor, todayStr()) && (
          <button type="button" className="cal-today-pill" onClick={goToday}>
            Dzisiaj
          </button>
        )}

        {jumpOpen && (
          <OverlayLayer>
            <div className="app-sheet-scrim" aria-hidden />
            <div
              className="cal-jump-sheet"
              role="dialog"
              aria-label="Skok do daty"
              ref={jumpSheetRef}
            >
              <div className="app-sheet-handle" aria-hidden />
              <div className="cal-view-toggle" role="group" aria-label="Widok kalendarza">
                {/* Na telefonie „Tydzień” renderuje się jako jeden dzień, więc
                    etykieta mówi „Dzień” — sam tryb (`view`) zostaje ten sam. */}
                <button
                  type="button"
                  className={view === 'week' ? 'toggle-btn active' : 'toggle-btn'}
                  onClick={() => {
                    setView('week');
                    setJumpOpen(false);
                  }}
                >
                  Dzień
                </button>
                <button
                  type="button"
                  className={view === 'month' ? 'toggle-btn active' : 'toggle-btn'}
                  onClick={() => {
                    setView('month');
                    setJumpOpen(false);
                  }}
                >
                  Miesiąc
                </button>
              </div>
              <label className="cal-jump-field">
                Skocz do dnia
                <input
                  type="date"
                  value={anchor}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!isValidDateStr(value)) return;
                    setAnchor(value);
                    setJumpOpen(false);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  goToday();
                  setJumpOpen(false);
                }}
              >
                Dzisiaj
              </button>
            </div>
          </OverlayLayer>
        )}
      </section>
    );
  }

  return (
    <section className="page">
      {/* JEDEN pasek sterowania nad siatką: tytuł + przełącznik widoku + nawigacja
          + „Filtry” (z osobami) + zegar. Wcześniej były to trzy osobne wiersze
          (page-head / cal-toolbar / filter-toolbar) — złożenie ich oddaje ~90px
          wysokości samemu kalendarzowi (zgłoszenie zespołu). Zmiana jest czysto
          układowa: żadne zachowanie filtrowania ani nawigacji się nie zmienia,
          a kotwica onboardingu `calendar.toolbar` zostaje na tym wierszu.

          Pasek ma DWIE grupy i nic pomiędzy nimi: przy lewej krawędzi zwarta
          trójka (tytuł · przełącznik widoku · plakietka daty/zegara), przy
          prawej „Filtry” i skrajnie po prawej nawigacja okresu. Wolna
          przestrzeń zostaje w ŚRODKU — wcześniej plakietka odjeżdżała na
          prawo (`margin-left: auto`) i wisiała w oderwaniu od tytułu. */}
      <div className="cal-toolbar" data-tour="calendar.toolbar">
        <div className="cal-toolbar-lead">
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

          <NowClockBadge />
        </div>

        <div className="cal-toolbar-trail">
          {filterBar}

          <div className="cal-nav">
            {/* Widoczny nagłówek okresu jest JEDNOCZEŚNIE ogłoszeniem zmiany
                (PageUp/PageDown w siatce miesiąca nie przestawia fokusu poza
                komórkę) i nazwą dostępną siatki (`aria-labelledby`). Stoi PRZED
                strzałkami, żeby sama nawigacja („‹ Dzisiaj ›”) kończyła się na
                skrajnie prawej krawędzi interfejsu. */}
            {rangeLabel}
            <button type="button" className="nav-btn" onClick={prev} aria-label="Poprzedni">
              ‹
            </button>
            <button type="button" className="btn ghost" onClick={goToday}>
              Dzisiaj
            </button>
            <button type="button" className="nav-btn" onClick={next} aria-label="Następny">
              ›
            </button>
          </div>
        </div>
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
