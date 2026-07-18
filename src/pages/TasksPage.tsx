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
  getWorkCategory,
  taskPlannedTotal,
  taskPlanningStatus,
  PLANNING_STATUSES,
  type PlanningStatus,
} from '../store/selectors';
import type { TaskPriority } from '../types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '../utils/priority';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { FilterPanel, type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { ChevronRight, Check } from '../components/icons';
import { formatShort } from '../utils/dates';
import { PersonChip } from '../components/PersonChip';
import { StatusBadge } from '../components/StatusBadge';
import { PlanningBadge } from '../components/PlanningBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { Coin } from '../components/Coin';
import { rangeLabel } from '../utils/dates';
import { formatDuration } from '../utils/time';

export function TasksPage() {
  const { state, dispatch } = useStore();
  const { openTask, openNewTask } = useOpenTask();
  const canManageTasks = useCan()('tasks.manage');
  const statuses = activeStatuses(state);

  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'' | TaskPriority>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  // Derived planning-status filter (single-select). Deliberately NOT part of
  // `criteria`/saved presets: presets are persisted (`SavedFilterCriteria`) and
  // this feature changes no stored shape. Consequence: presets ignore this
  // filter, and a planning-only selection does not enable "Zapisz filtr".
  const [planningFilter, setPlanningFilter] = useState<'' | PlanningStatus>('');
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
        if (planningFilter && taskPlanningStatus(state, t.id) !== planningFilter) return false;
        if (priorityFilter && t.priority !== priorityFilter) return false;
        if (categoryFilter && t.workCategoryId !== categoryFilter) return false;
        // Period-overlap on the task span: [startDate, endDate] vs [from, to].
        if (from && t.endDate < from) return false;
        if (to && t.startDate > to) return false;
        return true;
      }),
    [
      allTasks,
      state,
      clientFilter,
      statusFilter,
      personFilter,
      planningFilter,
      priorityFilter,
      categoryFilter,
      from,
      to,
    ],
  );

  const criteria = {
    ...DEFAULT_CRITERIA,
    clientId: clientFilter,
    statusId: statusFilter,
    personId: personFilter,
    priority: priorityFilter,
    workCategoryId: categoryFilter,
    from,
    to,
  };

  const applyPreset = (c: typeof criteria) => {
    setClientFilter(c.clientId);
    setStatusFilter(c.statusId);
    setPersonFilter(c.personId);
    setPriorityFilter(c.priority);
    setCategoryFilter(c.workCategoryId);
    setFrom(c.from);
    setTo(c.to);
  };

  const clearFilters = () => {
    setClientFilter('');
    setStatusFilter('');
    setPersonFilter('');
    setPlanningFilter('');
    setPriorityFilter('');
    setCategoryFilter('');
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
    {
      key: 'priority',
      label: 'Priorytet',
      value: priorityFilter,
      onChange: (v) => setPriorityFilter(v as '' | TaskPriority),
      options: [
        { value: '', label: 'Wszystkie' },
        ...TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
      ],
    },
    {
      key: 'category',
      label: 'Kategoria',
      value: categoryFilter,
      onChange: setCategoryFilter,
      options: [
        { value: '', label: 'Wszystkie' },
        ...state.workCategories.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'planning',
      label: 'Planowanie',
      value: planningFilter,
      onChange: (v) => setPlanningFilter(v as '' | PlanningStatus),
      options: [
        { value: '', label: 'Wszystkie' },
        ...PLANNING_STATUSES.map((s) => ({ value: s, label: s })),
      ],
    },
  ];

  const activeCount =
    (clientFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (personFilter ? 1 : 0) +
    (planningFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (categoryFilter ? 1 : 0) +
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
  if (planningFilter)
    chips.push({
      key: 'planning',
      label: `Planowanie: ${planningFilter}`,
      onRemove: () => setPlanningFilter(''),
    });
  if (priorityFilter)
    chips.push({
      key: 'priority',
      label: `Priorytet: ${PRIORITY_LABELS[priorityFilter]}`,
      onRemove: () => setPriorityFilter(''),
    });
  if (categoryFilter)
    chips.push({
      key: 'category',
      label: `Kategoria: ${getWorkCategory(state, categoryFilter)?.name ?? '—'}`,
      onRemove: () => setCategoryFilter(''),
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
          <div className="cal-toolbar" data-tour="tasks.filters">
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
            <ul className="task-list" data-tour="tasks.list">
          {tasks.map((task) => {
            const assignees = assigneesOfTask(state, task.id);
            const planned = taskPlannedTotal(state, task.id);
            const project = getProject(state, task.projectId);
            const client = project ? getClient(state, project.clientId) : undefined;
            const category = getWorkCategory(state, task.workCategoryId);
            const checklistDone = task.checklist.filter((c) => c.done).length;
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
                    <PlanningBadge status={taskPlanningStatus(state, task.id)} />
                    {task.priority !== 'normal' && <PriorityBadge priority={task.priority} />}
                    {category && <span className="muted task-category">{category.name}</span>}
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
                    {task.checklist.length > 0 && (
                      <span className="muted task-checklist-progress">
                        <Check size={13} aria-hidden /> {checklistDone}/{task.checklist.length}
                      </span>
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
