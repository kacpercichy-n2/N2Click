// Workload dashboard: per-person assigned vs available hours for a week, with
// per-day breakdown, overload warnings, and filters by department / client /
// service type.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { WorkloadEntry } from '../types';
import {
  getDepartment,
  personCapacity,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
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

export function WorkloadPage() {
  const { state } = useStore();
  const [anchor, setAnchor] = useState(() => todayStr());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  const days = weekDays(anchor);
  const daySet = new Set(days);

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
        <h1>Workload</h1>
        <div className="cal-nav">
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, -1))}
            aria-label="Previous week"
          >
            ‹
          </button>
          <button type="button" className="btn ghost" onClick={() => setAnchor(todayStr())}>
            Today
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, 1))}
            aria-label="Next week"
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
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {state.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          aria-label="Filter by client"
        >
          <option value="">All clients</option>
          {state.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          aria-label="Filter by service type"
        >
          <option value="">All service types</option>
          {state.serviceTypes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {people.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No people</p>
          <p className="empty-hint">
            Add team members on the <Link to="/people">People</Link> page.
          </p>
        </div>
      ) : (
        <div className="alloc-wrap">
          <table className="alloc-grid workload-table">
            <thead>
              <tr>
                <th className="alloc-day-col">Person</th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={isWeekend(d) ? 'workload-day weekend' : 'workload-day'}
                  >
                    {formatRowLabel(d)}
                  </th>
                ))}
                <th>Assigned</th>
                <th>Available</th>
                <th>Load</th>
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
                    </th>
                    {days.map((d) => {
                      const h = hoursFor(p.id, d);
                      const over = h > capacity;
                      return (
                        <td
                          key={d}
                          className={[
                            'workload-cell',
                            isWeekend(d) ? 'weekend' : '',
                            over ? 'overload' : '',
                            h === 0 ? 'free' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={over ? `${p.name}: ${fmtHours(h)}h > ${capacity}h capacity` : undefined}
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
                        aria-label={`${pct}% of available hours`}
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
                          title={`Over capacity on: ${overloadedDays.map(formatRowLabel).join(', ')}`}
                        >
                          ⚠ {overloadedDays.length} day{overloadedDays.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-hint">
        Available = daily capacity × {workdays.length} workdays. Filters by client and
        service type narrow which planned hours are counted.
      </p>
    </section>
  );
}
