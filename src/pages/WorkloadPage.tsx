// Workload dashboard: per-person assigned vs available hours for a week, with
// per-day breakdown, overload warnings, and filters by department / client /
// service type.
//
// DWA ROZDZIELONE SYGNAŁY (OP-21): pasek obciążenia koduje WYŁĄCZNIE
// wykorzystanie (`loadTone`, jedna monotoniczna skala), a „któryś dzień ponad
// dostępnością” to osobna ikona przy nazwisku. Wcześniej jedno `danger`
// sterowało obydwoma, więc 75% bywało czerwone obok fioletowego 84%, a tekst
// „⚠ 1 dzień” powtarzał to, co i tak mówiła czerwona komórka.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { AppData } from '../types';
import type { SavedFilterCriteria, WorkloadEntry } from '../types';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import {
  availableHoursInRange,
  availableHoursOnDate,
  blocksForPersonDate,
  getClient,
  getDepartment,
  getPerson,
  getServiceType,
  hoursForPersonOnDate,
  isPersonWorkday,
  loadPercent,
  loadTone,
  workloadCellDetail,
  type WorkloadCellBlock,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { useOpenTask } from '../components/TaskModal';
import { FilterPanel, type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { OverlayLayer, useOverlay } from '../components/useOverlay';
import { calendarDayTarget } from '../components/bottomNav';
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
} from '../components/icons';
import {
  formatRowLabel,
  isWeekend,
  shiftWeek,
  todayStr,
  weekDays,
  weekRangeLabel,
} from '../utils/dates';
import { findFreeStart, formatDuration, hoursToMinutes } from '../utils/time';
import { DisabledHint } from '../components/Tooltip';
import { sortByNamePl } from '../utils/collation';

/** Actions for one block inside the resolution popover. */
function BlockRow({
  state,
  block,
  personId,
  date,
  canReassign,
  canMoveTask,
  onReassign,
  onOpenTask,
  onMove,
}: {
  state: AppData;
  block: WorkloadCellBlock;
  personId: string;
  date: string;
  canReassign: boolean;
  canMoveTask: boolean;
  onReassign: (entryId: string, toPersonId: string) => void;
  onOpenTask: (taskId: string) => void;
  onMove: (taskId: string, dayDelta: number) => void;
}) {
  const entry: WorkloadEntry = block.entry;
  const others = state.people.filter((p) => p.id !== personId);
  const [target, setTarget] = useState(() => others[0]?.id ?? '');
  // Mirror REASSIGN_ENTRY's dated predicate: the target day must have a
  // collision-free slot for this block. Disable the move the reducer would
  // silently reject and flag each no-fit option.
  const durMin = hoursToMinutes(entry.plannedHours);
  const targetFits = target
    ? findFreeStart(blocksForPersonDate(state, target, date), durMin) !== null
    : true;

  return (
    <li className="wr-block">
      <div className="wr-block-info">
        <span className="wr-block-task">{block.taskTitle}</span>
        <span className="wr-block-project muted">
          {block.projectName === '' ? '—' : block.projectName}
          {block.clientName === '' ? '' : ` · ${block.clientName}`}
        </span>
      </div>
      {/* Godziny bloku: zakres z zegara + długość. Bez zakresu popover nie
          odpowiadał na pytanie „kiedy dokładnie”, więc i tak trzeba było iść do
          kalendarza. */}
      <span className="wr-block-hours">
        <span className="wr-block-time">{block.timeRange}</span>
        {' · '}
        {formatDuration(block.plannedHours)}
      </span>
      <div className="wr-block-actions">
        {canReassign && others.length > 0 && (
          <div className="wr-reassign">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Przypisz do osoby"
            >
              {others.map((p) => {
                const avail = availableHoursOnDate(state, p.id, date);
                const cur = hoursForPersonOnDate(state, p.id, date);
                const over = cur + entry.plannedHours > avail;
                const fits = findFreeStart(blocksForPersonDate(state, p.id, date), durMin) !== null;
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatDuration(cur)}/{formatDuration(avail)} tego dnia{over ? ' ⚠' : ''}
                    {fits ? '' : ' — brak miejsca'}
                  </option>
                );
              })}
            </select>
            <DisabledHint
              reason={targetFits ? null : 'Brak wolnego przedziału czasu w tym dniu u wybranej osoby.'}
              id={`wl-move-${entry.id}`}
            >
              <button
                type="button"
                className="btn ghost small"
                onClick={() => target && targetFits && onReassign(entry.id, target)}
                disabled={!targetFits}
              >
                <ArrowRightLeft size={14} /> Przenieś
              </button>
            </DisabledHint>
          </div>
        )}
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onOpenTask(entry.taskId)}
        >
          Otwórz zadanie
        </button>
        {canMoveTask && (
          <div className="wr-move">
            <span className="muted wr-move-label">Przesuń całe zadanie:</span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onMove(entry.taskId, -1)}
            >
              <ChevronLeft size={14} /> −1 dzień
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onMove(entry.taskId, 1)}
            >
              +1 dzień <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function WorkloadPage() {
  const { state, dispatch } = useStore();
  const { openTask } = useOpenTask();
  const navigate = useNavigate();
  const can = useCan();
  const canReassign = can('workload.reassign');
  const canMoveTask = can('tasks.manage');
  const [anchor, setAnchor] = useState(() => todayStr());
  // Stan filtrów ZAPAMIĘTANY w store (`lastFilters.workload`): dział/typ usługi to
  // wymiary specyficzne dla widoku (`departmentId`/`serviceTypeId`), klient żyje w
  // `criteria.clientId`. Setter wysyła pełny snapshot (no-op zapisu identycznego).
  const remembered = state.lastFilters.workload;
  const workloadCriteria: SavedFilterCriteria = remembered?.criteria ?? DEFAULT_FILTER_CRITERIA;
  const departmentFilter = remembered?.departmentId ?? '';
  const clientFilter = workloadCriteria.clientId;
  const serviceFilter = remembered?.serviceTypeId ?? '';

  const commitWorkload = (patch: {
    departmentId?: string;
    clientId?: string;
    serviceTypeId?: string;
  }) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'workload',
      filter: {
        criteria: { ...workloadCriteria, clientId: patch.clientId ?? clientFilter },
        personIds: [],
        departmentId: patch.departmentId ?? departmentFilter,
        serviceTypeId: patch.serviceTypeId ?? serviceFilter,
        planning: '',
      },
    });

  const setDepartmentFilter = (v: string) => commitWorkload({ departmentId: v });
  const setClientFilter = (v: string) => commitWorkload({ clientId: v });
  const setServiceFilter = (v: string) => commitWorkload({ serviceTypeId: v });

  const [selected, setSelected] = useState<{ personId: string; date: string } | null>(
    null,
  );
  // Kotwicą popovera jest KLIKNIĘTA komórka — trzymamy sam element, bo tabela
  // przewija się poziomo (`.alloc-wrap`) i pozycja musi jechać razem z nią.
  // Ten sam ref jest `triggerRef` powłoki: drugie kliknięcie w tę samą komórkę
  // zamyka popover (zamiast zamknąć + otworzyć na nowo), a fokus wraca na nią.
  const anchorRef = useRef<HTMLTableCellElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closePopover = useCallback(() => setSelected(null), []);
  const getAnchorRect = useCallback(() => {
    const element = anchorRef.current;
    return element === null || !element.isConnected ? null : element.getBoundingClientRect();
  }, []);
  const overlay = useOverlay({
    open: selected !== null,
    onClose: closePopover,
    overlayRef: popoverRef,
    getAnchorRect,
    triggerRef: anchorRef,
    // Komórka wyjechała poza widoczny obszar (przewinięta tabela) — popover
    // przyklejony do krawędzi nie opisywałby już żadnego dnia.
    closeOnAnchorOutOfView: true,
    offset: 4,
  });

  const days = weekDays(anchor);
  const daySet = new Set(days);

  // Pełna treść popovera (nagłówek + lista bloków) idzie z JEDNEGO selektora,
  // więc bilans „6h / 8h” zawsze zgadza się z listą pod nim.
  const detail = selected
    ? workloadCellDetail(state, selected.personId, selected.date)
    : null;
  const selectedPerson = selected ? getPerson(state, selected.personId) : undefined;

  // Close the popover once the selected person/day has no blocks left (e.g.
  // after reassigning the last one or shifting the task off this day).
  const selectedBlockCount = detail?.blocks.length ?? 0;
  useEffect(() => {
    if (selected && selectedBlockCount === 0) setSelected(null);
  }, [selected, selectedBlockCount]);

  const toggleCell = (personId: string, date: string, cell: HTMLTableCellElement) => {
    anchorRef.current = cell;
    setSelected((cur) =>
      cur && cur.personId === personId && cur.date === date ? null : { personId, date },
    );
  };

  // „Otwórz w kalendarzu”: ten sam deep-link dnia, co pasek tygodnia na Panelu
  // (`calendarDayTarget`), plus ZAPAMIĘTANY filtr osób kalendarza — czyli
  // dokładnie te dwa istniejące mechanizmy, żaden nowy parametr trasy.
  const openInCalendar = (personId: string, date: string) => {
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'calendar',
      filter: {
        criteria: DEFAULT_FILTER_CRITERIA,
        personIds: [personId],
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });
    setSelected(null);
    navigate(calendarDayTarget(date));
  };

  // Entry passes the client/service filters when its task's project matches.
  const taskProject = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of state.tasks) m.set(t.id, t.projectId);
    return m;
  }, [state.tasks]);

  const entryPasses = (w: WorkloadEntry): boolean => {
    if (!clientFilter && !serviceFilter) return true;
    const project = state.projects.find((p) => p.id === taskProject.get(w.taskId));
    if (!project) return false;
    if (clientFilter && project.clientId !== clientFilter) return false;
    if (serviceFilter && project.serviceTypeId !== serviceFilter) return false;
    return true;
  };

  const people = state.people.filter(
    (p) => !departmentFilter || p.departmentId === departmentFilter,
  );

  const filterGroups: FilterGroup[] = [
    {
      key: 'department',
      label: 'Dział',
      value: departmentFilter,
      onChange: setDepartmentFilter,
      options: [
        { value: '', label: 'Wszystkie działy' },
        ...state.departments.map((d) => ({ value: d.id, label: d.name })),
      ],
    },
    {
      key: 'client',
      label: 'Klient',
      value: clientFilter,
      onChange: setClientFilter,
      options: [
        { value: '', label: 'Wszyscy klienci' },
        ...sortByNamePl(state.clients).map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'service',
      label: 'Rodzaj usługi',
      value: serviceFilter,
      onChange: setServiceFilter,
      options: [
        { value: '', label: 'Wszystkie typy usług' },
        ...state.serviceTypes.map((s) => ({ value: s.id, label: s.name })),
      ],
    },
  ];

  const activeCount =
    (departmentFilter ? 1 : 0) + (clientFilter ? 1 : 0) + (serviceFilter ? 1 : 0);

  const chips: FilterChip[] = [];
  if (departmentFilter)
    chips.push({
      key: 'department',
      label: `Dział: ${getDepartment(state, departmentFilter)?.name ?? '—'}`,
      onRemove: () => setDepartmentFilter(''),
    });
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${getClient(state, clientFilter)?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (serviceFilter)
    chips.push({
      key: 'service',
      label: `Rodzaj usługi: ${getServiceType(state, serviceFilter)?.name ?? '—'}`,
      onRemove: () => setServiceFilter(''),
    });

  const clearAll = () =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'workload',
      filter: {
        criteria: DEFAULT_FILTER_CRITERIA,
        personIds: [],
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });

  // hours[personId][date] for this week, under the current filters.
  const weekEntries = state.workload.filter((w) => daySet.has(w.date) && entryPasses(w));
  const hoursFor = (personId: string, date: string) =>
    weekEntries
      .filter((w) => w.personId === personId && w.date === date)
      .reduce((s, w) => s + w.plannedHours, 0);

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Obciążenie</h1>
        <div className="cal-nav">
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, -1))}
            aria-label="Poprzedni tydzień"
          >
            ‹
          </button>
          <button type="button" className="btn ghost" onClick={() => setAnchor(todayStr())}>
            Dzisiaj
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, 1))}
            aria-label="Następny tydzień"
          >
            ›
          </button>
          <span className="cal-range-label">{weekRangeLabel(anchor)}</span>
        </div>
      </div>

      <div className="cal-toolbar">
        <FilterPanel
          groups={filterGroups}
          activeCount={activeCount}
          onClearAll={clearAll}
          chips={chips}
        />
      </div>

      {people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak osób</p>
          <p className="empty-hint">
            Dodaj członków zespołu na stronie <Link to="/people">Zespół</Link>.
          </p>
        </div>
      ) : (
        <div className="alloc-wrap" data-tour="workload.table">
          <table className="alloc-grid workload-table">
            <thead>
              <tr>
                <th className="alloc-day-col">Osoba</th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={isWeekend(d) ? 'workload-day weekend' : 'workload-day'}
                  >
                    {formatRowLabel(d)}
                  </th>
                ))}
                <th>Przypisane</th>
                <th>Dostępne</th>
                <th>Obciążenie</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const assigned = days.reduce((s, d) => s + hoursFor(p.id, d), 0);
                const available = availableHoursInRange(state, p.id, days);
                // null ⇒ hours booked against zero availability — szczyt skali
                // wykorzystania, nigdy spokojne 0%. Przeciążone POJEDYNCZE dni
                // NIE wchodzą już do koloru paska — mają własną ikonę przy
                // nazwisku, bo to inna informacja niż „ile tygodnia zajęte”.
                const pct = loadPercent(assigned, available);
                const tone = loadTone(pct);
                const overloadedDays = days.filter(
                  (d) => hoursFor(p.id, d) > availableHoursOnDate(state, p.id, d),
                );
                return (
                  <tr key={p.id}>
                    <th scope="row" className="workload-person">
                      <Link to={`/people/${p.id}`} className="workload-person-link">
                        <Avatar person={p} size={26} />
                        <span>
                          <span className="workload-person-name">{p.name}</span>
                          <span className="muted workload-person-dep">
                            {getDepartment(state, p.departmentId)?.name ?? ''}
                          </span>
                        </span>
                      </Link>
                      {/* OSOBNY sygnał „dzień ponad dostępnością” — poza paskiem
                          i poza linkiem do profilu (nie zaśmieca jego nazwy).
                          Ikona, nie tekst „⚠ 1 dzień”: liczbę i tak widać w
                          czerwonych komórkach obok, a pełna lista dni siedzi w
                          nazwie dostępnej. */}
                      {overloadedDays.length > 0 && (
                        <span
                          className="workload-over-flag"
                          role="img"
                          aria-label={`Przekroczona dostępność: ${overloadedDays
                            .map(formatRowLabel)
                            .join(', ')}`}
                        >
                          <AlertTriangle size={14} aria-hidden />
                        </span>
                      )}
                    </th>
                    {days.map((d) => {
                      const h = hoursFor(p.id, d);
                      const avail = availableHoursOnDate(state, p.id, d);
                      const over = h > avail;
                      const clickable = h > 0;
                      const isSel =
                        selected?.personId === p.id && selected?.date === d;
                      return (
                        <td
                          key={d}
                          className={[
                            'workload-cell',
                            isWeekend(d) || !isPersonWorkday(state, p.id, d)
                              ? 'weekend'
                              : '',
                            over ? 'overload' : '',
                            h === 0 ? 'free' : '',
                            clickable ? 'clickable' : '',
                            isSel ? 'selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-haspopup={clickable ? 'dialog' : undefined}
                          aria-expanded={clickable ? isSel : undefined}
                          onClick={
                            clickable ? (e) => toggleCell(p.id, d, e.currentTarget) : undefined
                          }
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleCell(p.id, d, e.currentTarget);
                                  }
                                }
                              : undefined
                          }
                        >
                          {h === 0 ? '—' : formatDuration(h)}
                          {over && ' ⚠'}
                          {/* Powód przeciążenia jako tekst UKRYTY WIZUALNIE
                              wewnątrz komórki: dawny `title` nie istniał na
                              dotyku. `aria-describedby` byłoby tu wskazaniem na
                              WŁASNE dziecko (komórka bierze nazwę z treści), co
                              dałoby podwójne ogłoszenie — dlatego opis jest po
                              prostu częścią treści komórki. */}
                          {over && (
                            <span id={`wl-over-${p.id}-${d}`} className="sr-only">
                              {p.name}: {formatDuration(h)} ponad {formatDuration(avail)} dostępności
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="workload-sum">{formatDuration(assigned)}</td>
                    <td className="workload-sum muted">{formatDuration(available)}</td>
                    <td className="workload-load">
                      {/* Pasek mówi TYLKO o wykorzystaniu tygodnia — jedna
                          skala, jedna nazwa dostępna. */}
                      <div
                        className="load-bar"
                        data-tour="workload.load"
                        role="img"
                        aria-label={
                          pct === null
                            ? 'Godziny zaplanowane przy zerowej dostępności'
                            : `${pct}% dostępnych godzin`
                        }
                      >
                        <div
                          className={`load-bar-fill tone-${tone}`}
                          style={{ width: `${pct === null ? 100 : Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className={tone === 'over' ? 'load-pct over' : 'load-pct'}>
                        {pct === null
                          ? '⚠ brak dostępności'
                          : tone === 'over'
                            ? `⚠ ${pct}%`
                            : `${pct}%`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-hint">
        Dostępne = dzienna dostępność × dni robocze osoby. Filtry klienta i typu usługi
        zawężają godziny uwzględniane w podsumowaniu.
      </p>

      {/* Popover komórki: JEDNA instancja na stronę, kotwiczona przy klikniętej
          komórce przez wspólną powłokę nakładek (`useOverlay` — pozycja z
          flipem, stos Escape, zamknięcie kliknięciem poza, powrót fokusa).
          Wcześniej był to wiersz rozwijany pod osobą, który rozpychał tabelę i
          nie stał obok dnia, o który pytał. */}
      {selected !== null && detail !== null && selectedPerson !== undefined && (
        <OverlayLayer>
          <div
            className="wr-popover"
            style={overlay.style}
            role="dialog"
            aria-label={`Bloki: ${selectedPerson.name}, ${formatRowLabel(selected.date)}`}
            ref={popoverRef}
          >
            <div className="wr-head">
              <span className={detail.overbooked ? 'wr-title over' : 'wr-title'}>
                {selectedPerson.name} — {formatRowLabel(selected.date)}:{' '}
                {formatDuration(detail.bookedHours)} / {formatDuration(detail.availableHours)}
              </span>
              <button
                type="button"
                className="wr-close"
                aria-label="Zamknij"
                onClick={closePopover}
              >
                <X size={16} />
              </button>
            </div>
            {(clientFilter !== '' || serviceFilter !== '') && (
              <p className="wr-hint muted">
                Wszystkie bloki tego dnia, niezależnie od filtrów.
              </p>
            )}
            <ul className="wr-blocks">
              {detail.blocks.map((block) => (
                <BlockRow
                  key={block.entry.id}
                  state={state}
                  block={block}
                  personId={selected.personId}
                  date={selected.date}
                  canReassign={canReassign}
                  canMoveTask={canMoveTask}
                  onReassign={(entryId, toPersonId) =>
                    dispatch({ type: 'REASSIGN_ENTRY', entryId, toPersonId })
                  }
                  onOpenTask={openTask}
                  onMove={(taskId, dayDelta) =>
                    dispatch({ type: 'MOVE_TASK', taskId, dayDelta })
                  }
                />
              ))}
            </ul>
            <div className="wr-foot">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => openInCalendar(selected.personId, selected.date)}
              >
                <CalendarDays size={14} /> Otwórz w kalendarzu
              </button>
            </div>
          </div>
        </OverlayLayer>
      )}
    </section>
  );
}
