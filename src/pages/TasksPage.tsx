import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { useOpenTask } from '../components/TaskModal';
import {
  activeStatuses,
  assigneeIdsOfTask,
  assigneesOfTask,
  getClient,
  getPerson,
  getProject,
  getStatus,
  taskPlannedTotal,
} from '../store/selectors';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { FilterPanel, type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { ChevronRight } from '../components/icons';
import { formatShort } from '../utils/dates';
import { PersonChip } from '../components/PersonChip';
import { StatusBadge } from '../components/StatusBadge';
import { Coin } from '../components/Coin';
import { parseDate } from '../utils/dates';
import { formatDuration } from '../utils/time';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';

function rangeLabel(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return format(s, 'd MMM yyyy', { locale: pl });
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  if (sameMonth) return `${format(s, 'd')}–${format(e, 'd MMM yyyy', { locale: pl })}`;
  if (sameYear) return `${format(s, 'd MMM', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
  return `${format(s, 'd MMM yyyy', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
}

export function TasksPage() {
  const { state, dispatch } = useStore();
  const { openTask, openNewTask } = useOpenTask();
  const canManageTasks = useCan()('tasks.manage');
  const statuses = activeStatuses(state);

  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Sort by start date, then title, for a stable predictable list.
  // Memoized so the filtering useMemo below has a stable array dependency.
  const allTasks = useMemo(
    () =>
      [...state.tasks].sort((a, b) =>
        a.startDate === b.startDate
          ? a.title.localeCompare(b.title)
          : a.startDate.localeCompare(b.startDate),
      ),
    [state.tasks],
  );

  const tasks = useMemo(
    () =>
      allTasks.filter((t) => {
        if (statusFilter && t.statusId !== statusFilter) return false;
        if (clientFilter) {
          const clientId = getProject(state, t.projectId)?.clientId;
          if (clientId !== clientFilter) return false;
        }
        if (personFilter && !assigneeIdsOfTask(state, t.id).includes(personFilter)) return false;
        // Period-overlap on the task span: [startDate, endDate] vs [from, to].
        if (from && t.endDate < from) return false;
        if (to && t.startDate > to) return false;
        return true;
      }),
    [allTasks, state, clientFilter, statusFilter, personFilter, from, to],
  );

  const criteria = {
    ...DEFAULT_CRITERIA,
    clientId: clientFilter,
    statusId: statusFilter,
    personId: personFilter,
    from,
    to,
  };

  const applyPreset = (c: typeof criteria) => {
    setClientFilter(c.clientId);
    setStatusFilter(c.statusId);
    setPersonFilter(c.personId);
    setFrom(c.from);
    setTo(c.to);
  };

  const clearFilters = () => {
    setClientFilter('');
    setStatusFilter('');
    setPersonFilter('');
    setFrom('');
    setTo('');
  };

  const filterGroups: FilterGroup[] = [
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
      key: 'status',
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: '', label: 'Wszystkie statusy' },
        ...statuses.map((s) => ({ value: s.id, label: s.name })),
      ],
    },
    {
      key: 'person',
      label: 'Osoba',
      value: personFilter,
      onChange: setPersonFilter,
      options: [
        { value: '', label: 'Wszystkie osoby' },
        ...state.people.map((p) => ({ value: p.id, label: p.name })),
      ],
    },
  ];

  const activeCount =
    (clientFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (personFilter ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0);

  const chips: FilterChip[] = [];
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${getClient(state, clientFilter)?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (statusFilter)
    chips.push({
      key: 'status',
      label: `Status: ${getStatus(state, statusFilter)?.name ?? '—'}`,
      onRemove: () => setStatusFilter(''),
    });
  if (personFilter)
    chips.push({
      key: 'person',
      label: `Osoba: ${getPerson(state, personFilter)?.name ?? '—'}`,
      onRemove: () => setPersonFilter(''),
    });
  if (from) chips.push({ key: 'from', label: `Od: ${formatShort(from)}`, onRemove: () => setFrom('') });
  if (to) chips.push({ key: 'to', label: `Do: ${formatShort(to)}`, onRemove: () => setTo('') });

  const handleDelete = (taskId: string, title: string) => {
    if (window.confirm(`Usunąć „${title}”? To usunie przypisania i zaplanowane godziny.`)) {
      dispatch({ type: 'DELETE_TASK', taskId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zadania</h1>
        {canManageTasks && (
          <button type="button" className="btn primary" onClick={() => openNewTask()}>
            + Nowe zadanie
          </button>
        )}
      </div>

      {allTasks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak zadań</p>
          <p className="empty-hint">
            Utwórz zadanie, przypisz osoby i zaplanuj ich godziny dzień po dniu.
          </p>
          {canManageTasks && (
            <button type="button" className="btn primary" onClick={() => openNewTask()}>
              + Nowe zadanie
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="cal-toolbar">
            <FilterPanel
              groups={filterGroups}
              dates={{ from, to, onFrom: setFrom, onTo: setTo }}
              activeCount={activeCount}
              onClearAll={clearFilters}
              chips={chips}
            />
            <span className="filter-count muted">
              {tasks.length} z {allTasks.length} zadań
            </span>
          </div>

          <FilterPresets page="tasks" criteria={criteria} onApply={applyPreset} />

          {tasks.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">Brak pasujących zadań</p>
              <p className="empty-hint">Zmień lub wyczyść filtry, aby zobaczyć zadania.</p>
            </div>
          ) : (
            <ul className="task-list">
          {tasks.map((task) => {
            const assignees = assigneesOfTask(state, task.id);
            const planned = taskPlannedTotal(state, task.id);
            const project = getProject(state, task.projectId);
            const client = project ? getClient(state, project.clientId) : undefined;
            return (
              <li key={task.id} className="task-card">
                <button
                  type="button"
                  className="task-card-main"
                  onClick={() => openTask(task.id)}
                >
                  <div className="task-card-top">
                    <span className="task-title">{task.title}</span>
                    <StatusBadge status={getStatus(state, task.statusId)} />
                    {project && (
                      <span className="project-badge">
                        <Coin paid={project.paid} size={13} />
                        {client ? `${client.name} / ` : ''}
                        {project.name}
                      </span>
                    )}
                  </div>
                  <div className="task-card-range">{rangeLabel(task.startDate, task.endDate)}</div>
                  <div className="task-card-assignees">
                    {assignees.length === 0 ? (
                      <span className="muted">Brak przypisanych osób</span>
                    ) : (
                      assignees.map((p) => <PersonChip key={p.id} person={p} />)
                    )}
                  </div>
                  <div className="task-card-hours">
                    <strong>zaplanowano {formatDuration(planned)}</strong>
                    {task.estimatedHours != null && (
                      <span className="muted"> / szac. {formatDuration(task.estimatedHours)}</span>
                    )}
                  </div>
                  <ChevronRight className="card-chevron" size={16} aria-hidden />
                </button>
                {canManageTasks && (
                  <div className="card-actions">
                    <button
                      type="button"
                      className="btn danger-ghost task-delete"
                      onClick={() => handleDelete(task.id, task.title)}
                      aria-label={`Usuń ${task.title}`}
                      title="Usuń"
                    >
                      Usuń
                    </button>
                  </div>
                )}
              </li>
            );
          })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
