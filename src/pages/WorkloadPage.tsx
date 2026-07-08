// Workload dashboard: per-person assigned vs available hours for a week, with
// per-day breakdown, overload warnings, and filters by department / client /
// service type.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { AppData } from '../types';
import type { WorkloadEntry } from '../types';
import {
  blocksForPersonDate,
  getClient,
  getDepartment,
  getProject,
  getTask,
  hoursForPersonOnDate,
  personCapacity,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { useOpenTask } from '../components/TaskModal';
import { ArrowRightLeft, ChevronLeft, ChevronRight, X } from '../components/icons';
import {
  formatRowLabel,
  isWeekend,
  shiftWeek,
  todayStr,
  weekDays,
  weekRangeLabel,
} from '../utils/dates';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Actions for one block inside the resolution panel. */
function BlockRow({
  state,
  entry,
  personId,
  date,
  onReassign,
  onOpenTask,
  onMove,
}: {
  state: AppData;
  entry: WorkloadEntry;
  personId: string;
  date: string;
  onReassign: (entryId: string, toPersonId: string) => void;
  onOpenTask: (taskId: string) => void;
  onMove: (taskId: string, dayDelta: number) => void;
}) {
  const task = getTask(state, entry.taskId);
  const project = task ? getProject(state, task.projectId) : undefined;
  const client = project ? getClient(state, project.clientId) : undefined;
  const others = state.people.filter((p) => p.id !== personId);
  const [target, setTarget] = useState(() => others[0]?.id ?? '');

  return (
    <li className="wr-block">
      <div className="wr-block-info">
        <span className="wr-block-task">{task?.title ?? 'Zadanie'}</span>
        <span className="wr-block-project muted">
          {project?.name ?? '—'}
          {client ? ` · ${client.name}` : ''}
        </span>
      </div>
      <span className="wr-block-hours">{fmtHours(entry.plannedHours)}h</span>
      <div className="wr-block-actions">
        {others.length > 0 && (
          <div className="wr-reassign">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Przypisz do osoby"
            >
              {others.map((p) => {
                const cap = personCapacity(state, p.id);
                const cur = hoursForPersonOnDate(state, p.id, date);
                const over = cur + entry.plannedHours > cap;
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmtHours(cur)}h/{cap}h tego dnia{over ? ' ⚠' : ''}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => target && onReassign(entry.id, target)}
            >
              <ArrowRightLeft size={14} /> Przenieś
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onOpenTask(entry.taskId)}
        >
          Otwórz zadanie
        </button>
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
      </div>
    </li>
  );
}

export function WorkloadPage() {
  const { state, dispatch } = useStore();
  const { openTask } = useOpenTask();
  const [anchor, setAnchor] = useState(() => todayStr());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [selected, setSelected] = useState<{ personId: string; date: string } | null>(
    null,
  );

  const days = weekDays(anchor);
  const daySet = new Set(days);

  // Close the panel once the selected person/day has no blocks left (e.g. after
  // reassigning the last one or shifting the task off this day).
  const selectedBlocks = selected
    ? blocksForPersonDate(state, selected.personId, selected.date)
    : [];
  useEffect(() => {
    if (selected && selectedBlocks.length === 0) setSelected(null);
  }, [selected, selectedBlocks.length]);

  const toggleCell = (personId: string, date: string) => {
    setSelected((cur) =>
      cur && cur.personId === personId && cur.date === date ? null : { personId, date },
    );
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

  // hours[personId][date] for this week, under the current filters.
  const weekEntries = state.workload.filter((w) => daySet.has(w.date) && entryPasses(w));
  const hoursFor = (personId: string, date: string) =>
    weekEntries
      .filter((w) => w.personId === personId && w.date === date)
      .reduce((s, w) => s + w.plannedHours, 0);

  const workdays = days.filter((d) => !isWeekend(d));

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
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          aria-label="Filtruj po dziale"
        >
          <option value="">Wszystkie działy</option>
          {state.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          aria-label="Filtruj po kliencie"
        >
          <option value="">Wszyscy klienci</option>
          {state.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          aria-label="Filtruj po typie usługi"
        >
          <option value="">Wszystkie typy usług</option>
          {state.serviceTypes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak osób</p>
          <p className="empty-hint">
            Dodaj członków zespołu na stronie <Link to="/people">Zespół</Link>.
          </p>
        </div>
      ) : (
        <div className="alloc-wrap">
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
                const capacity = personCapacity(state, p.id);
                const assigned = days.reduce((s, d) => s + hoursFor(p.id, d), 0);
                const available = workdays.length * capacity;
                const pct = available > 0 ? Math.round((assigned / available) * 100) : 0;
                const overloadedDays = days.filter((d) => hoursFor(p.id, d) > capacity);
                return (
                  <Fragment key={p.id}>
                  <tr>
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
                    </th>
                    {days.map((d) => {
                      const h = hoursFor(p.id, d);
                      const over = h > capacity;
                      const clickable = h > 0;
                      const isSel =
                        selected?.personId === p.id && selected?.date === d;
                      return (
                        <td
                          key={d}
                          className={[
                            'workload-cell',
                            isWeekend(d) ? 'weekend' : '',
                            over ? 'overload' : '',
                            h === 0 ? 'free' : '',
                            clickable ? 'clickable' : '',
                            isSel ? 'selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={over ? `${p.name}: ${fmtHours(h)}h > ${capacity}h dostępności` : undefined}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-expanded={clickable ? isSel : undefined}
                          onClick={clickable ? () => toggleCell(p.id, d) : undefined}
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleCell(p.id, d);
                                  }
                                }
                              : undefined
                          }
                        >
                          {h === 0 ? '—' : `${fmtHours(h)}h`}
                          {over && ' ⚠'}
                        </td>
                      );
                    })}
                    <td className="workload-sum">{fmtHours(assigned)}h</td>
                    <td className="workload-sum muted">{fmtHours(available)}h</td>
                    <td className="workload-load">
                      <div
                        className="load-bar"
                        role="img"
                        aria-label={`${pct}% dostępnych godzin`}
                      >
                        <div
                          className={pct > 100 ? 'load-bar-fill over' : 'load-bar-fill'}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className={pct > 100 ? 'load-pct over' : 'load-pct'}>
                        {pct}%
                      </span>
                      {overloadedDays.length > 0 && (
                        <span
                          className="workload-warn"
                          title={`Powyżej dostępności: ${overloadedDays.map(formatRowLabel).join(', ')}`}
                        >
                          ⚠ {overloadedDays.length} {overloadedDays.length === 1 ? 'dzień' : 'dni'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {selected && selected.personId === p.id && (() => {
                    const date = selected.date;
                    const blocks = blocksForPersonDate(state, p.id, date);
                    const dayTotal = hoursForPersonOnDate(state, p.id, date);
                    const over = dayTotal > capacity;
                    const filtersActive = Boolean(clientFilter || serviceFilter);
                    return (
                      <tr className="workload-detail-row">
                        <td colSpan={days.length + 4}>
                          <div className="wr-panel">
                            <div className="wr-head">
                              <span
                                className={over ? 'wr-title over' : 'wr-title'}
                              >
                                „{p.name} — {formatRowLabel(date)}: {fmtHours(dayTotal)}h
                                {' / '}
                                {capacity}h”
                              </span>
                              <button
                                type="button"
                                className="wr-close"
                                aria-label="Zamknij"
                                onClick={() => setSelected(null)}
                              >
                                <X size={16} />
                              </button>
                            </div>
                            {filtersActive && (
                              <p className="wr-hint muted">
                                Wszystkie bloki tego dnia, niezależnie od filtrów.
                              </p>
                            )}
                            <ul className="wr-blocks">
                              {blocks.map((entry) => (
                                <BlockRow
                                  key={entry.id}
                                  state={state}
                                  entry={entry}
                                  personId={p.id}
                                  date={date}
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
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-hint">
        Dostępne = dzienna dostępność × {workdays.length} dni roboczych. Filtry klienta i
        typu usługi zawężają godziny uwzględniane w podsumowaniu.
      </p>
    </section>
  );
}
