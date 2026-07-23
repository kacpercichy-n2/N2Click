// Project list grouped by client, with paid/unpaid coin markers, status badges,
// filters (client, status, paid/unpaid), and a create form.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { ProjectDraft } from '../store/AppStore';
import {
  activeStatuses,
  departmentsOfProject,
  getClient,
  getPerson,
  getServiceType,
  getStatus,
  peopleIdsOfProject,
  projectPlannedTotal,
  projectsOfPerson,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { FilterBar } from '../components/FilterBar';
import { useOpenTask } from '../components/TaskModal';
import { ChevronRight, GanttChart, Plus } from '../components/icons';
import { sortProjectGroups } from './projectSort';
import type { SavedFilterCriteria } from '../types';
import { addDaysStr, formatShort, formatShortWithWeekday, todayStr } from '../utils/dates';
import { periodError, PERIOD_ERROR_LABELS } from '../utils/dates';
import { formatDuration } from '../utils/time';

export type PaidFilter = 'all' | 'paid' | 'unpaid';

function rangeLabel(start: string, end: string): string {
  if (start === end) return formatShortWithWeekday(start);
  return `${formatShortWithWeekday(start)} – ${formatShortWithWeekday(end)}`;
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
  const can = useCan();
  const canManageProjects = can('projects.manage');
  const canManageTasks = can('tasks.manage');
  const [searchParams] = useSearchParams();
  const statuses = activeStatuses(state);

  // Stan filtrów jest ZAPAMIĘTANY w store (`lastFilters.projects`) — przetrwa
  // nawigację i przeładowanie. Każdy setter wysyła pełny snapshot przez
  // `SET_LAST_FILTER` (reduktor no-opuje zapis wartościowo identyczny).
  const rememberedProjects = state.lastFilters.projects;
  const projectsCriteria: SavedFilterCriteria = rememberedProjects?.criteria ?? DEFAULT_CRITERIA;
  const paidFilter = projectsCriteria.paid;
  const clientFilter = projectsCriteria.clientId;
  const personFilter = projectsCriteria.personId;
  const statusFilter = projectsCriteria.statusId;
  const from = projectsCriteria.from;
  const to = projectsCriteria.to;

  const commit = (nextCriteria: SavedFilterCriteria) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'projects',
      filter: {
        criteria: nextCriteria,
        personIds: [],
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });

  const setPaidFilter = (v: PaidFilter) => commit({ ...projectsCriteria, paid: v });
  const setClientFilter = (v: string) => commit({ ...projectsCriteria, clientId: v });
  const setPersonFilter = (v: string) => commit({ ...projectsCriteria, personId: v });
  const setStatusFilter = (v: string) => commit({ ...projectsCriteria, statusId: v });
  const setFrom = (v: string) => commit({ ...projectsCriteria, from: v });
  const setTo = (v: string) => commit({ ...projectsCriteria, to: v });

  // Deep-link: `?client=` (np. z globalnego wyszukiwania) WYGRYWA jako wartość
  // INICJALNA nad zapamiętanym filtrem — nadpisuje klienta, gdy param jest obecny
  // (mount i późniejsza nawigacja). Pozostałe filtry pozostają nietknięte.
  const clientParam = searchParams.get('client');
  useEffect(() => {
    if (clientParam && clientParam !== clientFilter) setClientFilter(clientParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientParam]);

  const [creating, setCreating] = useState(false);

  // ---- Create form state ----
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(addDaysStr(todayStr(), 13));
  const [error, setError] = useState('');

  // Client creation lives ONLY in the Klienci module — the form just picks one.
  const activeClients = state.clients.filter((c) => !c.archived);

  // Projekt pasuje do filtra „Osoba”, gdy osoba jest przypisana do KTÓREGOKOLWIEK
  // z jego zadań — reużywamy selektora `projectsOfPerson` (bez duplikowania logiki).
  const personProjectIds = useMemo(
    () => (personFilter ? new Set(projectsOfPerson(state, personFilter).map((p) => p.id)) : null),
    [state, personFilter],
  );

  const filtered = useMemo(
    () =>
      state.projects.filter(
        (p) =>
          (paidFilter === 'all' || p.paid === (paidFilter === 'paid')) &&
          (!clientFilter || p.clientId === clientFilter) &&
          (!personProjectIds || personProjectIds.has(p.id)) &&
          (!statusFilter || p.statusId === statusFilter) &&
          // Period overlap: [startDate, endDate] vs [from, to].
          (!from || p.endDate >= from) &&
          (!to || p.startDate <= to),
      ),
    [state.projects, paidFilter, clientFilter, personProjectIds, statusFilter, from, to],
  );

  const criteria: SavedFilterCriteria = projectsCriteria;

  const applyPreset = (c: SavedFilterCriteria) => commit(c);

  const paidLabel = (v: PaidFilter) =>
    v === 'paid' ? 'Opłacone' : v === 'unpaid' ? 'Nieopłacone' : 'Wszystkie';

  const filterGroups: FilterGroup[] = [
    {
      key: 'paid',
      label: 'Płatność',
      value: paidFilter,
      onChange: (v) => setPaidFilter(v as PaidFilter),
      options: [
        { value: 'all', label: 'Wszystkie' },
        { value: 'paid', label: 'Opłacone' },
        { value: 'unpaid', label: 'Nieopłacone' },
      ],
    },
    {
      key: 'client',
      label: 'Klient',
      value: clientFilter,
      onChange: setClientFilter,
      options: [
        { value: '', label: 'Wszyscy klienci' },
        ...state.clients.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'person',
      label: 'Osoba',
      value: personFilter,
      onChange: setPersonFilter,
      options: [
        { value: '', label: 'Wszyscy' },
        ...state.people.map((p) => ({ value: p.id, label: p.name })),
      ],
    },
    {
      key: 'status',
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: '', label: 'Wszystkie statusy' },
        ...statuses.map((s) => ({ value: s.id, label: s.name })),
      ],
    },
  ];

  const activeCount =
    (paidFilter !== 'all' ? 1 : 0) +
    (clientFilter ? 1 : 0) +
    (personFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0);

  const chips: FilterChip[] = [];
  if (paidFilter !== 'all')
    chips.push({ key: 'paid', label: `Płatność: ${paidLabel(paidFilter)}`, onRemove: () => setPaidFilter('all') });
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${getClient(state, clientFilter)?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (personFilter)
    chips.push({
      key: 'person',
      label: `Osoba: ${getPerson(state, personFilter)?.name ?? '—'}`,
      onRemove: () => setPersonFilter(''),
    });
  if (statusFilter)
    chips.push({
      key: 'status',
      label: `Status: ${getStatus(state, statusFilter)?.name ?? '—'}`,
      onRemove: () => setStatusFilter(''),
    });
  if (from) chips.push({ key: 'from', label: `Od: ${formatShort(from)}`, onRemove: () => setFrom('') });
  if (to) chips.push({ key: 'to', label: `Do: ${formatShort(to)}`, onRemove: () => setTo('') });

  // Group by client, then sort for presentation only: groups alphabetical by
  // client name, projects alphabetical within each group, „Bez klienta" last
  // (see `sortProjectGroups`). Store order and persistence stay untouched.
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
    return sortProjectGroups(out);
  }, [filtered, state.clients]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nazwa projektu jest wymagana');
      return;
    }
    const perErr = periodError(startDate, endDate);
    if (perErr) {
      setError(PERIOD_ERROR_LABELS[perErr]);
      return;
    }
    if (!clientId) {
      setError('Wybierz klienta');
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
    dispatch({ type: 'SAVE_PROJECT', projectId: null, draft });
    setName('');
    setError('');
    setCreating(false);
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Projekty</h1>
        {canManageProjects && (
          <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Zamknij' : '+ Nowy projekt'}
          </button>
        )}
      </div>

      {canManageProjects && creating && (
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
                <option value="">— wybierz klienta —</option>
                {activeClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {activeClients.length === 0 && (
                <p className="field-hint">
                  Najpierw dodaj klienta w zakładce <Link to="/clients">Klienci</Link>.
                </p>
              )}
            </div>
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
            Status, płatność, dział, typ usługi i opis edytujesz później na karcie
            projektu.
          </p>
        </form>
      )}

      <FilterBar
        dataTour="projects.filters"
        filterPanel={{
          groups: filterGroups,
          dates: { from, to, onFrom: setFrom, onTo: setTo },
          activeCount,
          onClearAll: () => applyPreset(DEFAULT_CRITERIA),
          chips,
        }}
        presets={<FilterPresets page="projects" criteria={criteria} onApply={applyPreset} />}
        trailing={
          <span className="filter-count muted">
            {filtered.length} z {state.projects.length}{' '}
            {polishCount(state.projects.length, 'projekt', 'projekty', 'projektów')}
          </span>
        }
      />

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
            <ul className="task-list" data-tour="projects.list">
              {g.projects.map((p) => {
                const tasks = tasksOfProject(state, p.id);
                const planned = projectPlannedTotal(state, p.id);
                const teamSize = peopleIdsOfProject(state, p.id).length;
                const svc = getServiceType(state, p.serviceTypeId);
                const departments = departmentsOfProject(state, p.id);
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
                        <span className="project-card-coin" data-tour="projects.coin">
                          <Coin paid={p.paid} />
                        </span>
                      </div>
                      <div className="task-card-range">
                        {rangeLabel(p.startDate, p.endDate)}
                        {svc && <span className="project-badge">{svc.name}</span>}
                        {departments.map((d) => (
                          <span key={d.id} className="project-badge project-badge-department">
                            {d.name}
                          </span>
                        ))}
                      </div>
                      <div className="task-card-hours">
                        <strong>{tasks.length}</strong>{' '}
                        {polishCount(tasks.length, 'zadanie', 'zadania', 'zadań')}
                        <span className="muted"> · zaplanowano {formatDuration(planned)}</span>
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
                      {canManageTasks && (
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
                      )}
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
