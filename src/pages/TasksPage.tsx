import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { useOpenTask } from '../components/TaskModal';
import {
  activeStatuses,
  assigneeIdsOfTask,
  assigneesOfTask,
  getClient,
  getProject,
  getStatus,
  taskPlannedTotal,
} from '../store/selectors';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { ChevronRight } from '../components/icons';
import { PersonChip } from '../components/PersonChip';
import { StatusBadge } from '../components/StatusBadge';
import { Coin } from '../components/Coin';
import { parseDate } from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

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

  const anyFilter =
    clientFilter !== '' ||
    statusFilter !== '' ||
    personFilter !== '' ||
    from !== '' ||
    to !== '';

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

  const handleDelete = (taskId: string, title: string) => {
    if (window.confirm(`Usunąć „${title}”? To usunie przypisania i zaplanowane godziny.`)) {
      dispatch({ type: 'DELETE_TASK', taskId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zadania</h1>
        <button type="button" className="btn primary" onClick={() => openNewTask()}>
          + Nowe zadanie
        </button>
      </div>

      {allTasks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak zadań</p>
          <p className="empty-hint">
            Utwórz zadanie, przypisz osoby i zaplanuj ich godziny dzień po dniu.
          </p>
          <button type="button" className="btn primary" onClick={() => openNewTask()}>
            + Nowe zadanie
          </button>
        </div>
      ) : (
        <>
          <div className="cal-toolbar">
            <div className="filter-controls">
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
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                aria-label="Filtruj po osobie"
              >
                <option value="">Wszystkie osoby</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
              {anyFilter && (
                <button type="button" className="btn ghost small" onClick={clearFilters}>
                  Wyczyść filtry
                </button>
              )}
            </div>
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
                    <strong>zaplanowano {fmtHours(planned)}h</strong>
                    {task.estimatedHours != null && (
                      <span className="muted"> / szac. {fmtHours(task.estimatedHours)}h</span>
                    )}
                  </div>
                  <ChevronRight className="card-chevron" size={16} aria-hidden />
                </button>
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
