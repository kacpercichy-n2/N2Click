// Project list grouped by client, with paid/unpaid coin markers, status badges,
// filters (client, status, paid/unpaid), and a create form.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { ProjectDraft } from '../store/AppStore';
import {
  activeStatuses,
  getServiceType,
  getStatus,
  peopleIdsOfProject,
  projectPlannedTotal,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { addDaysStr, todayStr } from '../utils/dates';
import { parseDate } from '../utils/dates';
import { format } from 'date-fns';

export type PaidFilter = 'all' | 'paid' | 'unpaid';

export function PaidFilterToggle({
  value,
  onChange,
}: {
  value: PaidFilter;
  onChange: (v: PaidFilter) => void;
}) {
  const opts: Array<[PaidFilter, string]> = [
    ['all', 'All'],
    ['paid', 'Paid'],
    ['unpaid', 'Unpaid'],
  ];
  return (
    <div className="cal-view-toggle" role="group" aria-label="Paid filter">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={value === v ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function rangeLabel(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return format(s, 'd MMM yyyy');
  const sameYear = s.getFullYear() === e.getFullYear();
  if (sameYear && s.getMonth() === e.getMonth())
    return `${format(s, 'd')}–${format(e, 'd MMM yyyy')}`;
  if (sameYear) return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
  return `${format(s, 'd MMM yyyy')} – ${format(e, 'd MMM yyyy')}`;
}

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function ProjectsPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const statuses = activeStatuses(state);

  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);

  // ---- Create form state ----
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(addDaysStr(todayStr(), 13));
  const [error, setError] = useState('');

  const filtered = useMemo(
    () =>
      state.projects.filter(
        (p) =>
          (paidFilter === 'all' || p.paid === (paidFilter === 'paid')) &&
          (!clientFilter || p.clientId === clientFilter) &&
          (!statusFilter || p.statusId === statusFilter),
      ),
    [state.projects, paidFilter, clientFilter, statusFilter],
  );

  // Group by client (clients in list order, then any orphaned projects).
  const groups = useMemo(() => {
    const out: Array<{ clientId: string; clientName: string; projects: typeof filtered }> = [];
    for (const c of state.clients) {
      const own = filtered.filter((p) => p.clientId === c.id);
      if (own.length > 0) out.push({ clientId: c.id, clientName: c.name, projects: own });
    }
    const known = new Set(state.clients.map((c) => c.id));
    const orphans = filtered.filter((p) => !known.has(p.clientId));
    if (orphans.length > 0)
      out.push({ clientId: '', clientName: 'No client', projects: orphans });
    return out;
  }, [filtered, state.clients]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date');
      return;
    }
    if (!clientId && !newClientName.trim()) {
      setError('Pick a client or type a new client name');
      return;
    }
    const draft: ProjectDraft = {
      clientId,
      name: trimmed,
      description: '',
      statusId: statuses[0]?.id ?? state.statuses[0]?.id ?? '',
      paid: false,
      startDate,
      endDate,
      departmentId: '',
      serviceTypeId: '',
    };
    dispatch({
      type: 'SAVE_PROJECT',
      projectId: null,
      draft,
      newClientName: clientId ? undefined : newClientName,
    });
    setName('');
    setNewClientName('');
    setError('');
    setCreating(false);
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Close' : '+ New project'}
        </button>
      </div>

      {creating && (
        <form className="project-create" onSubmit={submit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pr-name">Project name *</label>
              <input
                id="pr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Website redesign"
              />
            </div>
            <div className="field">
              <label htmlFor="pr-client">Client *</label>
              <select
                id="pr-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">— new client —</option>
                {state.clients
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            {clientId === '' && (
              <div className="field">
                <label htmlFor="pr-new-client">New client name</label>
                <input
                  id="pr-new-client"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. Acme Foods"
                />
              </div>
            )}
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pr-start">Start date</label>
              <input
                id="pr-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pr-end">End date</label>
              <input
                id="pr-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="editor-actions">
            <button type="submit" className="btn primary">
              Create project
            </button>
          </div>
          <p className="field-hint">
            Status, paid state, department, service type, milestones, and description
            are edited on the project card after creating.
          </p>
        </form>
      )}

      <div className="cal-toolbar">
        <PaidFilterToggle value={paidFilter} onChange={setPaidFilter} />
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No projects</p>
          <p className="empty-hint">
            Create a project under a client, then add tasks and plan hours.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.clientId || 'none'} className="client-group">
            <h2 className="client-group-name">{g.clientName}</h2>
            <ul className="task-list">
              {g.projects.map((p) => {
                const tasks = tasksOfProject(state, p.id);
                const planned = projectPlannedTotal(state, p.id);
                const teamSize = peopleIdsOfProject(state, p.id).length;
                const svc = getServiceType(state, p.serviceTypeId);
                return (
                  <li key={p.id} className="task-card project-card">
                    <button
                      type="button"
                      className="task-card-main"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <div className="task-card-top">
                        <span className="task-title">{p.name}</span>
                        <StatusBadge status={getStatus(state, p.statusId)} />
                        <span className="project-card-coin">
                          <Coin paid={p.paid} />
                        </span>
                      </div>
                      <div className="task-card-range">
                        {rangeLabel(p.startDate, p.endDate)}
                        {svc && <span className="project-badge">{svc.name}</span>}
                      </div>
                      <div className="task-card-hours">
                        <strong>{tasks.length}</strong> task{tasks.length === 1 ? '' : 's'}
                        <span className="muted"> · {fmtHours(planned)}h planned</span>
                        <span className="muted">
                          {' '}
                          · {teamSize} {teamSize === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {state.clients.length === 0 && state.projects.length === 0 && (
        <p className="field-hint">
          Tip: clients and other structure can also be managed in{' '}
          <Link to="/admin">Admin</Link>.
        </p>
      )}
    </section>
  );
}
