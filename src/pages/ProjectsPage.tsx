// Project list grouped by client, with paid/unpaid coin markers, status badges,
// filters (client, status, paid/unpaid), and a create form.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { useOpenTask } from '../components/TaskModal';
import { ChevronRight, GanttChart, Plus } from '../components/icons';
import type { SavedFilterCriteria } from '../types';
import { addDaysStr, todayStr } from '../utils/dates';
import { parseDate } from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';

export type PaidFilter = 'all' | 'paid' | 'unpaid';

export function PaidFilterToggle({
  value,
  onChange,
}: {
  value: PaidFilter;
  onChange: (v: PaidFilter) => void;
}) {
  const opts: Array<[PaidFilter, string]> = [
    ['all', 'Wszystkie'],
    ['paid', 'Opłacone'],
    ['unpaid', 'Nieopłacone'],
  ];
  return (
    <div className="cal-view-toggle" role="group" aria-label="Filtr płatności">
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
  if (start === end) return format(s, 'd MMM yyyy', { locale: pl });
  const sameYear = s.getFullYear() === e.getFullYear();
  if (sameYear && s.getMonth() === e.getMonth())
    return `${format(s, 'd')}–${format(e, 'd MMM yyyy', { locale: pl })}`;
  if (sameYear) return `${format(s, 'd MMM', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
  return `${format(s, 'd MMM yyyy', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
}

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

export function ProjectsPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { openNewTask } = useOpenTask();
  const [searchParams] = useSearchParams();
  const statuses = activeStatuses(state);

  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  // Deep-link: a `?client=` param (e.g. from global search) pre-filters the list.
  const [clientFilter, setClientFilter] = useState(() => searchParams.get('client') ?? '');

  // Keep the filter in sync when the param changes (e.g. picking a client in
  // global search while already on /projects, or back/forward navigation).
  // Only override when the param is present so normal in-page filtering stands.
  const clientParam = searchParams.get('client');
  useEffect(() => {
    if (clientParam) setClientFilter(clientParam);
  }, [clientParam]);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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
          (!statusFilter || p.statusId === statusFilter) &&
          // Period overlap: [startDate, endDate] vs [from, to].
          (!from || p.endDate >= from) &&
          (!to || p.startDate <= to),
      ),
    [state.projects, paidFilter, clientFilter, statusFilter, from, to],
  );

  const criteria: SavedFilterCriteria = {
    ...DEFAULT_CRITERIA,
    paid: paidFilter,
    clientId: clientFilter,
    statusId: statusFilter,
    from,
    to,
  };

  const applyPreset = (c: SavedFilterCriteria) => {
    setPaidFilter(c.paid);
    setClientFilter(c.clientId);
    setStatusFilter(c.statusId);
    setFrom(c.from);
    setTo(c.to);
  };

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
      out.push({ clientId: '', clientName: 'Bez klienta', projects: orphans });
    return out;
  }, [filtered, state.clients]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nazwa projektu jest wymagana');
      return;
    }
    if (endDate < startDate) {
      setError('Data końca musi być taka sama jak data startu albo późniejsza');
      return;
    }
    if (!clientId && !newClientName.trim()) {
      setError('Wybierz klienta albo wpisz nazwę nowego klienta');
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
        <h1>Projekty</h1>
        <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Zamknij' : '+ Nowy projekt'}
        </button>
      </div>

      {creating && (
        <form className="project-create" onSubmit={submit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pr-name">Nazwa projektu *</label>
              <input
                id="pr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="np. Redesign strony"
              />
            </div>
            <div className="field">
              <label htmlFor="pr-client">Klient *</label>
              <select
                id="pr-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">— nowy klient —</option>
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
                <label htmlFor="pr-new-client">Nazwa nowego klienta</label>
                <input
                  id="pr-new-client"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="np. Acme Foods"
                />
              </div>
            )}
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pr-start">Data startu</label>
              <input
                id="pr-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pr-end">Data końca</label>
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
              Utwórz projekt
            </button>
          </div>
          <p className="field-hint">
            Status, płatność, dział, typ usługi, kamienie milowe i opis edytujesz
            później na karcie projektu.
          </p>
        </form>
      )}

      <div className="cal-toolbar">
        <PaidFilterToggle value={paidFilter} onChange={setPaidFilter} />
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtruj po statusie"
        >
          <option value="">Wszystkie statusy</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Filtruj od daty"
          title="Od"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Filtruj do daty"
          title="Do"
        />
      </div>

      <FilterPresets page="projects" criteria={criteria} onApply={applyPreset} />

      {groups.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak projektów</p>
          <p className="empty-hint">
            Dodaj projekt pod klientem, a potem utwórz zadania i zaplanuj godziny.
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
                        <strong>{tasks.length}</strong>{' '}
                        {polishCount(tasks.length, 'zadanie', 'zadania', 'zadań')}
                        <span className="muted"> · zaplanowano {fmtHours(planned)}h</span>
                        <span className="muted">
                          {' '}
                          · {teamSize} {polishCount(teamSize, 'osoba', 'osoby', 'osób')}
                        </span>
                      </div>
                      <ChevronRight className="card-chevron" size={16} aria-hidden />
                    </button>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="card-action-btn"
                        title="Oś czasu"
                        aria-label="Otwórz oś czasu"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/timeline');
                        }}
                      >
                        <GanttChart size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="card-action-btn"
                        title="+ Zadanie"
                        aria-label={`Dodaj zadanie do ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openNewTask(p.id);
                        }}
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {state.clients.length === 0 && state.projects.length === 0 && (
        <p className="field-hint">
          Wskazówka: klientami i pozostałą strukturą możesz też zarządzać w panelu{' '}
          <Link to="/admin">Administracja</Link>.
        </p>
      )}
    </section>
  );
}
