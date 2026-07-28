import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { SavedFilterCriteria, TaskPriority } from '../types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '../utils/priority';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { FilterBar } from '../components/FilterBar';
import { ChevronRight, MoreHorizontal, Plus, X } from '../components/icons';
import { IconButton } from '../components/IconButton';
import { useConfirm } from '../components/ConfirmProvider';
import { buildDeleteConsequence } from '../components/confirmDialog';
import { formatShort, formatShortWithWeekday } from '../utils/dates';
import { PersonChip } from '../components/PersonChip';
import { Avatar } from '../components/Avatar';
import { OverlayLayer, useOverlay } from '../components/useOverlay';
import { MOBILE_NAV_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { visibleAssignees } from './taskCardMobile';
import { StatusBadge } from '../components/StatusBadge';
import { PlanningProgress } from '../components/PlanningProgress';
import { PriorityBadge } from '../components/PriorityBadge';
import { Coin } from '../components/Coin';
import { clientProjectPath } from '../utils/entityPath';
import { checklistGlyphs } from '../utils/checklistGlyphs';
import { formatDuration } from '../utils/time';

function rangeLabel(start: string, end: string): string {
  if (start === end) return formatShortWithWeekday(start);
  return `${formatShortWithWeekday(start)} – ${formatShortWithWeekday(end)}`;
}

export function TasksPage() {
  const { state, dispatch } = useStore();
  const { openTask, openNewTask } = useOpenTask();
  const canManageTasks = useCan()('tasks.manage');
  const confirm = useConfirm();
  const statuses = activeStatuses(state);
  // Telefon (≤760 px): karta zadania ma TRZY rzędy, a pigułki, które się na niej
  // nie mieszczą, przenoszą się do arkusza szczegółów. Ten sam hook i ten sam
  // breakpoint, co powłoka aplikacji i kalendarz.
  const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const detailsSheetRef = useRef<HTMLDivElement | null>(null);
  // Wyzwalacz jest PER KARTA, a arkusz JEDEN na stronę — ref pokazuje na
  // przycisk aktualnie wybranej karty (zapisywany w callbacku ref tylko przez
  // tę kartę), więc powłoka ma dokąd wrócić z fokusem po zamknięciu.
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Zadanie mogło zniknąć (usunięcie) — wtedy `undefined` zamyka arkusz przez
  // powłokę zamiast zostawiać pustą warstwę.
  const detailsTask =
    detailsTaskId === null ? undefined : state.tasks.find((t) => t.id === detailsTaskId);
  const closeDetails = useCallback(() => setDetailsTaskId(null), []);
  // Ten sam wariant powłoki co arkusz „Więcej” i szybki skok kalendarza: bez
  // `getAnchorRect` (arkusz kotwiczy CSS przy dolnej krawędzi), ze stosem
  // Escape, zamykaniem kliknięciem poza i powrotem fokusa na wyzwalacz.
  useOverlay({
    open: isMobileNav && detailsTask !== undefined,
    onClose: closeDetails,
    overlayRef: detailsSheetRef,
    triggerRef: detailsTriggerRef,
  });
  // Przejście na desktop kasuje wybór — inaczej powrót do szerokości telefonu
  // otworzyłby arkusz sam z siebie.
  useEffect(() => {
    if (!isMobileNav) setDetailsTaskId(null);
  }, [isMobileNav]);

  // Stan filtrów jest ZAPAMIĘTANY w store (`lastFilters.tasks`) — przetrwa
  // nawigację i przeładowanie. Każdy setter wysyła pełny, znormalizowany snapshot
  // przez `SET_LAST_FILTER` (reduktor no-opuje zapis wartościowo identyczny).
  const remembered = state.lastFilters.tasks;
  const criteria: SavedFilterCriteria = remembered?.criteria ?? DEFAULT_CRITERIA;
  const clientFilter = criteria.clientId;
  const projectFilter = criteria.projectId;
  const statusFilter = criteria.statusId;
  const personFilter = criteria.personId;
  const priorityFilter = criteria.priority;
  const categoryFilter = criteria.workCategoryId;
  const from = criteria.from;
  const to = criteria.to;
  // Filtr planowania (single-select). NIE jest częścią `criteria`/presetów, ale
  // JEST zapamiętywany obok nich w `lastFilters.tasks.planning`.
  const planningFilter = (remembered?.planning ?? '') as '' | PlanningStatus;

  const commit = (nextCriteria: SavedFilterCriteria, nextPlanning: '' | PlanningStatus) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'tasks',
      filter: {
        criteria: nextCriteria,
        personIds: [],
        departmentId: '',
        serviceTypeId: '',
        planning: nextPlanning,
      },
    });

  const setClientFilter = (v: string) => commit({ ...criteria, clientId: v }, planningFilter);
  const setProjectFilter = (v: string) => commit({ ...criteria, projectId: v }, planningFilter);
  const setStatusFilter = (v: string) => commit({ ...criteria, statusId: v }, planningFilter);
  const setPersonFilter = (v: string) => commit({ ...criteria, personId: v }, planningFilter);
  const setPriorityFilter = (v: '' | TaskPriority) =>
    commit({ ...criteria, priority: v }, planningFilter);
  const setCategoryFilter = (v: string) => commit({ ...criteria, workCategoryId: v }, planningFilter);
  const setFrom = (v: string) => commit({ ...criteria, from: v }, planningFilter);
  const setTo = (v: string) => commit({ ...criteria, to: v }, planningFilter);
  const setPlanningFilter = (v: '' | PlanningStatus) => commit(criteria, v);

  // Sort by start date, then title, for a stable predictable list.
  // Memoized so the filtering useMemo below has a stable array dependency.
  const allTasks = useMemo(
    () =>
      // Szkice zadań są widoczne wyłącznie w widoku projektu — lista „Zadania”
      // (widok planowania międzyprojektowy) pokazuje tylko opublikowane.
      [...state.tasks]
        .filter((t) => t.isDraft !== true)
        .sort((a, b) =>
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
        if (projectFilter && t.projectId !== projectFilter) return false;
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
      projectFilter,
      statusFilter,
      personFilter,
      planningFilter,
      priorityFilter,
      categoryFilter,
      from,
      to,
    ],
  );

  // Projekty do wyboru w filtrze „Projekt”, posortowane po nazwie.
  const sortedProjects = useMemo(
    () => [...state.projects].sort((a, b) => a.name.localeCompare(b.name)),
    [state.projects],
  );

  const applyPreset = (c: SavedFilterCriteria) => commit(c, planningFilter);

  const clearFilters = () => commit(DEFAULT_CRITERIA, '');

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
      key: 'project',
      label: 'Projekt',
      value: projectFilter,
      onChange: setProjectFilter,
      options: [
        { value: '', label: 'Wszystkie' },
        ...sortedProjects.map((p) => ({ value: p.id, label: p.name })),
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
    (projectFilter ? 1 : 0) +
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
  if (projectFilter)
    chips.push({
      key: 'project',
      label: `Projekt: ${getProject(state, projectFilter)?.name ?? '—'}`,
      onRemove: () => setProjectFilter(''),
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

  const handleDelete = async (taskId: string, title: string) => {
    // Zamiast ogólnikowego „to usunie przypisania i godziny” podajemy PRAWDZIWE
    // liczby z istniejących selektorów. Sumy godzin są derywowane z
    // `WorkloadEntry` (inwariant 1) — nic nie jest przechowywane osobno.
    const consequences = buildDeleteConsequence({
      assignments: assigneeIdsOfTask(state, taskId).length,
      plannedHours: taskPlannedTotal(state, taskId),
    });
    if (
      await confirm({
        title: `Usunąć „${title}”?`,
        consequences,
        confirmLabel: 'Usuń zadanie',
        tone: 'danger',
        // Świadome potwierdzenie tylko wtedy, gdy naprawdę coś ginie.
        requireAck: consequences !== '',
      })
    ) {
      dispatch({ type: 'DELETE_TASK', taskId });
    }
  };

  // Treść arkusza szczegółów — te same selektory, co karta desktopowa, tylko
  // policzone raz dla WYBRANEGO zadania (arkusz jest jeden na stronę).
  const detailsProject = detailsTask ? getProject(state, detailsTask.projectId) : undefined;
  const detailsClient = detailsProject ? getClient(state, detailsProject.clientId) : undefined;
  const detailsCategory = detailsTask
    ? getWorkCategory(state, detailsTask.workCategoryId)
    : undefined;
  const detailsPlanned = detailsTask ? taskPlannedTotal(state, detailsTask.id) : 0;

  const openFromDetails = (taskId: string) => {
    setDetailsTaskId(null);
    openTask(taskId);
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zadania</h1>
        {canManageTasks && (
          <button type="button" className="btn primary" onClick={() => openNewTask()}>
            <Plus size={16} aria-hidden />Nowe zadanie
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
              <Plus size={16} aria-hidden />Nowe zadanie
            </button>
          )}
        </div>
      ) : (
        <>
          <FilterBar
            dataTour="tasks.filters"
            filterPanel={{
              groups: filterGroups,
              dates: { from, to, onFrom: setFrom, onTo: setTo },
              activeCount,
              onClearAll: clearFilters,
              chips,
              // Ta sama liczba, co w liczniku obok paska — na telefonie pokazuje
              // ją przycisk „Pokaż N” w lepkiej stopce arkusza filtrów.
              resultCount: tasks.length,
            }}
            presets={<FilterPresets page="tasks" criteria={criteria} onApply={applyPreset} />}
            trailing={
              <span className="filter-count muted">
                {tasks.length} z {allTasks.length} zadań
              </span>
            }
          />

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
            const checklist = checklistGlyphs(
              task.checklist.filter((c) => c.done).length,
              task.checklist.length,
            );
            // Priorytet nie jest już pigułką w wierszu (SY-03): akcent niesie
            // pasek 3 px przy lewej krawędzi karty (`data-priority` + `::before`
            // na `.task-card`), a etykietę tekstową — `.sr-only` w treści karty.
            // Atrybut ustawiamy zawsze; CSS maluje WYŁĄCZNIE `high` i `urgent`.
            if (isMobileNav) {
              // Telefonowa karta: tytuł (max 2 wiersze) → ścieżka projektu →
              // rząd metadanych. Pigułki (status, planowanie, priorytet,
              // kategoria, plakietka projektu, zakres, lista kontrolna) żyją w
              // arkuszu szczegółów — to one rozpychały kartę do 4 wierszy.
              const status = getStatus(state, task.statusId);
              const avatars = visibleAssignees(assignees);
              return (
                <li key={task.id} className="task-card" data-priority={task.priority}>
                  <button
                    type="button"
                    className="task-card-main task-card-m-main"
                    onClick={() => openTask(task.id)}
                  >
                    <span className="task-card-m-title">{task.title}</span>
                    {task.priority !== 'normal' && (
                      <span className="sr-only">Priorytet: {PRIORITY_LABELS[task.priority]}</span>
                    )}
                    {/* `.task-card-m-project` to skracający wariant tej samej
                        reguły ścieżki co `.entity-path` (12 px, zwykły tekst) —
                        ma dodatkowo wielokropek, więc nie dokładamy klasy. */}
                    <span className="task-card-m-project">
                      {clientProjectPath(client?.name, project?.name)}
                    </span>
                    <span className="task-card-m-meta">
                      <span
                        className="task-card-m-dot"
                        style={{ background: status?.color }}
                        aria-hidden
                      />
                      <span className="sr-only">Status: {status?.name ?? '—'}</span>
                      <span className="task-card-m-hours">
                        zaplanowano {formatDuration(planned)}
                      </span>
                      {/* Awatary są ozdobą (`aria-hidden` w `Avatar`), więc
                          przypisania niesie osobny tekst dla czytnika. */}
                      <span className="sr-only">
                        {assignees.length === 0
                          ? 'Brak przypisanych osób'
                          : `Przypisani: ${assignees.map((p) => p.name).join(', ')}`}
                      </span>
                      <span className="task-card-m-avatars">
                        {avatars.shown.map((p) => (
                          <Avatar key={p.id} person={p} size={20} />
                        ))}
                        {avatars.extra > 0 && (
                          <span className="task-card-m-more" aria-hidden>
                            +{avatars.extra}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  {/* Wyzwalacz arkusza jest RODZEŃSTWEM karty-przycisku —
                      zagnieżdżony `<button>` to nielegalny HTML. */}
                  <div className="card-actions task-card-m-actions">
                    <IconButton
                      ref={(node) => {
                        if (node !== null && detailsTaskId === task.id)
                          detailsTriggerRef.current = node;
                      }}
                      icon={<MoreHorizontal size={16} aria-hidden />}
                      onClick={() => setDetailsTaskId(task.id)}
                      label={`Szczegóły zadania: ${task.title}`}
                      tooltip="Szczegóły zadania"
                      haspopup="dialog"
                      expanded={detailsTaskId === task.id}
                    />
                    {canManageTasks && (
                      // Bez `.task-delete` (margines dla wariantu desktopowego)
                      // — na telefonie odstępy trzyma `.task-card-m-actions`.
                      <IconButton
                        variant="danger"
                        icon={<X size={16} aria-hidden />}
                        onClick={() => handleDelete(task.id, task.title)}
                        label={`Usuń ${task.title}`}
                        tooltip="Usuń"
                      />
                    )}
                  </div>
                </li>
              );
            }
            return (
              <li key={task.id} className="task-card" data-priority={task.priority}>
                <button
                  type="button"
                  className="task-card-main"
                  onClick={() => openTask(task.id)}
                >
                  {/* Maks. dwa akcenty kolorystyczne w wierszu: obrysowana
                      pigułka = edytowalny status, reszta to zwykły tekst albo
                      pasek. Priorytet i stan rozplanowania zeszły z pigułek. */}
                  <div className="task-card-top">
                    <span className="task-title">{task.title}</span>
                    <StatusBadge status={getStatus(state, task.statusId)} />
                    {task.priority !== 'normal' && (
                      <span className="sr-only">Priorytet: {PRIORITY_LABELS[task.priority]}</span>
                    )}
                    {category && <span className="muted task-category">{category.name}</span>}
                    {project && (
                      <span className="entity-path">
                        <Coin paid={project.paid} size={13} />
                        {clientProjectPath(client?.name, project.name)}
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
                    <PlanningProgress
                      planned={planned}
                      estimate={task.estimatedHours ?? null}
                      status={taskPlanningStatus(state, task.id)}
                    />
                    {checklist && (
                      <span className="muted task-checklist-progress">
                        <span className="task-checklist-glyphs" aria-hidden>
                          {checklist.pattern}
                        </span>{' '}
                        {checklist.text}
                        <span className="sr-only"> — {checklist.label}</span>
                      </span>
                    )}
                  </div>
                  <ChevronRight className="card-chevron" size={16} aria-hidden />
                </button>
                {canManageTasks && (
                  <div className="card-actions">
                    <IconButton
                      className="task-delete"
                      variant="danger"
                      icon={<X size={16} aria-hidden />}
                      onClick={() => handleDelete(task.id, task.title)}
                      label={`Usuń ${task.title}`}
                      tooltip="Usuń"
                    />
                  </div>
                )}
              </li>
            );
          })}
            </ul>
          )}
        </>
      )}

      {/* Arkusz szczegółów: JEDNA instancja na stronę, montowana tylko na
          telefonie. Scrim nie ma własnego handlera — zamknięcie „kliknięciem
          poza” i Escape obsługuje `useOverlay`, on też oddaje fokus wyzwalaczowi. */}
      {isMobileNav && detailsTask && (
        <OverlayLayer>
          <div className="app-sheet-scrim" aria-hidden />
          <div
            className="task-details-sheet"
            role="dialog"
            aria-label={`Szczegóły zadania: ${detailsTask.title}`}
            ref={detailsSheetRef}
          >
            <div className="app-sheet-handle" aria-hidden />
            <p className="task-details-title">{detailsTask.title}</p>
            {/* Arkusz jest powierzchnią SZCZEGÓŁÓW (odpowiednik modala), więc
                pigułka priorytetu tu zostaje; stan rozplanowania schodzi na
                pasek przy wierszu „Zaplanowano”, tak jak na liście. */}
            <div className="task-details-badges">
              <StatusBadge status={getStatus(state, detailsTask.statusId)} />
              {detailsTask.priority !== 'normal' && (
                <PriorityBadge priority={detailsTask.priority} />
              )}
              {detailsCategory && <span className="muted task-category">{detailsCategory.name}</span>}
              {detailsProject && (
                <span className="entity-path">
                  <Coin paid={detailsProject.paid} size={13} />
                  {clientProjectPath(detailsClient?.name, detailsProject.name)}
                </span>
              )}
            </div>
            <dl className="task-details-rows">
              <div className="task-details-row">
                <dt className="muted">Okres</dt>
                <dd>{rangeLabel(detailsTask.startDate, detailsTask.endDate)}</dd>
              </div>
              <div className="task-details-row">
                <dt className="muted">Zaplanowano</dt>
                <dd>
                  {formatDuration(detailsPlanned)}{' '}
                  <PlanningProgress
                    planned={detailsPlanned}
                    estimate={detailsTask.estimatedHours ?? null}
                    status={taskPlanningStatus(state, detailsTask.id)}
                    showHours={false}
                  />
                </dd>
              </div>
              {detailsTask.estimatedHours != null && (
                <div className="task-details-row">
                  <dt className="muted">Szacowane</dt>
                  <dd>{formatDuration(detailsTask.estimatedHours)}</dd>
                </div>
              )}
              {detailsTask.checklist.length > 0 && (
                <div className="task-details-row">
                  <dt className="muted">Lista kontrolna</dt>
                  <dd>
                    {detailsTask.checklist.filter((c) => c.done).length}/
                    {detailsTask.checklist.length}
                  </dd>
                </div>
              )}
            </dl>
            <button
              type="button"
              className="btn primary task-details-open"
              onClick={() => openFromDetails(detailsTask.id)}
            >
              Otwórz zadanie
            </button>
          </div>
        </OverlayLayer>
      )}
    </section>
  );
}
